/* ==========================================================================
   ClutchAI — app.js
   App state lives in the browser (localStorage). Real AI calls go to a
   small backend endpoint you deploy yourself (see README.md) — that
   backend holds your Gemini API key server-side and forwards requests to
   Google's Gemini API. No AI key ever lives in this file or in the browser.
   ========================================================================== */

const STORAGE_KEY = 'clutchai_state_v1';
const BACKEND_URL_STORAGE = 'clutchai_backend_url';

// Baked-in default backend so the app works with real AI out of the box for
// anyone who opens this site — no setup needed on their end. This is just a
// public URL, not a secret, so it's safe to include here. Any visitor can
// still switch to demo mode or point at a different backend via the pill.
const DEFAULT_BACKEND_URL = 'https://clutchai-backend.prishahchheda.workers.dev/';

// Returns the effective backend URL: an explicit per-visitor override from
// localStorage if one has ever been saved (including an intentionally blank
// value, which means "use demo mode"), otherwise the baked-in default above.
function getBackendUrl() {
  const stored = localStorage.getItem(BACKEND_URL_STORAGE);
  if (stored === null) return DEFAULT_BACKEND_URL;
  return stored;
}

/* ---------------- Splitwise (real shared-expense balances) ----------------
   Optional. If connected, your real Splitwise balances are pulled in
   automatically and folded into your protected commitments — no manual
   typing. See README.md, section "7. Connect Splitwise (optional)". */

const SPLITWISE_TOKEN_STORAGE = 'clutchai_splitwise_token';

// Demo mode: lets the Splitwise feature be shown end-to-end (protected
// commitments, Safe-to-Spend impact, per-friend balances) without a real
// Splitwise API key — Splitwise currently requires a paid plan to register
// a third-party app, so this is a stand-in until real credentials exist.
// It never touches the real OAuth flow below; once SPLITWISE_CLIENT_ID /
// SECRET are added to the Worker, connectSplitwise() just works as-is.
const SPLITWISE_DEMO_STORAGE = 'clutchai_splitwise_demo';
function isSplitwiseDemo() { return localStorage.getItem(SPLITWISE_DEMO_STORAGE) === '1'; }

// Small, clearly-fictional sample so it's obvious at a glance this isn't a
// real account's data.
function getMockSplitwiseData() {
  return {
    netBalance: -650,
    owedToYou: 850,
    youOwe: 1500,
    friends: [
      { name: 'Aisha Verma (demo)', amount: 850 },
      { name: 'Rohit Malhotra (demo)', amount: -600 },
      { name: 'Neha Kapoor (demo)', amount: -900 },
    ],
  };
}

function connectSplitwiseDemo() {
  localStorage.setItem(SPLITWISE_DEMO_STORAGE, '1');
  splitwiseData = getMockSplitwiseData();
  splitwiseStatus = 'ready';
  render();
}

// Holds the last-fetched balance summary in memory only (not persisted —
// re-fetched fresh each time the app loads, so it's never stale for long).
let splitwiseData = null;   // { netBalance, owedToYou, youOwe, friends: [...] }
let splitwiseStatus = 'disconnected'; // 'disconnected' | 'loading' | 'ready' | 'error'
let splitwiseErrorMsg = '';

function getSplitwiseToken() { return localStorage.getItem(SPLITWISE_TOKEN_STORAGE); }

// If Splitwise (via the backend) just redirected back to us, pick up the
// token or error from the URL, store it, and clean the URL bar.
function handleSplitwiseRedirect() {
  const params = new URLSearchParams(location.search);
  const token = params.get('splitwise_token');
  const err = params.get('splitwise_error');
  if (token) {
    localStorage.setItem(SPLITWISE_TOKEN_STORAGE, token);
    localStorage.removeItem(SPLITWISE_DEMO_STORAGE); // a real connection supersedes demo mode
    history.replaceState({}, '', location.pathname);
  } else if (err) {
    splitwiseStatus = 'error';
    splitwiseErrorMsg = decodeURIComponent(err);
    history.replaceState({}, '', location.pathname);
  }
}

function connectSplitwise() {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    alert('Connect an AI backend first (top-right pill) — Splitwise uses the same backend.');
    return;
  }
  window.location.href = backendUrl.replace(/\/$/, '') + '/splitwise/connect';
}

function disconnectSplitwise() {
  localStorage.removeItem(SPLITWISE_TOKEN_STORAGE);
  localStorage.removeItem(SPLITWISE_DEMO_STORAGE);
  splitwiseData = null;
  splitwiseStatus = 'disconnected';
  render();
}

