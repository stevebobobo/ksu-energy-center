// 全站設定。標「假設」的數字都還沒有校方資料佐證，拿到總務處資料後改這裡就好。

export const SITE = {
  name: '崑山科技大學',
  lat: 22.9959,          // 校區中心（OpenStreetMap）
  lon: 120.2527,
};

// ── 契約與設備（假設）──────────────────────────────────────────────
export const PLANT = {
  contractKw: 4000,      // 經常契約容量（假設）
  ess: { kwh: 2000, kw: 500, socMin: 0.10, socMax: 0.95, eff: 0.95 },   // 儲能系統（假設）
  pv:  { pr: 0.80, tempCoef: -0.004 },                                   // 太陽能系統效率、溫度係數
};

// ── 電價：台電高壓三段式時間電價（尖峰時間固定）────────────────────
// 數字取自 114 年 10 月調整後的二手彙整資料，尚未逐項對過台電官網電價表。
export const TARIFF = {
  summer: { from: [5, 16], to: [10, 15] },                // 夏月 5/16–10/15
  rate: {                                                  // 流動電費，元/度
    summer:    { peak: 9.39, half: 5.85, sat: 2.60, off: 2.53 },
    nonSummer: { peak: 5.47, half: 5.47, sat: 2.41, off: 2.32 },
  },
  label: { peak: '尖峰', half: '半尖峰', sat: '週六半尖峰', off: '離峰' },
};

// 電力排碳係數：能源署 114 年度公用售電業係數（2026-06-02 公布），公斤 CO2e/度
export const EMISSION_KG_PER_KWH = 0.467;

// ── 各類建築的用電特性（假設）──────────────────────────────────────
// w = 尖峰用電密度 W/m²（以樓地板面積計）；base = 全天基載占比；hvac = 空調占比；其餘為照明與插座
export const TYPES = {
  lab:       { label: '實驗/實習', w: 32, base: 0.28, hvac: 0.40, sched: 'lab' },
  info:      { label: '資訊/機房', w: 36, base: 0.34, hvac: 0.40, sched: 'lab' },
  classroom: { label: '教學',      w: 24, base: 0.14, hvac: 0.50, sched: 'class' },
  library:   { label: '圖書',      w: 28, base: 0.20, hvac: 0.50, sched: 'library' },
  office:    { label: '行政',      w: 26, base: 0.18, hvac: 0.48, sched: 'office' },
  hall:      { label: '集會',      w: 20, base: 0.12, hvac: 0.55, sched: 'hall' },
  gym:       { label: '體育',      w: 14, base: 0.12, hvac: 0.35, sched: 'gym' },
  pool:      { label: '泳池',      w: 30, base: 0.55, hvac: 0.05, sched: 'gym' },
  dorm:      { label: '宿舍',      w: 16, base: 0.22, hvac: 0.48, sched: 'dorm' },
  food:      { label: '餐飲',      w: 40, base: 0.30, hvac: 0.30, sched: 'food' },
  utility:   { label: '公用設施',  w: 120, base: 0.80, hvac: 0.00, sched: 'flat' },
};

