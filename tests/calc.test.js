'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calc.js');

const base = { ...C.DEFAULTS };

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
  assert.ok(csv.startsWith('﻿"日期","類別","餐別","備註","金額"'));
});

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('buildExpense：餐別只保留固定選項，順序依 MEALS', () => {
  const r = C.buildExpense({
    date: '2026-10-12', amount: '120', category: '餐飲',
    meals: ['晚餐', '亂填', '早餐'],
  }, 1);
  assert.deepEqual(r.expense.meals, ['早餐', '晚餐']);
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
  assert.ok(csv.includes('"2026-10-02","交通","","old","20"'));
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
