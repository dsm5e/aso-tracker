export const MEDSCAN_APP_ID = 6762091560;
export const TARGET_DAILY_BUDGET_USD = 100;

export type MatchType = "EXACT" | "BROAD";
export type Portfolio = "BRAND_EXACT" | "CORE_EXACT" | "DISC_BROAD" | "DISC_SM" | "COMP_EXACT" | "LOCAL_EXACT";

export interface SemanticRegistry {
  schemaVersion: number;
  app: { name: string; adamId: number; bundleId?: string };
  eligibleStorefronts: string[];
  blockedStorefronts?: Record<string, { includeInPaidCutover?: boolean; reason?: string }>;
  auctionTiers: Record<string, string[]>;
  policy: {
    globalExact: string[];
    globalBroad: string[];
  };
  localeAdditionalExact: Record<string, string[]>;
  /** Storefront-only terms proven locally; avoids leaking a phrase to every
   * storefront that happens to share the same language. */
  countryAdditionalExact?: Record<string, string[]>;
  /** Semantically irrelevant search terms observed in a specific storefront. */
  countryNegativeExact?: Record<string, string[]>;
  competitorExact: {
    tierA: string[];
    tierB: string[];
    tierC_testOnly: string[];
  };
  negativeExactSeed: {
    immediateSemanticReject: string[];
    requireAtLeast50ImpressionsAndZeroInstallsOrManualSerpReview: string[];
  };
}

export interface DesiredKeyword {
  text: string;
  matchType: MatchType;
  bidAmount: number;
  rationale: string;
}

export interface DesiredCampaign {
  ref: string;
  name: string;
  portfolio: Portfolio;
  tier: string;
  countriesOrRegions: string[];
  dailyBudgetAmount: number;
  defaultBidAmount: number;
  automatedKeywordsOptIn: boolean;
  status: "PAUSED";
  adGroupName: string;
  keywords: DesiredKeyword[];
  negativeExact: string[];
}

export interface RemoteKeyword {
  id: number;
  campaignId: number;
  adGroupId: number;
  text: string;
  matchType: MatchType;
  bidAmount?: { amount?: string };
  status?: string;
  deleted?: boolean;
}

export interface RemoteAdGroup {
  id: number;
  campaignId: number;
  name: string;
  status?: string;
  defaultBidAmount?: { amount?: string };
  automatedKeywordsOptIn?: boolean;
  keywords: RemoteKeyword[];
  negativeKeywords: Array<Record<string, unknown>>;
}

export interface RemoteCampaign {
  id: number;
  name: string;
  adamId: number;
  status?: string;
  servingStatus?: string;
  countriesOrRegions?: string[];
  dailyBudgetAmount?: { amount?: string; currency?: string };
  adGroups: RemoteAdGroup[];
  negativeKeywords: Array<Record<string, unknown>>;
}

export interface RevenueSignal {
  keywordId: number;
  attributedInstalls: number;
  trials: number;
  paid: number;
  revenueUsd: number;
}

export interface OwnershipConflict {
  country: string;
  term: string;
  matchType: MatchType;
  owners: string[];
}

export interface RebuildPlan {
  schemaVersion: 1;
  mode: "DRY_RUN_ONLY";
  appId: number;
  targetDailyBudgetUsd: number;
  desiredCampaigns: DesiredCampaign[];
  legacyKeywords: Array<{
    action: "KEEP_UNTIL_CUTOVER" | "PAUSE_AT_CUTOVER";
    campaignId: number;
    campaignName: string;
    adGroupId: number;
    keywordId: number;
    text: string;
    matchType: MatchType;
    bidAmount: number | null;
    countriesOrRegions: string[];
    migrationTargets: string[];
    economics: RevenueSignal | null;
    reason: string;
  }>;
  legacyCampaignCutover: Array<{
    action: "PAUSE_AFTER_REMOTE_READBACK";
    campaignId: number;
    campaignName: string;
    countriesOrRegions: string[];
    currentStatus: string | null;
  }>;
  ambiguousNegativeReview: string[];
  validation: {
    paidStorefrontCount: number;
    cnExcluded: boolean;
    totalDailyBudgetUsd: number;
    ownershipConflicts: OwnershipConflict[];
    errors: string[];
  };
}

