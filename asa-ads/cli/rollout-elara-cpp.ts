import "dotenv/config";
import { loadConfig } from "../server/config.ts";
import { AsaClient } from "../server/asa-client.ts";

const APP_ID = 6771391236;
const COUNTRIES = ["IN", "ZA", "ID", "BR", "TR", "MX", "UA"];
const DAILY_BUDGET = "2";
const BID = "0.10";
const GROUP_NAME = "Intent — Exact + Broad";
const LEGACY_CAMPAIGNS = [
  2144238387, // IN v3
  2144237887, // ZA v3
  2144190958, // ID v3
  2144070742, // BR v2
  2144070546, // TR v2
  2144069671, // MX v2
  2144067181, // UA v2
];
const BR_DISCOVERY = { campaignId: 2144070742, adGroupId: 2149677789 };

interface Intent {
  key: string;
  campaignName: string;
  creativeName: string;
  ppid: string;
  exact: string[];
  broad: string[];
}

const intents: Intent[] = [
  {
    key: "calendar",
    campaignName: "Elara — CPP Calendar — Cheap Geo v1",
    creativeName: "Elara CPP — Pregnancy Calendar",
    ppid: "a95b95f8-ec33-4f3d-9071-c7e269409306",
    exact: [
      "due date calculator", "pregnancy", "pregnancy app", "pregnancy care",
      "pregnancy tracker", "pregnancy week by week",
      "aplikasi kehamilan", "jurnal kehamilan", "kalkulator hpl",
      "kalkulator kehamilan", "kehamilan minggu ke minggu", "pelacak kehamilan",
      "acompanhar gravidez", "app gravidez", "calculadora gravidez",
      "diário de gravidez", "gravidez", "gravidez semana a semana",
      "minha gravidez", "pre natal", "semanas de gravidez", "gestação",
      "gebelik", "gebelik hesaplama", "gebelik takibi", "hamilelik",
      "hamilelik takibi", "hamilelik uygulaması",
      "app embarazo", "calculadora embarazo", "embarazo",
      "embarazo del control", "embarazo semana a semana",
      "вагітність", "вагітність по тижнях", "дата пологів",
      "календар вагітності", "моя вагітність",
    ],
    broad: [
      "pregnancy tracker", "pregnancy app", "due date calculator",
      "aplikasi kehamilan", "pelacak kehamilan", "kalkulator hpl",
      "gravidez", "gestante", "app gravidez", "gestação",
      "gebelik takibi", "hamilelik uygulaması", "gebelik hesaplama",
      "app embarazo", "embarazo semana a semana", "calculadora embarazo",
      "календар вагітності", "вагітність по тижнях", "дата пологів",
    ],
  },
  {
    key: "kick",
    campaignName: "Elara — CPP Kick Counter — Cheap Geo v1",
    creativeName: "Elara CPP — Pregnancy Kick Counter",
    ppid: "d70d2955-a958-4b44-bd80-9f27fd34d3f9",
    exact: [
      "baby kicks", "kick counter", "contador de chutes", "tekme sayacı",
      "contador de patadas", "cuenta patadas", "лічильник поштовхів",
    ],
    broad: [
      "baby kicks", "kick counter",
      "contador de chutes", "movimentos do bebê",
      "tekme sayacı", "bebek hareketleri",
      "contador de patadas", "movimientos del bebé",
      "лічильник поштовхів", "рухи дитини",
      "gerakan bayi", "penghitung tendangan bayi",
    ],
  },
  {
    key: "contractions",
    campaignName: "Elara — CPP Contraction Timer — Cheap Geo v1",
    creativeName: "Elara CPP — Contraction Timer",
    ppid: "7b38a6c5-d0b0-4f1b-8752-9852689ac862",
    exact: [
      "contraction timer", "kontraksi", "penghitung kontraksi",
      "contrações", "перейми",
    ],
    broad: [
      "contraction timer",
      "kontraksi", "penghitung kontraksi",
      "contrações", "contador de contrações",
      "sancı sayacı", "kasılma sayacı",
      "contador de contracciones", "contracciones",
      "перейми", "лічильник перейм",
    ],
  },
  {
    key: "partner",
    campaignName: "Elara — CPP Partner Mode — Cheap Geo v1",
    creativeName: "Elara CPP — Pregnancy for Dad & Partner",
    ppid: "65b1ba24-d4b6-4512-9524-e91a5909e73b",
    exact: [
      "first time dad", "dad pregnancy app", "expecting dad",
      "calon ayah", "kehamilan ayah",
      "app para o pai", "futuro papai", "gravidez casal", "gravidez papai",
      "pai de primeira viagem", "papai grávido",
      "baba adayı", "baba olmak",
      "embarazo papá", "embarazo pareja", "futuro papá",
      "вагітність для тата", "майбутній тато", "партнер вагітність",
    ],
    broad: [
      "first time dad", "dad pregnancy app", "expecting dad",
      "calon ayah", "kehamilan ayah",
      "app para o pai", "futuro papai", "gravidez casal",
      "baba adayı", "baba olmak",
      "embarazo papá", "embarazo pareja", "futuro papá",
      "вагітність для тата", "майбутній тато", "партнер вагітність",
    ],
  },
];

