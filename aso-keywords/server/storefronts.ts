/**
 * Apple App Store storefronts and the App Store Connect localizations each one
 * indexes for search. Source: the official table «App Store localizations»
 * (https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations/),
 * captured 2026-09-25. The first locale is the storefront's default language,
 * the rest are the additional languages Apple indexes there.
 *
 * Pure data + search helpers — no Node imports, so the React client imports this
 * module directly (the palette searches without a round trip) and the API serves
 * the same table at GET /api/storefronts.
 */

export interface Storefront {
  /** ISO 3166-1 alpha-2, lowercase — the code used in keyword files and snapshots. */
  code: string;
  /** Apple's ISO alpha-3 code from the table. */
  iso3: string;
  /** Russian display name. */
  name: string;
  /** English name as written in Apple's table. */
  nameEn: string;
  flag: string;
  /** App Store Connect locale codes, default language first. */
  locales: string[];
}

/** Russian names of App Store Connect localizations. */
export const LOCALE_NAMES: Record<string, string> = {
  'ar-SA': 'арабский',
  ca: 'каталанский',
  cs: 'чешский',
  da: 'датский',
  'de-DE': 'немецкий',
  el: 'греческий',
  'en-AU': 'английский (Австралия)',
  'en-CA': 'английский (Канада)',
  'en-GB': 'английский (UK)',
  'en-US': 'английский (US)',
  'es-ES': 'испанский (Испания)',
  'es-MX': 'испанский (Мексика)',
  fi: 'финский',
  'fr-CA': 'французский (Канада)',
  'fr-FR': 'французский',
  he: 'иврит',
  hi: 'хинди',
  hr: 'хорватский',
  hu: 'венгерский',
  id: 'индонезийский',
  it: 'итальянский',
  ja: 'японский',
  ko: 'корейский',
  ms: 'малайский',
  'nl-NL': 'нидерландский',
  no: 'норвежский',
  pl: 'польский',
  'pt-BR': 'португальский (Бразилия)',
  'pt-PT': 'португальский (Португалия)',
  ro: 'румынский',
  ru: 'русский',
  sk: 'словацкий',
  'sl-SI': 'словенский',
  sv: 'шведский',
  th: 'тайский',
  tr: 'турецкий',
  uk: 'украинский',
  vi: 'вьетнамский',
  'zh-Hans': 'китайский (упрощ.)',
  'zh-Hant': 'китайский (традиц.)',
  'bn-BD': 'бенгальский',
  'gu-IN': 'гуджарати',
  'kn-IN': 'каннада',
  'ml-IN': 'малаялам',
  'mr-IN': 'маратхи',
  'or-IN': 'ория',
  'pa-IN': 'панджаби',
  'ta-IN': 'тамильский',
  'te-IN': 'телугу',
  'ur-PK': 'урду',
};