type GeoBundle = {
  id: string;
  tier: string;
  countries: string[];
  budgets: Record<"CORE_EXACT" | "DISC_BROAD" | "DISC_SM" | "COMP_EXACT", number>;
  bids: Record<"CORE_EXACT" | "DISC_BROAD" | "DISC_SM" | "COMP_EXACT", number>;
};

const normalize = (value: string) => value.trim().toLocaleLowerCase();
const unique = (values: string[]) => [...new Set(values.map(normalize).filter(Boolean))];
const intersection = (left: string[], right: string[]) => left.some((value) => right.includes(value));

const LANGUAGE_STOREFRONTS: Record<string, string[]> = {
  en: ["US", "GB", "CA", "AU", "NZ", "IE", "IN", "SG", "PH", "ZA"],
  "pt-BR": ["BR"],
  pt: ["PT"],
  es: ["ES", "MX", "AR", "CO", "CL", "PE", "CR", "DO", "EC", "GT", "HN", "BO", "PY", "SV", "PA"],
  de: ["DE", "AT", "CH"],
  fr: ["FR", "BE", "CH", "CA", "LU"],
  it: ["IT", "CH"],
  ja: ["JP"],
  ko: ["KR"],
  "zh-Hant": ["TW", "HK"],
  tr: ["TR"],
  ar: ["AE", "BH", "EG", "IQ", "JO", "KW", "LB", "OM", "QA", "SA", "DZ", "MA"],
  he: ["IL"],
  nl: ["NL", "BE"],
};

const LOCAL_BUDGETS: Record<string, number> = {
  en: 1,
  "pt-BR": 1,
  pt: 1,
  es: 1,
  de: 1,
  fr: 1,
  it: 1,
  ja: 1,
  ko: 1,
  "zh-Hant": 1,
  tr: 1,
  ar: 1,
  he: 1,
  nl: 1,
};

const LOCAL_BIDS: Record<string, number> = {
  en: 0.22,
  "pt-BR": 0.2,
  pt: 0.16,
  es: 0.16,
  de: 0.22,
  fr: 0.2,
  it: 0.16,
  ja: 0.16,
  ko: 0.14,
  "zh-Hant": 0.14,
  tr: 0.12,
  ar: 0.1,
  he: 0.14,
  nl: 0.18,
};

function paidStorefronts(registry: SemanticRegistry): string[] {
  return registry.eligibleStorefronts
    .map((country) => country.toUpperCase())
    .filter((country) => registry.blockedStorefronts?.[country]?.includeInPaidCutover !== false)
    .sort();
}

