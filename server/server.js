'use strict';
/* 存錢計畫的本機伺服器：同時提供網頁檔案與同步 API，資料存在 SQLite。
 * 需要 Node.js 22.13 以上（使用內建的 node:sqlite，不需要額外安裝套件）。
 *
 * 用法：
 *   node server/server.js add-user <帳號>     新增一位使用者（會提示輸入密碼）
 *   node server/server.js                    啟動伺服器（預設 127.0.0.1:8787）
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { DatabaseSync } = require('node:sqlite');
const C = require('../calc.js');

const ROOT = path.resolve(__dirname, '..');
const MAX_BODY = 30 * 1024 * 1024;
const SESSION_DAYS = 180;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const KEEP_BACKUPS = 14;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'saving-plan.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS docs (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
  `);
  return db;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function verifyPassword(password, salt, hash) {
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

function addUser(db, username, password) {
  if (!/^[A-Za-z0-9_.-]{2,32}$/.test(username)) {
    throw new Error('帳號只能用英文、數字、底線、點或減號，長度 2 到 32 個字');
  }
  if (password.length < 8) throw new Error('密碼至少要 8 個字');
  const { salt, hash } = hashPassword(password);
  db.prepare('INSERT INTO users (username, salt, hash, created_at) VALUES (?, ?, ?, ?)')
    .run(username, salt, hash, new Date().toISOString());
}

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('資料太大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('資料格式錯誤'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function createApp({ dataDir }) {
  const db = openDb(dataDir);
  const backupsDir = path.join(dataDir, 'backups');
  const failures = new Map();

  function tooManyFailures(ip) {
    const now = Date.now();
    const recent = (failures.get(ip) || []).filter(t => now - t < FAILURE_WINDOW_MS);
    failures.set(ip, recent);
    return recent.length >= MAX_FAILURES;
  }

  function recordFailure(ip) {
    failures.set(ip, [...(failures.get(ip) || []), Date.now()]);
  }

  function tokenOf(req) {
    const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization || '');
    return m ? m[1] : null;
  }

  function userOf(req) {
    const token = tokenOf(req);
    if (!token) return null;
    const row = db.prepare(`
      SELECT users.id, users.username, sessions.expires_at
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token = ?
    `).get(token);
    if (!row || row.expires_at < Date.now()) return null;
    return row;
  }

  // 每次備份都用 VACUUM INTO 產生完整的獨立檔案，並只保留最新的幾份
  function backup() {
    fs.mkdirSync(backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(backupsDir, `saving-plan-${stamp}.sqlite`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const files = fs.readdirSync(backupsDir)
      .filter(f => f.startsWith('saving-plan-') && f.endsWith('.sqlite'))
      .sort();
    for (const old of files.slice(0, -KEEP_BACKUPS)) fs.unlinkSync(path.join(backupsDir, old));
    return file;
  }

  async function handleApi(req, res, url) {
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = await readJson(req);
      const ip = req.socket.remoteAddress;
      if (tooManyFailures(ip)) return send(res, 429, { error: '嘗試次數太多，請 15 分鐘後再試' });
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(body.username || ''));
      if (!user || !verifyPassword(String(body.password || ''), user.salt, user.hash)) {
        recordFailure(ip);
        return send(res, 401, { error: '帳號或密碼錯誤' });
      }
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
        .run(token, user.id, Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
      return send(res, 200, { token, username: user.username });
    }

    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const token = tokenOf(req);
      if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return send(res, 200, { ok: true });
    }

    const user = userOf(req);
    if (!user) return send(res, 401, { error: '請先登入' });

    if (req.method === 'GET' && url.pathname === '/api/me') {
      return send(res, 200, { username: user.username });
    }

    if (url.pathname === '/api/doc' && req.method === 'GET') {
      const row = db.prepare('SELECT data FROM docs WHERE user_id = ?').get(user.id);
      return send(res, 200, { data: row ? JSON.parse(row.data) : null });
    }

    if (url.pathname === '/api/doc' && req.method === 'PUT') {
      const body = await readJson(req);
      if (!body.data || typeof body.data !== 'object') return send(res, 400, { error: '缺少資料' });
      // 伺服器端合併：兩台裝置同時同步也不會互相覆蓋
      const current = db.prepare('SELECT data FROM docs WHERE user_id = ?').get(user.id);
      const stored = current ? JSON.parse(current.data) : C.emptyDoc();
      const merged = C.mergeDocs(stored, body.data);
      db.prepare(`
        INSERT INTO docs (user_id, data, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
      `).run(user.id, JSON.stringify(merged), new Date().toISOString());
      return send(res, 200, { data: merged });
    }

    return send(res, 404, { error: '找不到這個 API' });
  }

  // 同時提供網頁檔案，手機與電腦都可以直接用伺服器的網址開啟
  function serveStatic(res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const parts = rel.split('/').filter(Boolean);
    const blocked = parts.some(p => p.startsWith('.') || ['server', 'tests', 'node_modules', 'supabase'].includes(p));
    const file = path.join(ROOT, ...parts);
    const type = TYPES[path.extname(file)];
    if (blocked || !type || !file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET') return send(res, 405, { error: '不支援的操作' });
      return serveStatic(res, url);
    } catch (err) {
      if (err.status) return send(res, err.status, { error: err.message });
      console.error(err);
      return send(res, 500, { error: '伺服器發生錯誤' });
    }
  });

  return {
    server,
    db,
    backup,
    close() {
      server.close();
      db.close();
    },
  };
}

function askPassword(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = () => {}; // 輸入時不顯示密碼
    process.stdout.write(question);
    rl.question('', answer => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

module.exports = { createApp, addUser, hashPassword, verifyPassword };

if (require.main === module) {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '127.0.0.1';

  if (process.argv[2] === 'add-user') {
    const username = process.argv[3];
    if (!username) {
      console.error('用法：node server/server.js add-user <帳號>');
      process.exit(1);
    }
    (async () => {
      const db = openDb(dataDir);
      const password = await askPassword(`為 ${username} 設定密碼：`);
      const again = await askPassword('再輸入一次：');
      if (password !== again) {
        console.error('兩次輸入的密碼不一樣');
        process.exit(1);
      }
      try {
        addUser(db, username, password);
        console.log(`已新增使用者 ${username}`);
      } catch (err) {
        console.error(err.message);
        process.exit(1);
      } finally {
        db.close();
      }
    })();
  } else {
    const app = createApp({ dataDir });
    app.backup();
    setInterval(app.backup, 24 * 60 * 60 * 1000).unref();
    app.server.listen(port, host, () => {
      console.log(`存錢計畫伺服器已啟動：http://${host}:${port}`);
      console.log(`資料位置：${dataDir}`);
    });
  }
}