// 使用率時間表：[小時, 使用率] 關鍵點之間線性內插。wd = 週一到週五、sat = 週六、sun = 週日
export const SCHEDULES = {
  class:   { wd: [[0, .04], [6.5, .04], [8.2, .95], [12, .95], [12.4, .55], [13.2, .9], [17, .9], [18, .4], [21.5, .4], [22.5, .04], [24, .04]],
             sat: [[0, .04], [8, .04], [9, .2], [16, .2], [17, .04], [24, .04]], sun: [[0, .04], [24, .04]] },
  lab:     { wd: [[0, .08], [7, .08], [8.5, .9], [12, .9], [12.5, .6], [13.3, .9], [17.5, .85], [18.5, .5], [22, .45], [23, .08], [24, .08]],
             sat: [[0, .08], [9, .08], [10, .3], [17, .3], [18, .08], [24, .08]], sun: [[0, .08], [24, .08]] },
  office:  { wd: [[0, .05], [7.3, .05], [8.2, .92], [12, .92], [12.3, .6], [13.2, .9], [17, .9], [18, .2], [19, .05], [24, .05]],
             sat: [[0, .05], [24, .05]], sun: [[0, .05], [24, .05]] },
  library: { wd: [[0, .06], [7.5, .06], [8.5, .7], [14, .85], [20, .8], [22, .7], [22.5, .06], [24, .06]],
             sat: [[0, .06], [8.5, .06], [9.5, .5], [17, .5], [17.5, .06], [24, .06]], sun: [[0, .06], [8.5, .06], [9.5, .4], [17, .4], [17.5, .06], [24, .06]] },
  hall:    { wd: [[0, .03], [8, .03], [9, .3], [16.5, .3], [17.5, .03], [24, .03]], sat: [[0, .03], [24, .03]], sun: [[0, .03], [24, .03]] },
  gym:     { wd: [[0, .05], [7, .05], [8, .5], [17, .6], [21, .6], [22, .05], [24, .05]],
             sat: [[0, .05], [8, .05], [9, .4], [18, .4], [19, .05], [24, .05]], sun: [[0, .05], [8, .05], [9, .3], [18, .3], [19, .05], [24, .05]] },
  dorm:    { wd: [[0, .7], [2, .6], [6.5, .55], [8.5, .3], [16.5, .3], [19, .85], [23.5, .95], [24, .7]],
             sat: [[0, .7], [8, .55], [12, .5], [19, .7], [24, .7]], sun: [[0, .7], [8, .55], [12, .5], [18, .8], [24, .7]] },
  food:    { wd: [[0, .1], [6, .1], [7, .5], [9, .3], [11, .95], [13, 1], [14, .3], [17, .8], [19, .7], [20, .1], [24, .1]],
             sat: [[0, .1], [10, .1], [11.5, .4], [13, .4], [14, .1], [24, .1]], sun: [[0, .1], [24, .1]] },
  flat:    { wd: [[0, 1], [24, 1]], sat: [[0, 1], [24, 1]], sun: [[0, 1], [24, 1]] },
};

// ── 外部資料來源 ───────────────────────────────────────────────────
export const SOURCES = {
  // 氣象：Open-Meteo（免金鑰、允許瀏覽器跨站讀取）
  weather: `https://api.open-meteo.com/v1/forecast?latitude=${SITE.lat}&longitude=${SITE.lon}`
    + '&current=temperature_2m,relative_humidity_2m,cloud_cover,shortwave_radiation,wind_speed_10m'
    + '&hourly=temperature_2m,relative_humidity_2m,cloud_cover,shortwave_radiation'
    + '&past_days=1&forecast_days=3&timezone=Asia%2FTaipei',
  // 台電：官方資料不允許瀏覽器跨站讀取，所以由 tools/fetch-taipower.mjs 定時抓成快照。
  // 依序嘗試，第一個讀得到的就用。
  taipower: [
    'https://raw.githubusercontent.com/stevebobobo/ksu-energy-center/live-data/taipower.json',   // GitHub Actions 每 10 分鐘更新
    'data/taipower.json',                                                                        // 本機快照
  ],
};

// ── MQTT（公用 broker，任何人都能讀寫，不要放真實敏感資料）──────────
export const MQTT = {
  // 依序嘗試，連不上就換下一個。tcp 是給 ESP32 / Wokwi 用的位址（同一個 broker 的 1883 埠）
  brokers: [
    { ws: 'wss://broker.hivemq.com:8884/mqtt', tcp: 'broker.hivemq.com:1883' },
    { ws: 'wss://broker.emqx.io:8084/mqtt',    tcp: 'broker.emqx.io:1883' },
  ],
  base: 'ksu-energy-center/demo',      // 主題前綴；學生節點發到 <base>/student/<名稱>
};
