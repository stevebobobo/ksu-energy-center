// 校園能源模型：不碰畫面，瀏覽器和 Node 都能跑。
// 輸入是時間與氣象（真實資料），輸出是各棟用電、冰水主機、太陽能、儲能、購電的推估值。
import { PLANT, TARIFF, TYPES, SCHEDULES, EMISSION_KG_PER_KWH } from './config.js';

const H8  = 8 * 3600e3;          // 一律用台北時間（UTC+8）計算，不受瀏覽器時區影響
const DAY = 864e5;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function taipei(ms) {
  const d = new Date(ms + H8);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay(),
    hh: d.getUTCHours(), mm: d.getUTCMinutes(), ss: d.getUTCSeconds(),
    hour: d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600,
  };
}
export const dayStart = ms => Math.floor((ms + H8) / DAY) * DAY - H8;

function interp(keys, h) {
  for (let i = 1; i < keys.length; i++) {
    if (h <= keys[i][0]) {
      const [h0, v0] = keys[i - 1], [h1, v1] = keys[i];
      return h1 === h0 ? v1 : v0 + (v1 - v0) * (h - h0) / (h1 - h0);
    }
  }
  return keys[keys.length - 1][1];
}
export function occupancy(sched, dow, hour) {
  const s = SCHEDULES[sched];
  return interp(dow === 0 ? s.sun : dow === 6 ? s.sat : s.wd, hour);
}

// 目前適用的時間電價時段與費率
export function tariffAt(ms) {
  const t  = taipei(ms);
  const md = t.mo * 100 + t.d;
  const { from, to } = TARIFF.summer;
  const summer = md >= from[0] * 100 + from[1] && md <= to[0] * 100 + to[1];
  let band;
  if (t.dow === 0) band = 'off';
  else if (summer) band = t.hour < 9 ? 'off' : t.dow === 6 ? 'sat' : (t.hour >= 16 && t.hour < 22) ? 'peak' : 'half';
  else band = (t.hour < 6 || (t.hour >= 11 && t.hour < 14)) ? 'off' : t.dow === 6 ? 'sat' : 'half';
  return { band, summer, rate: TARIFF.rate[summer ? 'summer' : 'nonSummer'][band], label: TARIFF.label[band] };
}

// 濕球溫度（Stull 2011 近似式），冷卻水塔出水溫度由它決定
export function wetBulb(T, RH) {
  return T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659)) + Math.atan(T + RH) - Math.atan(RH - 1.676331)
    + 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) - 4.686035;
}

// 空調需求係數：外氣愈熱愈濕愈高，19°C 以下不需冷氣
function coolFactor(wx) {
  const teff = wx.T + (wx.RH - 60) * 0.05;
  return clamp((teff - 19) / 14, 0, 1.25);
}

const CRITICAL = new Set(['info', 'utility', 'dorm', 'office']);   // 停電時優先供電的類型

export class CampusModel {
  constructor(campus) {
    this.buildings = campus.buildings.map(src => {
      const type   = TYPES[src.type];
      const peakKw = src.gfa * type.w / 1000;
      const b = { ...src, typeLabel: type.label, cfg: type, peakKw, noise: 0 };

      if (src.plant) {
        const hvacDesign = peakKw * type.hvac;
        const capRt  = hvacDesign * 0.65 / 0.62;             // 主機占空調用電 65%、設計 0.62 kW/RT
        const n      = capRt * 1.15 > 450 ? 3 : 2;
        const unitRt = Math.ceil(capRt * 1.15 / n / 25) * 25;
        b.plantCfg = { capRt, n, unitRt, hvacDesign };
        b.chillers = Array.from({ length: n }, (_, i) => ({ id: `CH-${i + 1}`, tripped: false }));
      }
      b.nodes = [
        { id: `${src.id}-M01`, kind: '總電表',   unit: 'kW' },
        { id: `${src.id}-T01`, kind: '室內溫度', unit: '°C' },
        { id: `${src.id}-H01`, kind: '室內濕度', unit: '%' },
        { id: `${src.id}-C01`, kind: 'CO₂',     unit: 'ppm' },
        { id: `${src.id}-L01`, kind: '照度',     unit: 'lux' },
      ].map(n => ({ ...n, value: 0, offline: false }));
      return b;
    });
    this.byId = Object.fromEntries(this.buildings.map(b => [b.id, b]));
    this.pvKwp = this.buildings.reduce((s, b) => s + b.pvKwp, 0);
    this.scenario = { cloud: false, heat: false, event: false, outage: false, trip: false, offline: false };
    this.events = [];          // 告警事件，由畫面端取走
    this.latch  = {};
    this.soc    = 0.5;
    this.resetDay(0);
  }