// [alpha-2, alpha-3, name RU, name EN, "default additional…"]
const TABLE: Array<[string, string, string, string, string]> = [
  ['ae', 'ARE', 'ОАЭ', 'United Arab Emirates', 'en-GB ar-SA'],
  ['af', 'AFG', 'Афганистан', 'Afghanistan', 'en-GB'],
  ['ag', 'ATG', 'Антигуа и Барбуда', 'Antigua and Barbuda', 'en-GB'],
  ['ai', 'AIA', 'Ангилья', 'Anguilla', 'en-GB'],
  ['al', 'ALB', 'Албания', 'Albania', 'en-GB'],
  ['am', 'ARM', 'Армения', 'Armenia', 'en-GB'],
  ['ao', 'AGO', 'Ангола', 'Angola', 'en-GB'],
  ['ar', 'ARG', 'Аргентина', 'Argentina', 'es-MX en-GB'],
  ['at', 'AUT', 'Австрия', 'Austria', 'de-DE en-GB'],
  ['au', 'AUS', 'Австралия', 'Australia', 'en-AU en-GB'],
  ['az', 'AZE', 'Азербайджан', 'Azerbaijan', 'en-GB'],
  ['ba', 'BIH', 'Босния и Герцеговина', 'Bosnia and Herzegovina', 'en-GB hr'],
  ['bb', 'BRB', 'Барбадос', 'Barbados', 'en-GB'],
  ['be', 'BEL', 'Бельгия', 'Belgium', 'en-GB nl-NL fr-FR'],
  ['bf', 'BFA', 'Буркина-Фасо', 'Burkina Faso', 'en-GB fr-FR'],
  ['bg', 'BGR', 'Болгария', 'Bulgaria', 'en-GB'],
  ['bh', 'BHR', 'Бахрейн', 'Bahrain', 'en-GB ar-SA'],
  ['bj', 'BEN', 'Бенин', 'Benin', 'en-GB fr-FR'],
  ['bm', 'BMU', 'Бермуды', 'Bermuda', 'en-GB'],
  ['bn', 'BRN', 'Бруней', 'Brunei', 'en-GB'],
  ['bo', 'BOL', 'Боливия', 'Bolivia', 'es-MX en-GB'],
  ['br', 'BRA', 'Бразилия', 'Brazil', 'pt-BR en-GB'],
  ['bs', 'BHS', 'Багамы', 'Bahamas', 'en-GB'],
  ['bt', 'BTN', 'Бутан', 'Bhutan', 'en-GB'],
  ['bw', 'BWA', 'Ботсвана', 'Botswana', 'en-GB'],
  ['by', 'BLR', 'Беларусь', 'Belarus', 'en-GB'],
  ['bz', 'BLZ', 'Белиз', 'Belize', 'en-GB es-MX'],
  ['ca', 'CAN', 'Канада', 'Canada', 'en-CA fr-CA'],
  ['cd', 'COD', 'ДР Конго', 'Congo, Democratic Republic of the', 'en-GB fr-FR'],
  ['cg', 'COG', 'Республика Конго', 'Congo, Republic of the', 'en-GB fr-FR'],
  ['ch', 'CHE', 'Швейцария', 'Switzerland', 'de-DE en-GB fr-FR it'],
  ['ci', 'CIV', 'Кот-д’Ивуар', 'Cote d’Ivoire', 'fr-FR en-GB'],
  ['cl', 'CHL', 'Чили', 'Chile', 'es-MX en-GB'],
  ['cm', 'CMR', 'Камерун', 'Cameroon', 'fr-FR en-GB'],
  ['cn', 'CHN', 'Китай', 'China mainland', 'zh-Hans en-GB'],
  ['co', 'COL', 'Колумбия', 'Colombia', 'es-MX en-GB'],
  ['cr', 'CRI', 'Коста-Рика', 'Costa Rica', 'es-MX en-GB'],
  ['cv', 'CPV', 'Кабо-Верде', 'Cape Verde', 'en-GB'],
  ['cy', 'CYP', 'Кипр', 'Cyprus', 'en-GB el tr'],
  ['cz', 'CZE', 'Чехия', 'Czechia', 'en-GB cs'],
  ['de', 'DEU', 'Германия', 'Germany', 'de-DE en-GB'],
  ['dk', 'DNK', 'Дания', 'Denmark', 'en-GB da'],
  ['dm', 'DMA', 'Доминика', 'Dominica', 'en-GB'],
  ['do', 'DOM', 'Доминиканская Республика', 'Dominican Republic', 'es-MX en-GB'],
  ['dz', 'DZA', 'Алжир', 'Algeria', 'en-GB ar-SA fr-FR'],
  ['ec', 'ECU', 'Эквадор', 'Ecuador', 'es-MX en-GB'],
  ['ee', 'EST', 'Эстония', 'Estonia', 'en-GB'],
  ['eg', 'EGY', 'Египет', 'Egypt', 'en-GB ar-SA fr-FR'],
  ['es', 'ESP', 'Испания', 'Spain', 'es-ES ca en-GB'],
  ['fi', 'FIN', 'Финляндия', 'Finland', 'en-GB fi'],
  ['fj', 'FJI', 'Фиджи', 'Fiji', 'en-GB'],
  ['fm', 'FSM', 'Микронезия', 'Micronesia', 'en-GB'],
  ['fr', 'FRA', 'Франция', 'France', 'fr-FR en-GB'],
  ['ga', 'GAB', 'Габон', 'Gabon', 'fr-FR en-GB'],
  ['gb', 'GBR', 'Великобритания', 'United Kingdom', 'en-GB'],
  ['gd', 'GRD', 'Гренада', 'Grenada', 'en-GB'],
  ['ge', 'GEO', 'Грузия', 'Georgia', 'en-GB'],
  ['gh', 'GHA', 'Гана', 'Ghana', 'en-GB'],
  ['gm', 'GMB', 'Гамбия', 'Gambia', 'en-GB'],
  ['gr', 'GRC', 'Греция', 'Greece', 'en-GB el'],
  ['gt', 'GTM', 'Гватемала', 'Guatemala', 'es-MX en-GB'],
  ['gw', 'GNB', 'Гвинея-Бисау', 'Guinea-Bissau', 'en-GB fr-FR'],
  ['gy', 'GUY', 'Гайана', 'Guyana', 'en-GB fr-FR'],
  ['hk', 'HKG', 'Гонконг', 'Hong Kong', 'zh-Hant en-GB'],
  ['hn', 'HND', 'Гондурас', 'Honduras', 'es-MX en-GB'],
  ['hr', 'HRV', 'Хорватия', 'Croatia', 'en-GB hr'],
  ['hu', 'HUN', 'Венгрия', 'Hungary', 'en-GB hu'],
  ['id', 'IDN', 'Индонезия', 'Indonesia', 'en-GB id'],
  ['ie', 'IRL', 'Ирландия', 'Ireland', 'en-GB'],
  ['il', 'ISR', 'Израиль', 'Israel', 'en-GB he'],
  ['in', 'IND', 'Индия', 'India', 'en-GB bn-BD gu-IN hi kn-IN ml-IN mr-IN or-IN pa-IN ta-IN te-IN ur-PK'],
  ['iq', 'IRQ', 'Ирак', 'Iraq', 'en-GB ar-SA'],
  ['is', 'ISL', 'Исландия', 'Iceland', 'en-GB'],
  ['it', 'ITA', 'Италия', 'Italy', 'it en-GB'],
  ['jm', 'JAM', 'Ямайка', 'Jamaica', 'en-GB'],
  ['jo', 'JOR', 'Иордания', 'Jordan', 'en-GB ar-SA'],
  ['jp', 'JPN', 'Япония', 'Japan', 'ja en-US'],
  ['ke', 'KEN', 'Кения', 'Kenya', 'en-GB'],
  ['kg', 'KGZ', 'Киргизия', 'Kyrgyzstan', 'en-GB'],
  ['kh', 'KHM', 'Камбоджа', 'Cambodia', 'en-GB fr-FR'],
  ['kn', 'KNA', 'Сент-Китс и Невис', 'St. Kitts and Nevis', 'en-GB'],
  ['kr', 'KOR', 'Южная Корея', 'Republic of Korea', 'ko en-GB'],
  ['kw', 'KWT', 'Кувейт', 'Kuwait', 'en-GB ar-SA'],
  ['ky', 'CYM', 'Каймановы о-ва', 'Cayman Islands', 'en-GB'],
  ['kz', 'KAZ', 'Казахстан', 'Kazakhstan', 'en-GB'],
  ['la', 'LAO', 'Лаос', 'Laos', 'en-GB fr-FR'],
  ['lb', 'LBN', 'Ливан', 'Lebanon', 'en-GB ar-SA fr-FR'],
  ['lc', 'LCA', 'Сент-Люсия', 'St. Lucia', 'en-GB'],
  ['lk', 'LKA', 'Шри-Ланка', 'Sri Lanka', 'en-GB'],
  ['lr', 'LBR', 'Либерия', 'Liberia', 'en-GB'],
  ['lt', 'LTU', 'Литва', 'Lithuania', 'en-GB'],
  ['lu', 'LUX', 'Люксембург', 'Luxembourg', 'en-GB fr-FR de-DE'],
  ['lv', 'LVA', 'Латвия', 'Latvia', 'en-GB'],
  ['ly', 'LBY', 'Ливия', 'Libya', 'en-GB ar-SA'],
  ['ma', 'MAR', 'Марокко', 'Morocco', 'en-GB ar-SA fr-FR'],
  ['md', 'MDA', 'Молдова', 'Moldova', 'en-GB'],
  ['me', 'MNE', 'Черногория', 'Montenegro', 'en-GB hr'],
  ['mg', 'MDG', 'Мадагаскар', 'Madagascar', 'en-GB fr-FR'],
  ['mk', 'MKD', 'Северная Македония', 'North Macedonia', 'en-GB'],
  ['ml', 'MLI', 'Мали', 'Mali', 'en-GB fr-FR'],
  ['mm', 'MMR', 'Мьянма', 'Myanmar', 'en-GB'],
  ['mn', 'MNG', 'Монголия', 'Mongolia', 'en-GB'],
  ['mo', 'MAC', 'Макао', 'Macau', 'zh-Hant en-GB'],
  ['mr', 'MRT', 'Мавритания', 'Mauritania', 'en-GB ar-SA fr-FR'],
  ['ms', 'MSR', 'Монтсеррат', 'Montserrat', 'en-GB'],
  ['mt', 'MLT', 'Мальта', 'Malta', 'en-GB'],
  ['mu', 'MUS', 'Маврикий', 'Mauritius', 'en-GB fr-FR'],
  ['mv', 'MDV', 'Мальдивы', 'Maldives', 'en-GB'],
  ['mw', 'MWI', 'Малави', 'Malawi', 'en-GB'],
  ['mx', 'MEX', 'Мексика', 'Mexico', 'es-MX en-GB'],
  ['my', 'MYS', 'Малайзия', 'Malaysia', 'en-GB ms'],
  ['mz', 'MOZ', 'Мозамбик', 'Mozambique', 'en-GB'],
  ['na', 'NAM', 'Намибия', 'Namibia', 'en-GB'],
  ['ne', 'NER', 'Нигер', 'Niger', 'en-GB fr-FR'],
  ['ng', 'NGA', 'Нигерия', 'Nigeria', 'en-GB'],
  ['ni', 'NIC', 'Никарагуа', 'Nicaragua', 'es-MX en-GB'],
  ['nl', 'NLD', 'Нидерланды', 'Netherlands', 'nl-NL en-GB'],
  ['no', 'NOR', 'Норвегия', 'Norway', 'en-GB no'],
  ['np', 'NPL', 'Непал', 'Nepal', 'en-GB'],
  ['nr', 'NRU', 'Науру', 'Nauru', 'en-GB'],
  ['nz', 'NZL', 'Новая Зеландия', 'New Zealand', 'en-AU en-GB'],
  ['om', 'OMN', 'Оман', 'Oman', 'en-GB ar-SA'],
  ['pa', 'PAN', 'Панама', 'Panama', 'es-MX en-GB'],
  ['pe', 'PER', 'Перу', 'Peru', 'es-MX en-GB'],
  ['pg', 'PNG', 'Папуа — Новая Гвинея', 'Papua New Guinea', 'en-GB'],
  ['ph', 'PHL', 'Филиппины', 'Philippines', 'en-GB'],
  ['pk', 'PAK', 'Пакистан', 'Pakistan', 'en-GB ur-PK'],
  ['pl', 'POL', 'Польша', 'Poland', 'en-GB pl'],
  ['pt', 'PRT', 'Португалия', 'Portugal', 'pt-PT en-GB'],
  ['pw', 'PLW', 'Палау', 'Palau', 'en-GB'],
  ['py', 'PRY', 'Парагвай', 'Paraguay', 'es-MX en-GB'],
  ['qa', 'QAT', 'Катар', 'Qatar', 'en-GB ar-SA'],
  ['ro', 'ROU', 'Румыния', 'Romania', 'en-GB ro'],
  ['rs', 'SRB', 'Сербия', 'Serbia', 'en-GB hr'],
  ['ru', 'RUS', 'Россия', 'Russia', 'ru en-GB uk'],
  ['rw', 'RWA', 'Руанда', 'Rwanda', 'en-GB fr-FR'],
  ['sa', 'SAU', 'Саудовская Аравия', 'Saudi Arabia', 'en-GB ar-SA'],
  ['sb', 'SLB', 'Соломоновы о-ва', 'Solomon Islands', 'en-GB'],
  ['sc', 'SYC', 'Сейшельские о-ва', 'Seychelles', 'en-GB fr-FR'],
  ['se', 'SWE', 'Швеция', 'Sweden', 'sv en-GB'],
  ['sg', 'SGP', 'Сингапур', 'Singapore', 'en-GB zh-Hans'],
  ['si', 'SVN', 'Словения', 'Slovenia', 'en-GB sl-SI'],
  ['sk', 'SVK', 'Словакия', 'Slovakia', 'en-GB sk'],
  ['sl', 'SLE', 'Сьерра-Леоне', 'Sierra Leone', 'en-GB'],
  ['sn', 'SEN', 'Сенегал', 'Senegal', 'en-GB fr-FR'],
  ['sr', 'SUR', 'Суринам', 'Suriname', 'en-GB nl-NL'],
  ['st', 'STP', 'Сан-Томе и Принсипи', 'Sao Tome and Principe', 'en-GB'],
  ['sv', 'SLV', 'Сальвадор', 'El Salvador', 'es-MX en-GB'],
  ['sz', 'SWZ', 'Эсватини', 'Eswatini', 'en-GB'],
  ['tc', 'TCA', 'Тёркс и Кайкос', 'Turks and Caicos Islands', 'en-GB'],
  ['td', 'TCD', 'Чад', 'Chad', 'en-GB fr-FR'],
  ['th', 'THA', 'Таиланд', 'Thailand', 'en-GB th'],
  ['tj', 'TJK', 'Таджикистан', 'Tajikistan', 'en-GB'],
  ['tm', 'TKM', 'Туркменистан', 'Turkmenistan', 'en-GB'],
  ['tn', 'TUN', 'Тунис', 'Tunisia', 'en-GB ar-SA fr-FR'],
  ['to', 'TON', 'Тонга', 'Tonga', 'en-GB'],
  ['tr', 'TUR', 'Турция', 'Türkiye', 'en-GB tr'],
  ['tt', 'TTO', 'Тринидад и Тобаго', 'Trinidad and Tobago', 'en-GB fr-FR'],
  ['tw', 'TWN', 'Тайвань', 'Taiwan', 'zh-Hant en-GB'],
  ['tz', 'TZA', 'Танзания', 'Tanzania', 'en-GB'],
  ['ua', 'UKR', 'Украина', 'Ukraine', 'en-GB ru uk'],
  ['ug', 'UGA', 'Уганда', 'Uganda', 'en-GB'],
  ['us', 'USA', 'США', 'United States', 'en-US ar-SA zh-Hans zh-Hant fr-FR ko pt-BR ru es-MX vi'],
  ['uy', 'URY', 'Уругвай', 'Uruguay', 'en-GB es-MX'],
  ['uz', 'UZB', 'Узбекистан', 'Uzbekistan', 'en-GB'],
  ['vc', 'VCT', 'Сент-Винсент и Гренадины', 'St. Vincent and the Grenadines', 'en-GB'],
  ['ve', 'VEN', 'Венесуэла', 'Venezuela', 'es-MX en-GB'],
  ['vg', 'VGB', 'Британские Виргинские о-ва', 'British Virgin Islands', 'en-GB'],
  ['vn', 'VNM', 'Вьетнам', 'Vietnam', 'en-GB vi'],
  ['vu', 'VUT', 'Вануату', 'Vanuatu', 'en-GB fr-FR'],
  ['xk', 'XKS', 'Косово', 'Kosovo', 'en-GB'],
  ['ye', 'YEM', 'Йемен', 'Yemen', 'en-GB ar-SA'],
  ['za', 'ZAF', 'ЮАР', 'South Africa', 'en-GB'],
  ['zm', 'ZMB', 'Замбия', 'Zambia', 'en-GB'],
  ['zw', 'ZWE', 'Зимбабве', 'Zimbabwe', 'en-GB'],
];

