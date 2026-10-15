'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calc.js');

// 測試用的範例數字（預設值已全部歸零，由使用者自行輸入）
const example = { income: 30000, loan: 15500, workdays: 22, dailyLimit: 300, outing: 2000, cardPay: 5000, cardBalance: 30000 };
const base = { ...example };

test('plan：預設值的計算結果', () => {
  // 工作日生活費 22*300=6600；剩餘 30000-15500-6600-2000-5000=900
  const p = C.plan(base, '2026-10');
  assert.equal(p.dailyBudget, 6600);
  assert.equal(p.leftover, 900);
  assert.equal(p.cardMonths, 6);
  assert.equal(p.buffer, 900);
  assert.equal(p.afterSave, 5000);
  assert.equal(p.payoff, '2027-04');
  // 前 6 個月存 900，之後 6 個月存 5000
  assert.equal(p.year, 6 * 900 + 6 * 5000);
});

test('plan：沒有信用卡分期時，剩餘金額直接存下', () => {
  const p = C.plan({ ...base, cardPay: 0, cardBalance: 0 }, '2026-10');
  assert.equal(p.cardMonths, 0);
  assert.equal(p.payoff, null);
  assert.equal(p.afterSave, p.buffer);
  assert.equal(p.year, 12 * p.buffer);
});

test('plan：信用卡本金為 0 時視為已繳清，不再扣月付金額', () => {
  const p = C.plan({ ...base, cardBalance: 0 }, '2026-10');
  assert.equal(p.cardPay, 0);
  assert.equal(p.leftover, 5900); // 30000-15500-6600-2000
  assert.equal(p.cardMonths, 0);
  assert.equal(p.buffer, 5900);
  assert.equal(p.afterSave, 5900);
});

test('plan：固定支出超過薪水時，剩餘金額為負但緩衝不為負', () => {
  const p = C.plan({ ...base, income: 20000 }, '2026-10');
  assert.equal(p.leftover, -9100);
  assert.equal(p.buffer, 0);
});

test('plan：分期本金不能整除月付時，最後一期仍算一個月', () => {
  const p = C.plan({ ...base, cardPay: 4000, cardBalance: 9000 }, '2026-10');
  assert.equal(p.cardMonths, 3);
});

test('addMonths：跨年份', () => {
  assert.equal(C.addMonths('2026-11', 3), '2027-02');
  assert.equal(C.addMonths('2026-01', -1), '2025-12');
});

test('validateSettings：合法輸入', () => {
  const r = C.validateSettings({ ...base, income: '32000' });
  assert.equal(r.ok, true);
  assert.equal(r.values.income, 32000);
});

test('validateSettings：空白、非數字、超出範圍都會回傳欄位名稱', () => {
  assert.deepEqual(
    pick(C.validateSettings({ ...base, loan: '' })),
    ['loan'],
  );
  assert.deepEqual(
    pick(C.validateSettings({ ...base, workdays: 32 })),
    ['workdays'],
  );
  assert.deepEqual(
    pick(C.validateSettings({ ...base, outing: 'abc' })),
    ['outing'],
  );
});

test('sanitizeSettings：壞掉的儲存資料退回預設值', () => {
  const s = C.sanitizeSettings({ income: 'bad', loan: -5, workdays: 22, dailyLimit: 400 });
  assert.equal(s.income, C.DEFAULTS.income);
  assert.equal(s.loan, C.DEFAULTS.loan);
  assert.equal(s.workdays, 22);
  assert.equal(s.dailyLimit, 400);
  assert.deepEqual(C.sanitizeSettings(null), C.DEFAULTS);
});

test('buildExpense：金額四捨五入到分、備註去頭尾空白並截斷', () => {
  const r = C.buildExpense({
    date: '2026-10-11',
    amount: '185.567',
    category: '餐飲',
    note: `  ${'x'.repeat(600)}  `,
  }, 1);
  assert.equal(r.ok, true);
  assert.equal(r.expense.amount, 185.57);
  assert.equal(r.expense.note.length, C.MAX_NOTE);
});

