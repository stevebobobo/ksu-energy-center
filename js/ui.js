// 畫面繪製：只讀模型狀態，不做任何計算決策。
import { PLANT, MQTT, EMISSION_KG_PER_KWH } from './config.js';
import { taipei, dayStart, tariffAt } from './model.js';

const $   = id => document.getElementById(id);
const NS  = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, text) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
};
const fmt  = (n, d = 0) => (Number.isFinite(n) ? n : 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pad2 = n => String(n).padStart(2, '0');
const WEEK = '日一二三四五六';
const TAG  = { live: '<span class="tag live">真實</span>', est: '<span class="tag est">推估</span>', sim: '<span class="tag sim">模擬</span>' };

export const clockText = ms => { const t = taipei(ms); return `${t.y}-${pad2(t.mo)}-${pad2(t.d)}(${WEEK[t.dow]}) ${pad2(t.hh)}:${pad2(t.mm)}:${pad2(t.ss)}`; };
const hm = ms => { const t = taipei(ms); return `${pad2(t.hh)}:${pad2(t.mm)}`; };

// 負載率 0–1 對應的顏色：深藍 → 藍 → 金 → 紅
const RAMP = [[0, [20, 48, 77]], [0.4, [47, 111, 179]], [0.78, [212, 169, 42]], [1.05, [224, 73, 47]]];
function ramp(f) {
  f = Math.max(0, Math.min(1.05, f));
  for (let i = 1; i < RAMP.length; i++) {
    if (f <= RAMP[i][0]) {
      const [f0, c0] = RAMP[i - 1], [f1, c1] = RAMP[i], k = (f - f0) / (f1 - f0);
      return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * k)).join(',')})`;
    }
  }
}

const MIX_COLOR = { nuclear: '#b9c4d4', coal: '#5c6f88', cogen: '#7f93ad', gas: '#4a9be8', oil: '#3a4a60', solar: '#f2d268', wind: '#9ad0f5', hydro: '#1f6fb5', other: '#d4a92a', storage: '#e0492f' };
const LAMP = { G: ['#3fae5a', '供電充裕'], Y: ['#f2d268', '供電吃緊'], O: ['#f08a2c', '供電警戒'], R: ['#e0492f', '限電警戒'], B: ['#111', '限電準備'] };

const SCENARIOS = [
  ['cloud',   '烏雲遮日'],
  ['heat',    '熱浪 +5°C'],
  ['event',   '大型活動'],
  ['trip',    '主機跳機', true],
  ['offline', '節點離線', true],
  ['outage',  '台電停電', true],
];
const SPEEDS = [[1, '即時'], [60, '×60'], [600, '×600'], [1440, '×1440（一分鐘一天）']];

export class View {
  constructor(campus, model, actions) {
    this.model = model;
    this.selected = 'lib';
    this.actions = actions;
    this.buildMap(campus);
    this.buildFlow();
    this.buildButtons();
  }

  select(id) { this.selected = id; }

  // ── 校園地圖（真實輪廓）──
  buildMap(campus) {
    // 校區是南北向的長條，轉 90 度（北方朝左）才塞得進橫向面板
    const rot = ([x, y]) => [y, -x];
    const src = campus.extent, p = 16;
    const e = { minX: src.minY, maxX: src.maxY, minY: -src.maxX, maxY: -src.minX };
    const map = $('map');
    map.setAttribute('viewBox', `${e.minX - p} ${e.minY - p} ${e.maxX - e.minX + p * 2} ${e.maxY - e.minY + p * 2}`);
    const poly = pts => pts.map(q => rot(q).join(',')).join(' ');
    map.append(svg('polygon', { class: 'ground', points: poly(campus.boundary) }));
    for (const w of campus.water)  map.append(svg('polygon', { class: 'water', points: poly(w.pts) }));
    for (const o of campus.others) map.append(svg('polygon', { class: 'other', points: poly(o.pts) }));

    this.shapes = {};
    const labels = svg('g');
    for (const b of campus.buildings) {
      const d = b.rings.map(r => 'M' + r.map(q => rot(q).join(' ')).join('L') + 'Z').join('');
      const path = svg('path', { class: 'bld', d });
      path.append(svg('title', {}, b.name));
      path.addEventListener('click', () => this.actions.select(b.id));
      map.append(path);

      const [cx, cy] = rot(b.center), big = b.footprint >= 900;
      labels.append(svg('text', { x: cx, y: cy + (big ? -1 : 2.5), class: big ? '' : 'small' }, b.short));
      const kw = big ? svg('text', { x: cx, y: cy + 8.5, class: 'kw' }) : null;
      if (kw) labels.append(kw);
      if (b.pvKwp) labels.append(svg('rect', { class: 'pv', x: cx - 3, y: cy - 17, width: 6, height: 6 }));
      if (b.plant) labels.append(svg('rect', { class: 'ch', x: cx + (b.pvKwp ? 6 : -2.5), y: cy - 16.5, width: 5, height: 5, transform: `rotate(45 ${cx + (b.pvKwp ? 8.5 : 0)} ${cy - 14})` }));
      this.shapes[b.id] = { path, kw };
    }
    map.append(labels);

    const north = svg('g', { class: 'north', transform: `translate(${e.minX + 2} ${e.minY - 4})` });
    north.append(svg('path', { d: 'M-10 0 L6 -5 L2 0 L6 5 Z' }), svg('text', { x: 13, y: 3.2 }, 'N'));
    const scale = svg('g', { class: 'scale', transform: `translate(${e.minX - 6} ${e.maxY + 8})` });
    scale.append(svg('line', { x1: 0, y1: 0, x2: 100, y2: 0 }), svg('line', { x1: 0, y1: -3, x2: 0, y2: 3 }), svg('line', { x1: 100, y1: -3, x2: 100, y2: 3 }), svg('text', { x: 104, y: 2.5 }, '100 m'));
    map.append(north, scale);

    // 停電卸載用的斜線圖樣
    const defs = svg('defs');
    const pat  = svg('pattern', { id: 'shed', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    pat.append(svg('rect', { width: 6, height: 6, fill: '#0f1d30' }), svg('rect', { width: 2, height: 6, fill: '#5c6f88' }));
    defs.append(pat);
    map.prepend(defs);
  }

  // ── 能量流向圖 ──
  buildFlow() {
    const f = $('flow');
    const box = (x, y, w, h, label, cls = '') => {
      f.append(svg('rect', { class: 'box ' + cls, x, y, width: w, height: h }));
      f.append(svg('text', { x: x + w / 2, y: y + 14 }, label));
      const v = svg('text', { class: 'v', x: x + w / 2, y: y + 34 });
      const u = svg('text', { class: 'u', x: x + w / 2, y: y + 47 });
      f.append(v, u);
      return { v, u };
    };
    const wire = (d, color) => {
      f.append(svg('path', { class: 'wire', d }));
      const run = svg('path', { class: 'run idle', d, stroke: color });
      f.append(run);
      return run;
    };
    this.flow = {
      wPv:   wire('M150 31 H205 V52 H240', '#f2d268'),
      wGrid: wire('M150 89 H205 V68 H240', '#4a9be8'),
      wEss:  wire('M360 60 H450', '#f2d268'),
      pv:   box(20, 4, 130, 54, '太陽能'),
      grid: box(20, 62, 130, 54, '台電購電'),
      load: box(240, 20, 120, 80, '校園負載', 'hub'),
      ess:  box(450, 20, 130, 80, '儲能系統'),
    };
  }

  buildButtons() {
    const sc = $('scenarios');
    this.scBtns = {};
    for (const [key, label, danger] of SCENARIOS) {
      const b = document.createElement('button');
      b.textContent = label;
      if (danger) b.className = 'danger';
      b.onclick = () => this.actions.toggle(key);
      sc.append(b);
      this.scBtns[key] = b;
    }
    const reset = document.createElement('button');
    reset.textContent = '全部復原'; reset.className = 'ghost';
    reset.onclick = () => this.actions.resetScenarios();
    sc.append(reset);

    const sp = $('speeds');
    this.spBtns = {};
    for (const [v, label] of SPEEDS) {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => this.actions.speed(v);
      sp.append(b);
      this.spBtns[v] = b;
    }
  }

  // ── 每次更新 ──
  render(ctx) {
    const { model } = this, s = model.s;
    if (!s) return;
    this.renderHeader(ctx, s);
    this.renderKpis(ctx, s);
    this.renderMap();
    this.renderFlow(s);
    this.renderCurve(ctx, s);
    this.renderRank();
    this.renderDetail(s);
    this.renderTaipower(ctx);
    this.renderMqtt(ctx);
    this.renderAlerts(ctx);
    for (const k in this.scBtns) this.scBtns[k].classList.toggle('on', model.scenario[k]);
    for (const v in this.spBtns) this.spBtns[v].classList.toggle('on', +v === ctx.speed);
  }

  renderHeader(ctx, s) {
    const { weather, taipower, link } = ctx;
    const live = ctx.speed === 1;
    $('clock').textContent = clockText(s.t);
    $('clock-label').textContent = live ? '台北時間' : `模擬時間 ×${ctx.speed}`;
    $('clock').parentElement.classList.toggle('sim', !live);

    const wx = weather.status === 'live'
      ? ['ok', s.wx.kind === 'live' ? `即時觀測 ${hm(weather.current.t)}` : '今日逐時資料']
      : ['bad', '離線，改用氣候平均'];
    const age = taipower.ageMin();
    const tp  = age == null ? ['bad', '無資料'] : [age <= 30 ? 'ok' : '', `${hm(Date.parse(taipower.data.gen.time + '+08:00'))} 快照`];
    const mq  = { online: ['ok', '已連線'], connecting: ['', '連線中'], off: ['bad', '未啟用'] }[link.status];
    $('chips').innerHTML = [['氣象', wx], ['台電', tp], ['MQTT', mq]]
      .map(([k, [cls, v]]) => `<span class="chip ${cls}">${k}<b>${v}</b></span>`).join('');
  }

  renderKpis(ctx, s) {
    const a = s.acc, pct = s.ratio * 100;
    const cells = [
      { h: '即時需量', tag: 'est', v: fmt(s.demand), u: 'kW', alarm: pct >= 100,
        meter: pct, s: `契約 ${fmt(PLANT.contractKw)} kW 的 <b>${fmt(pct)}%</b>` },
      { h: '校園總負載', tag: 'est', v: fmt(s.load), u: 'kW', alarm: s.shortfall > 20,
        s: s.shortfall > 20 ? `供電缺口 <b>${fmt(s.shortfall)} kW</b>` : `空調占 <b>${fmt(s.hvacKw / s.load * 100)}%</b>` },
      { h: '太陽能發電', tag: 'est', v: fmt(s.pv), u: 'kW',
        s: `裝置 ${fmt(this.model.pvKwp)} kWp · 供應 <b>${fmt(s.renewShare * 100)}%</b>` },
      { h: '儲能電量', tag: 'sim', v: fmt(s.soc * 100), u: '%',
        s: `${s.essMode} <b>${s.essKw ? fmt(Math.abs(s.essKw)) + ' kW' : ''}</b>` },
      { h: '台電購電', tag: 'est', v: fmt(s.grid), u: 'kW', alarm: this.model.scenario.outage,
        s: this.model.scenario.outage ? '<b>饋線停電</b>' : `${s.tar.label} <b>${s.tar.rate.toFixed(2)} 元/度</b>` },
      { h: '今日用電', tag: 'est', v: fmt(a.loadKwh), u: '度',
        s: `購電 <b>${fmt(a.gridKwh)}</b> · 自發 <b>${fmt(a.pvKwh)}</b>` },
      { h: '今日電費', tag: 'est', v: fmt(a.cost), u: '元',
        s: `碳排 <b>${fmt(a.co2)} kg</b>（${EMISSION_KG_PER_KWH}/度）` },
      // 熱浪、烏雲情境會改動氣象值，這時就不能再標「真實」
      { h: '外氣條件', tag: s.wx.kind === 'climate' || this.model.scenario.heat || this.model.scenario.cloud ? 'sim' : 'live', v: s.wx.T.toFixed(1), u: '°C',
        s: `濕度 <b>${fmt(s.wx.RH)}%</b> · 日射 <b>${fmt(s.wx.G)} W/m²</b>` },
    ];
    $('kpis').innerHTML = cells.map(c => `
      <div class="kpi${c.alarm ? ' alarm' : ''}">
        <h3>${c.h}${TAG[c.tag]}</h3>
        <div class="v">${c.v}<small>${c.u}</small></div>
        ${c.meter != null ? `<div class="meter${c.meter >= 90 ? ' hot' : ''}"><i style="width:${Math.min(100, c.meter)}%"></i></div>` : ''}
        <div class="s">${c.s}</div>
      </div>`).join('');
  }

  renderMap() {
    for (const b of this.model.buildings) {
      const sh = this.shapes[b.id];
      sh.path.setAttribute('fill', b.live.shed ? 'url(#shed)' : ramp(b.factor));
      sh.path.classList.toggle('sel', b.id === this.selected);
      if (sh.kw) sh.kw.textContent = fmt(b.live.kw) + ' kW';
    }
  }

  renderFlow(s) {
    const f = this.flow, set = (box, v, u) => { box.v.textContent = v; box.u.textContent = u; };
    set(f.pv, fmt(s.pv), 'kW');
    set(f.grid, fmt(s.grid), 'kW');
    set(f.load, fmt(s.load), 'kW');
    set(f.ess, `${fmt(s.soc * 100)}%`, s.essKw ? `${s.essMode} ${fmt(Math.abs(s.essKw))} kW` : '待機');
    f.wPv.classList.toggle('idle', s.pv < 5);
    f.wGrid.classList.toggle('idle', s.grid < 5);
    f.wEss.classList.toggle('idle', !s.essKw);
    f.wEss.classList.toggle('rev', s.essKw > 0);            // 放電：往校園方向流
    f.wEss.setAttribute('stroke', s.essKw > 0 ? '#f2d268' : '#4a9be8');
  }

  renderCurve(ctx, s) {
    const el = $('curve'), W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    el.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const L = 38, R = 8, T = 8, B = 24, day = dayStart(s.t);
    const fc = ctx.forecast || [], hist = this.model.history;
    const peak = Math.max(PLANT.contractKw * 1.1, ...fc.map(p => p.load), ...hist.map(p => p.load));
    const yMax = Math.ceil(peak / 500) * 500;
    const x = ms => L + (ms - day) / 864e5 * (W - L - R);
    const y = kw => T + (1 - kw / yMax) * (H - T - B);
    const line = (pts, key) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p[key]).toFixed(1)}`).join('');

    let out = '';
    for (let kw = 0; kw <= yMax; kw += yMax / 4) {
      out += `<line class="axis" x1="${L}" x2="${W - R}" y1="${y(kw)}" y2="${y(kw)}"/><text x="${L - 5}" y="${y(kw) + 3}" text-anchor="end">${fmt(kw)}</text>`;
    }
    for (let h = 0; h <= 24; h += 3) out += `<text x="${x(day + h * 3600e3)}" y="${H - 3}" text-anchor="middle">${pad2(h)}</text>`;
    // 時間電價色帶
    const bandColor = { peak: '#e0492f', half: '#a8861f', sat: '#1f4f86', off: '#1b3250' };
    for (let i = 0; i < 48; i++) {
      const t0 = day + i * 1800e3;
      out += `<rect x="${x(t0)}" y="${H - B + 3}" width="${(W - L - R) / 48 + .5}" height="4" fill="${bandColor[tariffAt(t0 + 60e3).band]}"/>`;
    }
    if (fc.length) out += `<path d="${line(fc, 'load')}" fill="none" stroke="#8094ae" stroke-width="1.2" stroke-dasharray="3 3"/>`;
    if (hist.length > 1) {
      const last = hist[hist.length - 1];
      out += `<path d="${line(hist, 'pv')}L${x(last.t)} ${y(0)}L${x(hist[0].t)} ${y(0)}Z" fill="#d4a92a" opacity=".45"/>`;
      out += `<path d="${line(hist, 'grid')}" fill="none" stroke="#4a9be8" stroke-width="1.4"/>`;
      out += `<path d="${line(hist, 'load')}" fill="none" stroke="#e9eef5" stroke-width="1.8"/>`;
    }
    out += `<line x1="${L}" x2="${W - R}" y1="${y(PLANT.contractKw)}" y2="${y(PLANT.contractKw)}" stroke="#e0492f" stroke-width="1" stroke-dasharray="5 3"/>`;
    out += `<line x1="${x(s.t)}" x2="${x(s.t)}" y1="${T}" y2="${H - B}" stroke="#f2d268" stroke-width="1"/>`;
    el.innerHTML = out;
    $('curve-note').textContent = `今日最高需量 ${fmt(s.acc.maxDemand)} kW · 底部色帶為時間電價時段`;
  }

  renderRank() {
    const top = [...this.model.buildings].sort((a, b) => b.live.kw - a.live.kw).slice(0, 8);
    const max = top[0].live.kw;
    $('rank').innerHTML = top.map(b => `
      <div data-id="${b.id}" class="${b.id === this.selected ? 'sel' : ''}">
        <span>${b.short}</span>
        <span class="barw"><i style="width:${b.live.kw / max * 100}%;background:${ramp(b.factor)}"></i></span>
        <span class="n">${fmt(b.live.kw)}<small> kW</small></span>
      </div>`).join('');
    for (const row of $('rank').children) row.onclick = () => this.actions.select(row.dataset.id);
  }

  renderDetail(s) {
    const b = this.model.byId[this.selected], r = b.live;
    $('detail-title').textContent = b.name;
    $('detail-note').textContent = `${b.typeLabel} · 樓地板 ${fmt(b.gfa)} m² · ${b.floors} 層${b.floorsSource === 'assumed' ? '（假設）' : ''}`;
    const parts = [['基載', r.base, '#5c6f88'], ['照明插座', r.light, '#4a9be8'], ['空調', r.hvac, '#d4a92a']];

    let html = `
      <div class="d-head">
        <div><div class="big">${fmt(r.kw)}<small>kW</small>${TAG.est}</div>
          <p>負載率 <b>${fmt(b.factor * 100)}%</b> · 使用率 <b>${fmt(r.occ * 100)}%</b>${b.pvKwp ? ` · 屋頂太陽能 <b>${fmt(b.pv)} kW</b> / ${b.pvKwp} kWp` : ''}</p></div>
        <p>${r.shed ? '<b style="color:var(--red)">停電卸載中</b>' : ''}</p>
      </div>
      <div class="split">${parts.map(([, v, c]) => `<i style="width:${v / r.kw * 100}%;background:${c}"></i>`).join('')}</div>
      <div class="split-legend">${parts.map(([k, v, c]) => `<div><b style="background:${c}"></b>${k}<span>${fmt(v)} kW</span></div>`).join('')}</div>`;

    if (r.plant) {
      const p = r.plant, cfg = b.plantCfg;
      let running = p.on;
      html += `
        <h4>冰水主機房${TAG.sim}</h4>
        <div class="plant-sum">
          <div><span>冷房負載</span><b>${fmt(p.q)}<small>RT</small></b></div>
          <div><span>冰水 出 / 回</span><b>${p.chws.toFixed(1)}<small>/</small>${p.chwr.toFixed(1)}<small>°C</small></b></div>
          <div><span>冷卻水 進 / 出</span><b>${p.cwIn.toFixed(1)}<small>/</small>${p.cwOut.toFixed(1)}<small>°C</small></b></div>
          <div><span>主機效率</span><b>${p.on ? p.kwPerRt.toFixed(2) : '—'}<small>kW/RT</small></b></div>
        </div>
        <table><tr><th>主機</th><th>容量</th><th>狀態</th><th>負載率</th><th>耗電</th><th>COP</th></tr>
        ${b.chillers.map(c => {
          const on = !c.tripped && running-- > 0;
          const st = c.tripped ? '<span class="st bad">跳機</span>' : on ? '<span class="st on">運轉</span>' : '<span class="st off">待機</span>';
          return `<tr><td class="id">${c.id}</td><td>${cfg.unitRt} RT</td><td>${st}</td><td>${on ? fmt(p.plr * 100) + '%' : '—'}</td><td>${on ? fmt(p.kwEach, 1) + ' kW' : '—'}</td><td>${on ? p.cop.toFixed(2) : '—'}</td></tr>`;
        }).join('')}
        <tr><td>水泵/水塔/風機</td><td></td><td></td><td></td><td>${fmt(p.aux, 1)} kW</td><td></td></tr></table>`;
    }

    html += `
      <h4>感測節點${TAG.sim}</h4>
      <table><tr><th>節點</th><th>量測</th><th>讀值</th><th>狀態</th></tr>
      ${b.nodes.map(n => `<tr><td class="id">${n.id}</td><td class="st">${n.kind}</td><td>${fmt(n.value, n.unit === '°C' ? 1 : 0)} ${n.unit}</td><td>${n.offline ? '<span class="st bad">離線</span>' : '<span class="st on">連線</span>'}</td></tr>`).join('')}
      </table>`;
    $('detail').innerHTML = html;
  }

  renderTaipower({ taipower }) {
    const d = taipower.data;
    if (!d) { $('taipower').innerHTML = '<p style="color:var(--mute)">尚未取得台電快照（執行 node tools/fetch-taipower.mjs）</p>'; return; }
    const l = d.load, lamp = LAMP[l.indicator] || LAMP.G, age = taipower.ageMin();
    $('tp-note').textContent = `資料時間 ${d.gen.time.slice(11, 16)}（${age} 分鐘前）`;
    $('taipower').innerHTML = `
      <div class="tp-nums">
        <div><span>全台即時負載</span><b>${fmt(l.currMW)}<small>MW</small></b></div>
        <div><span>使用率</span><b>${l.utilPct}<small>%</small></b></div>
        <div><span>今日尖峰預估</span><b>${fmt(l.peakMW)}<small>MW</small></b></div>
        <div><span>備轉容量率</span><b><i class="lamp" style="background:${lamp[0]}"></i>${l.reservePct}<small>% ${lamp[1]}</small></b></div>
      </div>
      <div class="mix">${d.gen.mix.map(m => `<i title="${m.label}" style="width:${m.mw / d.gen.totalMW * 100}%;background:${MIX_COLOR[m.key]}"></i>`).join('')}</div>
      <div class="mix-legend">${d.gen.mix.filter(m => m.mw / d.gen.totalMW > 0.004).map(m => `<div><b style="background:${MIX_COLOR[m.key]}"></b>${m.label}<span>${fmt(m.mw / d.gen.totalMW * 100, 1)}%</span></div>`).join('')}</div>`;
  }

  renderMqtt({ link }) {
    $('mqtt-note').textContent = link.status === 'online' ? `發布 ${link.tx} · 接收 ${link.rx}` : 'broker 未連線，戰情室以離線模式運作';
    const stu = [...link.students].filter(([, v]) => Date.now() - v.t < 120e3);
    $('mqtt').innerHTML = `
      <div>${link.broker ? `Broker <code>${link.broker.tcp}</code> · ` : ''}主題 <code>${MQTT.base}/#</code></div>
      <div class="log">${link.log.slice(0, 5).map(m => `<div>${hm(m.t)} <b>${m.topic}</b> <span>${m.payload.replace(/</g, '&lt;')}</span></div>`).join('') || '<div>尚未收到訊息</div>'}</div>
      <div class="stu">學生節點：${stu.length ? stu.map(([k, v]) => `<b>${k.replace(/</g, '&lt;')}</b> ${v.payload.replace(/</g, '&lt;').slice(0, 40)}`).join('　') : `發布到 <code>${MQTT.base}/student/你的名字</code> 就會出現在這裡`}</div>`;
  }

  renderAlerts({ alerts }) {
    const name = { crit: '緊急', warn: '警告', info: '通知' };
    $('alerts').innerHTML = alerts.length
      ? alerts.slice(0, 5).map(a => `<li class="${a.level}"><time>${clockText(a.t).slice(-8)}</time><span class="lv">${name[a.level]}</span><span>${a.text}</span></li>`).join('')
      : '<li class="none">目前沒有告警。按右側的情境按鈕，可以觀察系統在各種狀況下的反應。</li>';
  }
}
