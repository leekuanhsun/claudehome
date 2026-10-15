/* 存錢計畫的畫面與互動；計算邏輯在 calc.js。每個頁面由 body 的 data-page 決定要執行哪一段。 */
(function () {
  'use strict';

  const C = window.SavingPlanCalc;
  const $ = id => document.getElementById(id);
  const KEYS = {
    settings: 'savingPlan.v2.settings',
    expenses: 'savingPlan.v2.expenses',
    diary: 'savingPlan.v2.diary',
    tags: 'savingPlan.v2.tags',
    tombstones: 'savingPlan.v2.tombstones',
    meta: 'savingPlan.v2.meta',
    fx: 'savingPlan.v2.fx',
    acct: 'savingPlan.v3.acct',
  };
  const LEGACY = { settings: 'savingPlanSettings', expenses: 'savingPlanExpenses' };
  const page = document.body.dataset.page;

  let settings = { ...C.DEFAULTS };
  let expenses = [];
  let diary = [];
  let customTags = {};
  // 同一帳號底下的使用者：{ active: 目前使用者 id, list: [{id, name}], data: {使用者 id: 文件} }
  let acct = null;
  // 刪除記錄：{ expenses: {id: 刪除時間}, diary: {...} }，讓其他裝置同步時也會刪掉
  let tombstones = { expenses: {}, diary: {} };
  // 設定與細項最後修改的時間，用來決定同步時哪一份較新
  let meta = { settingsU: 0, tagsU: 0 };
  let onChange = () => {};
  let onDiaryChange = () => {};

  const money = n => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
  const todayIso = () => C.toIsoDate(new Date());
  const todayMonth = () => C.monthOf(todayIso());
  const newId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

  /* ---------- 共用小工具 ---------- */

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function setBar(el, pct) {
    el.style.width = Math.min(100, Math.max(0, pct)) + '%';
    el.parentElement.classList.toggle('over', pct > 100);
  }

  function cell(text, cls) {
    const td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  }

  const isForeign = e => !!e.currency && e.currency !== 'TWD';

  // 備註欄：餐別、心得、照片縮圖、位置連結
  function noteCell(e) {
    const td = document.createElement('td');
    const meals = e.meals || [];
    const photos = e.photos || [];
    if (!meals.length && !e.note && !photos.length && !e.location && !e.pay && !isForeign(e)) {
      td.textContent = '—';
      return td;
    }
    if (isForeign(e)) {
      const fxTag = document.createElement('span');
      fxTag.className = 'fx-tag';
      fxTag.textContent = `${e.currency} ${e.origAmount}`;
      td.appendChild(fxTag);
    }
    if (e.pay) {
      const pay = document.createElement('span');
      pay.className = 'pay-tag';
      pay.textContent = e.pay;
      td.appendChild(pay);
    }
    if (meals.length) {
      const tag = document.createElement('span');
      tag.className = 'meal-tag';
      tag.textContent = meals.join('、');
      td.appendChild(tag);
    }
    if (e.note) td.appendChild(document.createTextNode(e.note));
    for (const src of photos) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = '照片';
      img.className = 'note-thumb';
      td.appendChild(img);
    }
    if (e.location) {
      const a = document.createElement('a');
      a.className = 'map-link';
      a.href = `https://www.google.com/maps?q=${e.location.lat},${e.location.lng}`;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = '📍 地圖';
      td.appendChild(a);
    }
    return td;
  }

  // 共用的支出列表：expense 頁不顯示日期，history 頁顯示
  function fillRows(tbody, list, showDate) {
    tbody.textContent = '';
    for (const e of list) {
      const tr = document.createElement('tr');
      if (showDate) tr.append(cell(e.date));
      tr.append(cell(e.category), noteCell(e), cell(money(e.amount), 'amount'));
      const op = document.createElement('td');
      const btn = document.createElement('button');
      btn.className = 'btn danger-sm';
      btn.type = 'button';
      btn.textContent = '刪除';
      btn.setAttribute('aria-label', `刪除 ${e.date} ${e.category} ${money(e.amount)}`);
      btn.onclick = () => removeExpense(e.id);
      op.appendChild(btn);
      tr.appendChild(op);
      tbody.appendChild(tr);
    }
  }

  /* ---------- 儲存 ---------- */

  function readJSON(keys, fallback) {
    for (const k of keys) {
      try {
        const raw = localStorage.getItem(k);
        if (raw !== null) return JSON.parse(raw);
      } catch {
        // 讀取或解析失敗時改試下一個 key
      }
    }
    return fallback;
  }

  function load() {
    settings = C.sanitizeSettings(readJSON([KEYS.settings, LEGACY.settings], {}));
    const stored = readJSON([KEYS.expenses, LEGACY.expenses], []);
    expenses = Array.isArray(stored) ? stored.filter(C.isValidExpense) : [];
    customTags = C.sanitizeCustomTags(readJSON([KEYS.tags], {}));
    const storedDiary = readJSON([KEYS.diary], []);
    diary = Array.isArray(storedDiary) ? storedDiary.filter(C.isValidDiary) : [];
    tombstones = readJSON([KEYS.tombstones], { expenses: {}, diary: {} });
    meta = { settingsU: 0, tagsU: 0, ...readJSON([KEYS.meta], {}) };
    fx = readJSON([KEYS.fx], null);
    acct = readJSON([KEYS.acct], null);
    if (acct && acct.active && acct.data && acct.data[acct.active]) applyDoc(acct.data[acct.active]);
  }

  // 只寫入本機，不觸發同步
  function writeLocal() {
    localStorage.setItem(KEYS.settings, JSON.stringify(settings));
    localStorage.setItem(KEYS.expenses, JSON.stringify(expenses));
    localStorage.setItem(KEYS.diary, JSON.stringify(diary));
    localStorage.setItem(KEYS.tags, JSON.stringify(customTags));
    localStorage.setItem(KEYS.tombstones, JSON.stringify(tombstones));
    localStorage.setItem(KEYS.meta, JSON.stringify(meta));
    if (acct && acct.active) {
      acct.data = { ...(acct.data || {}), [acct.active]: toDoc() };
      localStorage.setItem(KEYS.acct, JSON.stringify(acct));
    }
  }

  function save() {
    try {
      writeLocal();
    } catch {
      toast('無法儲存資料，請確認瀏覽器儲存空間或是否在無痕模式');
      return false;
    }
    scheduleSync();
    return true;
  }

  /* ---------- 雲端同步 ---------- */

  let syncTimer = null;
  let syncRunning = false;
  let syncQueued = false;

  const cloudReady = () => !!(window.SavingPlanCloud && window.SavingPlanCloud.configured);

  function setSyncStatus(msg) {
    const el = $('syncStatus');
    if (el) el.textContent = msg;
  }

  function toDoc() {
    return {
      expenses,
      diary,
      tombstones,
      settings: { u: meta.settingsU || 0, v: settings },
      tags: { u: meta.tagsU || 0, v: customTags },
    };
  }

  // 把合併後的文件套用到本機
  function applyDoc(doc) {
    expenses = (doc.expenses || []).filter(C.isValidExpense);
    diary = (doc.diary || []).filter(C.isValidDiary);
    tombstones = doc.tombstones || { expenses: {}, diary: {} };
    settings = C.sanitizeSettings(doc.settings && doc.settings.v);
    customTags = C.sanitizeCustomTags(doc.tags && doc.tags.v);
    meta = { settingsU: (doc.settings && doc.settings.u) || 0, tagsU: (doc.tags && doc.tags.u) || 0 };
    writeLocal();
  }

  function scheduleSync() {
    if (!cloudReady()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 1500);
  }

  // 讀取雲端 → 與本機合併 → 寫回雲端
  async function syncNow() {
    if (!cloudReady()) return;
    if (syncRunning) {
      syncQueued = true;
      return;
    }
    syncRunning = true;
    try {
      if (!SavingPlanCloud.currentUser()) {
        setSyncStatus('尚未登入，資料只存在這台裝置。');
        return;
      }
      setSyncStatus('同步中…');
      applyAccountDoc(await SavingPlanCloud.exchange(accountDoc()));
      const time = new Date().toLocaleTimeString('zh-Hant', { hour: '2-digit', minute: '2-digit' });
      setSyncStatus(`已同步（${time}）`);
      onChange();
      onDiaryChange();
    } catch (e) {
      setSyncStatus('同步失敗：' + (e && e.message ? e.message : '請稍後再試'));
    } finally {
      syncRunning = false;
      if (syncQueued) {
        syncQueued = false;
        scheduleSync();
      }
    }
  }

  /* ---------- 同一帳號下的使用者（像 Netflix 的「誰在用？」） ---------- */

  function activeProfile() {
    if (!acct || !acct.active) return null;
    return (acct.list || []).find(p => p.id === acct.active) || null;
  }

  function hasLocalData() {
    return expenses.length > 0 || diary.length > 0 || meta.settingsU > 0 || meta.tagsU > 0 || Object.keys(customTags).length > 0;
  }

  // 第一次使用時建立使用者清單；舊版本已有的資料會放進「我」這位使用者
  function ensureAcct() {
    if (acct) return;
    acct = { active: null, list: [], data: {} };
    if (hasLocalData()) {
      acct.list = [{ id: 'p1', name: '我' }];
      acct.active = 'p1';
    }
    writeLocal();
  }

  // 同步時送出整個帳號（所有使用者的資料）
  function accountDoc() {
    const profiles = { ...((acct && acct.data) || {}) };
    if (acct && acct.active) profiles[acct.active] = toDoc();
    return { list: (acct && acct.list) || [], profiles };
  }

  function applyAccountDoc(merged) {
    acct = acct || { active: null, list: [], data: {} };
    acct.list = merged.list || [];
    acct.data = { ...(merged.profiles || {}) };
    const current = acct.active && acct.data[acct.active];
    if (current) applyDoc(current);
    else writeLocal();
  }

  function switchProfile(id) {
    if (!acct) return;
    writeLocal();
    acct.active = id;
    applyDoc((acct.data && acct.data[id]) || C.emptyDoc());
  }

  function createProfile(name) {
    ensureAcct();
    const id = 'p' + Date.now().toString(36);
    acct.list = [...(acct.list || []), { id, name }];
    acct.data = { ...(acct.data || {}), [id]: C.emptyDoc() };
    switchProfile(id);
    scheduleSync();
  }

  function renderProfiles() {
    const grid = $('profileGrid');
    grid.textContent = '';
    (acct && acct.list || []).forEach((p, i) => {
      const item = document.createElement('div');
      item.className = 'profile';
      const avatar = document.createElement('button');
      avatar.type = 'button';
      avatar.className = 'avatar';
      avatar.style.background = PROFILE_COLORS[i % PROFILE_COLORS.length];
      avatar.textContent = p.name.charAt(0);
      avatar.setAttribute('aria-label', `使用 ${p.name}`);
      avatar.onclick = () => {
        switchProfile(p.id);
        location.replace('index.html');
      };
      const name = document.createElement('span');
      name.className = 'profile-name';
      name.textContent = p.name;
      item.append(avatar, name);
      grid.appendChild(item);
    });
    const add = document.createElement('div');
    add.className = 'profile';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'avatar add';
    addBtn.textContent = '+';
    addBtn.setAttribute('aria-label', '新增使用者');
    addBtn.onclick = () => {
      $('newProfileForm').hidden = false;
      $('profileNameInput').focus();
    };
    const addName = document.createElement('span');
    addName.className = 'profile-name';
    addName.textContent = '新增使用者';
    add.append(addBtn, addName);
    grid.appendChild(add);
  }

  function initProfiles() {
    ensureAcct();
    onChange = renderProfiles;
    renderProfiles();
    $('newProfileForm').addEventListener('submit', ev => {
      ev.preventDefault();
      const name = $('profileNameInput').value.trim();
      if (!name) {
        toast('請輸入名字');
        return;
      }
      createProfile(name);
      location.replace('index.html');
    });
    $('logoutLink').onclick = async () => {
      if (!confirm('登出後會清除這台裝置上的記帳資料（雲端的資料不會刪除），確定登出？')) return;
      await syncNow();
      await SavingPlanCloud.signOut();
      clearLocalData();
      location.replace('login.html');
    };
    syncNow();
  }

  // 登出時清除這台裝置上的記帳資料，避免其他人用同一台裝置看到
  function clearLocalData() {
    for (const k of [...Object.values(KEYS), ...Object.values(LEGACY)]) localStorage.removeItem(k);
  }

  /* ---------- 登入頁 ---------- */

  const PROFILE_COLORS = ['#6f5fd0', '#16805a', '#b23a52', '#2d6fb0', '#c07a1a', '#7a5a9e'];

  function showLoginForm(email) {
    $('signupCard').hidden = true;
    $('loginCard').hidden = false;
    $('loginUser').value = email;
    $('loginPass').value = '';
    (email ? $('loginPass') : $('loginUser')).focus();
  }


  function initLogin() {
    if (!cloudReady()) {
      setSyncStatus('尚未設定雲端同步：請在 supabase-config.js 填入 Supabase 的網址。');
      return;
    }
    if (SavingPlanCloud.currentUser()) {
      location.replace('index.html');
      return;
    }
    showLoginForm('');

    $('loginForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const email = $('loginUser').value.trim();
      const password = $('loginPass').value;
      if (!email || !password) {
        toast('請輸入電子郵件與密碼');
        return;
      }
      try {
        await SavingPlanCloud.signIn(email, password);
        location.replace('profiles.html');
      } catch (e) {
        toast(e.message);
      }
    });

    $('showSignup').onclick = () => {
      $('loginCard').hidden = true;
      $('signupCard').hidden = false;
    };
    $('backToLogin').onclick = () => showLoginForm($('signupUser').value.trim());
    $('signupForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const email = $('signupUser').value.trim();
      const password = $('signupPass').value;
      if (!email || !password) {
        toast('請輸入電子郵件與密碼');
        return;
      }
      if (password.length < 6) {
        toast('密碼至少要 6 個字');
        return;
      }
      if (password !== $('signupPass2').value) {
        toast('兩次輸入的密碼不一樣');
        return;
      }
      try {
        const result = await SavingPlanCloud.signUp(email, password);
        if (result === 'signed-in') {
          location.replace('profiles.html');
        } else {
          toast('註冊成功，請到信箱點擊確認連結後登入');
          showLoginForm(email);
        }
      } catch (e) {
        toast(e.message);
      }
    });
  }

  function initCloudPanel() {
    const render = () => {
      const user = SavingPlanCloud.currentUser();
      $('loginForm').hidden = !!user || !cloudReady();
      $('signedIn').hidden = !user;
      const current = activeProfile();
      $('currentProfileName').textContent = current ? current.name : '尚未選擇';
      if (user) {
        $('signedUser').textContent = user.username;
        setSyncStatus('已登入，手機與電腦的資料會同步。');
      } else if (!cloudReady()) {
        setSyncStatus('尚未設定雲端同步：請在 supabase-config.js 填入 Supabase 的網址。');
      } else {
        setSyncStatus('登入後，手機與電腦的資料會同步。');
      }
    };

    $('loginForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const email = $('loginUser').value.trim();
      const password = $('loginPass').value;
      if (!email || !password) {
        toast('請輸入電子郵件與密碼');
        return;
      }
      try {
        setSyncStatus('登入中…');
        await SavingPlanCloud.signIn(email, password);
        $('loginPass').value = '';
        toast('登入成功');
        render();
        syncNow();
      } catch (e) {
        toast(e.message);
        render();
      }
    });
    $('syncNowBtn').onclick = () => syncNow();
    $('logoutBtn').onclick = async () => {
      if (!confirm('登出後會清除這台裝置上的記帳資料（雲端的資料不會刪除），確定登出？')) return;
      await syncNow();
      await SavingPlanCloud.signOut();
      clearLocalData();
      location.replace('login.html');
    };
    render();
  }

  function removeExpense(id) {
    const e = expenses.find(x => x.id === id);
    if (!e || !confirm(`確定刪除這筆 ${money(e.amount)}（${e.category}）？`)) return;
    const prev = { expenses, tombstones };
    expenses = expenses.filter(x => x.id !== id);
    tombstones = { ...tombstones, expenses: { ...tombstones.expenses, [id]: Date.now() } };
    if (save()) {
      toast('已刪除');
      onChange();
    } else {
      ({ expenses, tombstones } = prev);
    }
  }

  function fillCategories(sel) {
    for (const c of C.CATEGORIES) {
      const o = document.createElement('option');
      o.textContent = c;
      sel.appendChild(o);
    }
  }

  /* ---------- 總覽 ---------- */

  function initOverview() {
    const render = () => {
      const p = C.plan(settings, todayMonth());
      $('ovIncome').textContent = money(settings.income);
      $('ovFixed').textContent = money(settings.loan + p.cardPay + settings.outing + p.dailyBudget);
      $('ovDaily').textContent = money(p.dailyBudget);
      $('ovCard').textContent = money(p.cardPay);

      const lv = $('ovLeftover');
      lv.textContent = money(p.leftover);
      lv.classList.toggle('neg', p.leftover < 0);
      $('ovWarn').hidden = p.leftover >= 0;

      const day = C.daySummary(expenses, todayIso(), settings.dailyLimit);
      $('ovTodayText').textContent = `已花 ${money(day.spent)}，${day.remain < 0 ? '超支 ' + money(-day.remain) : '剩餘 ' + money(day.remain)}`;
      setBar($('ovTodayBar'), day.percent);

      const m = C.monthSummary(expenses, todayMonth());
      $('ovMonthText').textContent = `生活費 ${money(m.life)} / ${money(p.dailyBudget)}`;
      setBar($('ovMonthBar'), C.percentOf(m.life, p.dailyBudget));

      $('ovStage1').textContent = money(p.buffer) + ' / 月';
      $('ovStage1Note').textContent = p.cardMonths
        ? `約 ${p.cardMonths} 個月後（${p.payoff}）繳清分期`
        : '目前沒有信用卡分期，每月剩餘金額可直接存下';
      $('ovStage2').textContent = money(p.afterSave) + ' / 月';
      $('ovStage2Note').textContent = p.cardPay > 0
        ? `分期結束後，把 ${money(p.cardPay)} 轉為固定存款`
        : '每月固定存下剩餘金額';
    };
    onChange = render;
    render();
  }

  /* ---------- 記帳 ---------- */

  let pendingPhotos = [];

  // 照片縮成最長邊 800px 的 JPEG，控制 localStorage 的用量
  function compressImage(file, maxSide = 800) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('無法讀取圖片'));
      };
      img.src = url;
    });
  }

  // 勾選「附上目前位置」才取得位置；失敗時仍然記帳，只是不附位置
  function getLocation() {
    return new Promise(resolve => {
      if (!navigator.geolocation) {
        toast('這個瀏覽器不支援定位，已略過位置');
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => {
          toast('無法取得位置，已略過');
          resolve(null);
        },
        { timeout: 8000, maximumAge: 60000 }
      );
    });
  }

  // 依目前選的類別顯示細項；keep 為 true 時保留已勾選的項目
  function renderTags(keep) {
    const category = $('expCategory').value;
    const previous = keep ? checkedMeals() : [];
    const presets = C.PRESET_TAGS[category] || [];
    const tags = C.tagsFor(category, customTags);
    $('tagLegend').textContent = category === '餐飲' ? '餐別（可複選）' : `${category}細項（可複選）`;

    const box = $('mealChips');
    box.textContent = '';
    for (const t of tags) {
      const wrap = document.createElement('span');
      wrap.className = 'tag-wrap';
      const label = document.createElement('label');
      label.className = 'check-chip';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'meal';
      input.value = t;
      input.checked = previous.includes(t);
      label.append(input, document.createTextNode(t));
      wrap.appendChild(label);
      if (!presets.includes(t)) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'tag-del';
        del.textContent = '×';
        del.setAttribute('aria-label', `移除 ${t}`);
        del.onclick = () => removeCustomTag(category, t);
        wrap.appendChild(del);
      }
      box.appendChild(wrap);
    }
    if (!tags.length) {
      const hint = document.createElement('span');
      hint.className = 'muted';
      hint.textContent = '還沒有細項，可以在下方自己新增';
      box.appendChild(hint);
    }
  }

  function addCustomTag() {
    const category = $('expCategory').value;
    const res = C.addCustomTag(customTags, category, $('tagInput').value);
    if (!res.ok) {
      toast(res.message);
      return;
    }
    const prev = customTags;
    customTags = res.customTags;
    meta = { ...meta, tagsU: Date.now() };
    if (!save()) {
      customTags = prev;
      return;
    }
    $('tagInput').value = '';
    renderTags(true);
    document.querySelectorAll('input[name=meal]').forEach(i => {
      if (i.value === res.name) i.checked = true;
    });
    toast(`已新增「${res.name}」`);
  }

  function removeCustomTag(category, name) {
    if (!confirm(`移除「${name}」？已記錄的支出不會受影響。`)) return;
    const prev = customTags;
    customTags = C.removeCustomTag(customTags, category, name);
    meta = { ...meta, tagsU: Date.now() };
    if (!save()) {
      customTags = prev;
      return;
    }
    renderTags(true);
    toast('已移除');
  }

  function checkedMeals() {
    return [...document.querySelectorAll('input[name=meal]:checked')].map(i => i.value);
  }

  function renderPhotoPreview() {
    const box = $('photoPreview');
    box.textContent = '';
    for (const src of pendingPhotos) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = '待上傳的照片';
      box.appendChild(img);
    }
  }

  function resetExpenseForm() {
    $('expAmount').value = '';
    $('expNote').value = '';
    $('expPhotos').value = '';
    $('expLocation').checked = false;
    document.querySelectorAll('input[name=meal]').forEach(i => { i.checked = false; });
    pendingPhotos = [];
    renderPhotoPreview();
  }

  /* ---------- 日記 ---------- */

  let pendingDiaryPhotos = [];

  // 縮圖列：填入既有的容器
  function renderThumbs(box, srcs, alt) {
    box.textContent = '';
    for (const src of srcs) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = alt;
      box.appendChild(img);
    }
  }

  function fillMoods() {
    const box = $('moodChips');
    box.textContent = '';
    for (const m of C.MOODS) {
      const label = document.createElement('label');
      label.className = 'mood-chip';
      label.title = '心情';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'mood';
      input.value = m;
      // 心情只能選一個：勾選新的心情時取消其他的
      input.addEventListener('change', () => {
        if (!input.checked) return;
        document.querySelectorAll('input[name=mood]').forEach(i => {
          if (i !== input) i.checked = false;
        });
      });
      const span = document.createElement('span');
      span.textContent = m;
      label.append(input, span);
      box.appendChild(label);
    }
  }

  function resetDiaryForm() {
    $('diaryDate').value = todayIso();
    $('diaryText').value = '';
    $('diaryPhotos').value = '';
    $('diaryLocation').checked = false;
    document.querySelectorAll('input[name=mood]').forEach(i => { i.checked = false; });
    pendingDiaryPhotos = [];
    renderThumbs($('diaryPreview'), [], '');
  }

  function removeDiary(id) {
    const e = diary.find(x => x.id === id);
    if (!e || !confirm(`確定刪除 ${e.date} 的日記？`)) return;
    const prev = { diary, tombstones };
    diary = diary.filter(x => x.id !== id);
    tombstones = { ...tombstones, diary: { ...tombstones.diary, [id]: Date.now() } };
    if (save()) {
      toast('已刪除');
      onDiaryChange();
    } else {
      ({ diary, tombstones } = prev);
    }
  }

  function diaryItem(e) {
    const art = document.createElement('article');
    art.className = 'diary-item';

    const head = document.createElement('div');
    head.className = 'row';
    const meta = document.createElement('div');
    meta.className = 'diary-meta';
    meta.textContent = e.mood ? `${e.date}　${e.mood}` : e.date;
    const del = document.createElement('button');
    del.className = 'btn danger-sm';
    del.type = 'button';
    del.textContent = '刪除';
    del.setAttribute('aria-label', `刪除 ${e.date} 的日記`);
    del.onclick = () => removeDiary(e.id);
    head.append(meta, del);
    art.appendChild(head);

    if (e.text) {
      const p = document.createElement('p');
      p.className = 'diary-text';
      p.textContent = e.text;
      art.appendChild(p);
    }
    if (e.photos && e.photos.length) {
      const thumbs = document.createElement('div');
      thumbs.className = 'thumbs';
      renderThumbs(thumbs, e.photos, '日記照片');
      art.appendChild(thumbs);
    }
    if (e.location) {
      const a = document.createElement('a');
      a.className = 'map-link';
      a.href = `https://www.google.com/maps?q=${e.location.lat},${e.location.lng}`;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = '📍 地圖';
      art.appendChild(a);
    }
    return art;
  }

  function initDiary() {
    fillMoods();
    resetDiaryForm();
    $('diaryPicker').value = todayMonth();
    const selectedMonth = () => $('diaryPicker').value || todayMonth();

    const renderList = () => {
      const list = C.monthDiary(diary, selectedMonth());
      const box = $('diaryList');
      box.textContent = '';
      for (const e of list) box.appendChild(diaryItem(e));
      $('diaryEmpty').hidden = list.length > 0;
    };
    onDiaryChange = renderList;

    $('diaryPicker').addEventListener('change', renderList);
    $('diaryPrev').onclick = () => { $('diaryPicker').value = C.addMonths(selectedMonth(), -1); renderList(); };
    $('diaryNext').onclick = () => { $('diaryPicker').value = C.addMonths(selectedMonth(), 1); renderList(); };

    $('diaryPhotos').addEventListener('change', async ev => {
      const files = [...ev.target.files];
      if (files.length > C.MAX_DIARY_PHOTOS) toast(`最多 ${C.MAX_DIARY_PHOTOS} 張，已取前 ${C.MAX_DIARY_PHOTOS} 張`);
      pendingDiaryPhotos = [];
      for (const file of files.slice(0, C.MAX_DIARY_PHOTOS)) {
        try {
          pendingDiaryPhotos.push(await compressImage(file));
        } catch {
          toast('有一張圖片無法讀取，已略過');
        }
      }
      renderThumbs($('diaryPreview'), pendingDiaryPhotos, '待上傳的照片');
    });

    $('diaryForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const submitBtn = $('diaryForm').querySelector('button[type=submit]');
      submitBtn.disabled = true;
      try {
        const location = $('diaryLocation').checked ? await getLocation() : null;
        const picked = document.querySelector('input[name=mood]:checked');
        const res = C.buildDiary({
          date: $('diaryDate').value,
          mood: picked ? picked.value : null,
          text: $('diaryText').value,
          photos: pendingDiaryPhotos,
          location,
        }, newId());
        if (!res.ok) {
          toast(res.message);
          $(res.field === 'date' ? 'diaryDate' : 'diaryText').focus();
          return;
        }
        res.entry.u = Date.now();
        diary.push(res.entry);
        if (!save()) {
          diary.pop();
          return;
        }
        resetDiaryForm();
        $('diaryPicker').value = C.monthOf(res.entry.date);
        renderList();
        toast('已寫下這一天');
      } finally {
        submitBtn.disabled = false;
      }
    });

    renderList();
  }

  /* ---------- 幣別與匯率 ---------- */

  let fx = null;
  let onFxChange = () => {};
  let fxRefreshing = false;

  // 匯率每 12 小時向 open.er-api.com 更新一次；失敗時沿用上次的匯率，也可以手動修改
  async function refreshFx() {
    if (!C.fxIsStale(fx) || fxRefreshing) return;
    fxRefreshing = true;
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/TWD');
      const parsed = C.parseFx(await res.json());
      if (parsed) {
        fx = parsed;
        localStorage.setItem(KEYS.fx, JSON.stringify(fx));
        onFxChange();
      }
    } catch {
      // 離線或服務暫時無法連線：沿用舊的匯率
    } finally {
      fxRefreshing = false;
    }
  }

  function updateRateField() {
    const cur = $('expCurrency').value;
    const foreign = cur !== 'TWD';
    $('rateField').hidden = !foreign;
    if (!foreign) return;
    const rate = Number($('expRate').value);
    const amount = Number($('expAmount').value);
    const updated = fx && fx.updated ? `（匯率更新於 ${fx.updated.slice(0, 16)}）` : '';
    if (!$('expRate').value) {
      $('fxPreview').textContent = '還沒有取得匯率，請手動輸入，或稍後再試' + updated;
    } else if (amount > 0 && rate > 0) {
      $('fxPreview').textContent = `換算成台幣：約 ${money(Math.round(amount * rate))}` + updated;
    } else {
      $('fxPreview').textContent = '' + updated;
    }
  }

  function initExpense() {
    fillCategories($('expCategory'));
    for (const p of C.PAY_METHODS) {
      const o = document.createElement('option');
      o.textContent = p;
      $('expPay').appendChild(o);
    }
    for (const c of C.CURRENCIES) {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = C.CURRENCY_LABELS[c];
      $('expCurrency').appendChild(o);
    }
    $('expCurrency').addEventListener('change', () => {
      $('expRate').value = fx && fx.twdPer[$('expCurrency').value] ? fx.twdPer[$('expCurrency').value] : '';
      updateRateField();
    });
    $('expAmount').addEventListener('input', updateRateField);
    $('expRate').addEventListener('input', updateRateField);
    onFxChange = () => {
      const cur = $('expCurrency').value;
      if (cur !== 'TWD' && !$('expRate').value && fx && fx.twdPer[cur]) $('expRate').value = fx.twdPer[cur];
      updateRateField();
    };
    onFxChange();
    renderTags(false);
    $('expCategory').addEventListener('change', () => renderTags(false));
    $('tagAdd').onclick = addCustomTag;
    $('tagInput').addEventListener('keydown', ev => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        addCustomTag();
      }
    });
    $('expDate').value = todayIso();

    const selectedDate = () => $('expDate').value || todayIso();

    const render = () => {
      const date = selectedDate();
      const d = C.daySummary(expenses, date, settings.dailyLimit);
      $('dayTitle').textContent = date === todayIso() ? '今天的生活費' : `${date} 的生活費`;
      $('daySpent').textContent = '已花 ' + money(d.spent);
      $('dayRemain').textContent = d.remain < 0 ? '超支 ' + money(-d.remain) : '剩餘 ' + money(d.remain);
      setBar($('dayBar'), d.percent);
      $('dayHint').textContent = `每日上限 ${money(settings.dailyLimit)}；朋友聚會不計入這裡。`;

      const list = expenses.filter(e => e.date === date).sort((a, b) => b.id - a.id);
      fillRows($('dayRows'), list, false);
      $('dayEmpty').hidden = list.length > 0;
    };

    $('expDate').addEventListener('change', render);
    document.querySelectorAll('[data-amt]').forEach(b => b.addEventListener('click', () => {
      $('expAmount').value = b.dataset.amt;
      $('expAmount').focus();
    }));

    $('expPhotos').addEventListener('change', async ev => {
      const files = [...ev.target.files];
      if (files.length > C.MAX_PHOTOS) toast(`最多 ${C.MAX_PHOTOS} 張，已取前 ${C.MAX_PHOTOS} 張`);
      pendingPhotos = [];
      for (const file of files.slice(0, C.MAX_PHOTOS)) {
        try {
          pendingPhotos.push(await compressImage(file));
        } catch {
          toast('有一張圖片無法讀取，已略過');
        }
      }
      renderPhotoPreview();
    });

    $('expForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const submitBtn = $('expForm').querySelector('button[type=submit]');
      submitBtn.disabled = true;
      try {
        const location = $('expLocation').checked ? await getLocation() : null;
        const res = C.buildExpense({
          date: $('expDate').value,
          amount: $('expAmount').value,
          currency: $('expCurrency').value,
          rate: $('expRate').value,
          category: $('expCategory').value,
          pay: $('expPay').value,
          note: $('expNote').value,
          meals: checkedMeals(),
          photos: pendingPhotos,
          location,
        }, newId());
        if (!res.ok) {
          toast(res.message);
          $(res.field === 'date' ? 'expDate' : 'expAmount').focus();
          return;
        }
        res.expense.u = Date.now();
        expenses.push(res.expense);
        if (!save()) {
          expenses.pop();
          return;
        }
        resetExpenseForm();
        render();
        toast(`已記錄 ${money(res.expense.amount)}`);
        $('expAmount').focus();
      } finally {
        submitBtn.disabled = false;
      }
    });

    onChange = render;
    render();
  }

  /* ---------- 明細 ---------- */

  function initHistory() {
    $('histPicker').value = todayMonth();
    const selectedMonth = () => $('histPicker').value || todayMonth();

    const render = () => {
      const p = C.plan(settings, todayMonth());
      const cap = p.dailyBudget;
      const m = C.monthSummary(expenses, selectedMonth());

      $('sumLife').textContent = money(m.life);
      $('sumOuting').textContent = money(m.outing);
      $('sumTotal').textContent = money(m.total);

      $('lifeText').textContent = `${money(m.life)} / ${money(cap)}`;
      const lifePct = C.percentOf(m.life, cap);
      $('lifePct').textContent = m.life > cap
        ? '超支 ' + money(m.life - cap)
        : `剩餘 ${money(cap - m.life)}（${Math.round(lifePct)}%）`;
      setBar($('lifeBar'), lifePct);

      $('outingText').textContent = `${money(m.outing)} / ${money(settings.outing)}`;
      setBar($('outingBar'), C.percentOf(m.outing, settings.outing));

      renderCategories(m.categories);
      renderCategories(m.pays, 'payBreakdown');

      const list = m.list.slice().sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
      fillRows($('histRows'), list, true);
      $('histEmpty').hidden = list.length > 0;
      $('exportBtn').disabled = list.length === 0;
    };

    $('histPicker').addEventListener('change', render);
    $('histPrev').onclick = () => { $('histPicker').value = C.addMonths(selectedMonth(), -1); render(); };
    $('histNext').onclick = () => { $('histPicker').value = C.addMonths(selectedMonth(), 1); render(); };
    $('histThis').onclick = () => { $('histPicker').value = todayMonth(); render(); };

    $('exportBtn').onclick = () => {
      const m = selectedMonth();
      const list = C.monthSummary(expenses, m).list
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
      const url = URL.createObjectURL(new Blob([C.toCsv(list)], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `expenses-${m}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    onChange = render;
    render();
  }

  function renderCategories(categories, boxId = 'catBreakdown') {
    const box = $(boxId);
    box.textContent = '';
    if (!categories.length) {
      const d = document.createElement('div');
      d.className = 'muted';
      d.textContent = '本月尚無分類資料';
      box.appendChild(d);
      return;
    }
    const max = Math.max(...categories.map(t => t[1]));
    for (const [name, val] of categories) {
      const row = document.createElement('div');
      row.className = 'cat-row';
      const label = document.createElement('span');
      label.textContent = name;
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('span');
      fill.style.width = (val / max * 100) + '%';
      bar.appendChild(fill);
      const amt = document.createElement('span');
      amt.className = 'amt';
      amt.textContent = money(val);
      row.append(label, bar, amt);
      box.appendChild(row);
    }
  }

  /* ---------- 存錢計畫 ---------- */

  function initPlan() {
    const render = () => {
      const p = C.plan(settings, todayMonth());

      $('planStage1').textContent = money(p.buffer) + ' / 月';
      $('planStage1Note').textContent = p.cardMonths
        ? `信用卡分期約還 ${p.cardMonths} 個月（約 ${p.payoff} 繳清，未計利息）。這段期間每月先保留剩餘金額作緩衝。`
        : '目前沒有信用卡分期，每月剩餘金額可直接存下。';

      $('planStage2').textContent = money(p.afterSave) + ' / 月';
      $('planStage2Note').textContent = p.cardPay > 0
        ? `分期結束後，把原本的 ${money(p.cardPay)} 轉為固定存款，剩餘金額作為彈性預算。`
        : '每月固定存下剩餘金額。';

      $('planYear').textContent = money(p.year);
      $('planYearNote').textContent = `前 ${Math.min(12, p.cardMonths)} 個月每月存 ${money(p.buffer)}，之後每月存 ${money(p.afterSave)}。`;

      const rows = $('planRows');
      rows.textContent = '';
      let total = 0;
      for (let i = 0; i < 12; i++) {
        const saving = i < p.cardMonths ? p.buffer : p.afterSave;
        total += saving;
        const tr = document.createElement('tr');
        tr.append(cell(C.addMonths(todayMonth(), i)), cell(money(saving), 'amount'), cell(money(total), 'amount'));
        rows.appendChild(tr);
      }
    };
    onChange = render;
    render();
  }

  /* ---------- 設定 ---------- */

  function initSettings() {
    const fill = () => {
      for (const k of Object.keys(C.DEFAULTS)) $(k).value = settings[k];
    };
    fill();
    onChange = fill;
    initCloudPanel();

    $('setReset').onclick = () => {
      for (const k of Object.keys(C.DEFAULTS)) $(k).value = C.DEFAULTS[k];
      toast('已還原預設值，按「儲存設定」後生效');
    };

    $('setForm').addEventListener('submit', ev => {
      ev.preventDefault();
      const raw = {};
      for (const k of Object.keys(C.DEFAULTS)) raw[k] = $(k).value;
      const res = C.validateSettings(raw);
      if (!res.ok) {
        toast(res.message);
        $(res.field).focus();
        return;
      }
      const prev = settings;
      settings = res.values;
      meta = { ...meta, settingsU: Date.now() };
      if (!save()) {
        settings = prev;
        return;
      }
      toast('設定已儲存');
    });
  }

  /* ---------- 啟動 ---------- */

  const INITS = {
    overview: initOverview,
    expense: initExpense,
    diary: initDiary,
    history: initHistory,
    plan: initPlan,
    settings: initSettings,
  };

  // 設定了雲端同步時，沒有登入就只能看登入頁，別人看不到這台裝置上的資料
  const locked = cloudReady() && !SavingPlanCloud.currentUser();
  if (page === 'login') {
    initLogin();
  } else if (locked) {
    location.replace('login.html');
  } else if (page === 'profiles' && !cloudReady()) {
    location.replace('index.html');
  } else {
    load();
    if (cloudReady()) ensureAcct();
    if (page === 'profiles') {
      initProfiles();
    } else if (cloudReady() && !activeProfile()) {
      // 還沒選擇使用者：先到選擇頁
      location.replace('profiles.html');
    } else {
      if (INITS[page]) INITS[page]();
      refreshFx();

      // 開啟任何頁面時同步一次；切回這個分頁時也同步
      if (cloudReady()) syncNow();
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) syncNow();
      });
    }
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
