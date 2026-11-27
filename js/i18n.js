// 英文版：網址加 ?lang=en 時整個戰情室改成英文（給外籍生、國外來賓展示）。
// 演練面板（警報應變、需量反應）維持中英對照，和學生手機上看到的一致。
// MQTT 送出去的資料（警報名稱、任務名稱）一律維持中文，手機與網頁控制台才對得上。
export const LANG_EN = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lang') === 'en';

// t('中文', 'English')：依語言回傳其中一個
export const t = (zh, en) => LANG_EN ? en : zh;

// 建築英文名稱：[全名, 地圖上的簡稱]
export const BLD_EN = {
  gym: ['Gymnasium', 'Gym'], yun: ['Yunqing Hall', 'Yunqing'], dormY: ['Yuan Dormitory', 'Yuan'],
  cm2: ['College of Creative Media II', 'Media 2'], incb: ['Innovation & Incubation Center', 'Incubator'],
  dormN: ['North Dormitory', 'North'], dormS: ['South Dormitory', 'South'], dormH: ['He Dormitory', 'He'],
  slm3: ['College of Smart Living & Management III', 'SLM 3'], lib: ['Library & Information Center', 'Library'],
  eng1: ['College of Engineering I', 'Eng 1'], eng3: ['College of Engineering III', 'Eng 3'], eng2: ['College of Engineering II', 'Eng 2'],
  cm1: ['College of Creative Media I', 'Media 1'], teach: ['Teaching Building', 'Teaching'],
  slm1: ['College of Smart Living & Management I', 'SLM 1'], slm2: ['College of Smart Living & Management II', 'SLM 2'],
  wwtp: ['Wastewater Treatment Plant', 'WWTP'], rsch: ['Research Building', 'Research'],
  dormX: ['Xing Dormitory', 'Xing'], dormR: ['Rong Dormitory', 'Rong'],
  admin: ['Administration Center', 'Admin'], hall: ['Administration Auditorium', 'Auditorium'],
  des1: ['Design Building I', 'Design 1'], des3: ['Design Building III', 'Design 3'],
  it: ['College of Information Technology', 'IT'], lect: ['Lecture Theater', 'Lecture'], art: ['Arts Center', 'Arts'],
  sac: ['Student Activity Center', 'SAC'], food: ['Dining Hall', 'Dining'], pool: ['Swimming Pool', 'Pool'],
};

// 建築用途（config.js 的 TYPES）
export const TYPE_EN = {
  lab: 'Labs / workshops', info: 'IT / server room', classroom: 'Teaching', library: 'Library', office: 'Administration',
  hall: 'Assembly hall', gym: 'Sports', pool: 'Swimming pool', dorm: 'Dormitory', food: 'Dining', utility: 'Utility',
};

// 台電發電結構（data/taipower.json 的 key）
export const MIX_EN = {
  nuclear: 'Nuclear', coal: 'Coal', cogen: 'Cogeneration', gas: 'Gas', oil: 'Oil', solar: 'Solar',
  wind: 'Wind', hydro: 'Hydro', other: 'Other renewables', storage: 'Storage',
};

// 網頁上固定的文字：元素加 data-en="English"，英文版時換掉內容
export function applyStatic(root = document) {
  if (!LANG_EN) return;
  document.documentElement.lang = 'en';
  for (const e of root.querySelectorAll('[data-en]')) e.innerHTML = e.dataset.en;
  for (const e of root.querySelectorAll('[data-en-title]')) e.title = e.dataset.enTitle;
}
