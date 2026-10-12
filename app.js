/* 存錢計畫的畫面與互動；計算邏輯在 calc.js。每個頁面由 body 的 data-page 決定要執行哪一段。 */
(function () {
  'use strict';

  const C = window.SavingPlanCalc;
  const $ = id => document.getElementById(id);
  const KEYS = { settings: 'savingPlan.v2.settings', expenses: 'savingPlan.v2.expenses' };
  const LEGACY = { settings: 'savingPlanSettings', expenses: 'savingPlanExpenses' };
  const page = document.body.dataset.page;

  let settings = { ...C.DEFAULTS };
  let expenses = [];
  let onChange = () => {};

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

  // 備註欄：餐別、心得、照片縮圖、位置連結
  function noteCell(e) {
    const td = document.createElement('td');
    const meals = e.meals || [];
    const photos = e.photos || [];
    if (!meals.length && !e.note && !photos.length && !e.location) {
      td.textContent = '—';
      return td;
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
  }

  function save() {
    try {
      localStorage.setItem(KEYS.settings, JSON.stringify(settings));
      localStorage.setItem(KEYS.expenses, JSON.stringify(expenses));
      return true;
    } catch {
      toast('無法儲存資料，請確認瀏覽器儲存空間或是否在無痕模式');
      return false;
    }
  }

  function removeExpense(id) {
    const e = expenses.find(x => x.id === id);
    if (!e || !confirm(`確定刪除這筆 ${money(e.amount)}（${e.category}）？`)) return;
    const prev = expenses;
    expenses = expenses.filter(x => x.id !== id);
    if (save()) {
      toast('已刪除');
      onChange();
    } else {
      expenses = prev;
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

  function fillMeals() {
    const box = $('mealChips');
    for (const m of C.MEALS) {
      const label = document.createElement('label');
      label.className = 'check-chip';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'meal';
      input.value = m;
      label.append(input, document.createTextNode(m));
      box.appendChild(label);
    }
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

  function initExpense() {
    fillCategories($('expCategory'));
    fillMeals();
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
          category: $('expCategory').value,
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

  function renderCategories(categories) {
    const box = $('catBreakdown');
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
    history: initHistory,
    plan: initPlan,
    settings: initSettings,
  };

  load();
  if (INITS[page]) INITS[page]();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