  resetDay(ms) {
    this.day     = dayStart(ms);
    this.acc     = { loadKwh: 0, gridKwh: 0, pvKwh: 0, cost: 0, co2: 0, maxDemand: 0, exportKwh: 0 };
    this.history = [];
    this.window  = [];         // 15 分鐘需量視窗
    this.lastSample = 0;
  }

  // 情境會改變模型看到的氣象
  applyScenario(wx) {
    const s = this.scenario;
    return {
      ...wx,
      T:  wx.T + (s.heat ? 5 : 0),
      RH: clamp(wx.RH + (s.heat ? 5 : 0), 0, 100),
      G:  wx.G * (s.cloud ? 0.2 : 1),
    };
  }

  // 單棟用電。live = true 時帶入雜訊、跳機、停電卸載等即時狀態；false 用來算全日預測
  loadOf(b, t, wx, live) {
    const s    = live ? this.scenario : {};
    const cfg  = b.cfg;
    const shed = s.outage && !CRITICAL.has(b.type);
    let occ    = occupancy(cfg.sched, t.dow, t.hour);
    if (s.event && ['classroom', 'hall', 'gym', 'food'].includes(b.type)) occ = Math.max(occ, 1);
    if (shed) occ = 0;

    const n     = live ? 1 + b.noise : 1;
    const base  = b.peakKw * cfg.base * (shed ? 0.6 : 1) * n;
    const light = b.peakKw * (1 - cfg.base - cfg.hvac) * occ * n;
    const occH  = occ > 0.05 ? Math.pow(occ, 0.7) : occ;
    const cool  = coolFactor(wx) * (s.outage ? 0.5 : 1);

    let hvac, plant = null;
    if (b.plantCfg) {
      const p   = b.plantCfg;
      const q   = shed ? 0 : p.capRt * occH * cool;                       // 冷房需求 RT
      const ok  = live ? b.chillers.filter(c => !c.tripped).length : p.n;
      const on  = q < p.capRt * 0.04 ? 0 : Math.min(ok, Math.ceil(q / (p.unitRt * 0.92)));
      const plr = on ? Math.min(1.05, q / (on * p.unitRt)) : 0;
      const unmet = on ? Math.max(0, q - on * p.unitRt * plr) : (q >= p.capRt * 0.04 ? q : 0);
      const cwIn  = Math.max(wetBulb(wx.T, wx.RH) + 4, 22);                // 冷卻水塔趨近溫度 4°C
      const kwEach = p.unitRt * 3.517 / 5.8 * (0.14 + 0.86 * plr) * (1 + 0.022 * (cwIn - 30));
      const chws   = 7 + Math.min(4, unmet / p.capRt * 12);
      const aux    = p.hvacDesign * 0.35 * (on ? 0.35 + 0.65 * q / p.capRt : 0.04);
      hvac  = on * kwEach + aux;
      plant = {
        q, on, plr, unmet, cwIn, cwOut: cwIn + 5 * plr, chws, chwr: chws + 5 * plr,
        kwEach, cop: on ? plr * p.unitRt * 3.517 / kwEach : 0, kwPerRt: on && plr ? kwEach / (plr * p.unitRt) : 0, aux,
      };
    } else {
      hvac = b.peakKw * cfg.hvac * occH * cool * n;
    }
    const kw = base + light + hvac + (s.event && b.type === 'gym' ? 220 : 0);
    return { kw, base, light, hvac, occ, plant, shed };
  }