export function flagOf(code: string): string {
  const cc = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '🌐';
  return String.fromCodePoint(...[...cc].map((letter) => letter.charCodeAt(0) + 127397));
}

export const STOREFRONTS: Storefront[] = TABLE.map(([code, iso3, name, nameEn, locales]) => ({
  code, iso3, name, nameEn, flag: flagOf(code), locales: locales.split(' '),
}));

const BY_CODE = new Map(STOREFRONTS.map((storefront) => [storefront.code, storefront]));

/** Storefront by alpha-2 (any case). Unknown codes get a minimal synthetic entry. */
export function storefrontOf(code: string): Storefront {
  const normalized = code.trim().toLowerCase();
  return BY_CODE.get(normalized) ?? {
    code: normalized, iso3: normalized.toUpperCase(), name: normalized.toUpperCase(), nameEn: normalized.toUpperCase(),
    flag: flagOf(normalized), locales: [],
  };
}

export function isKnownStorefront(code: string): boolean {
  return BY_CODE.has(code.trim().toLowerCase());
}

/** Language part of a locale code: es-MX → es, zh-Hans → zh. */
export const languageOf = (locale: string) => locale.split('-')[0].toLowerCase();

/** Storefronts where a keyword written in `lang` (ISO 639-1) is indexed. */
export function storefrontsIndexing(lang: string, list: Storefront[] = STOREFRONTS): Storefront[] {
  const needle = lang.toLowerCase();
  return list.filter((storefront) => storefront.locales.some((locale) => languageOf(locale) === needle || locale.toLowerCase() === needle));
}

