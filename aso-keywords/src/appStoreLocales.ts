export type AppStoreLocale = {
  code: string;
  name: string;
};

const CODES = [
  'us', 'ca', 'mx', 'br', 'ar', 'cl', 'co', 'pe', 've', 'uy', 'py', 'bo', 'ec',
  'cr', 'pa', 'gt', 'hn', 'ni', 'sv', 'do', 'jm', 'bb', 'bs', 'tt', 'bz', 'bm',
  'ky', 'ag', 'dm', 'gd', 'kn', 'lc', 'vc', 'sr', 'ai', 'ms', 'tc', 'vg',
  'gb', 'ie', 'de', 'at', 'ch', 'fr', 'be', 'lu', 'nl', 'mc', 'es', 'pt', 'it',
  'mt', 'cy', 'se', 'no', 'dk', 'fi', 'is', 'pl', 'cz', 'sk', 'hu', 'ro', 'hr',
  'si', 'ua', 'ru', 'gr', 'bg', 'ee', 'lv', 'lt', 'md', 'by', 'mk', 'al', 'me',
  'ba', 'rs', 'xk', 'tr', 'il', 'sa', 'ae', 'eg', 'jo', 'lb', 'kw', 'qa', 'bh',
  'om', 'ye', 'iq', 'ma', 'dz', 'tn', 'ly', 'za', 'ng', 'ke', 'gh', 'ci', 'sn',
  'tz', 'ug', 'zw', 'zm', 'mu', 'na', 'bw', 'cm', 'ml', 'bf', 'ne', 'cd', 'cg',
  'ga', 'mg', 'mw', 'mz', 'cv', 'sc', 'sz', 'ao', 'sl', 'lr', 'rw', 'bj', 'td',
  'gm', 'gn', 'gw', 'st', 'au', 'nz', 'jp', 'kr', 'cn', 'tw', 'hk', 'mo', 'sg',
  'id', 'my', 'th', 'vn', 'ph', 'mm', 'kh', 'la', 'bn', 'mn', 'fj', 'pg', 'sb',
  'to', 'fm', 'pw', 'in', 'pk', 'bd', 'lk', 'np', 'bt', 'mv', 'af', 'kz', 'uz',
  'kg', 'tj', 'tm', 'am', 'ge', 'az',
] as const;

const SPECIAL: AppStoreLocale[] = [
  { code: 'es-ca', name: 'Catalonia (Spain)' },
  { code: 'in-hi', name: 'India (Hindi)' },
  { code: 'in-gu', name: 'India (Gujarati)' },
  { code: 'in-kn', name: 'India (Kannada)' },
  { code: 'in-ml', name: 'India (Malayalam)' },
  { code: 'in-mr', name: 'India (Marathi)' },
  { code: 'in-or', name: 'India (Odia)' },
  { code: 'in-pa', name: 'India (Punjabi)' },
  { code: 'in-ta', name: 'India (Tamil)' },
  { code: 'in-te', name: 'India (Telugu)' },
];

const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });

export const APP_STORE_LOCALES: AppStoreLocale[] = [
  ...CODES.map((code) => ({
    code,
    name: displayNames.of(code.toUpperCase()) ?? code.toUpperCase(),
  })),
  ...SPECIAL,
].sort((a, b) => a.name.localeCompare(b.name));
