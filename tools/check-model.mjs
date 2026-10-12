// 不開瀏覽器，直接跑一整天的模型，檢查數字是否合理。用法：node tools/check-model.mjs [YYYY-MM-DD]
import { readFileSync } from 'node:fs';
import { CampusModel, taipei, dayStart, tariffAt } from '../js/model.js';
import { PLANT } from '../js/config.js';

const campus = JSON.parse(readFileSync(new URL('../data/campus.json', import.meta.url), 'utf8'));
const model  = new CampusModel(campus);
const day    = dayStart(process.argv[2] ? Date.parse(process.argv[2] + 'T12:00:00+08:00') : Date.now());

// 台南十月的典型天氣（只供檢查用）
const weatherAt = ms => {
  const h = taipei(ms).hour;
  return {
    T:  26.5 + 4.5 * Math.sin((h - 9) / 24 * 2 * Math.PI),
    RH: 72 - 12 * Math.sin((h - 9) / 24 * 2 * Math.PI),
    G:  Math.max(0, 820 * Math.sin((h - 6) / 12 * Math.PI)),
  };
};

console.log(`裝置：尖峰合計 ${Math.round(model.buildings.reduce((s, b) => s + b.peakKw, 0))} kW、太陽能 ${model.pvKwp} kWp、契約 ${PLANT.contractKw} kW`);
for (const b of model.buildings.filter(b => b.plantCfg)) {
  console.log(`  機房 ${b.name}：${b.plantCfg.n} × ${b.plantCfg.unitRt} RT`);
}
console.log('時刻  時段      負載   太陽能  儲能   購電   需量  SOC   外氣');
for (let ms = day; ms < day + 864e5; ms += 60e3) {
  const s = model.step(ms, 60, weatherAt(ms));
  const t = taipei(ms);
  if (t.mm === 0) {
    console.log(`${String(t.hh).padStart(2, '0')}:00 ${tariffAt(ms).label.padEnd(5, '　')} ${[s.load, s.pv, s.essKw, s.grid, s.demand].map(v => String(Math.round(v)).padStart(6)).join(' ')} ${String(Math.round(s.soc * 100)).padStart(4)}% ${s.wx.T.toFixed(1)}`);
  }
}
const a = model.acc;
console.log(`全日：用電 ${Math.round(a.loadKwh)} 度、購電 ${Math.round(a.gridKwh)} 度、太陽能 ${Math.round(a.pvKwh)} 度、電費 ${Math.round(a.cost)} 元、碳排 ${Math.round(a.co2)} kg、最高需量 ${Math.round(a.maxDemand)} kW`);
const lib = model.byId.lib;
console.log('圖資館主機（最後一筆）：', JSON.stringify(lib.live.plant, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v));
console.log('告警：', model.events.map(e => e.text).join(' | ') || '無');