const fold = (value: string) => value.toLocaleLowerCase('ru').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ё/g, 'е');

function subsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

export interface StorefrontMatch {
  storefront: Storefront;
  score: number;
  /** Why it matched, for the UI hint: 'iso' | 'name' | 'lang-primary' | 'lang-secondary' | 'fuzzy'. */
  reason: 'iso' | 'name' | 'lang-primary' | 'lang-secondary' | 'fuzzy';
}

/**
 * Fuzzy storefront search by Russian/English name, ISO alpha-2/alpha-3 and
 * indexed language. «es» → Spain (ISO), Mexico / LatAm (default es-MX) and the
 * US (es-MX is an additional US language); «мекс» → Mexico; «ru» → Russia, Ukraine, US.
 * Diacritics and case are ignored. Empty query returns the list unchanged (score 0).
 */
export function searchStorefronts(query: string, list: Storefront[] = STOREFRONTS): StorefrontMatch[] {
  const q = fold(query.trim());
  if (!q) return list.map((storefront) => ({ storefront, score: 0, reason: 'name' as const }));
  const out: StorefrontMatch[] = [];
  for (const storefront of list) {
    let score = 0;
    let reason: StorefrontMatch['reason'] = 'fuzzy';
    const bump = (value: number, why: StorefrontMatch['reason']) => { if (value > score) { score = value; reason = why; } };
    if (storefront.code === q || storefront.iso3.toLowerCase() === q) bump(100, 'iso');
    const names = [fold(storefront.name), fold(storefront.nameEn)];
    for (const name of names) {
      if (name === q) bump(95, 'name');
      // Two letters are far more often an ISO or language code than a name prefix.
      else if (name.startsWith(q)) bump(q.length <= 2 ? 40 : 85, 'name');
      else if (name.split(/[\s\-—(),.]+/).some((word) => word.startsWith(q))) bump(q.length <= 2 ? 30 : 70, 'name');
      else if (q.length >= 3 && name.includes(q)) bump(50, 'name');
    }
    storefront.locales.forEach((locale, index) => {
      const code = locale.toLowerCase();
      const hit = languageOf(locale) === q || code === q || (q.length >= 4 && code.startsWith(q));
      const langName = fold(LOCALE_NAMES[locale] ?? '');
      const nameHit = q.length >= 3 && langName.startsWith(q);
      if (hit || nameHit) bump(index === 0 ? 80 : 60, index === 0 ? 'lang-primary' : 'lang-secondary');
    });
    if (!score && q.length >= 2 && names.some((name) => subsequence(q, name))) bump(10, 'fuzzy');
    if (score) out.push({ storefront, score, reason });
  }
  return out.sort((a, b) => b.score - a.score || a.storefront.name.localeCompare(b.storefront.name, 'ru'));
}

export interface CountryPreset {
  id: string;
  name: string;
  hint: string;
  locales: string[];
}

/**
 * Built-in country sets derived from the indexing table, limited to the
 * storefronts an app tracks: English-default storefronts, LatAm (es-MX default
 * or indexed, US excluded — it has its own column), and every storefront that
 * indexes Russian.
 */
export function builtInPresets(tracked: string[]): CountryPreset[] {
  const trackedSet = new Set(tracked.map((code) => code.toLowerCase()));
  const pick = (predicate: (storefront: Storefront) => boolean) =>
    STOREFRONTS.filter((storefront) => trackedSet.has(storefront.code) && predicate(storefront)).map((storefront) => storefront.code);
  return [
    { id: 'preset:en', name: 'EN-витрины', hint: 'английский — основной язык', locales: pick((s) => languageOf(s.locales[0]) === 'en') },
    { id: 'preset:latam', name: 'LatAm es-MX', hint: 'индексируют es-MX, без US', locales: pick((s) => s.code !== 'us' && s.locales.includes('es-MX')) },
    { id: 'preset:ru', name: 'Индексируют ru', hint: 'русский основной или вторичный', locales: pick((s) => s.locales.includes('ru')) },
  ].filter((preset) => preset.locales.length > 0);
}
