import { loadSprites } from './assets.js';
import { Scene, LEVELS, levelFor, floorsFor, registerScene, unregisterScene } from './scene.js';

const $ = (id) => document.getElementById(id);
const state = { settings: null, stocks: [], quotes: {}, cards: new Map(), detail: null, timer: null };

// ---------- api ----------
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function toast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), isError ? 4000 : 2200);
}

// ---------- formatting ----------
function fmtPrice(v, cur) {
  if (v == null || !Number.isFinite(v)) return '-';
  if (cur === 'KRW') return Math.round(v).toLocaleString('ko-KR') + '원';
  if (cur === 'USD') return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 }) + (cur ? ' ' + cur : '');
}
const fmtPct = (p) => (p == null || !Number.isFinite(p) ? '-' : (p > 0 ? '+' : '') + p.toFixed(2) + '%');
const fmtNum = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));
const dirClass = (p) => (p > 0.0001 ? 'up' : p < -0.0001 ? 'down' : 'flat');

function basePct(stock, q) {
  if (!q || q.price == null || !(stock.basePrice > 0)) return null;
  return ((q.price - stock.basePrice) / stock.basePrice) * 100;
}
function activePct(stock, q) {
  if (!q || q.error) return null;
  return state.settings.basis === 'daily' ? q.dayChangePct : basePct(stock, q);
}
const displayName = (s) => s.alias || s.name || s.symbol;

// ---------- grid ----------
function bestGrid(n, W, H) {
  let best = { cols: 1, rows: n, score: -1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = W / cols, ch = H / rows;
    const score = Math.min(cw / 4, ch / 3); // aim for ~4:3 cells
    if (score > best.score) best = { cols, rows, score };
  }
  return best;
}

function layoutGrid() {
  const grid = $('grid');
  const n = state.stocks.length;
  $('empty').hidden = n > 0;
  if (!n) return;
  const r = grid.getBoundingClientRect();
  const { cols, rows } = bestGrid(n, r.width, r.height);
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  grid.classList.toggle('dense', r.width / cols < 260 || r.height / rows < 180);
}

const resizeObs = new ResizeObserver((entries) => {
  for (const e of entries) {
    const card = state.cards.get(e.target.dataset.id);
    if (card) card.scene.resize();
  }
});

function renderGrid() {
  const grid = $('grid');
  const ids = new Set(state.stocks.map((s) => s.id));
  for (const [id, card] of state.cards) {
    if (!ids.has(id)) {
      unregisterScene(card.scene);
      resizeObs.unobserve(card.el);
      card.el.remove();
      state.cards.delete(id);
    }
  }
  for (const s of state.stocks) {
    let card = state.cards.get(s.id);
    if (!card) {
      const el = document.createElement('div');
      el.className = 'card';
      el.dataset.id = s.id;
      el.innerHTML = `
        <canvas></canvas>
        <div class="card-head">
          <div><div class="card-name"></div><div class="card-sub"></div></div>
          <div class="card-right"><div class="card-price"></div><span class="badge"></span></div>
        </div>
        <div class="card-level"></div>`;
      el.addEventListener('click', () => openDetail(s.id));
      bindDrag(el);
      grid.appendChild(el);
      const scene = new Scene(el.querySelector('canvas'));
      registerScene(scene);
      resizeObs.observe(el);
      card = { el, scene };
      state.cards.set(s.id, card);
    }
    grid.appendChild(card.el); // keep JSON order
  }
  layoutGrid();
  for (const c of state.cards.values()) c.scene.resize();
  updateCards();
}

// ---------- ordering ----------
async function saveOrder(ids) {
  const prev = state.stocks;
  const byId = new Map(prev.map((s) => [s.id, s]));
  state.stocks = ids.map((id) => byId.get(id));
  renderGrid();
  try {
    await api('PUT', '/api/stocks/order', { ids });
  } catch (e) {
    toast('순서를 저장하지 못했어요: ' + e.message, true);
    await loadState();
  }
}

let dragId = null;

function clearDropMarks() {
  for (const c of state.cards.values()) c.el.classList.remove('drop-before', 'drop-after');
}

function bindDrag(el) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    dragId = el.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => {
    dragId = null;
    el.classList.remove('dragging');
    clearDropMarks();
  });
  el.addEventListener('dragover', (e) => {
    if (!dragId || dragId === el.dataset.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = el.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    clearDropMarks();
    el.classList.add(after ? 'drop-after' : 'drop-before');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const from = dragId;
    const to = el.dataset.id;
    const after = el.classList.contains('drop-after');
    clearDropMarks();
    if (!from || from === to) return;
    const ids = state.stocks.map((s) => s.id).filter((id) => id !== from);
    ids.splice(ids.indexOf(to) + (after ? 1 : 0), 0, from);
    saveOrder(ids);
  });
}

