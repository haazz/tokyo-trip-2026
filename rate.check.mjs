import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fetchRate } from './api/rate.js';

const reply = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: async () => body });
const fail = async () => { throw new Error('refused'); };
const NOW = Date.parse('2026-11-26T03:00:00Z');
const yahoo = { chart: { result: [{ meta: { regularMarketPrice: 9.1234, chartPreviousClose: 9.0913, regularMarketTime: 1764130000 } }] } };
const ecb = { base: 'JPY', rates: { '2026-11-24': { KRW: 9.01 }, '2026-11-25': { KRW: 9.05 }, '2026-11-21': { KRW: 9.2 } } };
const er = { result: 'success', rates: { KRW: 9.05 }, time_last_update_unix: 1764115201 };
// answers by host, so the order the sources are tried in is part of what is checked
const by = (hosts) => async (url, o) => {
  const host = new URL(url).host;
  assert.ok(host in hosts, 'unexpected source ' + host);
  return hosts[host](url, o);
};
const quiet = console.error;
console.error = () => {}; // the failing sources log on purpose
try {
  assert.deepEqual(await fetchRate(by({ 'query1.finance.yahoo.com': reply(yahoo) }), NOW),
    { rate: 9.1234, prev: 9.0913, at: 1764130000000, daily: false, source: 'Yahoo Finance' });
  // Yahoo down, broken or absurd → ECB's last two business days, whatever order the reply lists them in
  let asked = '';
  for (const bad of [fail, reply({}, false), reply({ chart: { result: [] } }),
    reply({ chart: { result: [{ meta: { regularMarketPrice: 912, regularMarketTime: 1764130000 } }] } })]) {
    assert.deepEqual(await fetchRate(by({ 'query1.finance.yahoo.com': bad, 'api.frankfurter.dev': (url) => { asked = url; return reply(ecb)(); } }), NOW),
      { rate: 9.05, prev: 9.01, at: Date.parse('2026-11-25'), daily: true, source: 'Frankfurter' });
  }
  assert.equal(asked, 'https://api.frankfurter.dev/v1/2026-11-16..?base=JPY&symbols=KRW', 'ten days back covers weekends and holidays');
  // a single day, or a broken previous close, leaves the rate without a change
  assert.equal((await fetchRate(by({ 'query1.finance.yahoo.com': fail, 'api.frankfurter.dev': reply({ rates: { '2026-11-25': { KRW: 9.05 } } }) }), NOW)).prev, null);
  assert.equal((await fetchRate(by({ 'query1.finance.yahoo.com': reply({ chart: { result: [{ meta: { ...yahoo.chart.result[0].meta, chartPreviousClose: 0 } }] } }) }), NOW)).prev, null);
  // both down → today's rate from the last source, no change
  assert.deepEqual(await fetchRate(by({ 'query1.finance.yahoo.com': fail, 'api.frankfurter.dev': fail, 'open.er-api.com': reply(er) }), NOW),
    { rate: 9.05, prev: null, at: 1764115201000, daily: true, source: 'ExchangeRate-API' });
  assert.equal(await fetchRate(reply({}, false), NOW), null, 'all down → no rate');
} finally { console.error = quiet; }
console.log('rate sources ok');

// 전일 대비 on the page, per 100엔
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(html.slice(html.indexOf('  function won2('), html.indexOf('  function renderFx(')), ctx);
assert.deepEqual({ ...ctx.fxChange(9.1234, 9.0913) }, { dir: 'up', word: '상승', mark: '▲', text: '3.21원 (+0.35%)' });
assert.deepEqual({ ...ctx.fxChange(9.0913, 9.1234) }, { dir: 'down', word: '하락', mark: '▼', text: '3.21원 (−0.35%)' });
assert.equal(ctx.fxChange(9.12341, 9.1234).dir, 'flat', 'less than 0.01원 per 100엔 is 보합');
assert.equal(ctx.fxChange(9.1, null), null);
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
assert.match(css, /\.fx-bar\[data-dir="up"\] :is\(#fx-rate, \.fx-chg\) \{ color: var\(--fx-up\); \}/);
assert.ok(html.indexOf('class="fx-bar"') < html.indexOf('class="nearby-bar"'), '환율 sits above 지금 근처');
assert.match(css, /--fx-up: #d0112b; --fx-down: #1a5fd0;/, '상승 red, 하락 blue');
console.log('rate change ok');