function geoBundles(registry: SemanticRegistry, paid: string[]): GeoBundle[] {
  const tier1 = registry.auctionTiers.T1_WEST ?? [];
  const tier2 = registry.auctionTiers.T2_GROWTH ?? [];
  const tier3 = registry.auctionTiers.T3_EAST ?? [];
  const tier4 = registry.auctionTiers.T4_EMERGING ?? [];
  const tier5 = registry.auctionTiers.T5_TAIL ?? [];
  const allowed = new Set(paid);
  const without = (countries: string[], excluded: string[]) =>
    countries.filter((country) => allowed.has(country) && !excluded.includes(country)).sort();

  return [
    {
      id: "US",
      tier: "T1_WEST",
      countries: ["US"],
      budgets: { CORE_EXACT: 10, DISC_BROAD: 5, DISC_SM: 4, COMP_EXACT: 5 },
      bids: { CORE_EXACT: 0.4, DISC_BROAD: 0.18, DISC_SM: 0.12, COMP_EXACT: 0.15 },
    },
    {
      id: "GB",
      tier: "T1_WEST",
      countries: ["GB"],
      budgets: { CORE_EXACT: 3, DISC_BROAD: 1, DISC_SM: 1, COMP_EXACT: 1 },
      bids: { CORE_EXACT: 0.35, DISC_BROAD: 0.18, DISC_SM: 0.12, COMP_EXACT: 0.15 },
    },
    {
      id: "DE",
      tier: "T1_WEST",
      countries: ["DE"],
      budgets: { CORE_EXACT: 1, DISC_BROAD: 1, DISC_SM: 1, COMP_EXACT: 1 },
      bids: { CORE_EXACT: 0.25, DISC_BROAD: 0.15, DISC_SM: 0.12, COMP_EXACT: 0.15 },
    },
    {
      id: "T1-WEST",
      tier: "T1_WEST",
      countries: without(tier1, ["US", "GB", "DE"]),
      budgets: { CORE_EXACT: 1, DISC_BROAD: 1, DISC_SM: 1, COMP_EXACT: 1 },
      bids: { CORE_EXACT: 0.3, DISC_BROAD: 0.15, DISC_SM: 0.12, COMP_EXACT: 0.14 },
    },
    {
      id: "BR",
      tier: "T2_GROWTH",
      countries: ["BR"],
      budgets: { CORE_EXACT: 4, DISC_BROAD: 2, DISC_SM: 2, COMP_EXACT: 2 },
      bids: { CORE_EXACT: 0.25, DISC_BROAD: 0.15, DISC_SM: 0.1, COMP_EXACT: 0.12 },
    },
    {
      id: "MX",
      tier: "T2_GROWTH",
      countries: ["MX"],
      budgets: { CORE_EXACT: 3, DISC_BROAD: 1, DISC_SM: 1, COMP_EXACT: 1 },
      bids: { CORE_EXACT: 0.25, DISC_BROAD: 0.15, DISC_SM: 0.1, COMP_EXACT: 0.12 },
    },
    {
      id: "T2-GROWTH",
      tier: "T2_GROWTH",
      countries: without(tier2, ["BR", "MX"]),
      budgets: { CORE_EXACT: 4, DISC_BROAD: 2, DISC_SM: 1, COMP_EXACT: 1 },
      bids: { CORE_EXACT: 0.2, DISC_BROAD: 0.12, DISC_SM: 0.09, COMP_EXACT: 0.11 },
    },
    {
      id: "T3-EAST",
      tier: "T3_EAST",
      countries: without(tier3, []),
      budgets: { CORE_EXACT: 3, DISC_BROAD: 2, DISC_SM: 1, COMP_EXACT: 1 },
      bids: { CORE_EXACT: 0.18, DISC_BROAD: 0.1, DISC_SM: 0.08, COMP_EXACT: 0.1 },
    },
    {
      id: "T4-EMERGING",
      tier: "T4_EMERGING",
      countries: without(tier4, []),
      budgets: { CORE_EXACT: 3, DISC_BROAD: 2, DISC_SM: 1, COMP_EXACT: 2 },
      bids: { CORE_EXACT: 0.14, DISC_BROAD: 0.08, DISC_SM: 0.06, COMP_EXACT: 0.08 },
    },
    {
      id: "T5-TAIL",
      tier: "T5_TAIL",
      countries: without(tier5, []),
      budgets: { CORE_EXACT: 3, DISC_BROAD: 1, DISC_SM: 1, COMP_EXACT: 1 },
      bids: { CORE_EXACT: 0.1, DISC_BROAD: 0.06, DISC_SM: 0.05, COMP_EXACT: 0.06 },
    },
  ];
}

function usCoreBid(term: string, fallback: number): number {
  const bids: Record<string, number> = {
    dicom: 0.5,
    "dicom viewer": 0.6,
    "dicom reader": 0.35,
    cbct: 0.4,
    "cbct viewer": 0.4,
    pacs: 0.25,
    "x-ray": 0.2,
    "dental dicom": 0.2,
  };
  return bids[normalize(term)] ?? fallback;
}

function usCompetitorBid(term: string, fallback: number): number {
  const bids: Record<string, number> = {
    romexis: 0.2,
    weasis: 0.2,
    "radiant dicom viewer": 0.1,
  };
  return bids[normalize(term)] ?? fallback;
}