function moveStock(id, delta) {
  const ids = state.stocks.map((s) => s.id);
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  saveOrder(ids);
}

function updateCards() {
  const tiers = state.settings.tiers;
  for (const s of state.stocks) {
    const card = state.cards.get(s.id);
    if (!card) continue;
    const q = state.quotes[s.id];
    const pct = activePct(s, q);
    const el = card.el;
    el.querySelector('.card-name').textContent = displayName(s);
    el.querySelector('.card-sub').textContent = s.alias ? `${s.name} · ${s.symbol}` : s.symbol;
    const badge = el.querySelector('.badge');
    const lv = levelFor(pct, tiers);
    if (q?.error) {
      badge.className = 'badge err';
      badge.textContent = '시세 오류';
      el.querySelector('.card-price').textContent = '';
      el.title = q.error;
    } else if (q) {
      badge.className = 'badge ' + dirClass(pct);
      badge.textContent = fmtPct(pct);
      el.querySelector('.card-price').textContent = fmtPrice(q.price, q.currency);
      el.title = '';
    } else {
      badge.className = 'badge flat';
      badge.textContent = '불러오는 중';
    }
    el.querySelector('.card-level').textContent = `${LEVELS[lv].emoji} ${LEVELS[lv].label} · ${floorsFor(pct, tiers)}층`;
    card.scene.setData(pct, tiers);
  }
  if (state.detail) updateDetailText();
}

// ---------- data ----------
async function loadState() {
  const data = await api('GET', '/api/state');
  state.settings = data.settings;
  state.stocks = data.stocks;
  $('title').textContent = state.settings.title;
  document.title = state.settings.title;
  for (const b of $('basisSeg').querySelectorAll('button')) b.classList.toggle('on', b.dataset.basis === state.settings.basis);
  renderGrid();
}

async function refreshQuotes() {
  try {
    state.quotes = await api('GET', '/api/quotes');
    $('updated').textContent = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (e) {
    toast('시세를 불러오지 못했어요: ' + e.message, true);
  }
  updateCards();
}

function scheduleRefresh() {
  clearInterval(state.timer);
  state.timer = setInterval(refreshQuotes, state.settings.refreshSec * 1000);
}

// ---------- add / search ----------
let suggestItems = [];
let suggestIdx = -1;
let searchSeq = 0;

function renderSuggest() {
  const ul = $('suggest');
  ul.innerHTML = '';
  suggestItems.forEach((it, i) => {
    const li = document.createElement('li');
    li.className = i === suggestIdx ? 'active' : '';
    li.innerHTML = `<span></span><small></small>`;
    li.firstChild.textContent = it.name;
    li.lastChild.textContent = `${it.symbol} · ${it.exchange || ''}`;
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      addStock(it.symbol);
    });
    ul.appendChild(li);
  });
  ul.hidden = suggestItems.length === 0;
}

let searchTimer;
$('addInput').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  clearTimeout(searchTimer);
  if (!q || /^\d{1,6}$/.test(q)) {
    suggestItems = [];
    renderSuggest();
    return;
  }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    try {
      const items = await api('GET', '/api/search?q=' + encodeURIComponent(q));
      if (seq !== searchSeq) return;
      suggestItems = items;
      suggestIdx = items.length ? 0 : -1;
      renderSuggest();
    } catch (err) {
      console.warn('[search]', err.message);
    }
  }, 250);
});
$('addInput').addEventListener('keydown', (e) => {
  if (!suggestItems.length) return;
  if (e.key === 'ArrowDown') suggestIdx = (suggestIdx + 1) % suggestItems.length;
  else if (e.key === 'ArrowUp') suggestIdx = (suggestIdx - 1 + suggestItems.length) % suggestItems.length;
  else if (e.key === 'Escape') suggestItems = [];
  else return;
  e.preventDefault();
  renderSuggest();
});
$('addInput').addEventListener('blur', () => setTimeout(() => { suggestItems = []; renderSuggest(); }, 100));

$('addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('addInput').value.trim();
  if (!v) return;
  const pick = suggestItems[suggestIdx];
  addStock(pick ? pick.symbol : v);
});

async function addStock(symbol) {
  suggestItems = [];
  renderSuggest();
  const btn = $('addForm').querySelector('button');
  btn.disabled = true;
  try {
    const s = await api('POST', '/api/stocks', { symbol });
    $('addInput').value = '';
    toast(`🏗️ ${s.name} 공사장 오픈!`);
    await loadState();
    await refreshQuotes();
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

// ---------- title / basis / settings ----------
$('title').addEventListener('click', () => {
  const h = $('title');
  if (h.isContentEditable) return;
  h.contentEditable = 'true';
  h.focus();
  document.getSelection().selectAllChildren(h);
});
$('title').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('title').blur(); }
  if (e.key === 'Escape') { $('title').textContent = state.settings.title; $('title').blur(); }
});
$('title').addEventListener('blur', async () => {
  const h = $('title');
  h.contentEditable = 'false';
  const v = h.textContent.trim();
  if (!v || v === state.settings.title) { h.textContent = state.settings.title; return; }
  try {
    state.settings = await api('PATCH', '/api/settings', { title: v });
    document.title = v;
    toast('이름을 바꿨어요');
  } catch (e) {
    h.textContent = state.settings.title;
    toast(e.message, true);
  }
});