test('buildExpense：拒絕無效日期與金額', () => {
  assert.equal(C.buildExpense({ date: '', amount: '1', category: '餐飲' }, 1).field, 'date');
  assert.equal(C.buildExpense({ date: '2026-10-11', amount: '', category: '餐飲' }, 1).field, 'amount');
  assert.equal(C.buildExpense({ date: '2026-10-11', amount: '0', category: '餐飲' }, 1).field, 'amount');
  assert.equal(C.buildExpense({ date: '2026-10-11', amount: '0.001', category: '餐飲' }, 1).field, 'amount');
  assert.equal(C.buildExpense({ date: '2026-10-11', amount: '-5', category: '餐飲' }, 1).field, 'amount');
});

test('buildExpense：未知類別歸為「其他」', () => {
  const r = C.buildExpense({ date: '2026-10-11', amount: '10', category: '亂填' }, 1);
  assert.equal(r.expense.category, '其他');
});

test('isValidExpense：過濾損壞的儲存資料', () => {
  assert.equal(C.isValidExpense({ id: 1, date: '2026-10-11', amount: 10, category: '餐飲' }), true);
  assert.equal(C.isValidExpense({ id: '1', date: '2026-10-11', amount: 10, category: '餐飲' }), false);
  assert.equal(C.isValidExpense({ id: 1, date: '2026/10/11', amount: 10, category: '餐飲' }), false);
  assert.equal(C.isValidExpense({ id: 1, date: '2026-10-11', amount: 0, category: '餐飲' }), false);
  assert.equal(C.isValidExpense(null), false);
});

test('monthSummary：聚會與生活費分開計算', () => {
  const expenses = [
    { id: 1, date: '2026-10-01', amount: 100, category: '餐飲', note: '' },
    { id: 2, date: '2026-10-02', amount: 500, category: C.OUTING, note: '' },
    { id: 3, date: '2026-09-30', amount: 999, category: '交通', note: '' },
  ];
  const m = C.monthSummary(expenses, '2026-10');
  assert.equal(m.life, 100);
  assert.equal(m.outing, 500);
  assert.equal(m.total, 600);
  assert.deepEqual(m.categories, [['餐飲', 100], [C.OUTING, 500]]);
  assert.equal(m.list.length, 2);
});

test('daySummary：超過每日上限時剩餘為負，且不計入聚會', () => {
  const expenses = [
    { id: 1, date: '2026-10-11', amount: 200, category: '餐飲', note: '' },
    { id: 2, date: '2026-10-11', amount: 200, category: '交通', note: '' },
    { id: 3, date: '2026-10-11', amount: 900, category: C.OUTING, note: '' },
  ];
  const d = C.daySummary(expenses, '2026-10-11', 300);
  assert.equal(d.spent, 400);
  assert.equal(d.remain, -100);
  assert.ok(d.percent > 100);
});

test('percentOf：預算為 0 的處理', () => {
  assert.equal(C.percentOf(0, 0), 0);
  assert.equal(C.percentOf(50, 0), 100);
  assert.equal(C.percentOf(50, 200), 25);
});

