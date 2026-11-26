// 엔화 환율: won per 1 yen, with the previous day's rate for 전일 대비. Every source is free and needs no key.
// Fetched here, not in the browser: Yahoo sends no CORS headers, and the edge cache spares the sources.
// Each source gives today and its own previous rate, so the change never compares two different feeds.
// shortcut: Yahoo's chart endpoint is unofficial; if it starts refusing, the daily sources keep the page going.
const DAY = 86400000;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

const SOURCES = [
  {
    // minutes behind the market; prev = the last day's close
    name: 'Yahoo Finance',
    url: () => 'https://query1.finance.yahoo.com/v8/finance/chart/JPYKRW=X?range=1d&interval=5m',
    read: (j) => {
      const m = j?.chart?.result?.[0]?.meta;
      return { rate: m?.regularMarketPrice, prev: m?.previousClose ?? m?.chartPreviousClose, at: m?.regularMarketTime * 1000, daily: false };
    },
  },
  {
    // ECB reference rates, once per business day: the last two days in the window are today and the day before
    name: 'Frankfurter',
    url: (now) => 'https://api.frankfurter.dev/v1/' + ymd(now - 10 * DAY) + '..?base=JPY&symbols=KRW',
    read: (j) => {
      const days = Object.keys(j?.rates ?? {}).sort();
      const last = days.at(-1);
      return { rate: j?.rates?.[last]?.KRW, prev: j?.rates?.[days.at(-2)]?.KRW, at: Date.parse(last), daily: true };
    },
  },
  {
    // today only: shows the rate without a change
    name: 'ExchangeRate-API',
    url: () => 'https://open.er-api.com/v6/latest/JPY',
    read: (j) => ({ rate: j?.result === 'success' ? j.rates?.KRW : undefined, at: j?.time_last_update_unix * 1000, daily: true }),
  },
];

// A yen has been worth 5–15 won for decades; anything outside that is a broken reply, not a rate.
const plausible = (v) => Number.isFinite(v) && v > 5 && v < 15;

export async function fetchRate(get = fetch, now = Date.now()) {
  for (const s of SOURCES) {
    try {
      const r = await get(s.url(now), { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const q = s.read(await r.json());
      if (!plausible(q.rate) || !(q.at > 0)) throw new Error('bad reply');
      return { rate: q.rate, prev: plausible(q.prev) ? q.prev : null, at: q.at, daily: q.daily, source: s.name };
    } catch (err) {
      console.error('rate source failed', s.name, String(err));
    }
  }
  return null;
}

export default async function handler(req, res) {
  const q = await fetchRate();
  if (!q) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: '환율을 불러오지 못했어요.' });
  }
  // five minutes at the edge, so the whole group shares one lookup
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.status(200).json(q);
}
