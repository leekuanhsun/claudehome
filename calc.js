/* 存錢計畫的純計算邏輯（不碰 DOM，方便測試） */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SavingPlanCalc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULTS = {
    income: 30000,
    loan: 15500,
    workdays: 22,
    dailyLimit: 300,
    outing: 2000,
    cardPay: 5000,
    cardBalance: 30000,
  };

  const LIMITS = {
    income: [0, 1e7],
    loan: [0, 1e7],
    workdays: [0, 31],
    dailyLimit: [0, 1e6],
    outing: [0, 1e7],
    cardPay: [0, 1e7],
    cardBalance: [0, 1e8],
  };

  const LABELS = {
    income: '每月實領薪水',
    loan: '每月固定貸款',
    workdays: '每月工作日',
    dailyLimit: '每日生活費上限',
    outing: '每月朋友聚會預算',
    cardPay: '信用卡分期月付',
    cardBalance: '信用卡分期剩餘本金（約）',
  };

  const CATEGORIES = ['餐飲', '交通', '飲料／點心', '購物', '朋友聚會', '生活用品', '其他'];
  const MEALS = ['早餐', '午餐', '晚餐', '下午茶'];
  const OUTING = '朋友聚會';
  const MAX_AMOUNT = 1e8;
  const MAX_NOTE = 500;
  const MAX_PHOTOS = 3;
  // 照片以 data URL 存在 localStorage，單張上限約 500KB（base64 字元數）
  const MAX_PHOTO_CHARS = 700000;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  const pad = n => String(n).padStart(2, '0');

  function toIsoDate(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function monthOf(dateStr) {
    return dateStr.slice(0, 7);
  }

  // "2026-11" + 3 => "2027-02"
  function addMonths(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }

  function percentOf(spent, budget) {
    if (budget > 0) return (spent / budget) * 100;
    return spent > 0 ? 100 : 0;
  }

  /* ---------- 預算設定 ---------- */

  // 讀取 localStorage 的資料時使用：不合法的欄位退回預設值
  function sanitizeSettings(stored) {
    const out = { ...DEFAULTS };
    if (!stored || typeof stored !== 'object') return out;
    for (const key of Object.keys(DEFAULTS)) {
      const v = Number(stored[key]);
      const [lo, hi] = LIMITS[key];
      if (Number.isFinite(v) && v >= lo && v <= hi) out[key] = v;
    }
    return out;
  }

  // 表單輸入時使用：有任何一個欄位不合法就回傳錯誤
  function validateSettings(input) {
    const values = {};
    for (const key of Object.keys(DEFAULTS)) {
      const str = String(input[key] ?? '').trim();
      const v = Number(str);
      const [lo, hi] = LIMITS[key];
      if (str === '' || !Number.isFinite(v) || v < lo || v > hi) {
        return { ok: false, field: key, message: `「${LABELS[key]}」請輸入 ${lo} 到 ${hi} 之間的數字` };
      }
      values[key] = v;
    }
    return { ok: true, values };
  }

  // 信用卡本金為 0 代表已繳清，之後不再扣月付金額
  function effectiveCardPay(s) {
    return s.cardBalance > 0 ? s.cardPay : 0;
  }

  function plan(s, currentMonth) {
    const cardPay = effectiveCardPay(s);
    const dailyBudget = s.workdays * s.dailyLimit;
    const leftover = s.income - s.loan - dailyBudget - s.outing - cardPay;
    const cardMonths = cardPay > 0 ? Math.ceil(s.cardBalance / cardPay) : 0;
    const buffer = Math.max(0, leftover);
    // 分期結束後，保守起見只把原本的月付金額轉為存款
    const afterSave = cardPay > 0 ? cardPay : buffer;

    let year = 0;
    for (let i = 0; i < 12; i++) year += i < cardMonths ? buffer : afterSave;

    return {
      cardPay,
      dailyBudget,
      leftover,
      cardMonths,
      buffer,
      afterSave,
      year,
      payoff: cardMonths ? addMonths(currentMonth, cardMonths) : null,
    };
  }

  /* ---------- 支出紀錄 ---------- */

  function isValidExpense(e) {
    return !!e
      && typeof e.id === 'number'
      && DATE_RE.test(e.date)
      && Number(e.amount) > 0
      && typeof e.category === 'string';
  }

  // 只接受 1 到 90 / -180 到 180 的座標，四捨五入到約 1 公尺的精度
  function validLocation(loc) {
    if (!loc) return null;
    const lat = Number(loc.lat);
    const lng = Number(loc.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
  }

  function validPhoto(src) {
    return typeof src === 'string' && src.startsWith('data:image/') && src.length <= MAX_PHOTO_CHARS;
  }

  function buildExpense(input, id) {
    const date = String(input.date || '');
    if (!DATE_RE.test(date)) return { ok: false, field: 'date', message: '請選擇日期' };

    const amount = Math.round(Number(input.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      return { ok: false, field: 'amount', message: '請輸入大於 0 的金額' };
    }

    const category = CATEGORIES.includes(input.category) ? input.category : '其他';
    const note = String(input.note || '').trim().slice(0, MAX_NOTE);
    const meals = MEALS.filter(m => (input.meals || []).includes(m));
    const photos = (input.photos || []).filter(validPhoto).slice(0, MAX_PHOTOS);
    const location = validLocation(input.location);
    return { ok: true, expense: { id, date, amount, category, note, meals, photos, location } };
  }

  function monthSummary(expenses, month) {
    const list = expenses.filter(e => monthOf(e.date) === month);
    const sum = pred => list.reduce((s, e) => (pred(e) ? s + e.amount : s), 0);
    const life = sum(e => e.category !== OUTING);
    const outing = sum(e => e.category === OUTING);
    const categories = CATEGORIES
      .map(c => [c, sum(e => e.category === c)])
      .filter(([, v]) => v > 0);
    return { list, life, outing, total: life + outing, categories };
  }

  function daySummary(expenses, date, dailyLimit) {
    const spent = expenses
      .filter(e => e.date === date && e.category !== OUTING)
      .reduce((s, e) => s + e.amount, 0);
    return {
      spent,
      remain: dailyLimit - spent,
      percent: percentOf(spent, dailyLimit),
    };
  }

  // 試算表軟體會把 = + - @ 開頭的儲存格當成公式，這裡加上 ' 避免執行
  function csvCell(x) {
    let s = String(x ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  }

  function toCsv(list) {
    const rows = [
      ['日期', '類別', '餐別', '備註', '金額'],
      ...list.map(e => [e.date, e.category, (e.meals || []).join('、'), e.note, e.amount]),
    ];
    return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  }

  /* ---------- 日記 ---------- */

  const MOODS = ['😊', '🎉', '😔', '🥳', '🥰', '😄', '😌', '😤'];
  const MAX_DIARY_PHOTOS = 4;
  const MAX_DIARY_TEXT = 1000;

  function buildDiary(input, id) {
    const date = String(input.date || '');
    if (!DATE_RE.test(date)) return { ok: false, field: 'date', message: '請選擇日期' };

    const text = String(input.text || '').trim().slice(0, MAX_DIARY_TEXT);
    const photos = (input.photos || []).filter(validPhoto).slice(0, MAX_DIARY_PHOTOS);
    if (!text && !photos.length) return { ok: false, field: 'text', message: '請寫一點內容或加一張照片' };

    const mood = MOODS.includes(input.mood) ? input.mood : null;
    return { ok: true, entry: { id, date, mood, text, photos, location: validLocation(input.location) } };
  }

  function monthDiary(entries, month) {
    return entries
      .filter(e => monthOf(e.date) === month)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  }

  function isValidDiary(e) {
    return !!e && typeof e.id === 'number' && DATE_RE.test(e.date) && typeof e.text === 'string';
  }

  return {
    DEFAULTS,
    MOODS,
    MAX_DIARY_PHOTOS,
    MAX_DIARY_TEXT,
    buildDiary,
    monthDiary,
    isValidDiary,
    LIMITS,
    LABELS,
    CATEGORIES,
    MEALS,
    OUTING,
    MAX_AMOUNT,
    MAX_NOTE,
    MAX_PHOTOS,
    MAX_PHOTO_CHARS,
    toIsoDate,
    monthOf,
    addMonths,
    percentOf,
    sanitizeSettings,
    validateSettings,
    effectiveCardPay,
    plan,
    isValidExpense,
    buildExpense,
    monthSummary,
    daySummary,
    toCsv,
  };
});
