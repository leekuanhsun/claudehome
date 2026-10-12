/* 雲端同步的傳輸層：用 Supabase 登入，並把整份資料與雲端合併後寫回。
 * 合併規則在 calc.js（mergeDocs），何時同步在 app.js。 */
(function () {
  'use strict';

  const cfg = window.SUPABASE_CONFIG || {};
  // 設定還沒填、或套件載入失敗（例如離線），就停用同步，本機功能照常運作
  const configured = !!cfg.url && !!cfg.anonKey && !cfg.url.includes('YOUR-PROJECT') && !!window.supabase;
  const TABLE = 'saving_plan_docs';
  const KEY_ACCOUNT = 'savingPlan.v2.account';
  let client = null;

  function getClient() {
    if (!configured) return null;
    if (!client) {
      client = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
    }
    return client;
  }

  function cachedAccount() {
    try {
      return JSON.parse(localStorage.getItem(KEY_ACCOUNT) || 'null');
    } catch {
      return null;
    }
  }

  window.SavingPlanCloud = {
    get configured() {
      return configured;
    },
    currentUser() {
      return cachedAccount();
    },
    async signIn(email, password) {
      const sb = getClient();
      if (!sb) throw new Error('尚未設定雲端同步');
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? '電子郵件或密碼錯誤' : error.message);
      localStorage.setItem(KEY_ACCOUNT, JSON.stringify({ username: data.user.email, id: data.user.id }));
    },
    async signOut() {
      const sb = getClient();
      if (sb) await sb.auth.signOut();
      localStorage.removeItem(KEY_ACCOUNT);
    },
    // 讀取雲端的文件 → 與本機合併 → 寫回雲端，回傳合併後的整份資料
    async exchange(doc) {
      const sb = getClient();
      const account = cachedAccount();
      const { data: sessionData } = await sb.auth.getSession();
      if (!account || !sessionData.session) {
        localStorage.removeItem(KEY_ACCOUNT);
        throw new Error('登入已過期，請重新登入');
      }
      const { data: row, error: readError } = await sb.from(TABLE)
        .select('data').eq('user_id', account.id).maybeSingle();
      if (readError) throw readError;
      const merged = window.SavingPlanCalc.mergeDocs(doc, row ? row.data : window.SavingPlanCalc.emptyDoc());
      const { error: writeError } = await sb.from(TABLE)
        .upsert({ user_id: account.id, data: merged, updated_at: new Date().toISOString() });
      if (writeError) throw writeError;
      return merged;
    },
  };
})();