function localizedBid(locale: string, term: string, fallback: number): number {
  if (locale === "en") {
    const bids: Record<string, number> = {
      "dicom viewer free": 0.18,
      "xray app": 0.16,
      "x-ray viewer": 0.18,
    };
    return bids[normalize(term)] ?? fallback;
  }
  if (locale === "de") {
    const bids: Record<string, number> = {
      "dicom betrachter": 0.22,
      "dicom viewer kostenlos": 0.22,
      "mrt viewer": 0.18,
      "mri viewer": 0.15,
      "röntgen app": 0.15,
      radiologie: 0.12,
      "medical imaging": 0.12,
    };
    return bids[normalize(term)] ?? fallback;
  }
  if (locale === "fr") {
    const bids: Record<string, number> = {
      "visionneuse dicom": 0.2,
      irm: 0.18,
      radiographie: 0.14,
      radiologie: 0.1,
      "imagerie médicale": 0.12,
    };
    return bids[normalize(term)] ?? fallback;
  }
  if (locale === "es") {
    const bids: Record<string, number> = {
      "visor dicom": 0.16,
      "rayos x": 0.15,
      "resonancia magnetica": 0.14,
      "visor de radiografias": 0.12,
    };
    return bids[normalize(term)] ?? fallback;
  }
  if (locale === "pt") {
    const bids: Record<string, number> = {
      "visualizador dicom": 0.18,
      "raio x": 0.12,
    };
    return bids[normalize(term)] ?? fallback;
  }
  if (locale === "ja") {
    const bids: Record<string, number> = {
      "dicom ビューア": 0.18,
      "ct ビューア": 0.16,
      "mri ビューア": 0.14,
      "歯科 dicom": 0.12,
    };
    return bids[normalize(term)] ?? fallback;
  }
  if (locale === "ko") {
    const bids: Record<string, number> = {
      "dicom 뷰어": 0.16,
      "ct 뷰어": 0.14,
      "mri 뷰어": 0.14,
      "엑스레이 뷰어": 0.12,
      "치과 dicom": 0.1,
    };
    return bids[normalize(term)] ?? fallback;
  }
  if (locale === "zh-Hant") {
    const bids: Record<string, number> = {
      "dicom 查看器": 0.14,
      "醫學影像": 0.12,
    };
    return bids[normalize(term)] ?? fallback;
  }
  if (locale !== "pt-BR") return fallback;
  const bids: Record<string, number> = {
    "visualizador dicom": 0.3,
    "raio x": 0.15,
    "raio x visualizador": 0.15,
    "tomografia visualizador": 0.15,
    tcfc: 0.1,
  };
  return bids[normalize(term)] ?? fallback;
}

function countryLocalizedBid(country: string, term: string, fallback: number): number {
  if (country === "KG" && normalize(term) === "мрт снимки") return 0.1;
  if (country === "MO" && normalize(term) === "dicom 查看器") return 0.14;
  if (country === "MO" && normalize(term) === "醫學影像") return 0.12;
  return fallback;
}

function mxCoreBid(term: string, fallback: number): number {
  const bids: Record<string, number> = {
    "rayos x": 0.3,
    "visor dicom": 0.25,
    "tac visor": 0.2,
    "radiografía visor": 0.15,
    "resonancia magnetica": 0.15,
    "visor de radiografias": 0.12,
    "visor dicom gratis": 0.12,
  };
  return bids[normalize(term)] ?? fallback;
}

function gbCoreBid(term: string, fallback: number): number {
  const bids: Record<string, number> = {
    dicom: 0.4,
    "dicom viewer": 0.45,
    "dicom reader": 0.25,
    cbct: 0.3,
    "cbct viewer": 0.25,
    pacs: 0.2,
    "x-ray": 0.2,
    "dicom viewer free": 0.2,
    "xray app": 0.16,
    "ct viewer": 0.22,
    "ct scan viewer": 0.22,
    "mri viewer": 0.22,
    "x-ray viewer": 0.2,
    "pacs viewer": 0.18,
    "pacs mobile": 0.15,
    "view dicom files": 0.2,
    "dental dicom": 0.2,
    "radiology app": 0.15,
    "dicom mri viewer": 0.18,
    "dicom ct viewer": 0.18,
    "dicom x-ray viewer": 0.18,
    "dicom windowing": 0.12,
  };
  return bids[normalize(term)] ?? fallback;
}

