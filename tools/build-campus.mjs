// 把 OpenStreetMap 的崑山校區資料（tools/raw/osm.json）轉成戰情室用的 data/campus.json
// 用法：node tools/build-campus.mjs
// 建築輪廓、名稱、座標是 OSM 的真實資料；樓層數、用途分類、冰水主機、太陽能是「假設值」，
// 拿到總務處資料後直接改下面的 METERED 表再重跑即可。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const osm  = JSON.parse(readFileSync(join(ROOT, 'tools/raw/osm.json'), 'utf8'));

// 校區範圍（OSM relation 8250275 崑山科技大學 的外框）
const BBOX = { minLat: 22.99345, maxLat: 22.99842, minLon: 120.25058, maxLon: 120.25472 };
const LAT0 = (BBOX.minLat + BBOX.maxLat) / 2;
const LON0 = (BBOX.minLon + BBOX.maxLon) / 2;
const MX   = 111320 * Math.cos(LAT0 * Math.PI / 180);   // 每度經度的公尺數
const MY   = 110540;                                     // 每度緯度的公尺數

// 列入電表監測的建築。floors 除了註明 osm 的以外都是假設；plant = 設有中央冰水主機（假設）；pv = 屋頂太陽能 kWp（假設）
const METERED = {
  '工程學院一館':         { id: 'eng1',  short: '工程一館', type: 'lab',       floors: 7, osm: true, plant: true, pv: 160 },
  '工程學院二館':         { id: 'eng2',  short: '工程二館', type: 'lab',       floors: 5 },
  '工程學院三館':         { id: 'eng3',  short: '工程三館', type: 'lab',       floors: 5, pv: 120 },
  '資訊科技學院':         { id: 'it',    short: '資訊館',   type: 'info',      floors: 7, plant: true, pv: 180 },
  '教學大樓':             { id: 'teach', short: '教學大樓', type: 'classroom', floors: 6, plant: true, pv: 140 },
  '圖書資訊館':           { id: 'lib',   short: '圖資館',   type: 'library',   floors: 8, plant: true, pv: 150 },
  '研究大樓':             { id: 'rsch',  short: '研究大樓', type: 'lab',       floors: 6 },
  '階梯教室':             { id: 'lect',  short: '階梯教室', type: 'classroom', floors: 3 },
  '行政中心':             { id: 'admin', short: '行政中心', type: 'office',    floors: 5, plant: true },
  '行政中心禮堂':         { id: 'hall',  short: '禮堂',     type: 'hall',      floors: 2 },
  '智慧生活管理學院一館': { id: 'slm1',  short: '智管一館', type: 'classroom', floors: 5 },
  '智慧生活管理學院二館': { id: 'slm2',  short: '智管二館', type: 'classroom', floors: 5 },
  '智慧生活管理學院三館': { id: 'slm3',  short: '智管三館', type: 'classroom', floors: 7, plant: true, pv: 110 },
  '創意媒體學院一館':     { id: 'cm1',   short: '創媒一館', type: 'classroom', floors: 5 },
  '創意媒體學院二館':     { id: 'cm2',   short: '創媒二館', type: 'classroom', floors: 6, pv: 90 },
  '設計一館':             { id: 'des1',  short: '設計一館', type: 'classroom', floors: 4 },
  '設計三館':             { id: 'des3',  short: '設計三館', type: 'classroom', floors: 5 },
  '雲青館':               { id: 'yun',   short: '雲青館',   type: 'classroom', floors: 4 },
  '創新創業育成大樓':     { id: 'incb',  short: '育成大樓', type: 'office',    floors: 5 },
  '藝術中心':             { id: 'art',   short: '藝術中心', type: 'office',    floors: 2 },
  '體育館':               { id: 'gym',   short: '體育館',   type: 'gym',       floors: 3, pv: 250 },
  '游泳池':               { id: 'pool',  short: '游泳池',   type: 'pool',      floors: 1 },
  '學生活動中心':         { id: 'sac',   short: '活動中心', type: 'hall',      floors: 3 },
  '餐廳':                 { id: 'food',  short: '餐廳',     type: 'food',      floors: 2 },
  '北苑宿舍':             { id: 'dormN', short: '北苑',     type: 'dorm',      floors: 6 },
  '南苑宿舍':             { id: 'dormS', short: '南苑',     type: 'dorm',      floors: 6 },
  '蓉苑宿舍':             { id: 'dormR', short: '蓉苑',     type: 'dorm',      floors: 5 },
  '興苑宿舍':             { id: 'dormX', short: '興苑',     type: 'dorm',      floors: 5 },
  '元苑宿舍':             { id: 'dormY', short: '元苑',     type: 'dorm',      floors: 5 },
  '合苑學生宿舍':         { id: 'dormH', short: '合苑',     type: 'dorm',      floors: 6 },
  '污水處理場':           { id: 'wwtp',  short: '污水場',   type: 'utility',   floors: 1 },
};

