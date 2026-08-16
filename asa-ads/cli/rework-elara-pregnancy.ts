import "dotenv/config";
import { loadConfig } from "../server/config.ts";
import { AsaClient } from "../server/asa-client.ts";

const APP_ID = 6771391236;
const CORE_NAME = "Elara — Pregnancy Core — Cheap Geo v1";
const CORE_COUNTRIES = ["BR", "ID", "MX", "ZA", "IN", "CL", "PH", "SA"];
const DAILY_BUDGET = "2";
const BID = "0.10";
const CALENDAR_CAMPAIGN_ID = 2144362055;
const CALENDAR_AD_GROUP_ID = 2150049875;

const LEGACY_GENERIC_IDS = [
  2144238387, // IN v3
  2144237887, // ZA v3
  2144191949, // CL v3
  2144191265, // PH v3
  2144191049, // PT v3
  2144190958, // ID v3
  2144190853, // KW v3
  2144189481, // SA v3
  2144070742, // BR v2
  2144070546, // TR v2
  2144069671, // MX v2
  2144067181, // UA v2
];

const coreExact = [
  "pregnancy",
  "pregnancy app",
  "pregnancy care",
  "pregnancy tracker",
  "aplikasi kehamilan",
  "jurnal kehamilan",
  "pelacak kehamilan",
  "acompanhar gravidez",
  "app gravidez",
  "diário de gravidez",
  "gravidez",
  "minha gravidez",
  "pre natal",
  "gestação",
  "gebelik",
  "gebelik takibi",
  "hamilelik",
  "hamilelik takibi",
  "hamilelik uygulaması",
  "app embarazo",
  "embarazo",
  "embarazo del control",
  "вагітність",
  "моя вагітність",
];

const coreBroad = [
  "pregnancy tracker",
  "pregnancy app",
  "aplikasi kehamilan",
  "pelacak kehamilan",
  "gravidez",
  "gestante",
  "app gravidez",
  "gestação",
  "gebelik takibi",
  "hamilelik uygulaması",
  "app embarazo",
  "embarazo",
  "вагітність",
];

const calendarExact = [
  "pregnancy calendar",
  "due date calculator",
  "pregnancy week by week",
  "kalkulator hpl",
  "kalkulator kehamilan",
  "kehamilan minggu ke minggu",
  "calculadora gravidez",
  "gravidez semana a semana",
  "semanas de gravidez",
  "gebelik hesaplama",
  "calculadora embarazo",
  "embarazo semana a semana",
  "вагітність по тижнях",
  "дата пологів",
  "календар вагітності",
];

const calendarBroad = [
  "pregnancy calendar",
  "due date calculator",
  "pregnancy week by week",
  "kalkulator hpl",
  "kalkulator kehamilan",
  "kehamilan minggu ke minggu",
  "calculadora gravidez",
  "gravidez semana a semana",
  "gebelik hesaplama",
  "calculadora embarazo",
  "embarazo semana a semana",
  "вагітність по тижнях",
  "дата пологів",
  "календар вагітності",
];

const coreBroadNegatives = [
  "pregnancy calendar",
  "due date calculator",
  "pregnancy week by week",
  "kick counter",
  "baby kicks",
  "contraction timer",
  "dad pregnancy app",
  "expecting dad",
  "kalkulator hpl",
  "calculadora gravidez",
  "gebelik hesaplama",
  "calculadora embarazo",
  "календар вагітності",
  "дата пологів",
  "лічильник поштовхів",
  "перейми",
];

const calendarExactNegatives = [
  "pregnancy",
  "pregnancy app",
  "pregnancy tracker",
  "gravidez",
  "app gravidez",
  "gestação",
  "aplikasi kehamilan",
  "pelacak kehamilan",
  "gebelik",
  "gebelik takibi",
  "hamilelik",
  "app embarazo",
  "embarazo",
  "вагітність",
];

type RecordLike = Record<string, any>;
const unwrap = <T = RecordLike>(value: any): T => (value?.data ?? value) as T;
const normalized = (value: string) => value.trim().toLocaleLowerCase();

