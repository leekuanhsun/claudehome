/* 存錢計畫的純計算邏輯（不碰 DOM，方便測試） */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SavingPlanCalc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULTS = {
    income: 0,
    loan: 0,
    workdays: 0,
    dailyLimit: 0,
    outing: 0,
    cardPay: 0,
    cardBalance: 0,
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

  const CATEGORIES = ['餐飲', '交通', '飲料／點心', '購物', '朋友聚會', '生活用品', '繳卡費', '其他'];
  // 繳卡費是還信用卡帳單的轉帳，已在刷卡時記過消費，所以不計入生活費與總支出
  const CARD_PAYMENT = '繳卡費';
  const INCOME_CATEGORIES = ['薪資', '股票', '利息', '交易', '其他'];
  const INCOME_ACCOUNTS = ['銀行帳戶', '現金'];
  // 各類別預設的細項（餐飲的細項就是餐別）
  const PRESET_TAGS = {
    餐飲: ['早餐', '午餐', '晚餐', '下午茶'],
    交通: ['保養', '加油', '車票'],
  };
  const PAY_METHODS = ['現金', '轉帳', '國泰刷卡', '中信刷卡', '富邦刷卡'];
  // 所有金額都換算成台幣（amount）儲存；TWD 是基準幣別
  const CURRENCY_LABELS = {
    TWD: '台幣 TWD',
    USD: '美元 USD',
    JPY: '日圓 JPY',
    EUR: '歐元 EUR',
    CNY: '人民幣 CNY',
    HKD: '港幣 HKD',
    KRW: '韓元 KRW',
    GBP: '英鎊 GBP',
    THB: '泰銖 THB',
    SGD: '新加坡幣 SGD',
  };
  const CURRENCIES = Object.keys(CURRENCY_LABELS);
  const FX_MAX_AGE_MS = 12 * 60 * 60 * 1000;
  const MAX_TAG_LEN = 10;
  const MAX_CUSTOM_PER_CATEGORY = 20;
  const MAX_TAGS_PER_EXPENSE = 10;
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

  // 去掉空白與重複，過長的名稱會被丟掉
  function uniqueTags(list) {
    const names = (list || []).map(t => String(t).trim()).filter(t => t && t.length <= MAX_TAG_LEN);
    return [...new Set(names)].slice(0, MAX_TAGS_PER_EXPENSE);
  }

  // 某類別目前可選的細項：預設的在前，自訂的接在後面
  function tagsFor(category, customTags) {
    const presets = PRESET_TAGS[category] || [];
    const customs = (customTags && customTags[category]) || [];
    return [...presets, ...customs.filter(t => !presets.includes(t))];
  }

  function addCustomTag(customTags, category, raw) {
    const name = String(raw || '').trim();
    if (!name) return { ok: false, message: '請輸入細項名稱' };
    if (name.length > MAX_TAG_LEN) return { ok: false, message: `名稱最多 ${MAX_TAG_LEN} 個字` };
    if (tagsFor(category, customTags).includes(name)) return { ok: false, message: '這個細項已經有了' };
    const customs = (customTags && customTags[category]) || [];
    if (customs.length >= MAX_CUSTOM_PER_CATEGORY) {
      return { ok: false, message: `每個類別最多新增 ${MAX_CUSTOM_PER_CATEGORY} 個細項` };
    }
    return { ok: true, name, customTags: { ...customTags, [category]: [...customs, name] } };
  }

  function removeCustomTag(customTags, category, name) {
    const customs = (customTags && customTags[category]) || [];
    return { ...customTags, [category]: customs.filter(t => t !== name) };
  }

  // 讀取 localStorage 的自訂細項：只保留已知類別與合法名稱
  function sanitizeCustomTags(stored) {
    const out = {};
    if (!stored || typeof stored !== 'object') return out;
    for (const cat of Object.keys(stored)) {
      if (!CATEGORIES.includes(cat) || !Array.isArray(stored[cat])) continue;
      const names = [...new Set(stored[cat].map(t => String(t).trim()).filter(t => t && t.length <= MAX_TAG_LEN))]
        .slice(0, MAX_CUSTOM_PER_CATEGORY);
      if (names.length) out[cat] = names;
    }
    return out;
  }

  function buildExpense(input, id) {
    const date = String(input.date || '');
    if (!DATE_RE.test(date)) return { ok: false, field: 'date', message: '請選擇日期' };

    const currency = CURRENCIES.includes(input.currency) ? input.currency : 'TWD';
    const origAmount = Math.round(Number(input.amount) * 100) / 100;
    if (!Number.isFinite(origAmount) || origAmount <= 0 || origAmount > MAX_AMOUNT) {
      return { ok: false, field: 'amount', message: '請輸入大於 0 的金額' };
    }
    // rate 是「1 單位外幣等於多少台幣」；台幣的匯率固定為 1
    let rate = 1;
    let amount = origAmount;
    if (currency !== 'TWD') {
      rate = Number(input.rate);
      if (!Number.isFinite(rate) || rate <= 0) {
        return { ok: false, field: 'currency', message: '還沒有取得匯率，請稍後再試，或改用台幣' };
      }
      amount = Math.round(origAmount * rate);
      if (amount <= 0 || amount > MAX_AMOUNT) {
        return { ok: false, field: 'amount', message: '換算後的金額不正確，請檢查金額' };
      }
    }

    const category = CATEGORIES.includes(input.category) ? input.category : '其他';
    const note = String(input.note || '').trim().slice(0, MAX_NOTE);
    const meals = uniqueTags(input.meals);
    const photos = (input.photos || []).filter(validPhoto).slice(0, MAX_PHOTOS);
    const location = validLocation(input.location);
    const pay = PAY_METHODS.includes(input.pay) ? input.pay : '現金';
    return {
      ok: true,
      expense: {
        id, date, amount, category, pay, note, meals, photos, location,
        currency, origAmount, rate,
      },
    };
  }

  // 收入：只記金額、類別與存入的帳戶（一律是台幣）
  function buildIncome(input, id) {
    const date = String(input.date || '');
    if (!DATE_RE.test(date)) return { ok: false, field: 'date', message: '請選擇日期' };
    const amount = Math.round(Number(input.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      return { ok: false, field: 'amount', message: '請輸入大於 0 的金額' };
    }
    const category = INCOME_CATEGORIES.includes(input.category) ? input.category : '其他';
    const account = INCOME_ACCOUNTS.includes(input.account) ? input.account : '銀行帳戶';
    const note = String(input.note || '').trim().slice(0, MAX_NOTE);
    return {
      ok: true,
      expense: { id, date, amount, type: 'income', category, account, note },
    };
  }

  // 早期的紀錄沒有 type 欄位，一律視為支出
  function isIncome(e) {
    return e.type === 'income';
  }

  function monthSummary(expenses, month) {
    const list = expenses.filter(e => monthOf(e.date) === month);
    const spend = list.filter(e => !isIncome(e));
    const income = list.filter(isIncome);
    const sum = (rows, pred) => rows.reduce((s, e) => (pred(e) ? s + e.amount : s), 0);
    const cardPay = sum(spend, e => e.category === CARD_PAYMENT);
    const life = sum(spend, e => e.category !== OUTING && e.category !== CARD_PAYMENT);
    const outing = sum(spend, e => e.category === OUTING);
    const categories = CATEGORIES
      .map(c => [c, sum(spend, e => e.category === c)])
      .filter(([, v]) => v > 0);
    // 早期沒有付款方式的紀錄歸為「未記錄」
    const pays = PAY_METHODS
      .map(p => [p, sum(spend, e => e.pay === p)])
      .filter(([, v]) => v > 0);
    const unknown = sum(spend, e => !e.pay);
    if (unknown > 0) pays.push(['未記錄', unknown]);
    const incomeTotal = sum(income, () => true);
    const incomeCategories = INCOME_CATEGORIES
      .map(c => [c, sum(income, e => e.category === c)])
      .filter(([, v]) => v > 0);
    return {
      list, life, outing, total: life + outing, cardPay, categories, pays,
      income: incomeTotal, incomeCategories,
    };
  }

  function daySummary(expenses, date, dailyLimit) {
    const spent = expenses
      .filter(e => e.date === date && !isIncome(e) && e.category !== OUTING && e.category !== CARD_PAYMENT)
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
      ['日期', '類別', '餐別／細項', '付款方式', '備註', '金額（台幣）', '幣別', '原幣金額', '收支'],
      ...list.map(e => [
        e.date, e.category,
        isIncome(e) ? '' : (e.meals || []).join('、'),
        isIncome(e) ? e.account : (e.pay || ''),
        e.note, e.amount,
        e.currency || '', e.currency && e.currency !== 'TWD' ? e.origAmount : '',
        isIncome(e) ? '收入' : '支出',
      ]),
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

  /* ---------- 雲端同步合併 ---------- */

  // 文件結構：{ expenses, diary, tombstones: {expenses:{id:時間}, diary:{id:時間}},
  //            settings: {u, v}, tags: {u, v} }；u 是最後修改的毫秒時間戳
  const SYNC_LISTS = ['expenses', 'diary'];

  function newerOf(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (b.u || 0) > (a.u || 0) ? b : a;
  }

  function emptyDoc() {
    return {
      expenses: [],
      diary: [],
      tombstones: { expenses: {}, diary: {} },
      settings: { u: 0, v: { ...DEFAULTS } },
      tags: { u: 0, v: {} },
    };
  }

  // 兩份文件合併：同一筆取較新的；刪除時間晚於修改時間的就移除；設定與細項取較新的一份
  function mergeDocs(local, remote) {
    const a = { ...emptyDoc(), ...local };
    const b = { ...emptyDoc(), ...remote };
    const tombstones = { expenses: {}, diary: {} };
    for (const k of SYNC_LISTS) {
      const t = { ...(b.tombstones?.[k] || {}) };
      for (const [id, ts] of Object.entries(a.tombstones?.[k] || {})) {
        t[id] = Math.max(t[id] || 0, ts);
      }
      tombstones[k] = t;
    }

    const merged = { tombstones };
    for (const k of SYNC_LISTS) {
      const byId = new Map();
      for (const item of [...(a[k] || []), ...(b[k] || [])]) {
        byId.set(item.id, newerOf(byId.get(item.id), item));
      }
      merged[k] = [...byId.values()].filter(item => !(tombstones[k][item.id] >= (item.u || 0)));
    }
    merged.settings = newerOf(a.settings, b.settings);
    merged.tags = newerOf(a.tags, b.tags);
    return merged;
  }

  // open.er-api.com 的回應：rates 是「1 台幣能換多少外幣」，這裡轉成「1 外幣值多少台幣」
  function parseFx(json, now = Date.now()) {
    if (!json || json.result !== 'success' || !json.rates || typeof json.rates !== 'object') return null;
    const twdPer = { TWD: 1 };
    for (const c of CURRENCIES) {
      if (c === 'TWD') continue;
      const r = Number(json.rates[c]);
      if (Number.isFinite(r) && r > 0) twdPer[c] = Math.round((1 / r) * 10000) / 10000;
    }
    return { fetchedAt: now, updated: json.time_last_update_utc || '', twdPer };
  }

  function fxIsStale(fx, now = Date.now()) {
    return !fx || !fx.fetchedAt || now - fx.fetchedAt > FX_MAX_AGE_MS;
  }

  /* ---------- 同一帳號下的多位使用者 ---------- */

  // 帳號文件：{ list: [{id, name}], profiles: {使用者 id: 文件} }
  // 舊版是整份文件只有一位使用者，會視為 id 為 p1、名字為「我」的使用者
  function normalizeAccount(doc) {
    if (doc && doc.profiles && typeof doc.profiles === 'object') {
      return { list: Array.isArray(doc.list) ? doc.list : [], profiles: doc.profiles };
    }
    if (doc && typeof doc === 'object' && (doc.expenses || doc.diary || doc.settings)) {
      return { list: [{ id: 'p1', name: '我' }], profiles: { p1: doc } };
    }
    return { list: [], profiles: {} };
  }

  function mergeAccountDocs(local, remote) {
    const a = normalizeAccount(local);
    const b = normalizeAccount(remote);
    const byId = new Map();
    for (const item of [...a.list, ...b.list]) byId.set(item.id, item);
    const profiles = {};
    for (const id of new Set([...Object.keys(a.profiles), ...Object.keys(b.profiles)])) {
      profiles[id] = mergeDocs(a.profiles[id] || emptyDoc(), b.profiles[id] || emptyDoc());
    }
    return { list: [...byId.values()], profiles };
  }

  return {
    DEFAULTS,
    normalizeAccount,
    mergeAccountDocs,
    CURRENCIES,
    CURRENCY_LABELS,
    parseFx,
    fxIsStale,
    mergeDocs,
    emptyDoc,
    MOODS,
    MAX_DIARY_PHOTOS,
    MAX_DIARY_TEXT,
    buildDiary,
    monthDiary,
    isValidDiary,
    LIMITS,
    LABELS,
    CATEGORIES,
    PAY_METHODS,
    PRESET_TAGS,
    MAX_TAG_LEN,
    tagsFor,
    addCustomTag,
    removeCustomTag,
    sanitizeCustomTags,
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
    validPhoto,
    buildExpense,
    buildIncome,
    isIncome,
    CARD_PAYMENT,
    INCOME_CATEGORIES,
    INCOME_ACCOUNTS,
    monthSummary,
    daySummary,
    toCsv,
  };
});
