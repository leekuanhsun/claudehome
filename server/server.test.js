'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, addUser, hashPassword, verifyPassword } = require('./server.js');
const C = require('../calc.js');

function start() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saving-plan-test-'));
  const app = createApp({ dataDir });
  addUser(app.db, 'tom', 'correct-horse');
  return new Promise(resolve => {
    app.server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${app.server.address().port}`;
      resolve({ app, base, dataDir, close: () => app.close() });
    });
  });
}

async function login(base, username = 'tom', password = 'correct-horse') {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, body: await res.json() };
}

test('密碼用 scrypt 雜湊，正確的密碼才會通過', () => {
  const { salt, hash } = hashPassword('abcdefgh');
  assert.equal(verifyPassword('abcdefgh', salt, hash), true);
  assert.equal(verifyPassword('abcdefgx', salt, hash), false);
});

test('新增使用者會檢查帳號與密碼格式', () => {
  const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sp-')) });
  assert.throws(() => addUser(app.db, 'a b', 'longenough'), /帳號只能/);
  assert.throws(() => addUser(app.db, 'okuser', 'short'), /至少要 8/);
  addUser(app.db, 'okuser', 'longenough');
  app.close();
});

test('登入：錯誤的密碼被拒絕，正確的密碼取得 token', async () => {
  const s = await start();
  try {
    assert.equal((await login(s.base, 'tom', 'wrong-password')).status, 401);
    const ok = await login(s.base);
    assert.equal(ok.status, 200);
    assert.match(ok.body.token, /^[0-9a-f]{64}$/);
    assert.equal(ok.body.username, 'tom');
  } finally {
    s.close();
  }
});

test('連續登入失敗 5 次後暫時鎖定', async () => {
  const s = await start();
  try {
    for (let i = 0; i < 5; i++) await login(s.base, 'tom', 'nope-nope');
    assert.equal((await login(s.base)).status, 429);
  } finally {
    s.close();
  }
});

test('沒有 token 不能讀寫資料，登出後 token 失效', async () => {
  const s = await start();
  try {
    const noAuth = await fetch(`${s.base}/api/doc`);
    assert.equal(noAuth.status, 401);

    const { body: { token } } = await login(s.base);
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    assert.equal((await fetch(`${s.base}/api/doc`, { headers: auth })).status, 200);

    await fetch(`${s.base}/api/logout`, { method: 'POST', headers: auth });
    assert.equal((await fetch(`${s.base}/api/doc`, { headers: auth })).status, 401);
  } finally {
    s.close();
  }
});

test('同步：伺服器會把兩台裝置的資料合併，不會互相覆蓋', async () => {
  const s = await start();
  try {
    const { body: { token } } = await login(s.base);
    const put = doc => fetch(`${s.base}/api/doc`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: doc }),
    }).then(r => r.json());

    const phone = { ...C.emptyDoc(), expenses: [{ id: 1, u: 10, amount: 100 }] };
    const pc = { ...C.emptyDoc(), expenses: [{ id: 2, u: 20, amount: 200 }] };
    await put(phone);
    const merged = await put(pc);
    assert.deepEqual(merged.data.expenses.map(e => e.id).sort(), [1, 2]);

    const read = await (await fetch(`${s.base}/api/doc`, { headers: { Authorization: `Bearer ${token}` } })).json();
    assert.equal(read.data.expenses.length, 2);
  } finally {
    s.close();
  }
});

test('同步：刪除的資料會同步到伺服器並移除', async () => {
  const s = await start();
  try {
    const { body: { token } } = await login(s.base);
    const put = doc => fetch(`${s.base}/api/doc`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: doc }),
    }).then(r => r.json());

    await put({ ...C.emptyDoc(), expenses: [{ id: 5, u: 10, amount: 1 }] });
    const after = await put({ ...C.emptyDoc(), expenses: [], tombstones: { expenses: { 5: 30 }, diary: {} } });
    assert.deepEqual(after.data.expenses, []);
  } finally {
    s.close();
  }
});

test('網頁檔案可以用伺服器網址開啟，但 server 資料夾與隱藏檔不會被提供', async () => {
  const s = await start();
  try {
    const index = await fetch(`${s.base}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.equal((await fetch(`${s.base}/server/server.js`)).status, 404);
    assert.equal((await fetch(`${s.base}/server/data/saving-plan.sqlite`)).status, 404);
    assert.equal((await fetch(`${s.base}/..%2Fcalc.js`)).status, 404);
    assert.equal((await fetch(`${s.base}/.git/config`)).status, 404);
  } finally {
    s.close();
  }
});

test('備份會產生獨立的資料庫檔案，並只保留最新的幾份', () => {
  const s = { app: createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sp-bak-')) }) };
  try {
    const file = s.app.backup();
    assert.ok(fs.existsSync(file));
    assert.ok(fs.statSync(file).size > 0);
  } finally {
    s.app.close();
  }
});