async function fetchSplitwiseBalances() {
  const token = getSplitwiseToken();
  const backendUrl = getBackendUrl();
  if (!token || !backendUrl) return;

  splitwiseStatus = 'loading';
  renderSplitwise();

  try {
    const res = await fetch(backendUrl.replace(/\/$/, '') + '/splitwise/balances?token=' + encodeURIComponent(token));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Splitwise lookup failed (${res.status})`);
    splitwiseData = data;
    splitwiseStatus = 'ready';
  } catch (err) {
    splitwiseStatus = 'error';
    splitwiseErrorMsg = err.message || String(err);
  }
  render();
}

const CATEGORY_ICON = {
  'Food & Dining': '🍔', 'Transport': '🚗', 'Shopping': '🛍️',
  'Subscriptions': '📺', 'Fun & Social': '🎉', 'Bills': '📄',
  'Education': '🎓', 'Health': '❤️', 'Investing & Trading': '📈', 'Other': '•'
};
const CATEGORY_COLOR = {
  'Food & Dining': '#2B3EF0', 'Transport': '#5B6BF5', 'Shopping': '#E8503A',
  'Subscriptions': '#F0A63E', 'Fun & Social': '#D65DB1', 'Bills': '#55534B',
  'Education': '#1f7a4a', 'Health': '#C9455B', 'Investing & Trading': '#E8B93E',
  'Other': '#A9A497'
};

/* ---------------- state ---------------- */

function defaultState() {
  const today = new Date();
  const nextMonth = new Date(today); nextMonth.setDate(nextMonth.getDate() + 30);
  return {
    balance: 15000,
    income: 15000,
    nextInflow: nextMonth.toISOString().slice(0, 10),
    allowanceMode: 'monthly',   // 'monthly' | 'weekly'
    weekStartDay: 0,            // 0=Sunday .. 6=Saturday — only used when allowanceMode is 'weekly'
    milestones: [],
    transactions: [],
    categoryBudgets: {
      'Food & Dining': 4000, 'Transport': 2000, 'Shopping': 2500,
      'Subscriptions': 1000, 'Fun & Social': 2000, 'Bills': 2000,
      'Education': 2000, 'Health': 1500, 'Investing & Trading': 3000, 'Other': 1000
    },
    examPeriods: [],
    vault: 0,
    vaultLog: []
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch (e) { return defaultState(); }
}

function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

let state = loadState();

/* ---------------- helpers ---------------- */

function formatINR(n) {
  n = Math.round(n || 0);
  return '₹' + n.toLocaleString('en-IN');
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

function daysBetween(fromISO, toISO) {
  const a = new Date(fromISO + 'T00:00:00');
  const b = new Date(toISO + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

function totalSpent() {
  return state.transactions.reduce((s, t) => s + Number(t.amount || 0), 0);
}

function spentByCategory() {
  const map = {};
  state.transactions.forEach(t => { map[t.category] = (map[t.category] || 0) + Number(t.amount || 0); });
  return map;
}

/* upcoming, unpaid protected commitments */
function activeMilestones() {
  const today = todayISO();
  return state.milestones.filter(m => m.date >= today);
}

/* --------------- weekly allowance cycle (personalized week-start day) --------------- */

function isWeekly() { return state.allowanceMode === 'weekly'; }

// The student's current week runs [periodStart, periodEnd) where periodStart
// is the most recent occurrence of their chosen "week starts" weekday
// (on or before today) and periodEnd is exactly 7 days later — e.g.
// ₹2,000 + Sunday = a Sunday-through-Saturday cycle, not just "last 7 days".
function getPeriodBounds() {
  const startDow = Number(state.weekStartDay ?? 0);
  const today = new Date(todayISO() + 'T00:00:00');
  const diff = (today.getDay() - startDow + 7) % 7;
  const periodStart = new Date(today);
  periodStart.setDate(periodStart.getDate() - diff);
  const periodEnd = new Date(periodStart);
  periodEnd.setDate(periodEnd.getDate() + 7);
  return {
    start: periodStart.toISOString().slice(0, 10),
    end: periodEnd.toISOString().slice(0, 10),
  };
}

function periodSpent() {
  const { start, end } = getPeriodBounds();
  return state.transactions
    .filter(t => t.date >= start && t.date < end)
    .reduce((s, t) => s + Number(t.amount || 0), 0);
}

/* --------------- the runway engine (Feature 1) --------------- */

function computeRunway() {
  let protectedTotal = activeMilestones().reduce((s, m) => s + Number(m.amount || 0), 0);
  // Money you currently owe friends on Splitwise is money that's already
  // spoken for, same as rent or tuition — so it's protected first too.
  if (splitwiseData && splitwiseData.youOwe) protectedTotal += Number(splitwiseData.youOwe) || 0;

  if (isWeekly()) {
    // Weekly mode: "available" resets each personal week cycle instead of
    // depleting a lump balance forever — allowance minus what's been spent
    // since this week's start day.
    const { end } = getPeriodBounds();
    const allowance = Number(state.income || 0);
    const available = allowance - periodSpent();
    const spendable = Math.max(available - protectedTotal, 0);
    let days = daysBetween(todayISO(), end);
    if (!days || days < 1) days = 1;
    const dailyRunway = spendable / days;
    return { available, protectedTotal, spendable, days, dailyRunway, periodEnd: end };
  }

  // Monthly mode — unchanged from the original behavior.
  const available = Number(state.balance || 0) - totalSpent();
  const spendable = Math.max(available - protectedTotal, 0);
  let days = daysBetween(todayISO(), state.nextInflow);
  if (!days || days < 1) days = 1;
  const dailyRunway = spendable / days;
  return { available, protectedTotal, spendable, days, dailyRunway, periodEnd: state.nextInflow };
}

/* simulate what the runway becomes if `amount` is spent now */
function simulateSpend(amount, timeframeDays) {
  const r = computeRunway();
  const newSpendable = Math.max(r.spendable - Number(amount || 0), 0);
  const windowDays = Math.max(Math.min(timeframeDays || r.days, r.days), 1);
  const simulatedDaily = newSpendable / windowDays;
  return { ...r, newSpendable, windowDays, simulatedDaily };
}

/* --------------- rendering --------------- */

function render() {
  renderTopStatus();
  renderOverview();
  renderRunwayBar();
  renderExams();
  renderVault();
  renderSplitwise();
  renderTxList();
  renderDonut();
  renderTrend();
  renderBudgets();
  renderMilestoneList();
  saveState();
}

function renderTopStatus() {
  const backendUrl = getBackendUrl();
  const pill = document.getElementById('apiStatusPill');
  const txt = document.getElementById('apiStatusText');
  pill.classList.remove('ok', 'warn');
  if (backendUrl) { pill.classList.add('ok'); txt.textContent = 'AI connected (Gemini)'; }
  else { txt.textContent = 'Demo mode · simulated AI'; }

  document.getElementById('txCountPill').textContent = state.transactions.length + ' transactions';
}

function renderOverview() {
  const r = computeRunway();
  const el = document.getElementById('overviewCards');
  el.innerHTML = `
    <div class="card">
      <div class="stat-label">Available balance</div>
      <div class="stat-value">${formatINR(r.available)}</div>
      <div class="stat-note">${isWeekly() ? "This week's allowance − what you've logged since it started" : "Income − everything you've logged"}</div>
    </div>
    <div class="card">
      <div class="stat-label">Protected commitments</div>
      <div class="stat-value">${formatINR(r.protectedTotal)}</div>
      <div class="stat-note">${activeMilestones().length} upcoming milestone(s)${splitwiseData && splitwiseData.youOwe ? ` + ${formatINR(splitwiseData.youOwe)} owed on Splitwise` : ''} reserved</div>
    </div>
    <div class="card accent">
      <div class="stat-label" style="color:#DDE1FB;">Safe to spend, today</div>
      <div class="stat-value">${formatINR(r.dailyRunway)}<span style="font-size:15px; font-weight:500;">/day</span></div>
      <div class="stat-note">${isWeekly() ? `Until this week resets on ${r.periodEnd || '—'}` : `Until your next inflow on ${r.periodEnd || '—'}`}</div>
    </div>
  `;
}

function renderRunwayBar() {
  const r = computeRunway();
  const fill = document.getElementById('runwayFill');
  const pct = Math.max(Math.min((r.spendable / Math.max(r.available, 1)) * 100, 100), 4);
  fill.style.width = pct + '%';
  fill.classList.toggle('danger', r.dailyRunway < 200);
  document.getElementById('runwayDaysLabel').textContent =
    `${r.days} day${r.days === 1 ? '' : 's'} to next inflow · ${formatINR(r.dailyRunway)}/day safe`;
}

function renderMilestoneList() {
  const el = document.getElementById('milestoneList');
  if (!state.milestones.length) { el.innerHTML = '<p class="list-empty">No protected commitments yet.</p>'; return; }
  el.innerHTML = state.milestones.map((m, i) => `
    <div class="milestone-row">
      <span>${m.name} · ${m.date}</span>
      <span style="display:flex; align-items:center; gap:10px;">
        <strong>${formatINR(m.amount)}</strong>
        <button class="icon-btn" onclick="removeMilestone(${i})">✕</button>
      </span>
    </div>
  `).join('');
}

function renderExams() {
  const today = todayISO();
  const upcoming = state.examPeriods
    .filter(e => daysBetween(today, e.date) >= -1 && daysBetween(today, e.date) <= 14)
    .sort((a, b) => a.date.localeCompare(b.date));

  const alertsEl = document.getElementById('examAlerts');
  if (upcoming.length) {
    alertsEl.innerHTML = upcoming.map(e => {
      const d = daysBetween(today, e.date);
      const label = d <= 0 ? 'happening now' : `in ${d} day${d === 1 ? '' : 's'}`;
      return `<div class="banner coral">📚 <strong>${e.name}</strong> ${label} — students typically spend more on food, coffee &amp; transport this week. Consider keeping a buffer.</div>`;
    }).join('');
  } else {
    alertsEl.innerHTML = '';
  }

  const listEl = document.getElementById('examList');
  if (!state.examPeriods.length) { listEl.innerHTML = '<p class="list-empty">No high-pressure periods added yet.</p>'; return; }
  listEl.innerHTML = state.examPeriods.map((e, i) => `
    <div class="exam-row">
      <span>${e.name} · ${e.date}</span>
      <button class="icon-btn" onclick="removeExam(${i})">✕</button>
    </div>
  `).join('');
}

function renderVault() {
  document.getElementById('vaultBalance').textContent = formatINR(state.vault);
  const r = computeRunway();
  const avgDaily = r.spendable > 0 ? r.spendable / Math.max(r.days, 1) : 0;
  const comfortable = r.dailyRunway > avgDaily * 1.3 && r.dailyRunway > 300;
  const el = document.getElementById('vaultBanner');
  if (comfortable) {
    const amount = Math.min(300, Math.max(100, Math.round(r.dailyRunway * 0.15 / 10) * 10));
    el.innerHTML = `<div class="banner cobalt">
      Your runway looks comfortably healthy right now — safe to tuck away ${formatINR(amount)}?
      <span class="banner-actions"><button class="small cobalt" onclick="moveToVault(${amount})">Move to vault</button></span>
    </div>`;
  } else {
    el.innerHTML = '';
  }
}

function renderSplitwise() {
  const el = document.getElementById('splitwiseCard');
  if (!el) return; // safe no-op if this build's HTML doesn't have the card yet

  if (splitwiseStatus === 'disconnected') {
    el.innerHTML = `
      <div class="stat-label">Splitwise</div>
      <p class="stat-note">Connect your Splitwise account so shared expenses (trips, group dinners, rent splits) count toward your protected commitments automatically — no manual typing.</p>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button class="cobalt small" onclick="connectSplitwise()">Connect Splitwise</button>
        <button class="secondary small" onclick="connectSplitwiseDemo()">Try with demo data</button>
      </div>
      <p class="stat-note" style="margin-top:8px;">Real Splitwise sign-in needs API credentials on the backend. No credentials yet? Demo data shows exactly how this feature works once connected.</p>
    `;
    return;
  }

  if (splitwiseStatus === 'loading') {
    el.innerHTML = `<div class="stat-label">Splitwise</div><p class="loading-dots">Fetching your balances</p>`;
    return;
  }

  if (splitwiseStatus === 'error') {
    el.innerHTML = `
      <div class="stat-label">Splitwise</div>
      <p class="stat-note">Couldn't load your balances: ${escapeHtml(splitwiseErrorMsg)}</p>
      <div style="display:flex; gap:10px;">
        <button class="secondary small" onclick="fetchSplitwiseBalances()">Try again</button>
        <button class="secondary small" onclick="disconnectSplitwise()">Disconnect</button>
      </div>
    `;
    return;
  }

  // ready
  const isDemo = isSplitwiseDemo();
  const demoBadge = isDemo
    ? `<span style="font-family:var(--font-mono); font-size:10px; text-transform:uppercase; letter-spacing:0.05em; color:var(--coral); border:1px solid var(--coral); border-radius:999px; padding:2px 8px; margin-left:8px; vertical-align:middle;">Demo data</span>`
    : '';
  const d = splitwiseData || { netBalance: 0, owedToYou: 0, youOwe: 0, friends: [] };
  const netLabel = d.netBalance >= 0 ? 'You are owed, overall' : 'You owe, overall';
  el.innerHTML = `
    <div class="stat-label">Splitwise${demoBadge}</div>
    <div class="stat-value">${formatINR(Math.abs(d.netBalance))}</div>
    <p class="stat-note">${netLabel} · ${formatINR(d.youOwe)} of that is already counted in your protected commitments above${isDemo ? ' · Sample data — not a real Splitwise connection.' : ''}</p>
    ${d.friends.length ? `
      <div style="margin-top:10px;">
        ${d.friends.map(f => `
          <div class="milestone-row">
            <span>${escapeHtml(f.name)}</span>
            <strong>${f.amount >= 0 ? 'owes you ' : 'you owe '}${formatINR(Math.abs(f.amount))}</strong>
          </div>
        `).join('')}
      </div>
    ` : `<p class="list-empty">All settled up — no outstanding balances.</p>`}
    <button class="secondary small" style="margin-top:10px;" onclick="disconnectSplitwise()">${isDemo ? 'Exit demo' : 'Disconnect'}</button>
  `;
}

function renderTxList() {
  const el = document.getElementById('txList');
  if (!state.transactions.length) { el.innerHTML = '<p class="list-empty">No transactions yet — add one on the left.</p>'; return; }
  const sorted = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date));
  el.innerHTML = sorted.map(t => `
    <div class="tx-row">
      <div class="tx-main">
        <div class="tx-icon">${CATEGORY_ICON[t.category] || '•'}</div>
        <div>
          <div class="tx-desc">${escapeHtml(t.desc)}</div>
          <div class="tx-meta">${t.category} · ${t.date}</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <div class="tx-amount">${formatINR(t.amount)}</div>
        <button class="icon-btn" onclick="removeTx('${t.id}')">🗑</button>
      </div>
    </div>
  `).join('');
}

function renderDonut() {
  const byCat = spentByCategory();
  const total = Object.values(byCat).reduce((a, b) => a + b, 0);
  const wrap = document.getElementById('donutWrap');
  if (!total) { wrap.innerHTML = '<p class="list-empty">No spending logged this period.</p>'; return; }

  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  let acc = 0;
  const stops = entries.map(([cat, amt]) => {
    const start = (acc / total) * 360; acc += amt;
    const end = (acc / total) * 360;
    return `${CATEGORY_COLOR[cat] || '#999'} ${start}deg ${end}deg`;
  }).join(', ');

  wrap.innerHTML = `
    <div class="donut" style="background: conic-gradient(${stops});">
      <div class="donut-center"><div class="n">${formatINR(total)}</div><div class="l">SPENT</div></div>
    </div>
    <div class="legend">
      ${entries.map(([cat, amt]) => `
        <div class="legend-row">
          <span class="legend-swatch" style="background:${CATEGORY_COLOR[cat] || '#999'};"></span>
          <span>${cat}</span>
          <span class="amt">${formatINR(amt)} · ${Math.round(amt / total * 100)}%</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderTrend() {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), label: d.toLocaleString('en', { month: 'short' }) });
  }
  const sums = months.map(m => state.transactions
    .filter(t => t.date && t.date.slice(0, 7) === m.key)
    .reduce((s, t) => s + Number(t.amount || 0), 0));
  const max = Math.max(...sums, 1);
  const el = document.getElementById('trendChart');
  el.innerHTML = months.map((m, i) => `
    <div class="trend-col">
      <div class="trend-val">${sums[i] ? formatINR(sums[i]) : ''}</div>
      <div class="trend-bar ${i === months.length - 1 ? 'active' : ''}" style="height:${Math.max((sums[i] / max) * 100, 3)}%;"></div>
      <div class="trend-lbl">${m.label}</div>
    </div>
  `).join('');
}

function renderBudgets() {
  const byCat = spentByCategory();
  const el = document.getElementById('budgetCard');
  el.innerHTML = Object.entries(state.categoryBudgets).map(([cat, budget]) => {
    const spent = byCat[cat] || 0;
    const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
    const over = spent > budget;
    return `
      <div class="budget-row">
        <div class="budget-top">
          <span>${CATEGORY_ICON[cat] || ''} ${cat}</span>
          <span>
            <input type="number" value="${budget}" style="width:90px; display:inline-block; padding:4px 8px; font-size:12px;"
              onchange="updateBudget('${cat}', this.value)" />
          </span>
        </div>
        <div class="budget-bar"><div class="budget-bar-fill ${over ? 'over' : ''}" style="width:${pct}%;"></div></div>
        <div class="stat-note">${formatINR(spent)} spent · ${Math.round(pct)}%</div>
      </div>
    `;
  }).join('');
}

function escapeHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

/* ---------------- transactions ---------------- */

document.getElementById('addTxBtn').addEventListener('click', () => {
  const desc = document.getElementById('txDesc').value.trim();
  const amount = Number(document.getElementById('txAmount').value);
  const category = document.getElementById('txCategory').value;
  const date = document.getElementById('txDate').value || todayISO();
  if (!desc || !amount) return;
  state.transactions.push({ id: 'tx_' + Date.now(), desc, amount, category, date });
  document.getElementById('txDesc').value = '';
  document.getElementById('txAmount').value = '';
  render();
});

function removeTx(id) { state.transactions = state.transactions.filter(t => t.id !== id); render(); }

document.getElementById('csvBtn').addEventListener('click', () => document.getElementById('csvInput').click());
document.getElementById('csvInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const lines = reader.result.split('\n').map(l => l.trim()).filter(Boolean);
    lines.forEach(line => {
      const parts = line.split(',').map(s => s.trim());
      if (parts.length < 4) return;
      const [desc, amount, category, date] = parts;
      if (desc.toLowerCase() === 'description') return; // header row
      if (isNaN(Number(amount))) return;
      state.transactions.push({ id: 'tx_' + Date.now() + Math.random(), desc, amount: Number(amount), category: category || 'Other', date });
    });
    render();
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ---------------- milestones (settings modal) ---------------- */

// Shows/hides "Week starts" vs "Next inflow date" and relabels the
// allowance amount field depending on the selected allowance type.
function toggleAllowanceFields() {
  const weekly = document.getElementById('setAllowanceMode').value === 'weekly';
  document.getElementById('weekStartField').style.display = weekly ? '' : 'none';
  document.getElementById('nextInflowField').style.display = weekly ? 'none' : '';
  document.getElementById('incomeLabel').textContent = weekly ? 'Weekly allowance (₹)' : 'Monthly income (₹)';
}
document.getElementById('setAllowanceMode').addEventListener('change', toggleAllowanceFields);

document.getElementById('openSettingsBtn').addEventListener('click', () => {
  document.getElementById('setBalance').value = state.balance;
  document.getElementById('setIncome').value = state.income;
  document.getElementById('setNextInflow').value = state.nextInflow;
  document.getElementById('setAllowanceMode').value = state.allowanceMode || 'monthly';
  document.getElementById('setWeekStart').value = state.weekStartDay ?? 0;
  toggleAllowanceFields();
  document.getElementById('settingsModal').classList.add('open');
});
document.getElementById('closeSettingsBtn').addEventListener('click', () => document.getElementById('settingsModal').classList.remove('open'));
document.getElementById('saveSettingsBtn').addEventListener('click', () => {
  state.balance = Number(document.getElementById('setBalance').value) || 0;
  state.income = Number(document.getElementById('setIncome').value) || 0;
  state.nextInflow = document.getElementById('setNextInflow').value || state.nextInflow;
  state.allowanceMode = document.getElementById('setAllowanceMode').value === 'weekly' ? 'weekly' : 'monthly';
  state.weekStartDay = Number(document.getElementById('setWeekStart').value) || 0;
  document.getElementById('settingsModal').classList.remove('open');
  render();
});
document.getElementById('addMilestoneBtn').addEventListener('click', () => {
  const name = document.getElementById('msName').value.trim();
  const amount = Number(document.getElementById('msAmount').value);
  const date = document.getElementById('msDate').value;
  if (!name || !amount || !date) return;
  state.milestones.push({ name, amount, date });
  document.getElementById('msName').value = ''; document.getElementById('msAmount').value = ''; document.getElementById('msDate').value = '';
  renderMilestoneList(); renderOverview(); renderRunwayBar(); saveState();
});
function removeMilestone(i) { state.milestones.splice(i, 1); render(); }

/* ---------------- exam / academic pace ---------------- */

document.getElementById('addExamBtn').addEventListener('click', () => {
  const name = document.getElementById('examName').value.trim();
  const date = document.getElementById('examDate').value;
  if (!name || !date) return;
  state.examPeriods.push({ name, date });
  document.getElementById('examName').value = ''; document.getElementById('examDate').value = '';
  render();
});
function removeExam(i) { state.examPeriods.splice(i, 1); render(); }

/* ---------------- budgets ---------------- */

function updateBudget(cat, val) { state.categoryBudgets[cat] = Number(val) || 0; saveState(); }

/* ---------------- micro-surplus vault ---------------- */

function moveToVault(amount) {
  state.vault += amount;
  state.balance -= amount; // moving it out of "spendable" available balance into the vault
  state.vaultLog.push({ amount, date: todayISO() });
  render();
}

/* ---------------- API key modal ---------------- */

document.getElementById('apiStatusPill').addEventListener('click', () => {
  document.getElementById('backendUrlInput').value = getBackendUrl();
  document.getElementById('apiModal').classList.add('open');
});
document.getElementById('closeApiBtn').addEventListener('click', () => document.getElementById('apiModal').classList.remove('open'));
document.getElementById('saveApiBtn').addEventListener('click', () => {
  const url = document.getElementById('backendUrlInput').value.trim();
  // Always store explicitly (even '') so we can tell "never configured, use
  // default" apart from "user cleared it on purpose, force demo mode".
  localStorage.setItem(BACKEND_URL_STORAGE, url);
  document.getElementById('apiModal').classList.remove('open');
  renderTopStatus();
});

/* ---------------- "Can I Go?" simulator (Feature 1, AI-powered) ---------------- */

document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => { document.getElementById('simInput').value = chip.dataset.ex; });
});

document.getElementById('simAskBtn').addEventListener('click', runSimulator);

async function runSimulator() {
  const query = document.getElementById('simInput').value.trim();
  if (!query) return;
  const backendUrl = getBackendUrl();
  const resultEl = document.getElementById('simResult');
  resultEl.style.display = 'block';
  resultEl.innerHTML = `<p class="loading-dots">ClutchAI is reading your message</p>`;

  let extracted, sim, advice, usedDemo = false;

  if (backendUrl) {
    // ---- REAL AI PATH — talks to your own backend, which talks to Gemini ----
    try {
      extracted = await extractExpense(query, backendUrl);
      sim = simulateSpend(extracted.amount, extracted.timeframe_days);
      resultEl.innerHTML = `<p class="loading-dots">Working out the trade-off</p>`;
      advice = await explainScenario(query, extracted, sim, backendUrl);
    } catch (err) {
      // Real AI call failed (backend unreachable, bad URL, Gemini error, etc.)
      // Fall back to demo logic rather than leaving the user stuck.
      resultEl.innerHTML = `<p class="loading-dots">AI backend unavailable, falling back to demo mode</p>`;
      await wait(400);
      extracted = demoExtractExpense(query);
      sim = simulateSpend(extracted.amount, extracted.timeframe_days);
      advice = demoExplainScenario(extracted, sim);
      usedDemo = true;
      advice.fallbackNotice = `Couldn't reach the AI backend (${escapeHtml(err.message || String(err))}) — showing a demo-mode estimate instead.`;
    }
  } else {
    // ---- DEMO PATH — no backend configured, runs entirely in this browser ----
    await wait(500);
    extracted = demoExtractExpense(query);
    sim = simulateSpend(extracted.amount, extracted.timeframe_days);
    resultEl.innerHTML = `<p class="loading-dots">Working out the trade-off</p>`;
    await wait(500);
    advice = demoExplainScenario(extracted, sim);
    usedDemo = true;
  }

  renderSimResult(extracted, sim, advice, usedDemo);
}

function wait(ms) { return new Promise(res => setTimeout(res, ms)); }

function renderSimResult(extracted, sim, advice, isDemo) {
  const resultEl = document.getElementById('simResult');
  const demoNote = advice.fallbackNotice
    ? `<div class="stat-note" style="margin-bottom:10px;">⚠️ ${advice.fallbackNotice}</div>`
    : (isDemo ? `<div class="stat-note" style="margin-bottom:10px;">🤖 Simulated AI response — demo mode, no backend connected. <a href="#" onclick="document.getElementById('apiStatusPill').click(); return false;">Connect the AI backend</a> for genuine Gemini-powered analysis.</div>` : '');
  resultEl.innerHTML = `
    ${demoNote}
    <div class="stat-label">Total: ${formatINR(extracted.amount)} decision · ${extracted.category || 'General'}</div>
    <div class="sim-compare">
      <div class="sim-box now">
        <div class="lbl">Current state</div>
        <div class="val">${formatINR(sim.dailyRunway)}/day</div>
      </div>
      <div class="sim-box future">
        <div class="lbl">Simulated future</div>
        <div class="val">${formatINR(sim.simulatedDaily)}/day <span style="font-size:12px; font-weight:500;">for ~${sim.windowDays}d</span></div>
      </div>
    </div>
    <div class="sim-explain">${escapeHtml(advice.explanation || '')}</div>
    ${advice.alternatives && advice.alternatives.length ? `
      <ul class="alt-list">${advice.alternatives.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>
    ` : ''}
  `;
}

async function callBackend(backendUrl, system, prompt) {
  let res;
  try {
    res = await fetch(backendUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ system, prompt })
    });
  } catch (e) {
    throw new Error('Could not reach the backend URL. Check it\'s correct and the Worker is deployed.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Backend error (${res.status})`);
  }
  if (!data.text) throw new Error('Backend returned an empty response.');
  return data.text;
}

