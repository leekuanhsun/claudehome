/* 雲端同步的傳輸層：登入、讀取與寫入整份資料。合併規則在 calc.js，何時同步在 app.js。 */
(function () {
  'use strict';

  const cfg = window.SUPABASE_CONFIG || {};
  // 套件載入失敗（例如離線）或設定還沒填，就停用同步，本機功能照常運作
  const configured = !!cfg.url && !!cfg.anonKey && !cfg.url.includes('YOUR-PROJECT') && !!window.supabase;
  const TABLE = 'saving_plan_docs';
  let client = null;

  function getClient() {
    if (!configured || !window.supabase) return null;
    if (!client) {
      client = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: true, detectSessionInUrl: true },
      });
    }
    return client;
  }

  async function currentUser() {
    const sb = getClient();
    if (!sb) return null;
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    return data.session ? data.session.user : null;
  }

  // 寄送登入連結到信箱，點擊後會回到目前的頁面
  async function signIn(email) {
    const sb = getClient();
    if (!sb) throw new Error('尚未設定雲端同步');
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.href.split('#')[0] },
    });
    if (error) throw error;
  }

  async function signOut() {
    const sb = getClient();
    if (sb) await sb.auth.signOut();
  }

  async function fetchDoc(user) {
    const { data, error } = await getClient()
      .from(TABLE)
      .select('data')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    return data ? data.data : null;
  }

  async function pushDoc(user, doc) {
    const { error } = await getClient()
      .from(TABLE)
      .upsert({ user_id: user.id, data: doc, updated_at: new Date().toISOString() });
    if (error) throw error;
  }

  window.SavingPlanCloud = {
    configured,
    currentUser,
    signIn,
    signOut,
    fetchDoc,
    pushDoc,
  };
})();
