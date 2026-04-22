// Mock data — realistic for an indie iOS dev

const APPS = [
  {
    id: "nomly",
    name: "Nomly",
    emoji: "🍜",
    bundle: "com.example.myapp",
    iTunesId: "324684580",
    tagline: "Food journal for picky eaters",
    iconBg: "linear-gradient(135deg, #FFD7C4 0%, #FF8A6A 100%)",
    keywords: 446,
    ranked: 312,
    avgPos: 27.4,
    top10: 42,
    top50: 198,
    unranked: 134,
    lastSnapshot: "2h ago",
    snapshotEpoch: "Tue 08:14",
    weekDelta: { top10: 5, top50: -12, avg: -2.1, ranked: 14 },
    winners: [
      { kw: "food diary app", delta: 18, from: 34, to: 16 },
      { kw: "meal tracker", delta: 11, from: 23, to: 12 },
      { kw: "ramen finder", delta: 7, from: 14, to: 7 },
    ],
    losers: [
      { kw: "calorie counter", delta: -9, from: 22, to: 31 },
      { kw: "recipe log", delta: -5, from: 18, to: 23 },
    ],
    locales: ["US","GB","DE","FR","JP","CA","AU","NL","SE","ES","IT","KR","BR","MX","IN","NO","DK","FI","CH","AT","BE","IE","NZ","SG","HK","TW","PT","ZA","CL","AR","CO","PL","TR","RU"],
  },
  {
    id: "waverly",
    name: "Waverly",
    emoji: "🌊",
    bundle: "com.example.surfer",
    iTunesId: "284882215",
    tagline: "Tide charts for surfers",
    iconBg: "linear-gradient(135deg, #CFE3F5 0%, #4A7FB5 100%)",
    keywords: 182,
    ranked: 148,
    avgPos: 19.8,
    top10: 34,
    top50: 102,
    unranked: 34,
    lastSnapshot: "9m ago",
    snapshotEpoch: "Tue 10:07",
    weekDelta: { top10: 3, top50: 8, avg: 1.4, ranked: 6 },
    winners: [
      { kw: "surf forecast", delta: 14, from: 19, to: 5 },
      { kw: "tide tracker", delta: 6, from: 11, to: 5 },
    ],
    losers: [
      { kw: "wave app", delta: -4, from: 8, to: 12 },
    ],
    locales: ["US","GB","AU","NZ","FR","ES","PT","BR","MX","ZA","JP","IE","CA"],
  },
  {
    id: "dimmer",
    name: "Dimmer",
    emoji: "🕯️",
    bundle: "com.example.sleep",
    iTunesId: "447188370",
    tagline: "Bedside clock & sleep sounds",
    iconBg: "linear-gradient(135deg, #1B1B1F 0%, #3A3A44 100%)",
    keywords: 298,
    ranked: 241,
    avgPos: 34.7,
    top10: 21,
    top50: 156,
    unranked: 57,
    lastSnapshot: "yesterday",
    snapshotEpoch: "Mon 22:31",
    weekDelta: { top10: -2, top50: 4, avg: 0.8, ranked: -3 },
    winners: [
      { kw: "sleep timer", delta: 9, from: 21, to: 12 },
      { kw: "bedside clock", delta: 4, from: 16, to: 12 },
    ],
    losers: [
      { kw: "white noise", delta: -11, from: 28, to: 39 },
      { kw: "sleep sounds", delta: -7, from: 15, to: 22 },
    ],
    locales: ["US","GB","DE","FR","JP","CA","AU","NL","SE","ES","IT","KR","BR","MX","IN","NO","DK"],
  },
];