function parseJsonFromText(text) {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned);
}

async function extractExpense(query, backendUrl) {
  const system = `You extract structured spending-decision data from a student's message. Today's date is ${todayISO()}.
Respond with ONLY valid JSON, no markdown fences, no commentary, in this exact shape:
{"amount": <total rupee amount as a number>, "timeframe_days": <number of days from today until this expense happens, your best estimate>, "category": "<short category label>", "description": "<one short phrase describing the plan>"}
If the message mentions multiple amounts (e.g. a ticket plus accommodation), sum them into "amount". If no clear timing is given, estimate a reasonable number of days (e.g. "this weekend" ≈ 3, "next month" ≈ 30, "next week" ≈ 7).`;
  const text = await callBackend(backendUrl, system, query);
  const parsed = parseJsonFromText(text);
  parsed.amount = Number(parsed.amount) || 0;
  parsed.timeframe_days = Number(parsed.timeframe_days) || 7;
  return parsed;
}

async function explainScenario(query, extracted, sim, backendUrl) {
  const system = `You are ClutchAI, a zero-judgment financial co-pilot for students. You never say a flat "yes" or "no", and you never shame the user for wanting to spend money. You explain the real trade-off in plain, warm, conversational language (2-4 sentences), then suggest 2-3 concrete, specific alternatives the student could consider.
Respond with ONLY valid JSON, no markdown fences, in this exact shape:
{"explanation": "<2-4 sentence explanation of the trade-off, written directly to the student>", "alternatives": ["<alternative 1>", "<alternative 2>", "<alternative 3>"]}`;
  const userText = `Student asked: "${query}"

Numbers already calculated (do not recalculate, just explain them):
- Proposed spend: ₹${extracted.amount} on ${extracted.description || extracted.category}
- Current safe-to-spend: ₹${Math.round(sim.dailyRunway)}/day
- If they spend it, safe-to-spend drops to: ₹${Math.round(sim.simulatedDaily)}/day for about ${sim.windowDays} days
- Days until their next expected inflow: ${sim.days}
- Protected commitments already reserved: ₹${sim.protectedTotal}`;
  const text = await callBackend(backendUrl, system, userText);
  return parseJsonFromText(text);
}

