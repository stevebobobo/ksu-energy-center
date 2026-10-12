// 外部真實資料：氣象（Open-Meteo）與台電快照。抓不到時退回氣候平均值，並標示為離線。
import { SOURCES } from './config.js';
import { taipei } from './model.js';

const HOUR = 3600e3;

export const weather = {
  status: 'offline',       // live = 即時觀測、offline = 氣候平均
  current: null,
  hourly: [],              // [{ t, T, RH, G, cloud }]
  fetchedAt: 0,

  async refresh() {
    try {
      const j = await (await fetch(SOURCES.weather)).json();
      const off = j.utc_offset_seconds * 1000;
      const ms  = s => Date.parse(s + 'Z') - off;
      this.hourly = j.hourly.time.map((s, i) => ({
        t: ms(s), T: j.hourly.temperature_2m[i], RH: j.hourly.relative_humidity_2m[i],
        G: j.hourly.shortwave_radiation[i], cloud: j.hourly.cloud_cover[i],
      })).filter(h => h.T != null);
      const c = j.current;
      this.current = { t: ms(c.time), T: c.temperature_2m, RH: c.relative_humidity_2m, G: c.shortwave_radiation, cloud: c.cloud_cover, wind: c.wind_speed_10m };
      this.status = 'live';
      this.fetchedAt = Date.now();
    } catch (err) {
      console.warn('氣象資料讀取失敗，改用氣候平均', err);
      this.status = 'offline';
    }
  },

  // 台南十月的典型日變化，沒網路時用
  climate(ms) {
    const h = taipei(ms).hour, w = Math.sin((h - 9) / 24 * 2 * Math.PI);
    return { T: 26.5 + 4.5 * w, RH: 72 - 12 * w, G: Math.max(0, 780 * Math.sin((h - 6) / 12 * Math.PI)), cloud: 40, wind: 8 };
  },

  // 任一時刻的氣象。live = true 且時間接近現在時用即時觀測，其餘用逐時資料內插
  at(ms, live) {
    if (this.status !== 'live') return { ...this.climate(ms), kind: 'climate' };
    if (live && this.current && Math.abs(ms - Date.now()) < 20 * 60e3) return { ...this.current, kind: 'live' };
    const hs = this.hourly;
    // 超出資料範圍時，用同一時刻、有資料的那一天代替
    let t = ms;
    while (t < hs[0].t) t += 24 * HOUR;
    while (t > hs[hs.length - 1].t) t -= 24 * HOUR;
    const i = Math.min(hs.length - 2, Math.max(0, Math.floor((t - hs[0].t) / HOUR)));
    const a = hs[i], b = hs[i + 1], f = (t - a.t) / HOUR;
    const mix = k => a[k] + (b[k] - a[k]) * f;
    return { T: mix('T'), RH: mix('RH'), G: mix('G'), cloud: mix('cloud'), wind: this.current?.wind ?? 0, kind: 'hourly' };
  },
};

export const taipower = {
  data: null,
  async refresh() {
    for (const url of SOURCES.taipower) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        this.data = await res.json();
        return;
      } catch { /* 換下一個來源 */ }
    }
  },
  // 快照是幾分鐘前的資料
  ageMin() {
    return this.data ? Math.round((Date.now() - Date.parse(this.data.gen.time + '+08:00')) / 60e3) : null;
  },
};