type RecordLike = Record<string, any>;
const unwrap = <T = RecordLike>(value: any): T => (value?.data ?? value) as T;

async function main() {
  throw new Error(
    "Superseded by cli/rework-elara-pregnancy.ts; refusing to restore the old mixed-intent structure.",
  );

  if (!process.argv.includes("--apply")) {
    console.error("Refusing to mutate Apple Ads without --apply");
    process.exit(2);
  }

  const config = loadConfig();
  const asa = new AsaClient(config.asa);
  const existingCampaigns = await asa.listCampaigns();
  const existingCreatives = unwrap<RecordLike[]>(
    await asa.req("GET", "/creatives", { query: { limit: 1000 } }),
  ).filter((creative) => creative.adamId === APP_ID);

  const created: RecordLike[] = [];

  for (const intent of intents) {
    let creative = existingCreatives.find(
      (candidate) => candidate.productPageId === intent.ppid && candidate.state === "VALID",
    );
    if (!creative) {
      creative = unwrap(
        await asa.req("POST", "/creatives", {
          body: {
            adamId: APP_ID,
            name: intent.creativeName,
            type: "CUSTOM_PRODUCT_PAGE",
            productPageId: intent.ppid,
          },
        }),
      );
      existingCreatives.push(creative);
    }
    if (!creative?.id || creative.state !== "VALID") {
      throw new Error(`${intent.key}: creative is not VALID: ${JSON.stringify(creative)}`);
    }

    let campaign = existingCampaigns.find(
      (candidate) => candidate.adamId === APP_ID && candidate.name === intent.campaignName,
    ) as RecordLike | undefined;
    if (!campaign) {
      campaign = unwrap(
        await asa.req("POST", "/campaigns", {
          body: {
            name: intent.campaignName,
            billingEvent: "TAPS",
            dailyBudgetAmount: { amount: DAILY_BUDGET, currency: "USD" },
            adamId: APP_ID,
            countriesOrRegions: COUNTRIES,
            supplySources: ["APPSTORE_SEARCH_RESULTS"],
            adChannelType: "SEARCH",
            biddingStrategy: "MANUAL_CPT",
            status: "PAUSED",
          },
        }),
      );
    }
    if (!campaign?.id) throw new Error(`${intent.key}: campaign creation returned no id`);

    const campaignId = Number(campaign.id);
    const groups = unwrap<RecordLike[]>(
      await asa.req("GET", `/campaigns/${campaignId}/adgroups`, { query: { limit: 1000 } }),
    );
    let group = groups.find((candidate) => candidate.name === GROUP_NAME);
    if (!group) {
      group = unwrap(
        await asa.req("POST", `/campaigns/${campaignId}/adgroups`, {
          body: {
            name: GROUP_NAME,
            startTime: new Date().toISOString(),
            automatedKeywordsOptIn: false,
            pricingModel: "CPC",
            defaultBidAmount: { amount: BID, currency: "USD" },
            targetingDimensions: { deviceClass: { included: ["IPHONE"] } },
            status: "ENABLED",
          },
        }),
      );
    }
    if (!group?.id || group.automatedKeywordsOptIn !== false) {
      throw new Error(`${intent.key}: invalid ad group: ${JSON.stringify(group)}`);
    }

    const adGroupId = Number(group.id);
    const currentKeywords = unwrap<RecordLike[]>(
      await asa.req(
        "GET",
        `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords`,
        { query: { limit: 1000 } },
      ),
    );
    const wanted = [
      ...intent.exact.map((text) => ({ text, matchType: "EXACT" as const })),
      ...intent.broad.map((text) => ({ text, matchType: "BROAD" as const })),
    ];
    const missing = wanted.filter(
      (keyword) =>
        !currentKeywords.some(
          (candidate) =>
            !candidate.deleted &&
            candidate.text.toLocaleLowerCase() === keyword.text.toLocaleLowerCase() &&
            candidate.matchType === keyword.matchType,
        ),
    );
    if (missing.length) {
      const response = unwrap<RecordLike[]>(
        await asa.req(
          "POST",
          `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`,
          {
            body: missing.map((keyword) => ({
              ...keyword,
              bidAmount: { amount: BID, currency: "USD" },
            })),
          },
        ),
      );
      const failures = response.filter((item) => item?.error);
      if (failures.length) {
        throw new Error(`${intent.key}: keyword failures: ${JSON.stringify(failures)}`);
      }
    }

    const ads = unwrap<RecordLike[]>(
      await asa.req(
        "GET",
        `/campaigns/${campaignId}/adgroups/${adGroupId}/ads`,
        { query: { limit: 1000 } },
      ),
    );
    let ad = ads.find(
      (candidate) => candidate.creativeId === creative.id && !candidate.deleted,
    );
    if (!ad) {
      ad = unwrap(
        await asa.req("POST", `/campaigns/${campaignId}/adgroups/${adGroupId}/ads`, {
          body: {
            creativeId: creative.id,
            name: intent.creativeName,
            status: "ENABLED",
          },
        }),
      );
    }
    if (!ad?.id || ad.status !== "ENABLED") {
      throw new Error(`${intent.key}: custom ad not enabled: ${JSON.stringify(ad)}`);
    }

    await asa.addCampaignNegative(campaignId, "meu rookery", "EXACT");
    created.push({
      intent: intent.key,
      campaignId,
      adGroupId,
      creativeId: creative.id,
      adId: ad.id,
      exact: intent.exact.length,
      broad: intent.broad.length,
    });
  }

  // Search Match must stay off even if BR legacy is later restored.
  await asa.req(
    "PUT",
    `/campaigns/${BR_DISCOVERY.campaignId}/adgroups/${BR_DISCOVERY.adGroupId}`,
    { body: { automatedKeywordsOptIn: false } },
  );

  // Enable the fully assembled CPP campaigns first.
  for (const item of created) {
    await asa.resumeCampaign(item.campaignId);
  }

  // Verify every new campaign is enabled before switching legacy traffic off.
  const afterEnable = await asa.listCampaigns();
  for (const item of created) {
    const campaign = afterEnable.find((candidate) => candidate.id === item.campaignId);
    if (!campaign || campaign.status !== "ENABLED") {
      throw new Error(`${item.intent}: campaign failed to enable`);
    }
  }

  for (const campaignId of LEGACY_CAMPAIGNS) {
    await asa.pauseCampaign(campaignId);
  }

  console.log(JSON.stringify({ created, pausedLegacy: LEGACY_CAMPAIGNS }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