/* ---------------- demo mode — simulated AI, zero API calls ----------------
   This is a rule-based stand-in for the real Gemini calls above, and the
   automatic fallback if the backend is unreachable. It's intentionally
   kept in the same "extract → simulate → explain" shape so connecting a
   real backend later (via the pill top-right) changes nothing else about
   how the app works. */

const CATEGORY_KEYWORDS = [
  ['Fun & Social', /festival|concert|trip|travel|vacation|party|club|bar|movie|pvr|match|game night|outing/i],
  ['Food & Dining', /dinner|lunch|brunch|food|restaurant|swiggy|zomato|cafe|coffee|snack/i],
  ['Transport', /uber|ola|cab|taxi|flight|train|bus|petrol|fuel|ride/i],
  ['Shopping', /headphone|shoes|clothes|phone|gadget|laptop|shopping|buy|jacket|sneaker/i],
  ['Subscriptions', /netflix|spotify|subscription|prime|hotstar/i],
  ['Bills', /rent|bill|electricity|wifi|insurance/i],
  ['Education', /course|book|tuition|exam fee|certification/i],
  ['Health', /doctor|medicine|gym|health|dentist/i],
  ['Investing & Trading', /stock|sip|invest|mutual fund|crypto/i],
];

function demoExtractExpense(query) {
  const amount = extractAmount(query);
  const timeframe_days = extractTimeframeDays(query);
  const category = CATEGORY_KEYWORDS.find(([, re]) => re.test(query))?.[0] || 'Fun & Social';
  const description = query.length > 70 ? query.slice(0, 67) + '…' : query;
  return { amount, timeframe_days, category, description };
}