$('basisSeg').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b || b.dataset.basis === state.settings.basis) return;
  try {
    state.settings = await api('PATCH', '/api/settings', { basis: b.dataset.basis });
    for (const x of $('basisSeg').querySelectorAll('button')) x.classList.toggle('on', x === b);
    updateCards();
  } catch (err) {
    toast(err.message, true);
  }
});

$('refreshBtn').addEventListener('click', refreshQuotes);

$('settingsBtn').addEventListener('click', () => {
  const s = state.settings;
  $('sTitle').value = s.title;
  $('sRefresh').value = s.refreshSec;
  [$('sT1').value, $('sT2').value, $('sT3').value] = s.tiers;
  $('settingsModal').hidden = false;
});
$('sSave').addEventListener('click', async () => {
  try {
    state.settings = await api('PATCH', '/api/settings', {
      title: $('sTitle').value.trim() || state.settings.title,
      refreshSec: Number($('sRefresh').value),
      tiers: [$('sT1').value, $('sT2').value, $('sT3').value].map(Number),
    });
    $('title').textContent = state.settings.title;
    document.title = state.settings.title;
    scheduleRefresh();
    updateCards();
    $('settingsModal').hidden = true;
    toast('설정을 저장했어요');
  } catch (e) {
    toast(e.message, true);
  }
});

// ---------- detail popup ----------
function openDetail(id) {
  const s = state.stocks.find((x) => x.id === id);
  if (!s) return;
  const modal = $('modal');
  modal.hidden = false;
  if (!state.detail) {
    state.detail = { scene: new Scene($('detailCanvas')) };
    registerScene(state.detail.scene);
  }
  state.detail.id = id;
  state.detail.range = '1mo';
  $('dAlias').value = s.alias || '';
  $('dAlias').placeholder = s.name + ' (별명 설정)';
  $('dBasePrice').value = s.basePrice;
  requestAnimationFrame(() => state.detail?.scene.resize());
  updateDetailText();
  loadChart();
}

function closeModals() {
  $('modal').hidden = true;
  $('settingsModal').hidden = true;
  if (state.detail) {
    unregisterScene(state.detail.scene);
    state.detail = null;
  }
}

function updateDetailText() {
  const d = state.detail;
  const s = state.stocks.find((x) => x.id === d.id);
  if (!s) return closeModals();
  const q = state.quotes[s.id];
  const tiers = state.settings.tiers;
  const pct = activePct(s, q);
  const lv = levelFor(pct, tiers);
  d.scene.setData(pct, tiers);
  const idx = state.stocks.indexOf(s);
  $('dOrder').textContent = `${idx + 1} / ${state.stocks.length}번째`;
  $('dMovePrev').disabled = idx === 0;
  $('dMoveNext').disabled = idx === state.stocks.length - 1;
  $('dName').textContent = `${s.name} · ${s.symbol}${q?.exchange ? ' · ' + q.exchange : ''}`;
  $('detailLevel').textContent = `${LEVELS[lv].emoji} ${LEVELS[lv].label} · ${floorsFor(pct, tiers)}층`;
  $('dDesc').textContent = `${LEVELS[lv].desc} (${state.settings.basis === 'daily' ? '전일 대비' : '기준가 대비'} ${fmtPct(pct)})`;
  if (!q || q.error) {
    $('dPrice').textContent = q?.error ? '시세 오류' : '불러오는 중…';
    $('dDay').textContent = '';
    $('dBase').textContent = q?.error || '';
    $('dStats').innerHTML = '';
    return;
  }
  $('dPrice').textContent = fmtPrice(q.price, q.currency);
  const dc = q.price - q.prevClose;
  $('dDay').className = 'chg ' + dirClass(q.dayChangePct);
  $('dDay').textContent = `전일 대비 ${dc > 0 ? '▲' : dc < 0 ? '▼' : ''} ${fmtPrice(Math.abs(dc), q.currency)} (${fmtPct(q.dayChangePct)})`;
  const bp = basePct(s, q);
  $('dBase').innerHTML = '';
  $('dBase').append(`기준가 ${fmtPrice(s.basePrice, q.currency)} 대비 `);
  const span = document.createElement('b');
  span.className = dirClass(bp) + '-text';
  span.textContent = fmtPct(bp);
  $('dBase').append(span);
  const rows = [
    ['시가', fmtPrice(q.open, q.currency)],
    ['전일 종가', fmtPrice(q.prevClose, q.currency)],
    ['고가', fmtPrice(q.dayHigh, q.currency)],
    ['저가', fmtPrice(q.dayLow, q.currency)],
    ['52주 최고', fmtPrice(q.high52, q.currency)],
    ['52주 최저', fmtPrice(q.low52, q.currency)],
    ['거래량', fmtNum(q.volume)],
    ['등록일', new Date(s.addedAt).toLocaleDateString('ko-KR')],
  ];
  $('dStats').innerHTML = '';
  for (const [k, v] of rows) {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = k;
    dd.textContent = v;
    div.append(dt, dd);
    $('dStats').append(div);
  }
}

