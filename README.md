# ksu-energy-center

崑山科技大學校園能源戰情室，「智慧能源與物聯網」課程的展示教材。
單頁網站、不需要建置步驟，用真實的校園輪廓、即時氣象與台電資料，推估各棟大樓的用電、冰水主機、太陽能與儲能狀態。

## 啟動

```
node tools/serve.mjs
```

開 <http://localhost:8600>。這支伺服器同時每 10 分鐘更新一次台電快照。
沒有網路也能開，氣象會改用台南十月的氣候平均值，畫面右上角會標示離線。

## 哪些是真的

畫面上每個數字旁邊都有標籤：

| 標籤 | 意思 | 內容 |
|---|---|---|
| 真實 | 直接來自外部量測或官方資料 | 校園建築輪廓與館名（OpenStreetMap）、氣溫／濕度／日射量（Open-Meteo）、全台負載與發電結構（台電）、電力排碳係數（能源署 114 年度 0.467） |
| 推估 | 用真實輸入算出來的 | 各棟用電、全校需量、太陽能發電、電費、碳排 |
| 模擬 | 沒有真實依據的工程模型 | 冰水主機運轉數據、感測節點讀值、儲能系統 |

以下數字目前是**假設值**，都集中在 `js/config.js` 和 `tools/build-campus.mjs`，拿到校方資料後直接改：

- 契約容量 4,000 kW、儲能 2,000 kWh / 500 kW
- 各棟樓層數（只有工程學院一館的 7 層來自 OpenStreetMap）
- 哪幾棟有中央冰水主機、主機噸數
- 屋頂太陽能裝在哪幾棟、各多少 kWp（合計 1,200 kWp）
- 各類建築的用電密度（W/m²）與使用時間表
- 時間電價費率取自二手彙整資料，尚未逐項對過台電官網電價表

館名沿用 OpenStreetMap 上的寫法，可能和學校現行名稱不同。

## 課堂操作

- **情境演練**：烏雲遮日、熱浪、大型活動、主機跳機、節點離線、台電停電，可以同時開多個。
- **時間**：`×1440` 一分鐘跑完一天，用的是當天真實的逐時氣象；按「即時」回到現在。
- **點建築**：地圖或排行上點任一棟，右側顯示用電拆解、冰水主機與感測節點。

## MQTT 對接

戰情室把讀值發布到公用 broker，再訂閱回來顯示。實際連上的 broker 位址顯示在「MQTT 訊息流」面板。

| 主題 | 內容 |
|---|---|
| `ksu-energy-center/demo/campus/summary` | 全校負載、太陽能、購電、儲能電量、外氣溫度 |
| `ksu-energy-center/demo/building/<代號>/power` | 單棟用電（各棟輪流發布） |
| `ksu-energy-center/demo/student/<名稱>` | 學生自己的節點，內容任意（建議 JSON） |

學生用 ESP32 或 Wokwi 連到面板顯示的 broker（1883 埠），發布到 `student/<名稱>`，兩分鐘內就會出現在戰情室。
公用 broker 任何人都能讀寫，不要放真實的敏感資料。

## 檔案

```
index.html, css/style.css      畫面
js/config.js                   所有可調參數與假設值
js/model.js                    能源模型（不碰畫面，Node 也能跑）
js/sources.js                  氣象與台電資料讀取
js/mqtt-link.js                MQTT 連線
js/ui.js, js/main.js           繪製與主迴圈
data/campus.json               校園資料（由 tools/build-campus.mjs 產生）
data/taipower.json             台電快照（由 tools/fetch-taipower.mjs 產生）
tools/check-model.mjs          不開瀏覽器跑一整天模型，檢查數字
vendor/mqtt.min.js             MQTT.js 5.10.1
```

## 資料來源與授權

- 建築輪廓：© OpenStreetMap contributors，ODbL
- 氣象：Open-Meteo
- 電力資訊：台灣電力公司，政府資料開放授權