const r1 = n => Math.round(n * 10) / 10;
const project = p => [r1((p.lon - LON0) * MX), r1((LAT0 - p.lat) * MY)];   // y 向下（SVG 座標）
const inCampus = b => b && b.minlat >= BBOX.minLat - 0.0002 && b.maxlat <= BBOX.maxLat + 0.0002
                        && b.minlon >= BBOX.minLon - 0.0002 && b.maxlon <= BBOX.maxLon + 0.0002;

// 多邊形面積（平方公尺，鞋帶公式）
function area(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}
function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [r1(x / pts.length), r1(y / pts.length)];
}
// way 直接有 geometry；relation 取 outer 成員
function rings(e) {
  if (e.geometry) return [e.geometry.map(project)];
  return (e.members || []).filter(m => m.geometry && m.role !== 'inner').map(m => m.geometry.map(project));
}

const buildings = [], others = [], water = [];
const seen = new Set();

for (const e of osm.elements) {
  const t = e.tags || {};
  if (!inCampus(e.bounds)) continue;
  const rs = rings(e);
  if (!rs.length) continue;

  if (t.natural === 'water') { water.push({ name: t.name || '', pts: rs[0] }); continue; }

  const cfg = METERED[t.name];
  if (cfg && !seen.has(cfg.id)) {
    seen.add(cfg.id);
    const foot = rs.reduce((s, r) => s + area(r), 0);
    buildings.push({
      id: cfg.id, name: t.name, short: cfg.short, type: cfg.type,
      floors: cfg.floors, floorsSource: cfg.osm ? 'osm' : 'assumed',
      footprint: Math.round(foot), gfa: Math.round(foot * cfg.floors),
      plant: !!cfg.plant, pvKwp: cfg.pv || 0,
      rings: rs, center: centroid(rs[0]),
    });
  } else if (t.building || t.amenity === 'shelter' || t.amenity === 'kindergarten') {
    others.push({ name: t.name || '', pts: rs[0] });   // 只畫出來、不列入監測
  }
}

// 游泳池、餐廳、校區邊界在 OSM 是 relation，另外從 OSM API 抓的 full.json 讀（tools/raw/rel_<id>.json）
function relationOuterRings(id) {
  const j     = JSON.parse(readFileSync(join(ROOT, `tools/raw/rel_${id}.json`), 'utf8'));
  const nodes = new Map(j.elements.filter(e => e.type === 'node').map(n => [n.id, n]));
  const ways  = new Map(j.elements.filter(e => e.type === 'way').map(w => [w.id, w]));
  const rel   = j.elements.find(e => e.type === 'relation');
  return {
    name: rel.tags.name,
    rings: rel.members.filter(m => m.type === 'way' && m.role === 'outer')
      .map(m => ways.get(m.ref).nodes.map(n => project(nodes.get(n)))),
  };
}
for (const id of [8250275, 8250276]) {
  const { name, rings: rs } = relationOuterRings(id);
  const cfg = METERED[name];
  seen.add(cfg.id);
  const foot = rs.reduce((s, r) => s + area(r), 0);
  buildings.push({
    id: cfg.id, name, short: cfg.short, type: cfg.type, floors: cfg.floors, floorsSource: 'assumed',
    footprint: Math.round(foot), gfa: Math.round(foot * cfg.floors),
    plant: !!cfg.plant, pvKwp: cfg.pv || 0, rings: rs, center: centroid(rs[0]),
  });
}
// 校區邊界：兩段 outer way 首尾相接，取最長那段當輪廓即可（另一段只是把缺口補起來）
const boundary = relationOuterRings(10082348).rings.sort((a, b) => b.length - a.length)[0];

const missing = Object.keys(METERED).filter(n => !seen.has(METERED[n].id));
if (missing.length) console.warn('OSM 裡找不到：', missing.join('、'));

const out = {
  source: 'OpenStreetMap contributors (ODbL)，建築輪廓與名稱為真實資料；樓層/用途/主機/太陽能為假設',
  origin: { lat: LAT0, lon: LON0 },
  extent: {
    minX: r1((BBOX.minLon - LON0) * MX), maxX: r1((BBOX.maxLon - LON0) * MX),
    minY: r1((LAT0 - BBOX.maxLat) * MY), maxY: r1((LAT0 - BBOX.minLat) * MY),
  },
  boundary, buildings, others, water,
};

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(join(ROOT, 'data/campus.json'), JSON.stringify(out));

const gfa = buildings.reduce((s, b) => s + b.gfa, 0);
console.log(`監測建築 ${buildings.length} 棟、其他 ${others.length} 棟、水體 ${water.length} 處`);
console.log(`總樓地板面積（推估）${gfa.toLocaleString()} m²，太陽能合計 ${buildings.reduce((s, b) => s + b.pvKwp, 0)} kWp`);
for (const b of buildings) console.log(`  ${b.id.padEnd(6)} ${b.name.padEnd(12, '　')} 基地 ${String(b.footprint).padStart(5)} m² × ${b.floors}F = ${String(b.gfa).padStart(6)} m²`);