async function loadChart() {
  const d = state.detail;
  const s = state.stocks.find((x) => x.id === d.id);
  for (const b of $('ranges').querySelectorAll('button')) b.classList.toggle('on', b.dataset.range === d.range);
  const svg = $('chart');
  svg.innerHTML = '<text x="200" y="75" text-anchor="middle" fill="#8a8278" font-size="12">불러오는 중…</text>';
  try {
    const q = await api('GET', `/api/quote/${encodeURIComponent(s.symbol)}?range=${d.range}`);
    if (state.detail !== d) return;
    drawChart(svg, q.history.map((p) => p.c), s.basePrice, q.currency);
  } catch (e) {
    svg.innerHTML = '';
    toast('차트를 불러오지 못했어요: ' + e.message, true);
  }
}

function drawChart(svg, closes, basePrice, cur) {
  const W = 400, H = 140, P = 8;
  if (closes.length < 2) {
    svg.innerHTML = '<text x="200" y="75" text-anchor="middle" fill="#8a8278" font-size="12">데이터 없음</text>';
    return;
  }
  const min = Math.min(...closes, basePrice), max = Math.max(...closes, basePrice);
  const span = max - min || 1;
  const x = (i) => P + (i / (closes.length - 1)) * (W - P * 2);
  const y = (v) => P + (1 - (v - min) / span) * (H - P * 2);
  const pts = closes.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const up = closes[closes.length - 1] >= closes[0];
  const color = up ? '#e03131' : '#1c7ed6';
  const by = y(basePrice).toFixed(1);
  svg.innerHTML = `
    <polygon points="${x(0)},${H - P} ${pts} ${x(closes.length - 1)},${H - P}" fill="${color}" opacity="0.12"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <line x1="${P}" x2="${W - P}" y1="${by}" y2="${by}" stroke="#f4a259" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>
    <text x="${W - P}" y="${Number(by) - 4}" text-anchor="end" font-size="10" fill="#c77a2b">기준가 ${fmtPrice(basePrice, cur)}</text>
    <text x="${P}" y="${P + 8}" font-size="10" fill="#8a8278">${fmtPrice(max, cur)}</text>
    <text x="${P}" y="${H - P - 2}" font-size="10" fill="#8a8278">${fmtPrice(min, cur)}</text>`;
}

$('ranges').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !state.detail) return;
  state.detail.range = b.dataset.range;
  loadChart();
});

$('dSave').addEventListener('click', async () => {
  const d = state.detail;
  if (!d) return;
  try {
    await api('PATCH', `/api/stocks/${d.id}`, { alias: $('dAlias').value, basePrice: Number($('dBasePrice').value) });
    await loadState();
    updateCards();
    loadChart();
    toast('저장했어요');
  } catch (e) {
    toast(e.message, true);
  }
});
$('dMovePrev').addEventListener('click', () => state.detail && moveStock(state.detail.id, -1));
$('dMoveNext').addEventListener('click', () => state.detail && moveStock(state.detail.id, 1));
$('dAlias').addEventListener('keydown', (e) => e.key === 'Enter' && $('dSave').click());

$('dDelete').addEventListener('click', async () => {
  const d = state.detail;
  const s = state.stocks.find((x) => x.id === d?.id);
  if (!s || !confirm(`"${displayName(s)}" 공사장을 삭제할까요?`)) return;
  try {
    await api('DELETE', `/api/stocks/${s.id}`);
    closeModals();
    await loadState();
    toast(`🧹 ${displayName(s)} 공사장을 정리했어요`);
  } catch (e) {
    toast(e.message, true);
  }
});

for (const m of [$('modal'), $('settingsModal')]) {
  m.addEventListener('click', (e) => {
    if (e.target === m || e.target.closest('[data-close]')) closeModals();
  });
}
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeModals());
window.addEventListener('resize', () => {
  layoutGrid();
  state.detail?.scene.resize();
});

// ---------- boot ----------
(async function boot() {
  await loadSprites();
  await loadState();
  await refreshQuotes();
  scheduleRefresh();
})().catch((e) => toast('초기화 실패: ' + e.message, true));
