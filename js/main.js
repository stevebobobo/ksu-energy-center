// 進入點：載入資料、推進模型時間、定時更新畫面與 MQTT。
import { CampusModel, dayStart } from './model.js';
import { weather, taipower } from './sources.js';
import { link } from './mqtt-link.js';
import { View } from './ui.js';

const TICK_MS = 500;

const campus = await (await fetch('data/campus.json')).json();
const model  = new CampusModel(campus);
model.sensors = link.sensors;     // 光敏認養大樓：MQTT 收到的讀值直接給模型用
const ctx    = { speed: 1, weather, taipower, link, alerts: [], forecast: [] };
let simTime  = Date.now();
let fcDay    = 0;

const weatherAt = ms => weather.at(ms, ctx.speed === 1);

// 開啟頁面時，用今日逐時氣象把 00:00 到現在補算一遍，曲線和累計值才不會從零開始
function backfill() {
  const now = Date.now(), saved = model.scenario;
  model.scenario = Object.fromEntries(Object.keys(saved).map(k => [k, false]));
  model.resetDay(now);
  model.soc = 0.5;
  for (let ms = dayStart(now); ms < now; ms += 60e3) model.step(ms, 60, weather.at(ms, false));
  model.scenario = saved;
  model.events.length = 0;
  model.latch = {};
  simTime = now;
}

function refreshForecast() {
  fcDay = dayStart(simTime);
  ctx.forecast = model.forecast(fcDay, ms => weather.at(ms, false));
}

function tick() {
  if (ctx.speed === 1) {
    const now = Date.now(), dt = (now - simTime) / 1000;
    if (dt > 0) model.step(now, dt, weatherAt(now));
    simTime = now;
  } else {
    let left = ctx.speed * TICK_MS / 1000;
    while (left > 0) {
      const dt = Math.min(60, left);
      simTime += dt * 1000;
      model.step(simTime, dt, weatherAt(simTime));
      left -= dt;
    }
  }
  if (dayStart(simTime) !== fcDay) refreshForecast();
  while (model.events.length) ctx.alerts.unshift(model.events.shift());
  if (ctx.alerts.length > 60) ctx.alerts.length = 60;
  view.render(ctx);
}

const view = new View(campus, model, {
  select: id => { view.select(id); view.render(ctx); },
  toggle: key => { model.scenario[key] = !model.scenario[key]; if (key === 'dr') drSync(); almSync(); tick(); },
  resetScenarios: () => { for (const k in model.scenario) model.scenario[k] = false; drSync(); almSync(); link.alarmsLast.length = 0; tick(); },
  clearAlarms: () => { link.alarmsLast.length = 0; tick(); },   // 警報應變面板的 ✕：清掉已結束的結果
  speed: v => {
    if (v === 1 && ctx.speed !== 1) { backfill(); refreshForecast(); }   // 回到即時：重新對齊現在
    ctx.speed = v;
    tick();
  },
});

await Promise.all([weather.refresh(), taipower.refresh()]);
backfill();
refreshForecast();
tick();
setInterval(tick, TICK_MS);

setInterval(async () => { await weather.refresh(); refreshForecast(); }, 600e3);
setInterval(() => taipower.refresh(), 300e3);

// MQTT：每 2 秒發布全校摘要與一棟建築的讀值（輪流），訊息繞 broker 一圈再顯示在面板上
link.connect();
// 分頁在背景超過 5 分鐘，Chrome 會把一般的 setInterval 壓到一分鐘一次，演練訊息就跟著斷斷續續；
// Worker 裡的計時器不受影響，所以 MQTT 發布改用 Worker 計時。不支援 Worker 時退回 setInterval
function bgInterval(fn, ms) {
  try {
    const w = new Worker(URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: 'text/javascript' })));
    w.onmessage = () => fn();
  } catch (e) { setInterval(fn, ms); }
}
let turn = 0;
bgInterval(() => {
  const s = model.s;
  if (!s) return;
  const r0 = v => Math.round(v);
  link.publish('campus/summary', { load: r0(s.load), pv: r0(s.pv), grid: r0(s.grid), soc: r0(s.soc * 100), temp: +s.wx.T.toFixed(1) });
  const b = model.buildings[turn++ % model.buildings.length];
  link.publish(`building/${b.id}/power`, { kw: +b.live.kw.toFixed(1), name: b.short });
}, 2000);

// 需量反應演練：開始時給一個新編號；進行中每秒發布狀態，網頁控制台收到就讓 LED 閃爍，按鈕回應後排名
let drOff = 0;
function drSync() {
  if (model.scenario.dr && !model.dr) model.dr = link.dr = { id: Date.now().toString(36), start: Date.now(), acks: [], told: 0 };
  if (!model.scenario.dr && model.dr) { model.drLast = { ...model.dr, end: Date.now(), saved: model.s ? model.s.drSaved : 0 }; model.dr = link.dr = null; drOff = 3; }
}
bgInterval(() => {
  const dr = model.dr;
  if (model.scenario.dr && dr) link.publish('dr/state', { on: 1, id: dr.id, sec: Math.round((Date.now() - dr.start) / 1000), acks: dr.acks.length });
  else if (drOff > 0) { drOff--; link.publish('dr/state', { on: 0 }); }
  // 警報應變：有情境開著就每秒發布清單，全部關掉後再發 3 次空清單
  const list = [...link.alarms.values()].map(a => ({ k: a.k, id: a.id, t: a.t, lv: a.lv, sec: Math.round((Date.now() - a.start) / 1000) }));
  if (list.length) { link.publish('alarm/state', { list }); almOff = 3; }
  else if (almOff > 0) { almOff--; link.publish('alarm/state', { list: [] }); }
}, 1000);

// 警報應變演練：情境開啟時給一個新編號。手機回 alarm/seen（收到通知），
// 網頁控制台回 alarm/task（接下任務、Arduino 完成），都記在 link.alarms
const ALARMS = { trip: ['主機跳機', 'crit'], outage: ['台電停電', 'crit'], offline: ['節點離線', 'warn'],
                 cloud: ['烏雲遮日', 'warn'], heat: ['熱浪', 'warn'], event: ['大型活動', 'info'] };
let almOff = 0;
function almSync() {
  for (const k in ALARMS) {
    const a = link.alarms.get(k);
    if (model.scenario[k] && !a) link.alarms.set(k, { k, id: Date.now().toString(36) + k, t: ALARMS[k][0], lv: ALARMS[k][1], start: Date.now(), groups: new Map() });
    if (!model.scenario[k] && a) { a.end = Date.now(); link.alarmsLast.unshift(a); link.alarmsLast.length = Math.min(link.alarmsLast.length, 6); link.alarms.delete(k); }
  }
}