async function ensureAdGroup(
  asa: AsaClient,
  campaignId: number,
  name: string,
): Promise<RecordLike> {
  const groups = await asa.listAdGroups(campaignId);
  let group = groups.find((candidate) => candidate.name === name);
  if (!group) {
    group = unwrap(
      await asa.req("POST", `/campaigns/${campaignId}/adgroups`, {
        body: {
          name,
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
  if (!group?.id || (group as RecordLike).automatedKeywordsOptIn !== false) {
    throw new Error(`${name}: invalid ad group`);
  }
  return group;
}

async function ensureKeywords(
  asa: AsaClient,
  campaignId: number,
  adGroupId: number,
  texts: string[],
  matchType: "EXACT" | "BROAD",
): Promise<void> {
  const current = await asa.listKeywords(campaignId, adGroupId);
  const missing = texts.filter(
    (text) =>
      !current.some(
        (candidate) =>
          !candidate.deleted &&
          normalized(candidate.text) === normalized(text) &&
          candidate.matchType === matchType &&
          candidate.status === "ACTIVE",
      ),
  );
  if (!missing.length) return;
  const response = unwrap<RecordLike[]>(
    await asa.req(
      "POST",
      `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`,
      {
        body: missing.map((text) => ({
          text,
          matchType,
          bidAmount: { amount: BID, currency: "USD" },
        })),
      },
    ),
  );
  const failures = response.filter((item) => item?.error);
  if (failures.length) throw new Error(`Keyword failures: ${JSON.stringify(failures)}`);
}

async function ensureNegative(
  asa: AsaClient,
  campaignId: number,
  text: string,
  matchType: "EXACT" | "BROAD",
): Promise<void> {
  const response = unwrap<RecordLike[]>(
    await asa.req("GET", `/campaigns/${campaignId}/negativekeywords`, {
      query: { limit: 1000 },
    }),
  );
  if (
    response.some(
      (candidate) =>
        !candidate.deleted &&
        normalized(candidate.text) === normalized(text) &&
        candidate.matchType === matchType,
    )
  ) {
    return;
  }
  await asa.addCampaignNegative(campaignId, text, matchType);
}

async function main() {
  if (!process.argv.includes("--apply")) {
    throw new Error("Refusing to mutate Apple Ads without --apply");
  }

  const asa = new AsaClient(loadConfig().asa);
  const baseline = await asa.listCampaigns();
  const calendar = baseline.find((candidate) => candidate.id === CALENDAR_CAMPAIGN_ID);
  if (!calendar || calendar.adamId !== APP_ID || (calendar as RecordLike).deleted) {
    throw new Error("Calendar campaign ownership check failed");
  }

  const legacy = LEGACY_GENERIC_IDS.map((id) =>
    baseline.find((candidate) => candidate.id === id),
  );
  if (
    legacy.some(
      (campaign) =>
        !campaign ||
        campaign.adamId !== APP_ID ||
        campaign.status !== "PAUSED" ||
        (campaign as RecordLike).deleted,
    )
  ) {
    throw new Error("Legacy campaign ownership/status check failed");
  }

  let core = baseline.find(
    (candidate) => candidate.adamId === APP_ID && candidate.name === CORE_NAME,
  );
  if (!core) {
    core = unwrap(
      await asa.req("POST", "/campaigns", {
        body: {
          name: CORE_NAME,
          billingEvent: "TAPS",
          dailyBudgetAmount: { amount: DAILY_BUDGET, currency: "USD" },
          adamId: APP_ID,
          countriesOrRegions: CORE_COUNTRIES,
          supplySources: ["APPSTORE_SEARCH_RESULTS"],
          adChannelType: "SEARCH",
          biddingStrategy: "MANUAL_CPT",
          status: "PAUSED",
        },
      }),
    );
  }
  if (!core?.id || core.adamId !== APP_ID) throw new Error("Core creation failed");
  const coreId = Number(core.id);

  const exactGroup = await ensureAdGroup(asa, coreId, "Core Exact");
  const broadGroup = await ensureAdGroup(asa, coreId, "Discovery Broad");
  await ensureKeywords(asa, coreId, Number(exactGroup.id), coreExact, "EXACT");
  await ensureKeywords(asa, coreId, Number(broadGroup.id), coreBroad, "BROAD");
  for (const text of coreBroadNegatives) {
    await ensureNegative(asa, coreId, text, "BROAD");
  }
  await ensureNegative(asa, coreId, "meu rookery", "EXACT");

  await ensureKeywords(
    asa,
    CALENDAR_CAMPAIGN_ID,
    CALENDAR_AD_GROUP_ID,
    calendarExact,
    "EXACT",
  );
  await ensureKeywords(
    asa,
    CALENDAR_CAMPAIGN_ID,
    CALENDAR_AD_GROUP_ID,
    calendarBroad,
    "BROAD",
  );

  const wantedCalendar = new Set([
    ...calendarExact.map((text) => `EXACT:${normalized(text)}`),
    ...calendarBroad.map((text) => `BROAD:${normalized(text)}`),
  ]);
  const currentCalendar = await asa.listKeywords(
    CALENDAR_CAMPAIGN_ID,
    CALENDAR_AD_GROUP_ID,
  );
  for (const keyword of currentCalendar) {
    const key = `${keyword.matchType}:${normalized(keyword.text)}`;
    if (!keyword.deleted && keyword.status === "ACTIVE" && !wantedCalendar.has(key)) {
      await asa.pauseKeyword(
        CALENDAR_CAMPAIGN_ID,
        CALENDAR_AD_GROUP_ID,
        keyword.id,
      );
    }
  }
  for (const text of calendarExactNegatives) {
    await ensureNegative(asa, CALENDAR_CAMPAIGN_ID, text, "EXACT");
  }

  await asa.resumeCampaign(coreId);

  const afterEnable = await asa.listCampaigns();
  const liveCore = afterEnable.find((candidate) => candidate.id === coreId);
  const liveCalendar = afterEnable.find(
    (candidate) => candidate.id === CALENDAR_CAMPAIGN_ID,
  );
  if (
    liveCore?.status !== "ENABLED" ||
    liveCore.servingStatus !== "RUNNING" ||
    liveCalendar?.status !== "ENABLED" ||
    liveCalendar.servingStatus !== "RUNNING"
  ) {
    throw new Error("Live verification failed; legacy campaigns were not deleted");
  }

  for (const id of LEGACY_GENERIC_IDS) {
    await asa.req("DELETE", `/campaigns/${id}`);
  }

  const finalCampaigns = await asa.listCampaigns();
  const finalCore = finalCampaigns.find((candidate) => candidate.id === coreId);
  const finalCalendarKeywords = await asa.listKeywords(
    CALENDAR_CAMPAIGN_ID,
    CALENDAR_AD_GROUP_ID,
  );
  const finalGroups = await asa.listAdGroups(coreId);
  const exact = finalGroups.find((group) => group.name === "Core Exact");
  const broad = finalGroups.find((group) => group.name === "Discovery Broad");
  const exactKeywords = exact ? await asa.listKeywords(coreId, exact.id) : [];
  const broadKeywords = broad ? await asa.listKeywords(coreId, broad.id) : [];

  console.log(
    JSON.stringify(
      {
        core: {
          id: coreId,
          status: finalCore?.status,
          servingStatus: finalCore?.servingStatus,
          countries: finalCore?.countriesOrRegions,
          dailyBudget: finalCore?.dailyBudgetAmount,
          exactAdGroupId: exact?.id,
          broadAdGroupId: broad?.id,
          activeExact: exactKeywords.filter((keyword) => keyword.status === "ACTIVE").length,
          activeBroad: broadKeywords.filter((keyword) => keyword.status === "ACTIVE").length,
        },
        calendar: {
          id: CALENDAR_CAMPAIGN_ID,
          activeExact: finalCalendarKeywords.filter(
            (keyword) => keyword.status === "ACTIVE" && keyword.matchType === "EXACT",
          ).length,
          activeBroad: finalCalendarKeywords.filter(
            (keyword) => keyword.status === "ACTIVE" && keyword.matchType === "BROAD",
          ).length,
        },
        deletedLegacy: LEGACY_GENERIC_IDS.map((id) => ({
          id,
          stillListed: finalCampaigns.some((campaign) => campaign.id === id),
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