function deCoreBid(term: string, fallback: number): number {
  const bids: Record<string, number> = {
    dicom: 0.3,
    "dicom viewer": 0.35,
    "dicom reader": 0.2,
    cbct: 0.25,
    "cbct viewer": 0.2,
    pacs: 0.18,
    "x-ray": 0.15,
    "dicom betrachter": 0.2,
    "dicom viewer kostenlos": 0.1,
    "ct viewer": 0.15,
    "mrt viewer": 0.18,
    "mri viewer": 0.15,
    "röntgen app": 0.15,
    radiologie: 0.12,
    "medical imaging": 0.12,
    "dental dicom": 0.15,
    "röntgen viewer": 0.2,
    "dvt viewer": 0.2,
  };
  return bids[normalize(term)] ?? fallback;
}

function discoveryKeywordBid(term: string, fallback: number): number {
  const floors: Record<string, number> = {
    // The former worldwide campaign delivered 407 installs at a $0.30 max CPT
    // from this seed. Preserve auction eligibility while the new per-tier
    // structure establishes its own delivery history.
    dicom: 0.3,
    "dicom viewer": 0.12,
    "dicom reader": 0.12,
    "radiology viewer": 0.12,
    "medical imaging": 0.12,
    "medical imaging viewer": 0.1,
    pacs: 0.1,
    "x-ray viewer": 0.1,
    "mri viewer": 0.1,
    "ct viewer": 0.1,
  };
  return Math.max(fallback, floors[normalize(term)] ?? fallback);
}

function desiredCampaign(args: Omit<DesiredCampaign, "ref" | "status">): DesiredCampaign {
  return {
    ...args,
    ref: `campaign:${args.name}`,
    status: "PAUSED",
    countriesOrRegions: [...args.countriesOrRegions].sort(),
    keywords: args.keywords.map((keyword) => ({ ...keyword, text: normalize(keyword.text) })),
    negativeExact: unique(args.negativeExact),
  };
}

