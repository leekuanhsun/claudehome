/* 存錢計畫的畫面與互動；計算邏輯在 calc.js */
(function () {
  'use strict';

  const C = window.SavingPlanCalc;
  const $ = id => document.getElementById(id);
  const KEYS = { settings: 'savingPlan.v2.settings', expenses: 'savingPlan.v2.expenses' };
  const LEGACY = { settings: 'savingPlanSettings', expenses: 'savingPlanExpenses' };

  let settings = { ...C.DEFAULTS };
  let expenses = [];

  const money = n => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
  const todayIso = () => C.toIsoDate(new Date());
  const todayMonth = () => C.monthOf(todayIso());
  const selectedMonth = () => $('monthPicker').value || todayMonth();
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

  /* ---------- 畫面 ---------- */

  function render() {
    const p = C.plan(settings, todayMonth());
    $('incomeView').textContent = money(settings.income);
    $('loanView').textContent = money(settings.loan);
    $('dailyBudgetView').textContent = money(p.dailyBudget);
    $('outingView').textContent = money(settings.outing);
    $('cardView').textContent = money(p.cardPay);
    const lv = $('leftoverView');
    lv.textContent = money(p.leftover);
    lv.classList.toggle('neg', p.leftover < 0);
    $('leftoverWarn').hidden = p.leftover >= 0;
    renderDay();
    renderMonth(p);
    renderTable();
    renderPlan(p);
  }

  function renderDay() {
    const date = $('expenseDate').value || todayIso();
    const d = C.daySummary(expenses, date, settings.dailyLimit);
    $('daySpentLabel').textContent = '已花 ' + money(d.spent);
    $('dayRemainLabel').textContent = d.remain < 0 ? '超支 ' + money(-d.remain) : '剩餘 ' + money(d.remain);
    setBar($('dayBar'), d.percent);
    $('dayHint').textContent = d.remain < 0
      ? `今天已超出每日上限 ${money(-d.remain)}，可以看看哪些項目能調整。`
      : `每日上限 ${money(settings.dailyLimit)}；朋友聚會不計入這裡。`;
  }

  function renderMonth(p) {
    const m = C.monthSummary(expenses, selectedMonth());
    const cap = p.dailyBudget;

    $('monthSpentLabel').textContent = money(m.life) + ' / ' + money(cap);
    setBar($('monthBar'), C.percentOf(m.life, cap));
    $('monthRemainLabel').textContent = m.life > cap
      ? '超支 ' + money(m.life - cap)
      : '生活費剩餘 ' + money(cap - m.life);
    $('monthPercent').textContent = Math.round(C.percentOf(m.life, cap)) + '%';

    $('outingSpentLabel').textContent = money(m.outing) + ' / ' + money(settings.outing);
    setBar($('outingBar'), C.percentOf(m.outing, settings.outing));

    $('monthTotal').textContent = money(m.total);
    renderCategories(m.categories);
  }

  function renderCategories(categories) {
    const box = $('catBreakdown');
    box.textContent = '';
    if (!categories.length) {
      const d = document.createElement('div');
      d.className = 'hint';
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

  function renderTable() {
    const list = C.monthSummary(expenses, selectedMonth()).list
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    const tbody = $('expenseRows');
    tbody.textContent = '';
    for (const e of list) {
      const tr = document.createElement('tr');
      tr.append(cell(e.date), cell(e.category), cell(e.note || '—'), cell(money(e.amount), 'amount'));
      const op = document.createElement('td');
      const btn = document.createElement('button');
      btn.className = 'danger-sm';
      btn.type = 'button';
      btn.textContent = '刪除';
      btn.setAttribute('aria-label', `刪除 ${e.date} ${e.category} ${money(e.amount)}`);
      btn.onclick = () => removeExpense(e.id);
      op.appendChild(btn);
      tr.appendChild(op);
      tbody.appendChild(tr);
    }
    $('emptyState').hidden = list.length > 0;
    $('exportBtn').disabled = list.length === 0;
  }

  function renderPlan(p) {
    $('stage1Save').textContent = money(p.buffer) + '／月';
    $('stage1Hint').textContent = p.cardMonths
      ? `信用卡分期約還 ${p.cardMonths} 個月（約 ${p.payoff} 繳清，未計利息）。這段期間每月先保留剩餘金額作緩衝。`
      : '目前沒有信用卡分期，每月剩餘金額可直接存下。';
    $('stage2Save').textContent = money(p.afterSave) + '／月';
    $('stage2Hint').textContent = p.cardPay > 0
      ? `分期結束後，把原本的 ${money(p.cardPay)} 轉為固定存款，剩餘金額作為彈性預算。`
      : '每月固定存下剩餘金額。';
    $('yearEstimate').textContent = money(p.year);
    $('yearHint').textContent = `假設未來 12 個月：前 ${Math.min(12, p.cardMonths)} 個月每月存 ${money(p.buffer)}，之後每月存 ${money(p.afterSave)}。`;
  }

  function fillCategories() {
    const sel = $('expenseCategory');
    for (const c of C.CATEGORIES) {
      const o = document.createElement('option');
      o.textContent = c;
      sel.appendChild(o);
    }
  }

  function fillSettingsForm() {
    for (const k of Object.keys(C.DEFAULTS)) $(k).value = settings[k];
  }

  /* ---------- 動作 ---------- */

  function openSettings(open) {
    $('settingsForm').hidden = !open;
    $('editBudgetBtn').setAttribute('aria-expanded', String(open));
    if (open) {
      fillSettingsForm();
      $('income').focus();
    }
  }

  function removeExpense(id) {
    const e = expenses.find(x => x.id === id);
    if (!e) return;
    if (!confirm(`確定刪除這筆 ${money(e.amount)}（${e.category}）？`)) return;
    const prev = expenses;
    expenses = expenses.filter(x => x.id !== id);
    if (save()) {
      render();
      toast('已刪除');
    } else {
      expenses = prev;
    }
  }

  $('editBudgetBtn').onclick = () => openSettings($('settingsForm').hidden);
  $('cancelSettings').onclick = () => openSettings(false);
  $('resetSettings').onclick = () => {
    for (const k of Object.keys(C.DEFAULTS)) $(k).value = C.DEFAULTS[k];
    toast('已還原預設值，按「儲存設定」後生效');
  };

  $('settingsForm').addEventListener('submit', ev => {
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
    render();
    openSettings(false);
    toast('設定已儲存');
  });

  document.querySelectorAll('[data-amt]').forEach(b => b.addEventListener('click', () => {
    $('expenseAmount').value = b.dataset.amt;
    $('expenseAmount').focus();
  }));

  $('expenseForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const res = C.buildExpense({
      date: $('expenseDate').value,
      amount: $('expenseAmount').value,
      category: $('expenseCategory').value,
      note: $('expenseNote').value,
    }, newId());
    if (!res.ok) {
      toast(res.message);
      $(res.field === 'date' ? 'expenseDate' : 'expenseAmount').focus();
      return;
    }
    expenses.push(res.expense);
    if (!save()) {
      expenses.pop();
      return;
    }
    $('monthPicker').value = C.monthOf(res.expense.date);
    $('expenseAmount').value = '';
    $('expenseNote').value = '';
    render();
    toast(`已記錄 ${money(res.expense.amount)}`);
    $('expenseAmount').focus();
  });

  $('expenseDate').addEventListener('change', render);
  $('monthPicker').addEventListener('change', render);
  $('prevMonth').onclick = () => { $('monthPicker').value = C.addMonths(selectedMonth(), -1); render(); };
  $('nextMonth').onclick = () => { $('monthPicker').value = C.addMonths(selectedMonth(), 1); render(); };
  $('thisMonth').onclick = () => { $('monthPicker').value = todayMonth(); render(); };

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

  /* ---------- 初始化 ---------- */

  fillCategories();
  load();
  $('expenseDate').value = todayIso();
  $('monthPicker').value = todayMonth();
  render();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