// Keyword rows for the Rankings table (Nomly, US locale by default)
const KEYWORD_ROWS = [
  { locale: "US", kw: "food diary app",   today: 6,  yesterday: 8,  w1: 14, w4: 34, top5: ["MyFitnessPal","Lose It!","Cronometer","Lifesum","YAZIO"] },
  { locale: "US", kw: "meal tracker",     today: 12, yesterday: 11, w1: 18, w4: 23, top5: ["MyFitnessPal","Lose It!","Lifesum","Cronometer","FatSecret"] },
  { locale: "US", kw: "ramen finder",     today: 7,  yesterday: 9,  w1: 11, w4: 14, top5: ["TabelogUSA","Yelp","HappyCow","Foursquare","Google Maps"] },
  { locale: "US", kw: "calorie counter",  today: 31, yesterday: 28, w1: 22, w4: 19, top5: ["MyFitnessPal","Lose It!","YAZIO","Cronometer","FatSecret"] },
  { locale: "US", kw: "recipe log",       today: 23, yesterday: 21, w1: 18, w4: 16, top5: ["Paprika","Mealime","Yummly","BigOven","Cookpad"] },
  { locale: "US", kw: "picky eater",      today: 3,  yesterday: 3,  w1: 4,  w4: 9,  top5: ["PickyEats","Nomly","PlatesForKids","Kidfresh","YumYum"] },
  { locale: "US", kw: "food journal",     today: 5,  yesterday: 5,  w1: 6,  w4: 8,  top5: ["Ate","MyFitnessPal","FoodNoms","Nomly","Bitesnap"] },
  { locale: "US", kw: "what to eat",      today: 18, yesterday: 15, w1: 12, w4: 11, top5: ["Yelp","HappyCow","Mealime","Nomly","Foursquare"] },
  { locale: "US", kw: "breakfast ideas",  today: 44, yesterday: 49, w1: 62, w4: 71, top5: ["Yummly","Tasty","NYT Cooking","Mealime","BigOven"] },
  { locale: "US", kw: "dinner planner",   today: 27, yesterday: 26, w1: 33, w4: 41, top5: ["Mealime","Paprika","Yummly","Plan to Eat","BigOven"] },
  { locale: "US", kw: "kid friendly food",today: 0,  yesterday: 0,  w1: 0,  w4: 0,  top5: [] },
  { locale: "GB", kw: "food diary app",   today: 4,  yesterday: 5,  w1: 7,  w4: 19, top5: ["MyFitnessPal","YAZIO","Lifesum","Nutracheck","Cronometer"] },
  { locale: "GB", kw: "meal tracker",     today: 9,  yesterday: 10, w1: 15, w4: 20, top5: ["MyFitnessPal","Nutracheck","Lifesum","YAZIO","Lose It!"] },
  { locale: "DE", kw: "essenstagebuch",   today: 2,  yesterday: 2,  w1: 3,  w4: 8,  top5: ["YAZIO","Lifesum","FatSecret","MyFitnessPal","EatSmarter"] },
  { locale: "JP", kw: "ラーメン 探す",     today: 14, yesterday: 17, w1: 23, w4: 38, top5: ["Tabelog","GuruNavi","Retty","Hot Pepper","Foodie"] },
  { locale: "FR", kw: "journal alimentaire", today: 8, yesterday: 9, w1: 12, w4: 16, top5: ["YAZIO","FatSecret","Lifesum","MyFitnessPal","Yuka"] },
];