export function buildDesiredCampaigns(registry: SemanticRegistry): DesiredCampaign[] {
  if (registry.app.adamId !== MEDSCAN_APP_ID) {
    throw new Error(`Semantic Registry belongs to unexpected app ${registry.app.adamId}`);
  }
  const paid = paidStorefronts(registry);
  const bundles = geoBundles(registry, paid);
  const tierABCompetitors = unique([
    ...registry.competitorExact.tierA,
    ...registry.competitorExact.tierB,
    "3dicom mobile",
    "sidexis",
    "ondemand3d",
  ]);
  const testCompetitors = unique(registry.competitorExact.tierC_testOnly);
  const immediateReject = unique(registry.negativeExactSeed.immediateSemanticReject);
  const localByCountry = new Map<string, string[]>();
  for (const [locale, countries] of Object.entries(LANGUAGE_STOREFRONTS)) {
    const terms = registry.localeAdditionalExact[locale] ?? [];
    for (const country of countries.filter((candidate) => paid.includes(candidate))) {
      localByCountry.set(country, unique([...(localByCountry.get(country) ?? []), ...terms]));
    }
  }
  for (const [country, terms] of Object.entries(registry.countryAdditionalExact ?? {})) {
    const normalizedCountry = country.toUpperCase();
    if (!paid.includes(normalizedCountry)) continue;
    localByCountry.set(normalizedCountry, unique([
      ...(localByCountry.get(normalizedCountry) ?? []),
      ...terms,
    ]));
  }

  const result: DesiredCampaign[] = [];
  for (const bundle of bundles) {
    if (!bundle.countries.length) continue;
    const bundleLocalExact = unique(bundle.countries.flatMap((country) => localByCountry.get(country) ?? []));
    const competitors = bundle.id === "US" || bundle.id === "BR"
      ? unique([...tierABCompetitors, ...testCompetitors])
      : tierABCompetitors;
    const countryNegatives = unique(bundle.countries.flatMap(
      (country) => registry.countryNegativeExact?.[country] ?? [],
    ));
    const discoveryNegatives = unique([
      ...registry.policy.globalExact,
      ...bundleLocalExact,
      ...competitors,
      "medscan",
      ...immediateReject,
      ...countryNegatives,
    ]);

    const coreBid = bundle.bids.CORE_EXACT;
    const coreTerms = unique([
      ...registry.policy.globalExact,
      ...(["MX", "GB", "DE"].includes(bundle.id) ? bundleLocalExact : []),
    ]);
    result.push(desiredCampaign({
      name: `M26 - ${bundle.id} - CORE-EXACT`,
      portfolio: "CORE_EXACT",
      tier: bundle.tier,
      countriesOrRegions: bundle.countries,
      dailyBudgetAmount: bundle.budgets.CORE_EXACT,
      defaultBidAmount: coreBid,
      automatedKeywordsOptIn: false,
      adGroupName: "Core exact",
      keywords: coreTerms.map((text) => ({
        text,
        matchType: "EXACT",
        bidAmount: bundle.id === "US"
          ? usCoreBid(text, coreBid)
          : bundle.id === "MX"
            ? mxCoreBid(text, coreBid)
            : bundle.id === "GB"
              ? gbCoreBid(text, coreBid)
              : bundle.id === "DE"
                ? deCoreBid(text, coreBid)
                : coreBid,
        rationale: registry.policy.globalExact.map(normalize).includes(normalize(text))
          ? "Global medical core; one exact owner per paid storefront"
          : "Validated storefront-local medical intent",
      })),
      negativeExact: [],
    }));

    const broadBid = bundle.bids.DISC_BROAD;
    result.push(desiredCampaign({
      name: `M26 - ${bundle.id} - DISC-BROAD`,
      portfolio: "DISC_BROAD",
      tier: bundle.tier,
      countriesOrRegions: bundle.countries,
      dailyBudgetAmount: bundle.budgets.DISC_BROAD,
      defaultBidAmount: broadBid,
      automatedKeywordsOptIn: false,
      adGroupName: "Broad discovery",
      keywords: unique(registry.policy.globalBroad).map((text) => ({
        text,
        matchType: "BROAD",
        bidAmount: discoveryKeywordBid(text, broadBid),
        rationale: "Controlled query discovery; exact owners excluded below",
      })),
      negativeExact: discoveryNegatives,
    }));

    result.push(desiredCampaign({
      name: `M26 - ${bundle.id} - DISC-SM`,
      portfolio: "DISC_SM",
      tier: bundle.tier,
      countriesOrRegions: bundle.countries,
      dailyBudgetAmount: bundle.budgets.DISC_SM,
      defaultBidAmount: bundle.bids.DISC_SM,
      automatedKeywordsOptIn: true,
      adGroupName: "Search Match discovery",
      keywords: [],
      negativeExact: discoveryNegatives,
    }));

    const competitorBid = bundle.bids.COMP_EXACT;
    result.push(desiredCampaign({
      name: `M26 - ${bundle.id} - COMP-EXACT`,
      portfolio: "COMP_EXACT",
      tier: bundle.tier,
      countriesOrRegions: bundle.countries,
      dailyBudgetAmount: bundle.budgets.COMP_EXACT,
      defaultBidAmount: competitorBid,
      automatedKeywordsOptIn: false,
      adGroupName: "Competitor exact",
      keywords: competitors.map((text) => ({
        text,
        matchType: "EXACT",
        bidAmount: bundle.id === "US" ? usCompetitorBid(text, competitorBid) : competitorBid,
        rationale: testCompetitors.includes(text)
          ? "Tier C competitor; bounded test in US/BR only"
          : "Tier A/B or downstream-proven competitor term",
      })),
      negativeExact: [],
    }));
  }

  for (const [locale, sourceCountries] of Object.entries(LANGUAGE_STOREFRONTS)) {
    const countries = sourceCountries.filter((country) =>
      paid.includes(country) &&
      !(locale === "es" && country === "MX") &&
      !(locale === "en" && country === "GB") &&
      !(locale === "de" && country === "DE"),
    );
    const terms = unique(registry.localeAdditionalExact[locale] ?? []);
    if (!countries.length || !terms.length) continue;
    const bid = LOCAL_BIDS[locale] ?? 0.12;
    result.push(desiredCampaign({
      name: `M26 - L10N-${locale.toUpperCase()} - LOCAL-EXACT`,
      portfolio: "LOCAL_EXACT",
      tier: "LOCALIZED",
      countriesOrRegions: countries,
      dailyBudgetAmount: LOCAL_BUDGETS[locale] ?? 1,
      defaultBidAmount: bid,
      automatedKeywordsOptIn: false,
      adGroupName: `${locale} localized exact`,
      keywords: terms.map((text) => ({
        text,
        matchType: "EXACT",
        bidAmount: localizedBid(locale, text, bid),
        rationale: `Relevant ${locale} storefront-local intent; bounded exact test`,
      })),
      negativeExact: [],
    }));
  }

  // Storefront-only evidence must receive a real exact owner. Dedicated core
  // bundles (currently GB/MX/DE) already absorb their local terms; all other
  // country-only terms get a small, isolated campaign so attribution remains
  // honest and the same term is excluded from discovery in that storefront.
  for (const [rawCountry, sourceTerms] of Object.entries(registry.countryAdditionalExact ?? {})) {
    const country = rawCountry.toUpperCase();
    if (!paid.includes(country)) continue;
    const terms = unique(sourceTerms).filter((term) => !result.some((campaign) =>
      campaign.countriesOrRegions.includes(country) &&
      campaign.keywords.some((keyword) => keyword.matchType === "EXACT" && keyword.text === term),
    ));
    if (!terms.length) continue;
    const bid = 0.1;
    result.push(desiredCampaign({
      name: `M26 - ${country} - LOCAL-EXACT`,
      portfolio: "LOCAL_EXACT",
      tier: "COUNTRY_LOCAL",
      countriesOrRegions: [country],
      dailyBudgetAmount: 1,
      defaultBidAmount: bid,
      automatedKeywordsOptIn: false,
      adGroupName: `${country} local exact`,
      keywords: terms.map((text) => ({
        text,
        matchType: "EXACT",
        bidAmount: countryLocalizedBid(country, text, bid),
        rationale: `Validated ${country}-only medical intent; isolated exact test`,
      })),
      negativeExact: [],
    }));
  }

  result.push(desiredCampaign({
    name: "M26 - ALL - BRAND-EXACT",
    portfolio: "BRAND_EXACT",
    tier: "ALL_PAID",
    countriesOrRegions: paid,
    dailyBudgetAmount: 1,
    defaultBidAmount: 0.08,
    automatedKeywordsOptIn: false,
    adGroupName: "MedScan brand exact",
    keywords: [{
      text: "medscan",
      matchType: "EXACT",
      bidAmount: 0.08,
      rationale: "Brand defense across every paid storefront",
    }],
    negativeExact: [],
  }));

  return result;
}

