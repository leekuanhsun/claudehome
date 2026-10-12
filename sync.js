/* 雲端同步的傳輸層：連到本機伺服器（server/server.js），登入後交換整份資料。
 * 合併規則在 calc.js（伺服器也用同一份），何時同步在 app.js。 */
(function () {
  'use strict';

  const KEY_SERVER = 'savingPlan.v2.server';
  const KEY_AUTH = 'savingPlan.v2.auth';

  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  // 伺服器網址：使用者填的優先；網頁是由伺服器自己提供時用同一個網址；
  // 在 GitHub Pages 上沒填網址就視為未設定
  function serverBase() {
    const saved = readStorage(KEY_SERVER);
    if (saved !== null) return saved.replace(/\/+$/, '');
    return location.hostname.endsWith('github.io') ? null : '';
  }

  function auth() {
    try {
      return JSON.parse(readStorage(KEY_AUTH) || 'null');
    } catch {
      return null;
    }
  }

  function setAuth(value) {
    try {
      if (value) localStorage.setItem(KEY_AUTH, JSON.stringify(value));
      else localStorage.removeItem(KEY_AUTH);
    } catch {
      // 無痕模式等情況無法寫入時，只是這次不記住登入
    }
  }

  async function request(method, path, body) {
    const base = serverBase();
    if (base === null) throw new Error('尚未設定伺服器網址');
    const headers = { 'Content-Type': 'application/json' };
    const current = auth();
    if (current) headers.Authorization = `Bearer ${current.token}`;
    const res = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && current) {
      setAuth(null);
      throw new Error('登入已過期，請重新登入');
    }
    if (!res.ok) throw new Error(json.error || `伺服器錯誤（${res.status}）`);
    return json;
  }

  window.SavingPlanCloud = {
    get configured() {
      return serverBase() !== null;
    },
    get serverUrl() {
      const saved = readStorage(KEY_SERVER);
      return saved !== null ? saved : '';
    },
    setServer(url) {
      const clean = String(url || '').trim().replace(/\/+$/, '');
      if (clean && !/^https?:\/\//.test(clean)) throw new Error('網址要以 http:// 或 https:// 開頭');
      localStorage.setItem(KEY_SERVER, clean);
    },
    currentUser() {
      const current = auth();
      return current ? { username: current.username } : null;
    },
    async signIn(username, password) {
      const res = await request('POST', '/api/login', { username, password });
      setAuth({ token: res.token, username: res.username });
    },
    async signOut() {
      try {
        await request('POST', '/api/logout', {});
      } catch {
        // 伺服器連不上時仍然清除本機的登入狀態
      }
      setAuth(null);
    },
    // 把本機資料送到伺服器，伺服器合併後回傳最新的整份資料
    async exchange(doc) {
      const res = await request('PUT', '/api/doc', { data: doc });
      return res.data;
    },
  };
})();
