// 進入點：載入資料、推進模型時間、定時更新畫面與 MQTT。
import { CampusModel, dayStart } from './model.js';
import { weather, taipower } from './sources.js';
import { link } from './mqtt-link.js';
import { View } from './ui.js';

const TICK_MS = 500;

const campus = await (await fetch('data/campus.json')).json();
const model  = new CampusModel(campus);
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
  toggle: key => { model.scenario[key] = !model.scenario[key]; tick(); },
  resetScenarios: () => { for (const k in model.scenario) model.scenario[k] = false; tick(); },
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
let turn = 0;
setInterval(() => {
  const s = model.s;
  if (!s) return;
  const r0 = v => Math.round(v);
  link.publish('campus/summary', { load: r0(s.load), pv: r0(s.pv), grid: r0(s.grid), soc: r0(s.soc * 100), temp: +s.wx.T.toFixed(1) });
  const b = model.buildings[turn++ % model.buildings.length];
  link.publish(`building/${b.id}/power`, { kw: +b.live.kw.toFixed(1), name: b.short });
}, 2000);