// Locales with avg-position stats for Dashboard locale strip
const LOCALE_STATS = {
  Nomly: [
    { code: "US", avg: 11 }, { code: "GB", avg: 8 },  { code: "DE", avg: 24 },
    { code: "FR", avg: 19 }, { code: "JP", avg: 7 },  { code: "CA", avg: 14 },
    { code: "AU", avg: 22 }, { code: "NL", avg: 41 }, { code: "SE", avg: 38 },
    { code: "ES", avg: 56 }, { code: "IT", avg: 72 }, { code: "KR", avg: null },
    { code: "BR", avg: 33 }, { code: "MX", avg: 29 }, { code: "IN", avg: null },
  ],
  Waverly: [
    { code: "US", avg: 6 }, { code: "GB", avg: 9 }, { code: "AU", avg: 4 },
    { code: "NZ", avg: 3 }, { code: "FR", avg: 21 }, { code: "ES", avg: 27 },
    { code: "PT", avg: 34 }, { code: "BR", avg: 44 }, { code: "MX", avg: 58 },
    { code: "ZA", avg: 28 }, { code: "JP", avg: null }, { code: "IE", avg: 11 },
    { code: "CA", avg: 18 },
  ],
  Dimmer: [
    { code: "US", avg: 18 }, { code: "GB", avg: 22 }, { code: "DE", avg: 41 },
    { code: "FR", avg: 37 }, { code: "JP", avg: 64 }, { code: "CA", avg: 26 },
    { code: "AU", avg: 31 }, { code: "NL", avg: 58 }, { code: "SE", avg: 49 },
    { code: "ES", avg: null }, { code: "IT", avg: null }, { code: "KR", avg: 71 },
  ],
};

function statusFromAvg(avg) {
  if (avg == null) return "gray";
  if (avg <= 10) return "pos";
  if (avg <= 50) return "neg";
  return "gray";
}

// Keywords editor data
const EDITOR_LOCALES = [
  { code: "US", name: "United States", count: 58 },
  { code: "GB", name: "United Kingdom", count: 42 },
  { code: "DE", name: "Germany", count: 38 },
  { code: "FR", name: "France", count: 36 },
  { code: "JP", name: "Japan", count: 44 },
  { code: "CA", name: "Canada", count: 38 },
  { code: "AU", name: "Australia", count: 28 },
  { code: "NL", name: "Netherlands", count: 24 },
  { code: "SE", name: "Sweden", count: 22 },
  { code: "ES", name: "Spain", count: 26 },
  { code: "IT", name: "Italy", count: 24 },
  { code: "KR", name: "South Korea", count: 28 },
];

const EDITOR_KEYWORDS = [
  { kw: "food diary app", validated: true },
  { kw: "meal tracker", validated: true },
  { kw: "ramen finder", validated: true },
  { kw: "calorie counter", validated: true },
  { kw: "recipe log", validated: true },
  { kw: "picky eater", validated: true },
  { kw: "food journal", validated: true },
  { kw: "what to eat", validated: true },
  { kw: "breakfast ideas", validated: true },
  { kw: "dinner planner", validated: true },
  { kw: "kid friendly food", validated: false },
  { kw: "lunch tracker", validated: true },
  { kw: "ate.app style", validated: false },
  { kw: "meals for kids", validated: true },
  { kw: "food log", validated: true },
  { kw: "what did i eat", validated: true },
  { kw: "eating tracker", validated: true },
  { kw: "hyperfood journal", validated: false },
];

// Snapshot progress feed items
const PROGRESS_FEED = [
  { locale: "US", items: [
    { kw: "food diary app", rank: 6 },
    { kw: "meal tracker", rank: 12 },
    { kw: "ramen finder", rank: 7 },
    { kw: "calorie counter", rank: 31 },
    { kw: "recipe log", rank: 23 },
    { kw: "picky eater", rank: 3 },
    { kw: "food journal", rank: 5 },
    { kw: "what to eat", rank: 18 },
    { kw: "kid friendly food", rank: null },
    { kw: "dinner planner", rank: 27 },
  ] },
  { locale: "GB", items: [
    { kw: "food diary app", rank: 4 },
    { kw: "meal tracker", rank: 9 },
    { kw: "calorie counter", rank: 22 },
    { kw: "picky eater", rank: 2 },
    { kw: "recipe log", rank: 28 },
  ] },
  { locale: "DE", items: [
    { kw: "essenstagebuch", rank: 2 },
    { kw: "ernährungstagebuch", rank: 14 },
  ] },
];

export {
  APPS, KEYWORD_ROWS, LOCALE_STATS, EDITOR_LOCALES, EDITOR_KEYWORDS,
  PROGRESS_FEED, statusFromAvg,
};