test('toCsv：加上 BOM、跳脫引號、防止試算表公式注入', () => {
  const csv = C.toCsv([
    { id: 1, date: '2026-10-01', amount: 10, category: '其他', note: '=HYPERLINK("x")' },
  ]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(csv.startsWith('﻿"日期","類別","餐別／細項","付款方式","備註","金額（台幣）","幣別","原幣金額","收支"'));
});

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('buildExpense：細項去掉空白與重複，過長的名稱會被丟掉', () => {
  const r = C.buildExpense({
    date: '2026-10-12', amount: '120', category: '交通',
    meals: [' 加油 ', '加油', '這個名稱實在太長了不行', '車票'],
  }, 1);
  assert.deepEqual(r.expense.meals, ['加油', '車票']);
});

test('tagsFor：預設細項在前，自訂細項接在後，不重複', () => {
  const custom = { 交通: ['洗車', '加油'] };
  assert.deepEqual(C.tagsFor('交通', custom), ['保養', '加油', '車票', '洗車']);
  assert.deepEqual(C.tagsFor('餐飲', custom), C.PRESET_TAGS['餐飲']);
  assert.deepEqual(C.tagsFor('購物', custom), []);
});

test('addCustomTag：新增成功，並寫入對應類別', () => {
  const r = C.addCustomTag({}, '交通', ' 洗車 ');
  assert.equal(r.ok, true);
  assert.equal(r.name, '洗車');
  assert.deepEqual(r.customTags, { 交通: ['洗車'] });
});

test('addCustomTag：空白、太長、重複、超過數量都會被擋下', () => {
  assert.equal(C.addCustomTag({}, '交通', '   ').ok, false);
  assert.equal(C.addCustomTag({}, '交通', 'x'.repeat(C.MAX_TAG_LEN + 1)).ok, false);
  assert.equal(C.addCustomTag({}, '交通', '加油').ok, false, '預設細項不能重複新增');
  const full = { 交通: Array.from({ length: 20 }, (_, i) => `項${i}`) };
  assert.equal(C.addCustomTag(full, '交通', '新的').ok, false);
});

test('addCustomTag：同名細項在不同類別可以各自存在', () => {
  const r = C.addCustomTag({ 購物: ['保養'] }, '交通', '保養');
  assert.equal(r.ok, false, '交通已有預設的保養，應該擋下');
  const other = C.addCustomTag({}, '購物', '保養');
  assert.equal(other.ok, true);
});

test('removeCustomTag：只移除指定類別的細項', () => {
  const r = C.removeCustomTag({ 交通: ['洗車', '停車'], 購物: ['洗車'] }, '交通', '洗車');
  assert.deepEqual(r, { 交通: ['停車'], 購物: ['洗車'] });
});

test('sanitizeCustomTags：忽略名稱不合法的類別與不合法的資料', () => {
  const s = C.sanitizeCustomTags({
    交通: ['洗車', '洗車', '  ', 'x'.repeat(50)],
    ['x'.repeat(20)]: ['abc'],
    餐飲: 'not-an-array',
  });
  assert.deepEqual(s, { 交通: ['洗車'] });
  assert.deepEqual(C.sanitizeCustomTags(null), {});
});

test('buildExpense：照片只接受圖片 data URL，最多 3 張', () => {
  const r = C.buildExpense({
    date: '2026-10-12', amount: '120', category: '餐飲',
    photos: [PNG, 'javascript:alert(1)', PNG, PNG, PNG],
  }, 1);
  assert.equal(r.expense.photos.length, C.MAX_PHOTOS);
  assert.ok(r.expense.photos.every(p => p.startsWith('data:image/')));
});

test('buildExpense：超過大小上限的照片會被丟掉', () => {
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(C.MAX_PHOTO_CHARS);
  const r = C.buildExpense({ date: '2026-10-12', amount: '120', category: '餐飲', photos: [big] }, 1);
  assert.deepEqual(r.expense.photos, []);
});

test('buildExpense：位置需為有效經緯度，並取到約 1 公尺精度', () => {
  const ok = C.buildExpense({
    date: '2026-10-12', amount: '120', category: '餐飲',
    location: { lat: 25.0330123456, lng: 121.5654987654 },
  }, 1);
  assert.deepEqual(ok.expense.location, { lat: 25.03301, lng: 121.56550 });

  const bad = C.buildExpense({
    date: '2026-10-12', amount: '120', category: '餐飲',
    location: { lat: 95, lng: 121 },
  }, 1);
  assert.equal(bad.expense.location, null);
});

test('buildExpense：沒有填的選填欄位有預設值', () => {
  const r = C.buildExpense({ date: '2026-10-12', amount: '120', category: '餐飲' }, 1);
  assert.deepEqual(r.expense.meals, []);
  assert.deepEqual(r.expense.photos, []);
  assert.equal(r.expense.location, null);
  assert.equal(r.expense.note, '');
});

test('buildExpense：心得最多 500 字', () => {
  const r = C.buildExpense({ date: '2026-10-12', amount: '120', category: '餐飲', note: 'x'.repeat(600) }, 1);
  assert.equal(r.expense.note.length, 500);
});

test('toCsv：餐別以頓號串接，舊資料沒有餐別也不會出錯', () => {
  const csv = C.toCsv([
    { id: 1, date: '2026-10-01', amount: 10, category: '餐飲', meals: ['早餐', '下午茶'], note: '' },
    { id: 2, date: '2026-10-02', amount: 20, category: '交通', note: 'old' },
  ]);
  assert.ok(csv.includes('"早餐、下午茶"'));
  assert.ok(csv.includes('"2026-10-02","交通","","","old","20"'));
});

test('buildDiary：心情只接受固定選項，沒選就是 null', () => {
  assert.equal(C.buildDiary({ date: '2026-10-12', mood: '😊', text: 'hi' }, 1).entry.mood, '😊');
  assert.equal(C.buildDiary({ date: '2026-10-12', mood: 'x', text: 'hi' }, 1).entry.mood, null);
  assert.equal(C.buildDiary({ date: '2026-10-12', text: 'hi' }, 1).entry.mood, null);
});

test('buildDiary：內容或照片至少要有一樣', () => {
  const empty = C.buildDiary({ date: '2026-10-12', text: '   ' }, 1);
  assert.equal(empty.ok, false);
  assert.equal(empty.field, 'text');
  const photoOnly = C.buildDiary({ date: '2026-10-12', text: '', photos: [PNG] }, 1);
  assert.equal(photoOnly.ok, true);
});

test('buildDiary：照片最多 4 張，內容最多 1000 字', () => {
  const r = C.buildDiary({
    date: '2026-10-12', text: 'x'.repeat(1200),
    photos: [PNG, PNG, PNG, PNG, PNG, PNG],
  }, 1);
  assert.equal(r.entry.photos.length, C.MAX_DIARY_PHOTOS);
  assert.equal(r.entry.text.length, C.MAX_DIARY_TEXT);
});

test('buildDiary：日期格式錯誤會被拒絕', () => {
  const r = C.buildDiary({ date: '2026/10/12', text: 'hi' }, 1);
  assert.equal(r.ok, false);
  assert.equal(r.field, 'date');
});

test('monthDiary：只取指定月份，且最新的在前', () => {
  const entries = [
    { id: 1, date: '2026-10-01', text: 'a' },
    { id: 2, date: '2026-10-12', text: 'b' },
    { id: 3, date: '2026-09-30', text: 'c' },
    { id: 4, date: '2026-10-12', text: 'd' },
  ];
  const list = C.monthDiary(entries, '2026-10');
  assert.deepEqual(list.map(e => e.id), [4, 2, 1]);
});

function pick(r) {
  return r.ok ? [] : [r.field];
}

/* ---------- 雲端同步合併 ---------- */

test('mergeDocs：兩邊各自新增的資料會合併在一起', () => {
  const local = { ...C.emptyDoc(), expenses: [{ id: 1, u: 10, amount: 100 }] };
  const remote = { ...C.emptyDoc(), expenses: [{ id: 2, u: 20, amount: 200 }] };
  const m = C.mergeDocs(local, remote);
  assert.deepEqual(m.expenses.map(e => e.id).sort(), [1, 2]);
});

test('mergeDocs：同一筆資料取修改時間較新的版本', () => {
  const local = { ...C.emptyDoc(), expenses: [{ id: 1, u: 10, amount: 100 }] };
  const remote = { ...C.emptyDoc(), expenses: [{ id: 1, u: 30, amount: 150 }] };
  const m = C.mergeDocs(local, remote);
  assert.equal(m.expenses.length, 1);
  assert.equal(m.expenses[0].amount, 150);
  assert.equal(C.mergeDocs(remote, local).expenses[0].amount, 150, '順序不影響結果');
});

test('mergeDocs：一邊刪除的資料會從合併結果移除', () => {
  const local = { ...C.emptyDoc(), expenses: [], tombstones: { expenses: { 1: 50 }, diary: {} } };
  const remote = { ...C.emptyDoc(), expenses: [{ id: 1, u: 10, amount: 100 }] };
  const m = C.mergeDocs(local, remote);
  assert.deepEqual(m.expenses, []);
  assert.equal(m.tombstones.expenses[1], 50, '刪除記錄會保留，讓之後的同步也能刪掉');
});

test('mergeDocs：刪除之後又重新編輯的資料會保留', () => {
  const local = { ...C.emptyDoc(), expenses: [], tombstones: { expenses: { 1: 50 }, diary: {} } };
  const remote = { ...C.emptyDoc(), expenses: [{ id: 1, u: 80, amount: 100 }] };
  assert.equal(C.mergeDocs(local, remote).expenses.length, 1);
});

test('mergeDocs：設定與細項取較新的一份', () => {
  const local = { ...C.emptyDoc(), settings: { u: 5, v: { ...C.DEFAULTS, income: 1 } } };
  const remote = { ...C.emptyDoc(), settings: { u: 9, v: { ...C.DEFAULTS, income: 2 } }, tags: { u: 3, v: { 交通: ['洗車'] } } };
  const m = C.mergeDocs(local, remote);
  assert.equal(m.settings.v.income, 2);
  assert.deepEqual(m.tags.v, { 交通: ['洗車'] });
});

test('mergeDocs：日記也會合併與刪除', () => {
  const local = { ...C.emptyDoc(), diary: [{ id: 7, u: 40, text: 'a' }] };
  const remote = { ...C.emptyDoc(), diary: [{ id: 8, u: 41, text: 'b' }], tombstones: { expenses: {}, diary: { 7: 45 } } };
  const m = C.mergeDocs(local, remote);
  assert.deepEqual(m.diary.map(d => d.id), [8]);
});

test('mergeDocs：空的或缺欄位的文件不會出錯', () => {
  const m = C.mergeDocs({}, { expenses: [{ id: 1, u: 1 }] });
  assert.equal(m.expenses.length, 1);
  assert.deepEqual(m.diary, []);
});

test('buildExpense：付款方式只接受固定選項，沒選就是現金', () => {
  assert.equal(C.buildExpense({ date: '2026-10-12', amount: '10', category: '餐飲', pay: '中信刷卡' }, 1).expense.pay, '中信刷卡');
  assert.equal(C.buildExpense({ date: '2026-10-12', amount: '10', category: '餐飲', pay: '亂填' }, 1).expense.pay, '現金');
  assert.equal(C.buildExpense({ date: '2026-10-12', amount: '10', category: '餐飲' }, 1).expense.pay, '現金');
});

test('monthSummary：依付款方式統計，沒有付款方式的歸為未記錄', () => {
  const expenses = [
    { id: 1, date: '2026-10-01', amount: 100, category: '餐飲', pay: '現金', note: '' },
    { id: 2, date: '2026-10-02', amount: 300, category: '購物', pay: '國泰刷卡', note: '' },
    { id: 3, date: '2026-10-03', amount: 50, category: '交通', note: '' },
  ];
  const m = C.monthSummary(expenses, '2026-10');
  assert.deepEqual(m.pays, [['現金', 100], ['國泰刷卡', 300], ['未記錄', 50]]);
});

/* ---------- 幣別與匯率 ---------- */

test('buildExpense：台幣直接記錄，外幣依匯率換算成台幣並保留原幣金額', () => {
  const twd = C.buildExpense({ date: '2026-10-12', amount: '250', category: '餐飲' }, 1).expense;
  assert.equal(twd.amount, 250);
  assert.equal(twd.currency, 'TWD');
  assert.equal(twd.origAmount, 250);
  assert.equal(twd.rate, 1);

  const usd = C.buildExpense({ date: '2026-10-12', amount: '10.5', category: '購物', currency: 'USD', rate: 31.2 }, 2).expense;
  assert.equal(usd.amount, 328, '10.5 × 31.2 = 327.6，四捨五入為 328');
  assert.equal(usd.currency, 'USD');
  assert.equal(usd.origAmount, 10.5);
  assert.equal(usd.rate, 31.2);
});

test('buildExpense：外幣沒有匯率時拒絕，不會默默記成 0 元', () => {
  const r = C.buildExpense({ date: '2026-10-12', amount: '10', category: '購物', currency: 'JPY' }, 1);
  assert.equal(r.ok, false);
  assert.equal(r.field, 'currency');
  const bad = C.buildExpense({ date: '2026-10-12', amount: '10', category: '購物', currency: 'JPY', rate: 0 }, 1);
  assert.equal(bad.ok, false);
});

test('buildExpense：不認識的幣別當成台幣', () => {
  const r = C.buildExpense({ date: '2026-10-12', amount: '10', category: '餐飲', currency: 'XYZ' }, 1);
  assert.equal(r.expense.currency, 'TWD');
});

test('parseFx：把「每台幣換多少外幣」轉成「每外幣值多少台幣」', () => {
  const fx = C.parseFx({
    result: 'success',
    time_last_update_utc: 'Mon, 12 Oct 2026 00:00:01 +0000',
    rates: { TWD: 1, USD: 0.032, JPY: 4.8 },
  }, 1000);
  assert.equal(fx.fetchedAt, 1000);
  assert.equal(fx.twdPer.TWD, 1);
  assert.equal(fx.twdPer.USD, 31.25);
  assert.equal(fx.twdPer.JPY, 0.2083);
  assert.equal(fx.twdPer.EUR, undefined, '沒有回傳的幣別不會出現');
});

test('parseFx：回應不是成功時回傳 null', () => {
  assert.equal(C.parseFx({ result: 'error' }), null);
  assert.equal(C.parseFx(null), null);
  assert.equal(C.parseFx({ result: 'success' }), null);
});

test('fxIsStale：超過 12 小時或沒有資料就要重新取得', () => {
  const now = 100 * 60 * 60 * 1000;
  assert.equal(C.fxIsStale(null, now), true);
  assert.equal(C.fxIsStale({ fetchedAt: now - 60 * 1000 }, now), false);
  assert.equal(C.fxIsStale({ fetchedAt: now - 13 * 60 * 60 * 1000 }, now), true);
});

test('toCsv：有幣別時附上原幣金額', () => {
  const csv = C.toCsv([
    { id: 1, date: '2026-10-01', amount: 328, category: '購物', note: '', currency: 'USD', origAmount: 10.5 },
  ]);
  assert.ok(csv.includes('"328","USD","10.5"'));
});

/* ---------- 同一帳號下的多位使用者 ---------- */

test('normalizeAccount：舊格式會變成 p1「我」', () => {
  const a = C.normalizeAccount({ ...C.emptyDoc(), expenses: [{ id: 1, u: 1 }] });
  assert.deepEqual(a.list, [{ id: 'p1', name: '我' }]);
  assert.equal(a.profiles.p1.expenses.length, 1);
});

test('mergeAccountDocs：兩台裝置各自的使用者會合併，各使用者的資料互不影響', () => {
  const local = { list: [{ id: 'a', name: '爸爸' }], profiles: { a: { ...C.emptyDoc(), expenses: [{ id: 1, u: 10, amount: 1 }] } } };
  const remote = {
    list: [{ id: 'a', name: '爸爸' }, { id: 'b', name: '媽媽' }],
    profiles: { a: C.emptyDoc(), b: { ...C.emptyDoc(), expenses: [{ id: 2, u: 20, amount: 2 }] } },
  };
  const m = C.mergeAccountDocs(local, remote);
  assert.deepEqual(m.list.map(p => p.id).sort(), ['a', 'b']);
  assert.deepEqual(m.profiles.a.expenses.map(e => e.id), [1]);
  assert.deepEqual(m.profiles.b.expenses.map(e => e.id), [2]);
});

test('mergeAccountDocs：可以合併舊格式的雲端資料', () => {
  const m = C.mergeAccountDocs({ list: [], profiles: {} }, { ...C.emptyDoc(), expenses: [{ id: 3, u: 1 }] });
  assert.deepEqual(m.list, [{ id: 'p1', name: '我' }]);
  assert.deepEqual(m.profiles.p1.expenses.map(e => e.id), [3]);
});

test('mergeAccountDocs：沒有資料時回傳空的帳號', () => {
  assert.deepEqual(C.mergeAccountDocs(null, null), { list: [], profiles: {} });
});

test('繳卡費與收入不計入生活費與總支出，收入另外統計', () => {
  const expenses = [
    { id: 1, date: '2026-10-02', amount: 100, category: '餐飲', pay: '現金' },
    { id: 2, date: '2026-10-03', amount: 5000, category: '繳卡費', pay: '轉帳' },
    { id: 3, date: '2026-10-04', amount: 300, category: '朋友聚會', pay: '國泰刷卡' },
    { id: 4, date: '2026-10-05', amount: 30000, category: '薪資', type: 'income', account: '銀行帳戶' },
    { id: 5, date: '2026-10-06', amount: 500, category: '利息', type: 'income', account: '現金' },
  ];
  const m = C.monthSummary(expenses, '2026-10');
  assert.equal(m.life, 100);
  assert.equal(m.outing, 300);
  assert.equal(m.total, 400);
  assert.equal(m.cardPay, 5000);
  assert.equal(m.income, 30500);
  assert.deepEqual(m.incomeCategories, [['薪資', 30000], ['利息', 500]]);
  assert.ok(m.pays.some(([p, v]) => p === '轉帳' && v === 5000));
  assert.equal(C.daySummary(expenses, '2026-10-03', 300).spent, 0);
  assert.equal(C.daySummary(expenses, '2026-10-04', 300).spent, 0);
  assert.equal(C.daySummary(expenses, '2026-10-02', 300).spent, 100);
});

test('buildIncome 檢查金額並限制類別與帳戶', () => {
  const ok = C.buildIncome({ date: '2026-10-01', amount: '30000', category: '薪資', account: '現金' }, 9);
  assert.equal(ok.ok, true);
  assert.equal(ok.expense.type, 'income');
  assert.equal(ok.expense.amount, 30000);
  assert.equal(ok.expense.account, '現金');
  const fallback = C.buildIncome({ date: '2026-10-01', amount: 10, category: '亂填', account: '別的' }, 10);
  assert.equal(fallback.expense.category, '其他');
  assert.equal(fallback.expense.account, '銀行帳戶');
  assert.equal(C.buildIncome({ date: '2026-10-01', amount: 0 }, 11).ok, false);
  assert.equal(C.buildIncome({ date: 'bad', amount: 10 }, 12).ok, false);
});

test('收入的 CSV 會標示收支，並把帳戶放在付款方式欄', () => {
  const csv = C.toCsv([{ id: 1, date: '2026-10-01', amount: 30000, category: '薪資', type: 'income', account: '銀行帳戶', note: '' }]);
  assert.ok(csv.includes('"薪資"'));
  assert.ok(csv.includes('"銀行帳戶"'));
  assert.ok(csv.trimEnd().endsWith('"收入"'));
});

test('清單編輯：新增、改名、刪除，並保護固定項目', () => {
  const names = ['餐飲', '交通'];
  assert.equal(C.addName(names, ' 寵物 ').names.at(-1), '寵物');
  assert.equal(C.addName(names, '餐飲').ok, false);
  assert.equal(C.addName(names, '').ok, false);
  assert.equal(C.addName(names, 'x'.repeat(11)).ok, false);
  assert.deepEqual(C.renameName(names, '交通', '通勤').names, ['餐飲', '通勤']);
  assert.equal(C.renameName(names, '交通', '餐飲').ok, false);
  assert.equal(C.renameName(['朋友聚會', '餐飲'], '朋友聚會', '聚會', ['朋友聚會']).ok, false);
  assert.equal(C.removeName(names, '交通').names.length, 1);
  assert.equal(C.removeName(['只剩一個'], '只剩一個').ok, false);
  assert.equal(C.removeName(['朋友聚會', '餐飲'], '朋友聚會', ['朋友聚會']).ok, false);
});

test('付款方式改名或改刷卡設定時保留刷卡旗標', () => {
  const pays = [{ name: '現金', card: false }, { name: '國泰刷卡', card: true }];
  const renamed = C.renamePay(pays, '國泰刷卡', '國泰信用卡');
  assert.deepEqual(renamed.pays[1], { name: '國泰信用卡', card: true });
  assert.deepEqual(C.setPayCard(pays, '現金', true)[0], { name: '現金', card: true });
  assert.equal(C.addPay(pays, '玉山信用卡', true).pays.at(-1).card, true);
  assert.equal(C.isCardPay('未知刷卡', { pays: [] }), true);
  assert.equal(C.isCardPay('未知的卡', { pays: [] }), false);
  assert.equal(C.isCardPay('現金', C.DEFAULT_LISTS), false);
});

test('sanitizeLists：缺的項目用預設值補上，固定項目一定保留', () => {
  const l = C.sanitizeLists({ categories: ['餐飲'] });
  assert.ok(l.categories.includes('繳卡費'));
  assert.ok(l.categories.includes('朋友聚會'));
  assert.deepEqual(l.pays, C.DEFAULT_LISTS.pays);
  assert.deepEqual(C.sanitizeLists(null), C.DEFAULT_LISTS);
});

test('自訂清單會用在記帳，而且清單外的舊名稱仍會統計', () => {
  const lists = C.sanitizeLists({
    categories: ['寵物', '朋友聚會', '繳卡費'],
    pays: [{ name: '現金', card: false }, { name: '玉山信用卡', card: true }],
  });
  const ok = C.buildExpense({ date: '2026-10-01', amount: 200, category: '寵物', pay: '玉山信用卡' }, 1, lists);
  assert.equal(ok.expense.category, '寵物');
  assert.equal(ok.expense.pay, '玉山信用卡');
  const fallback = C.buildExpense({ date: '2026-10-01', amount: 200, category: '舊類別', pay: '國泰刷卡' }, 2, lists);
  assert.equal(fallback.expense.category, '寵物');
  assert.equal(fallback.expense.pay, '現金');
  const old = [{ id: 3, date: '2026-10-02', amount: 50, category: '已刪除的類別', pay: '現金' }];
  assert.ok(C.monthSummary(old, '2026-10', lists).categories.some(([c]) => c === '已刪除的類別'));
});

test('當月實際結餘：收入減現金支出與繳卡費，刷卡消費要等繳卡費時才算', () => {
  const expenses = [
    { id: 1, date: '2026-10-02', amount: 1000, category: '餐飲', pay: '現金' },
    { id: 2, date: '2026-10-03', amount: 2000, category: '購物', pay: '國泰刷卡' },
    { id: 3, date: '2026-10-05', amount: 5000, category: '繳卡費', pay: '轉帳' },
    { id: 4, date: '2026-10-06', amount: 30000, category: '薪資', type: 'income', account: '銀行帳戶' },
  ];
  const m = C.monthSummary(expenses, '2026-10');
  assert.equal(m.income, 30000);
  assert.equal(m.creditOut, 2000);
  assert.equal(m.cashOut, 6000);
  assert.equal(m.balance, 24000);
  // 刷卡消費還沒繳卡費時，不會減少實際結餘
  const beforePayment = C.monthSummary(expenses.filter(e => e.id !== 3), '2026-10');
  assert.equal(beforePayment.balance, 29000);
});
