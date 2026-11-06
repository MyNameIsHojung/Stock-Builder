// Stock Builder server: static files + JSON storage + quote proxy (no external deps)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 4545);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data', 'stocks.json');
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh) StockBuilder/1.0' };
const QUOTE_TTL_MS = 20_000;

const DEFAULT_DATA = {
  settings: { title: '우리 동네 주식 공사장', refreshSec: 60, tiers: [10, 20, 30], basis: 'base' },
  stocks: [],
};

// ---------- storage ----------
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    saveData(DEFAULT_DATA);
    return structuredClone(DEFAULT_DATA);
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  data.settings = { ...DEFAULT_DATA.settings, ...(data.settings || {}) };
  data.stocks = data.stocks || [];
  return data;
}

function saveData(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, DATA_FILE);
}

// ---------- quotes ----------
const quoteCache = new Map(); // key -> { at, value }

async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: UA });
  } catch (e) {
    // undici hides the real reason (DNS, TLS, refused...) in e.cause
    const c = e.cause;
    throw new Error(`${e.message} (${new URL(url).host}${c ? `: ${c.code || ''} ${c.message || ''}`.trimEnd() : ''})`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

function isKoreanSymbol(symbol) {
  return /\.(KS|KQ)$/i.test(symbol);
}

async function fetchKoreanName(symbol) {
  const code = symbol.split('.')[0];
  try {
    const j = await fetchJson(`https://m.stock.naver.com/api/stock/${code}/basic`);
    return j.stockName || null;
  } catch (e) {
    console.warn(`[name] Naver name lookup failed for ${symbol}: ${e.message}`);
    return null;
  }
}

async function fetchQuote(symbol, range = '1mo') {
  const key = `${symbol}|${range}`;
  const hit = quoteCache.get(key);
  if (hit && Date.now() - hit.at < QUOTE_TTL_MS) return hit.value;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const j = await fetchJson(url);
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(j?.chart?.error?.description || `No data for ${symbol}`);
  const m = r.meta;
  const q = r.indicators?.quote?.[0] || {};
  const ts = r.timestamp || [];
  const history = ts
    .map((t, i) => ({ t: t * 1000, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i] }))
    .filter((p) => p.c != null);

  const price = m.regularMarketPrice;
  let prevClose;
  if (typeof m.fulldayChange === 'number') prevClose = price - m.fulldayChange;
  else if (history.length >= 2) prevClose = history[history.length - 2].c;
  else prevClose = m.chartPreviousClose;
  const last = history[history.length - 1] || {};

  const value = {
    symbol: m.symbol,
    name: m.longName || m.shortName || m.symbol,
    currency: m.currency,
    exchange: m.fullExchangeName || m.exchangeName,
    price,
    prevClose,
    dayChangePct: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
    open: last.o ?? null,
    dayHigh: m.regularMarketDayHigh ?? last.h ?? null,
    dayLow: m.regularMarketDayLow ?? last.l ?? null,
    volume: m.regularMarketVolume ?? last.v ?? null,
    high52: m.fiftyTwoWeekHigh ?? null,
    low52: m.fiftyTwoWeekLow ?? null,
    marketTime: m.regularMarketTime ? m.regularMarketTime * 1000 : null,
    history,
  };
  if (isKoreanSymbol(symbol)) {
    const kr = await fetchKoreanName(symbol);
    if (kr) value.name = kr;
  }
  quoteCache.set(key, { at: Date.now(), value });
  return value;
}

// "005930" -> try .KS then .KQ ; anything else as-is (uppercased)
async function resolveSymbol(input) {
  const raw = String(input || '').trim().toUpperCase();
  if (!raw) throw new Error('종목 코드를 입력해주세요');
  if (/^\d[0-9A-Z]{5}$/.test(raw)) {
    // Yahoo returns stale data for a KOSDAQ code queried as .KS, so ask Naver which market it is first
    let suffixes = ['.KS', '.KQ'];
    try {
      const j = await fetchJson(`https://m.stock.naver.com/api/stock/${raw}/basic`);
      const market = j?.stockExchangeType?.code;
      if (market === 'KS' || market === 'KQ') suffixes = [`.${market}`];
      else console.warn(`[resolve] Naver returned no market for ${raw}; trying .KS then .KQ`);
    } catch (e) {
      console.warn(`[resolve] Naver market lookup failed for ${raw}: ${e.message}; trying .KS then .KQ`);
    }
    for (const suffix of suffixes) {
      try {
        const q = await fetchQuote(raw + suffix);
        return { symbol: raw + suffix, quote: q };
      } catch (e) {
        console.warn(`[resolve] ${raw}${suffix} failed: ${e.message}`);
      }
    }
    throw new Error(`${raw}: 코스피/코스닥에서 찾을 수 없어요`);
  }
  const q = await fetchQuote(raw);
  return { symbol: raw, quote: q };
}

async function searchSymbols(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  if (/[가-힣]/.test(q)) {
    const j = await fetchJson(`https://ac.stock.naver.com/ac?q=${encodeURIComponent(q)}&target=stock`);
    return (j.items || [])
      .filter((it) => it.nationCode === 'KOR' && (it.typeCode === 'KOSPI' || it.typeCode === 'KOSDAQ'))
      .slice(0, 8)
      .map((it) => ({
        symbol: it.code + (it.typeCode === 'KOSDAQ' ? '.KQ' : '.KS'),
        name: it.name,
        exchange: it.typeName,
      }));
  }
  const j = await fetchJson(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`
  );
  return (j.quotes || [])
    .filter((it) => it.symbol && (it.quoteType === 'EQUITY' || it.quoteType === 'ETF'))
    .map((it) => ({ symbol: it.symbol, name: it.longname || it.shortname || it.symbol, exchange: it.exchDisp }));
}

// ---------- http helpers ----------
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => {
      buf += c;
      if (buf.length > 1e6) reject(new Error('body too large'));
    });
    req.on('end', () => {
      if (!buf) return resolve({});
      try {
        resolve(JSON.parse(buf));
      } catch (e) {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

// ---------- API ----------
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;

  if (parts[1] === 'state' && method === 'GET') {
    return send(res, 200, loadData());
  }

  if (parts[1] === 'search' && method === 'GET') {
    return send(res, 200, await searchSymbols(url.searchParams.get('q')));
  }

  if (parts[1] === 'quote' && parts[2] && method === 'GET') {
    const range = url.searchParams.get('range') || '1mo';
    if (!['5d', '1mo', '3mo', '6mo', '1y'].includes(range)) return send(res, 400, { error: 'invalid range' });
    return send(res, 200, await fetchQuote(decodeURIComponent(parts[2]), range));
  }

  if (parts[1] === 'quotes' && method === 'GET') {
    const data = loadData();
    const out = {};
    await Promise.all(
      data.stocks.map(async (s) => {
        try {
          const q = await fetchQuote(s.symbol);
          const { history, ...rest } = q;
          out[s.id] = { ...rest, spark: history.slice(-20).map((p) => p.c) };
        } catch (e) {
          console.warn(`[quotes] ${s.symbol}: ${e.message}`);
          out[s.id] = { error: e.message };
        }
      })
    );
    return send(res, 200, out);
  }

  if (parts[1] === 'settings' && method === 'PATCH') {
    const body = await readBody(req);
    const data = loadData();
    const s = data.settings;
    if (typeof body.title === 'string') s.title = body.title.slice(0, 60);
    if (body.refreshSec != null) s.refreshSec = Math.max(10, Math.min(3600, Number(body.refreshSec) || 60));
    if (body.basis === 'base' || body.basis === 'daily') s.basis = body.basis;
    if (Array.isArray(body.tiers) && body.tiers.length === 3) {
      const t = body.tiers.map(Number);
      if (!t.every((x) => x > 0) || !(t[0] < t[1] && t[1] < t[2])) return send(res, 400, { error: 'tiers must be increasing positive numbers' });
      s.tiers = t;
    }
    saveData(data);
    return send(res, 200, s);
  }

  if (parts[1] === 'stocks') {
    const data = loadData();
    const id = parts[2];

    if (id === 'order' && method === 'PUT') {
      const body = await readBody(req);
      const ids = body.ids;
      const current = new Set(data.stocks.map((s) => s.id));
      const valid =
        Array.isArray(ids) && ids.length === current.size && new Set(ids).size === ids.length && ids.every((x) => current.has(x));
      if (!valid) return send(res, 400, { error: '순서 목록이 등록된 종목과 맞지 않아요. 새로고침 후 다시 시도해주세요' });
      const byId = new Map(data.stocks.map((s) => [s.id, s]));
      data.stocks = ids.map((x) => byId.get(x));
      saveData(data);
      return send(res, 200, data.stocks);
    }

    if (!id && method === 'GET') return send(res, 200, data.stocks);

    if (!id && method === 'POST') {
      const body = await readBody(req);
      const { symbol, quote } = await resolveSymbol(body.symbol);
      if (data.stocks.some((s) => s.symbol === symbol)) return send(res, 409, { error: `${quote.name}(${symbol})은(는) 이미 등록되어 있어요` });
      const stock = {
        id: crypto.randomUUID(),
        symbol,
        name: quote.name,
        alias: typeof body.alias === 'string' && body.alias.trim() ? body.alias.trim().slice(0, 30) : '',
        basePrice: Number(body.basePrice) > 0 ? Number(body.basePrice) : quote.price,
        basis: body.basis === 'base' || body.basis === 'daily' ? body.basis : data.settings.basis,
        addedAt: new Date().toISOString(),
      };
      data.stocks.push(stock);
      saveData(data);
      return send(res, 201, stock);
    }

    const idx = data.stocks.findIndex((s) => s.id === id);
    if (id && idx === -1) return send(res, 404, { error: 'stock not found' });

    if (id && method === 'PATCH') {
      const body = await readBody(req);
      const s = data.stocks[idx];
      if (typeof body.alias === 'string') s.alias = body.alias.trim().slice(0, 30);
      if (body.basePrice != null) {
        const bp = Number(body.basePrice);
        if (!(bp > 0)) return send(res, 400, { error: '기준가는 0보다 커야 해요' });
        s.basePrice = bp;
      }
      if (body.basis != null) {
        if (body.basis !== 'base' && body.basis !== 'daily') return send(res, 400, { error: "basis는 'base' 또는 'daily'여야 해요" });
        s.basis = body.basis;
      }
      saveData(data);
      return send(res, 200, s);
    }

    if (id && method === 'DELETE') {
      const [removed] = data.stocks.splice(idx, 1);
      saveData(data);
      return send(res, 200, removed);
    }
  }

  return send(res, 404, { error: 'unknown endpoint' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(`[error] ${req.method} ${url.pathname}: ${e.message}`);
    send(res, 400, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[stock-builder] http://localhost:${PORT}  (data: ${path.relative(ROOT, DATA_FILE)})`);
});
