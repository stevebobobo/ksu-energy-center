// 抓台電官方即時資料，整理成 data/taipower.json 給網頁讀。
// 台電的 JSON 不允許瀏覽器跨站讀取，所以要由這支腳本（本機或 GitHub Actions）先抓成快照。
// 用法：node tools/fetch-taipower.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://service.taipower.com.tw/data/opendata/apply/file';

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'ksu-energy-center (course demo)' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return JSON.parse((await res.text()).replace(/^﻿/, ''));
}

const GROUPS = [
  ['nuclear', '核能',     /核能/],
  ['coal',    '燃煤',     /燃煤/],
  ['cogen',   '汽電共生', /汽電共生/],
  ['gas',     '燃氣',     /燃氣/],
  ['oil',     '燃油',     /燃料油|輕油/],
  ['solar',   '太陽能',   /太陽能/],
  ['wind',    '風力',     /風力/],
  ['hydro',   '水力',     /水力/],
  ['other',   '其他再生', /其它再生|其他再生/],
  ['storage', '儲能',     /^儲能$/],
];

const [loadRaw, genRaw] = await Promise.all([getJson(`${BASE}/d006020/001.json`), getJson(`${BASE}/d006001/001.json`)]);

// 今日電力資訊：原始單位是「萬瓩」，換成 MW
const rec = Object.assign({}, ...loadRaw.records);
const mw  = v => Math.round(parseFloat(v) * 10);
const load = {
  currMW: mw(rec.curr_load), utilPct: +rec.curr_util_rate,
  supplyMW: mw(rec.fore_maxi_sply_capacity), peakMW: mw(rec.fore_peak_dema_load),
  reserveMW: mw(rec.fore_peak_resv_capacity), reservePct: +rec.fore_peak_resv_rate,
  indicator: rec.fore_peak_resv_indicator, peakRange: rec.fore_peak_hour_range, publish: rec.publish_time,
};

// 各機組發電量：每一類最後有一列「小計」，直接取用
const sums = {};
for (const row of genRaw.aaData) {
  if (!row['機組名稱'].startsWith('小計')) continue;      // 有的類別寫成「小計(註5)」
  const type = row['機組類型'].replace(/<[^>]*>/g, '').trim();
  const g = GROUPS.find(([, , re]) => re.test(type));
  if (!g) continue;
  sums[g[0]] = (sums[g[0]] || 0) + (parseFloat(row['淨發電量(MW)']) || 0);
}
const mix = GROUPS.map(([key, label]) => ({ key, label, mw: Math.round(sums[key] || 0) })).filter(m => m.mw > 0);

const out = {
  source: '台灣電力公司 政府資料開放平臺（今日電力資訊、各機組發電量）',
  fetchedAt: new Date().toISOString(),
  load,
  gen: { time: genRaw.DateTime, totalMW: mix.reduce((s, m) => s + m.mw, 0), mix },
};

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(join(ROOT, 'data/taipower.json'), JSON.stringify(out, null, 1));
console.log(`台電 ${out.gen.time}：負載 ${load.currMW} MW、備轉 ${load.reservePct}%（${load.indicator}）`);
console.log(mix.map(m => `${m.label} ${m.mw}`).join('、'));
