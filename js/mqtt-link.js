// MQTT 連線：把戰情室的讀值發布到公用 broker，再訂閱回來顯示，資料流和真實 IoT 系統一樣。
// 學生的 ESP32 / Wokwi 發布到 <base>/student/<名稱>，就會出現在「學生節點」。
// 網頁控制台的光敏感測發布到 <base>/sensor/<名稱>，會帶動認養大樓的照明與太陽能。
// 連不上 broker（沒網路）時整個模組靜靜停用，戰情室照常運作。
import { MQTT } from './config.js';

export const link = {
  status: 'off',            // off / connecting / online
  log: [],                  // 最近收到的訊息 [{ t, topic, payload }]
  students: new Map(),      // 名稱 → { t, payload }
  sensors: new Map(),       // 建築 id → { v, s, on, by, t }
  rx: 0, tx: 0,
  client: null,
  broker: null,             // 目前連上的 broker
  tries: 0,

  connect() {
    if (!window.mqtt) return;
    this.status = 'connecting';
    const broker = MQTT.brokers[this.tries++ % MQTT.brokers.length];
    const client = window.mqtt.connect(broker.ws, {
      clientId: 'ksu-ec-' + Math.random().toString(16).slice(2, 10),
      reconnectPeriod: 0, connectTimeout: 8000, clean: true,
    });
    this.client = client;
    client.on('connect', () => { this.status = 'online'; this.broker = broker; client.subscribe(MQTT.base + '/#'); });
    // 斷線或被拒絕：收掉這條連線，5 秒後換下一個 broker 再試
    client.on('close', () => {
      if (this.client !== client) return;
      this.status = 'connecting'; this.broker = null; this.client = null;
      client.end(true);
      setTimeout(() => this.connect(), 5000);
    });
    client.on('error', () => {});
    client.on('message', (topic, buf) => {
      const raw = buf.toString().slice(0, 2000);
      const payload = raw.slice(0, 200);
      this.rx++;
      let short = topic.slice(MQTT.base.length + 1);
      try { short = decodeURIComponent(short); } catch (e) {}   // 舊版用網址編碼送中文組名
      this.log.unshift({ t: Date.now(), topic: short, payload });
      if (this.log.length > 40) this.log.length = 40;
      const m = short.match(/^student\/([^/]+)$/);
      if (m) this.students.set(m[1].slice(0, 24), { t: Date.now(), payload });
      if (/^sensor\/[^/]+$/.test(short)) this.onSensor(raw);
    });
  },

  // 光敏感測：{"by":"第3組","b":{"lib":{"v":512,"s":0.1,"on":0}}}
  onSensor(raw) {
    let d;
    try { d = JSON.parse(raw); } catch (e) { return; }
    if (!d || !d.b || typeof d.b !== 'object') return;
    const by = String(d.by || '?').slice(0, 16), t = Date.now();
    const ids = Object.keys(d.b).filter(id => d.b[id] && Number.isFinite(+d.b[id].v));
    for (const id of ids) {
      const r = d.b[id];
      this.sensors.set(id, { v: Math.round(+r.v), s: Math.max(0, Math.min(1, +r.s || 0)), on: !!r.on, dim: !!r.dim, by, t });
    }
    if (!ids.length) return;
    const dark = ids.filter(id => d.b[id].on).length;
    this.students.set(by, { t, payload: ids.length > 1 ? `${ids.length} 棟光敏 · ${dark} 棟開燈` : `光敏 ${d.b[ids[0]].v}${dark ? ' · 開燈' : ''}` });
  },

  publish(sub, obj) {
    if (this.status !== 'online') return;
    this.client.publish(`${MQTT.base}/${sub}`, typeof obj === 'string' ? obj : JSON.stringify(obj));
    this.tx++;
  },
};
