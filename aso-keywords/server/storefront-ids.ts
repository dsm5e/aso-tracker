// Apple storefront ids (the numeric part of the `X-Apple-Store-Front` header)
// by ISO alpha-2 code. Single source for MZStore search and MZSearchHints.
// Only ids we are confident in are listed; an unknown storefront makes
// `searchAppStore` fall back to the iTunes Search API instead of guessing.

const IDS: Record<string, number> = {
  us: 143441, fr: 143442, de: 143443, gb: 143444, at: 143445, be: 143446, fi: 143447, gr: 143448,
  ie: 143449, it: 143450, lu: 143451, nl: 143452, pt: 143453, es: 143454, ca: 143455, se: 143456,
  no: 143457, dk: 143458, ch: 143459, au: 143460, nz: 143461, jp: 143462, hk: 143463, sg: 143464,
  cn: 143465, kr: 143466, in: 143467, mx: 143468, ru: 143469, tw: 143470, vn: 143471, za: 143472,
  my: 143473, ph: 143474, th: 143475, id: 143476, pk: 143477, pl: 143478, sa: 143479, tr: 143480,
  ae: 143481, hu: 143482, cl: 143483, np: 143484, pa: 143485, lk: 143486, ro: 143487, mv: 143488,
  cz: 143489, il: 143491, ua: 143492, kw: 143493, hr: 143494, cr: 143495, sk: 143496, lb: 143497,
  qa: 143498, si: 143499, rs: 143500, co: 143501, ve: 143502, br: 143503, gt: 143504, ar: 143505,
  sv: 143506, pe: 143507, do: 143508, ec: 143509, hn: 143510, jm: 143511, ni: 143512, py: 143513,
  uy: 143514, mo: 143515, eg: 143516, kz: 143517, ee: 143518, lv: 143519, lt: 143520, mt: 143521,
  md: 143523, am: 143524, bw: 143525, bg: 143526, jo: 143528, ke: 143529, mk: 143530, mg: 143531,
  ml: 143532, mu: 143533, ne: 143534, sn: 143535, tn: 143536, ug: 143537, ai: 143538, bs: 143539,
  ag: 143540, bb: 143541, bm: 143542, vg: 143543, ky: 143544, dm: 143545, gd: 143546, ms: 143547,
  kn: 143548, lc: 143549, vc: 143550, tt: 143551, tc: 143552, gy: 143553, sr: 143554, bz: 143555,
  bo: 143556, cy: 143557, is: 143558, bh: 143559, bn: 143560, ng: 143561, om: 143562, dz: 143563,
  ao: 143564, by: 143565, uz: 143566, az: 143568, ye: 143571, tz: 143572, gh: 143573, al: 143575,
  bj: 143576, bt: 143577, bf: 143578, kh: 143579, cv: 143580, td: 143581, cg: 143582, fj: 143583,
  gm: 143584, gw: 143585, kg: 143586, la: 143587, lr: 143588, mw: 143589, mr: 143590, fm: 143591,
  mn: 143592, mz: 143593, na: 143594, pw: 143595, pg: 143597, st: 143598, sc: 143599, sl: 143600,
  sb: 143601, sz: 143602, tj: 143603, tm: 143604, zw: 143605,
};

/** Keyword-file locales that are language variants of one storefront. */
const COUNTRY_OVERRIDE: Record<string, string> = {
  'in-hi': 'in', 'in-gu': 'in', 'in-kn': 'in', 'in-ml': 'in',
  'in-mr': 'in', 'in-or': 'in', 'in-pa': 'in', 'in-ta': 'in', 'in-te': 'in',
  'es-ca': 'es',
};

/** Tracked locale key (`us`, `in-hi`) → ISO alpha-2 storefront country. */
export function storefrontCountry(locale: string): string {
  const key = locale.trim().toLowerCase();
  return COUNTRY_OVERRIDE[key] ?? key.split('-')[0];
}

/** Numeric storefront id, or null when unknown. */
export function storefrontId(locale: string): number | null {
  return IDS[storefrontCountry(locale)] ?? null;
}

/**
 * `X-Apple-Store-Front` value for the App Store app's endpoints. No language
 * suffix: `143481-1,29` (AE + en-US) is HTTP 400 for search, while `143481,29`
 * returns the storefront's default language. Platform 29 = iPhone.
 */
export function storeFrontHeader(locale: string): string | null {
  const id = storefrontId(locale);
  return id == null ? null : `${id},29`;
}
