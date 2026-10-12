/* 雲端同步設定。填入 Supabase 專案的網址與 anon 金鑰後，各裝置的資料就會同步。
 * 還沒填的話，應用程式仍然可以使用，只是資料只存在這台裝置。
 * anon 金鑰可以公開放在網頁上，資料安全靠 supabase/schema.sql 的 RLS 規則保護。 */
window.SUPABASE_CONFIG = {
  url: 'https://YOUR-PROJECT.supabase.co',
  anonKey: 'YOUR-ANON-KEY',
};