function extractAmount(text) {
  const found = [];
  const currencyRe = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(k)?\b/gi;
  const kRe = /\b(\d+(?:\.\d+)?)\s?k\b/gi;
  const commaRe = /\b(\d{1,3}(?:,\d{3})+)\b/g;

  let m;
  while ((m = currencyRe.exec(text))) found.push(numFrom(m[1], m[2]));
  while ((m = kRe.exec(text))) found.push(numFrom(m[1], 'k'));
  while ((m = commaRe.exec(text))) found.push(numFrom(m[1]));

  if (found.length) {
    // de-duplicate near-identical matches (currency + comma regex can both catch the same number)
    const rounded = [...new Set(found.map(n => Math.round(n)))];
    return rounded.reduce((a, b) => a + b, 0);
  }

  // fallback: any standalone 3+ digit number, summed
  const bare = [...text.matchAll(/\b\d{3,6}\b/g)].map(m => Number(m[0]));
  if (bare.length) return bare.reduce((a, b) => a + b, 0);

  return 2000; // last-resort default so the simulator never fails outright
}

function numFrom(raw, kFlag) {
  let n = Number(String(raw).replace(/,/g, ''));
  if (kFlag) n *= 1000;
  return n;
}

function extractTimeframeDays(text) {
  const t = text.toLowerCase();
  let m;
  if (/\btoday\b/.test(t)) return 0;
  if (/\btomorrow\b/.test(t)) return 1;
  if ((m = t.match(/in\s+(\d+)\s*day/))) return Number(m[1]);
  if ((m = t.match(/in\s+(\d+)\s*week/))) return Number(m[1]) * 7;
  if ((m = t.match(/(\d+)\s*days?\s*(from now|away)?/))) return Number(m[1]);
  if (/this weekend|\bweekend\b/.test(t)) return 3;
  if (/next week/.test(t)) return 7;
  if (/this week/.test(t)) return 3;
  if (/next month/.test(t)) return 30;
  if (/this month/.test(t)) return 15;
  return 14;
}