  pvOf(b, wx) {
    if (!b.pvKwp) return 0;
    const tCell = wx.T + wx.G * 0.03;
    return Math.max(0, b.pvKwp * wx.G / 1000 * PLANT.pv.pr * (1 + PLANT.pv.tempCoef * (tCell - 25)));
  }

  // 全日預測曲線（每 15 分鐘一點），不含雜訊與情境
  forecast(day, weatherAt) {
    const out = [];
    for (let i = 0; i <= 96; i++) {
      const ms = day + i * 900e3, t = taipei(ms), wx = weatherAt(ms);
      let load = 0, pv = 0;
      for (const b of this.buildings) { load += this.loadOf(b, t, wx, false).kw; pv += this.pvOf(b, wx); }
      out.push({ t: ms, load, pv });
    }
    return out;
  }

  alert(key, on, level, text) {
    if (on && !this.latch[key]) this.events.push({ t: this.now, level, text });
    this.latch[key] = on;
  }

  // 往前推進 dt 秒
  step(ms, dt, rawWx) {
    if (dayStart(ms) !== this.day) this.resetDay(ms);
    this.now = ms;
    const t  = taipei(ms);
    const wx = this.applyScenario(rawWx);
    const sc = this.scenario;

    // 情境：冰水主機跳機（負載最大的那座機房第一台）、感測節點離線
    const plants = this.buildings.filter(b => b.plantCfg);
    const big    = plants.reduce((a, b) => (b.plantCfg.capRt > a.plantCfg.capRt ? b : a));
    for (const b of plants) b.chillers.forEach((c, i) => { c.tripped = sc.trip && b === big && i === 0; });
    const offNode = this.byId.eng1.nodes[1];
    offNode.offline = sc.offline;

    let load = 0, pv = 0, unmetRt = 0, hvacKw = 0;
    for (const b of this.buildings) {
      b.noise += -b.noise * dt / 600 + 0.03 * Math.sqrt(Math.min(1, dt / 600)) * (Math.random() * 2 - 1) * 1.7;
      const r = this.loadOf(b, t, wx, true);
      b.live = r;
      b.pv   = this.pvOf(b, wx);
      b.factor = r.kw / b.peakKw;
      load += r.kw; pv += b.pv; hvacKw += r.hvac;
      if (r.plant) unmetRt += r.plant.unmet;

      // 模擬感測節點讀值
      const occH = Math.pow(r.occ, 0.7);
      const tin  = 25.5 + (wx.T - 25.5) * (1 - occH) * 0.6 + (r.plant ? r.plant.unmet / b.plantCfg.capRt * 5 : 0) + (r.shed ? 2 : 0);
      const vals = [r.kw, tin + b.noise * 8, clamp(58 + (wx.RH - 60) * 0.25 + b.noise * 40, 30, 90), 420 + r.occ * 650 * (1 + b.noise * 3), 60 + r.occ * 440];
      b.nodes.forEach((n, i) => { if (!n.offline) n.value = vals[i]; });
    }

    // 儲能調度
    const ess = PLANT.ess, tar = tariffAt(ms);
    const net = load - pv;
    const canDis = Math.min(ess.kw, Math.max(0, (this.soc - ess.socMin) * ess.kwh * 3600 / dt * ess.eff));
    const canChg = Math.min(ess.kw, Math.max(0, (ess.socMax - this.soc) * ess.kwh * 3600 / dt / ess.eff));
    let essKw = 0, mode = '待機';       // 正值放電、負值充電
    if (sc.outage) {
      essKw = clamp(net, -canChg, canDis); mode = essKw > 0 ? '孤島供電' : '孤島充電';
    } else if (net < 0) {
      essKw = -Math.min(canChg, -net); mode = '餘電充電';
    } else if (net > PLANT.contractKw * 0.88) {
      essKw = Math.min(canDis, net - PLANT.contractKw * 0.88); mode = '削峰放電';
    } else if (tar.band === 'peak' && this.soc > 0.25) {
      essKw = Math.min(canDis, 300, net); mode = '尖峰放電';
    } else if (tar.band === 'off' && this.soc < ess.socMax - 0.01) {
      essKw = -Math.min(canChg, 300, Math.max(0, PLANT.contractKw * 0.8 - net)); mode = essKw < 0 ? '離峰充電' : '待機';
    }
    if (Math.abs(essKw) < 1) { essKw = 0; if (!sc.outage) mode = '待機'; }
    this.soc = clamp(this.soc - (essKw > 0 ? essKw / ess.eff : essKw * ess.eff) * dt / 3600 / ess.kwh, 0, 1);

    let grid = sc.outage ? 0 : net - essKw;
    const shortfall = sc.outage ? Math.max(0, net - essKw) : 0;      // 停電時供不上的缺口
    const exportKw  = grid < 0 ? -grid : 0;                          // 餘電（不逆送，視為棄電）
    grid = Math.max(0, grid);

    // 15 分鐘平均需量（台電計費用的需量算法）
    this.window.push({ t: ms, kw: grid, dt });
    while (this.window.length > 1 && this.window[0].t < ms - 900e3) this.window.shift();
    const wsum = this.window.reduce((s, w) => s + w.dt, 0);
    const demand = this.window.reduce((s, w) => s + w.kw * w.dt, 0) / (wsum || 1);

    const h = dt / 3600, a = this.acc;
    a.loadKwh += (load - shortfall) * h; a.gridKwh += grid * h; a.pvKwh += pv * h; a.exportKwh += exportKw * h;
    a.cost += grid * h * tar.rate; a.co2 += grid * h * EMISSION_KG_PER_KWH;
    a.maxDemand = Math.max(a.maxDemand, demand);

    if (ms - this.lastSample >= 300e3) {
      this.history.push({ t: ms, load, pv, grid, soc: this.soc });
      this.lastSample = ms;
    }

    const ratio = demand / PLANT.contractKw;
    this.alert('d90',  ratio >= 0.9 && ratio < 1, 'warn', `需量達契約容量 ${Math.round(ratio * 100)}%，儲能啟動削峰`);
    this.alert('d100', ratio >= 1, 'crit', `需量 ${Math.round(demand)} kW 超過契約容量 ${PLANT.contractKw} kW，將產生超約附加費`);
    this.alert('trip', sc.trip, 'crit', `${big.name} 冰水主機 CH-1 跳機，其餘主機加載`);
    this.alert('unmet', unmetRt > 15, 'warn', `冷房能力不足 ${Math.round(unmetRt)} RT，冰水出水溫上升`);
    this.alert('out',  sc.outage, 'crit', '台電饋線停電，校園切換孤島運轉，非必要負載卸載');
    this.alert('short', shortfall > 20, 'crit', `孤島供電不足，缺口 ${Math.round(shortfall)} kW`);
    this.alert('soc',  this.soc <= 0.15, 'warn', `儲能電量剩 ${Math.round(this.soc * 100)}%`);
    this.alert('cloud', sc.cloud, 'warn', '雲層通過，太陽能發電驟降');
    this.alert('heat', sc.heat, 'warn', `外氣溫度升至 ${wx.T.toFixed(1)}°C，空調負載增加`);
    this.alert('event', sc.event, 'info', '體育館大型活動進場，教學區滿載');
    this.alert('off',  sc.offline, 'warn', `感測節點 ${offNode.id}（工程學院一館 室內溫度）失去連線`);

    this.s = {
      t: ms, wx, tar, load, pv, grid, demand, ratio, essKw, essMode: mode, soc: this.soc,
      exportKw, shortfall, hvacKw, renewShare: load > 0 ? Math.min(1, pv / load) : 0, acc: a,
    };
    return this.s;
  }
}
