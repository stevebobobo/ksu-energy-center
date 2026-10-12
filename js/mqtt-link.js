// MQTT 連線：把戰情室的讀值發布到公用 broker，再訂閱回來顯示，資料流和真實 IoT 系統一樣。
// 學生的 ESP32 / Wokwi 發布到 <base>/student/<名稱>，就會出現在「學生節點」。
// 連不上 broker（沒網路）時整個模組靜靜停用，戰情室照常運作。
import { MQTT } from './config.js';

export const link = {
  status: 'off',            // off / connecting / online
  log: [],                  // 最近收到的訊息 [{ t, topic, payload }]
  students: new Map(),      // 名稱 → { t, payload }
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
      const payload = buf.toString().slice(0, 200);
      this.rx++;
      this.log.unshift({ t: Date.now(), topic: topic.slice(MQTT.base.length + 1), payload });
      if (this.log.length > 40) this.log.length = 40;
      const m = topic.match(/\/student\/([^/]+)$/);
      if (m) this.students.set(decodeURIComponent(m[1]).slice(0, 24), { t: Date.now(), payload });
    });
  },

  publish(sub, obj) {
    if (this.status !== 'online') return;
    this.client.publish(`${MQTT.base}/${sub}`, typeof obj === 'string' ? obj : JSON.stringify(obj));
    this.tx++;
  },
};