function demoExplainScenario(extracted, sim) {
  const daily = Math.round(sim.dailyRunway);
  const simDaily = Math.round(sim.simulatedDaily);
  const overBudget = extracted.amount > sim.spendable;
  const ratio = daily > 0 ? simDaily / daily : 0;

  let explanation;
  if (overBudget) {
    explanation = `Being direct: ${formatINR(extracted.amount)} is more than your current spendable balance of ${formatINR(sim.spendable)}, even before spreading it across your runway. That doesn't have to mean no — it means something else needs to move first, like waiting for your next inflow or freeing up cash elsewhere.`;
  } else if (ratio < 0.5) {
    explanation = `You can technically afford this, but it's a real squeeze: your safe-to-spend would drop from ${formatINR(daily)}/day to about ${formatINR(simDaily)}/day for roughly ${sim.windowDays} days. Not a reason to say no — just worth deciding on purpose rather than by accident.`;
  } else if (ratio < 0.85) {
    explanation = `This is affordable, and it does change your month a bit. Your daily safe-to-spend would fall from ${formatINR(daily)}/day to about ${formatINR(simDaily)}/day for around ${sim.windowDays} days — noticeable, but manageable if you go in aware of it.`;
  } else {
    explanation = `Good news — this barely moves your runway. Your safe-to-spend only shifts from ${formatINR(daily)}/day to about ${formatINR(simDaily)}/day for ${sim.windowDays} days, which is a small, easily absorbed dip.`;
  }

  const alternatives = [];
  if (overBudget || ratio < 0.85) {
    const nextResetLabel = isWeekly() ? 'this week resets' : 'your next expected inflow';
    alternatives.push(`Wait until ${nextResetLabel} on ${computeRunway().periodEnd} if the plan can flex that long.`);
  }
  if (extracted.category === 'Fun & Social') {
    alternatives.push(`Trim one adjacent cost — a second night out, an extra ride — to bring the total down.`);
  } else if (extracted.category === 'Shopping') {
    alternatives.push(`Look for a cheaper version or wait for a sale to close part of the gap.`);
  } else {
    alternatives.push(`Pull back spending in your highest category for a couple of weeks to offset it.`);
  }
  alternatives.push(`Use the micro-surplus vault — move small amounts in on days your runway is healthy, ahead of the date.`);

  return { explanation, alternatives: alternatives.slice(0, 3) };
}

/* ---------------- boot ---------------- */

handleSplitwiseRedirect();
if (isSplitwiseDemo() && !getSplitwiseToken()) {
  splitwiseData = getMockSplitwiseData();
  splitwiseStatus = 'ready';
}
render();
if (getSplitwiseToken()) fetchSplitwiseBalances();