export function findOwnershipConflicts(campaigns: DesiredCampaign[]): OwnershipConflict[] {
  const owners = new Map<string, string[]>();
  for (const campaign of campaigns) {
    for (const country of campaign.countriesOrRegions) {
      for (const keyword of campaign.keywords) {
        const key = `${country}\u0000${normalize(keyword.text)}\u0000${keyword.matchType}`;
        owners.set(key, [...(owners.get(key) ?? []), campaign.name]);
      }
    }
  }
  return [...owners.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([key, names]) => {
      const [country = "", term = "", matchType = "EXACT"] = key.split("\u0000");
      return { country, term, matchType: matchType as MatchType, owners: names };
    });
}

function desiredTargets(keyword: RemoteKeyword, campaign: RemoteCampaign, desired: DesiredCampaign[]): DesiredCampaign[] {
  const geos = campaign.countriesOrRegions ?? [];
  return desired.filter((candidate) =>
    intersection(candidate.countriesOrRegions, geos) &&
    candidate.keywords.some((item) => item.matchType === keyword.matchType && normalize(item.text) === normalize(keyword.text)),
  );
}

export function buildRebuildPlan(
  registry: SemanticRegistry,
  current: RemoteCampaign[],
  revenueSignals: RevenueSignal[],
): RebuildPlan {
  const desiredCampaigns = buildDesiredCampaigns(registry);
  const paid = paidStorefronts(registry);
  const revenueByKeyword = new Map(revenueSignals.map((row) => [row.keywordId, row]));
  const legacyKeywords: RebuildPlan["legacyKeywords"] = [];

  for (const campaign of current.filter((item) => item.adamId === MEDSCAN_APP_ID)) {
    for (const adGroup of campaign.adGroups) {
      for (const keyword of adGroup.keywords.filter((item) => !item.deleted && item.status !== "PAUSED")) {
        const targets = desiredTargets(keyword, campaign, desiredCampaigns);
        const economics = revenueByKeyword.get(keyword.id) ?? null;
        const proven = Boolean(economics && (economics.trials > 0 || economics.paid > 0 || economics.revenueUsd > 0));
        legacyKeywords.push({
          action: targets.length || proven ? "KEEP_UNTIL_CUTOVER" : "PAUSE_AT_CUTOVER",
          campaignId: campaign.id,
          campaignName: campaign.name,
          adGroupId: adGroup.id,
          keywordId: keyword.id,
          text: keyword.text,
          matchType: keyword.matchType,
          bidAmount: Number.isFinite(Number(keyword.bidAmount?.amount)) ? Number(keyword.bidAmount?.amount) : null,
          countriesOrRegions: [...(campaign.countriesOrRegions ?? [])],
          migrationTargets: targets.map((target) => target.name),
          economics,
          reason: targets.length
            ? "A clean owner exists in desired state; retain only until verified handoff"
            : proven
              ? "Downstream signal exists but the term needs explicit semantic routing before cutover"
              : "No desired owner and no downstream proof; pause with its legacy campaign",
        });
      }
    }
  }

  const errors: string[] = [];
  const desiredGeoSet = new Set(
    desiredCampaigns
      .filter((campaign) => ["CORE_EXACT", "DISC_BROAD", "DISC_SM", "COMP_EXACT"].includes(campaign.portfolio))
      .flatMap((campaign) => campaign.countriesOrRegions),
  );
  for (const country of paid) {
    if (!desiredGeoSet.has(country)) errors.push(`Paid storefront ${country} is missing from geo bundles`);
  }
  for (const country of desiredGeoSet) {
    if (!paid.includes(country)) errors.push(`Blocked or unknown storefront ${country} is present in desired state`);
  }
  const totalDailyBudgetUsd = desiredCampaigns.reduce((sum, campaign) => sum + campaign.dailyBudgetAmount, 0);
  if (totalDailyBudgetUsd !== TARGET_DAILY_BUDGET_USD) {
    errors.push(`Desired daily budget ${totalDailyBudgetUsd} != ${TARGET_DAILY_BUDGET_USD}`);
  }
  const ownershipConflicts = findOwnershipConflicts(desiredCampaigns);
  if (ownershipConflicts.length) errors.push(`Desired state has ${ownershipConflicts.length} ownership conflicts`);
  if (desiredCampaigns.some((campaign) => campaign.status !== "PAUSED")) {
    errors.push("Every new campaign must be created PAUSED");
  }

  return {
    schemaVersion: 1,
    mode: "DRY_RUN_ONLY",
    appId: MEDSCAN_APP_ID,
    targetDailyBudgetUsd: TARGET_DAILY_BUDGET_USD,
    desiredCampaigns,
    legacyKeywords,
    legacyCampaignCutover: current
      .filter((campaign) => campaign.adamId === MEDSCAN_APP_ID && campaign.status !== "PAUSED")
      .map((campaign) => ({
        action: "PAUSE_AFTER_REMOTE_READBACK",
        campaignId: campaign.id,
        campaignName: campaign.name,
        countriesOrRegions: [...(campaign.countriesOrRegions ?? [])],
        currentStatus: campaign.status ?? null,
      })),
    ambiguousNegativeReview: unique(
      registry.negativeExactSeed.requireAtLeast50ImpressionsAndZeroInstallsOrManualSerpReview,
    ),
    validation: {
      paidStorefrontCount: paid.length,
      cnExcluded: !paid.includes("CN"),
      totalDailyBudgetUsd,
      ownershipConflicts,
      errors,
    },
  };
}
