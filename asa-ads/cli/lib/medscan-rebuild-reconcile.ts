import type {
  DesiredCampaign,
  RemoteCampaign,
  RebuildPlan,
} from "./medscan-rebuild-plan.ts";

type JsonRecord = Record<string, unknown>;

export interface KeywordRemoval {
  kind: "keyword";
  campaignId: number;
  campaignName: string;
  adGroupId: number;
  id: number;
  text: string;
  matchType: string;
}

export interface NegativeRemoval {
  kind: "campaign-negative" | "adgroup-negative";
  campaignId: number;
  campaignName: string;
  adGroupId: number | null;
  id: number;
  text: string;
  matchType: string;
}

export interface StagedReconcilePlan {
  keywordRemovals: KeywordRemoval[];
  negativeRemovals: NegativeRemoval[];
  errors: string[];
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function key(value: { text?: unknown; matchType?: unknown }): string {
  return `${String(value.matchType ?? "EXACT").toUpperCase()}:${normalize(String(value.text ?? ""))}`;
}

function amount(value: unknown): number {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Number((value as JsonRecord).amount);
  }
  return Number(value);
}

function sameCountries(left: string[] | undefined, right: string[]): boolean {
  return JSON.stringify([...(left ?? [])].sort()) === JSON.stringify([...right].sort());
}

function inspectCampaign(desired: DesiredCampaign, remote: RemoteCampaign): StagedReconcilePlan {
  const errors: string[] = [];
  const keywordRemovals: KeywordRemoval[] = [];
  const negativeRemovals: NegativeRemoval[] = [];
  const groups = remote.adGroups.filter((group) => !Boolean((group as unknown as JsonRecord).deleted));

  if (remote.status !== "PAUSED") errors.push(`${desired.name}: campaign is not PAUSED`);
  if (!sameCountries(remote.countriesOrRegions, desired.countriesOrRegions)) {
    errors.push(`${desired.name}: countries differ`);
  }
  if (Math.abs(amount(remote.dailyBudgetAmount) - desired.dailyBudgetAmount) > 0.000001) {
    errors.push(`${desired.name}: daily budget differs`);
  }
  if (groups.length !== 1) errors.push(`${desired.name}: expected one live ad group, got ${groups.length}`);
  const group = groups[0];
  if (!group) return { keywordRemovals, negativeRemovals, errors };
  if (group.status !== "PAUSED") errors.push(`${desired.name}: ad group is not PAUSED`);
  if (Boolean(group.automatedKeywordsOptIn) !== desired.automatedKeywordsOptIn) {
    errors.push(`${desired.name}: Search Match differs`);
  }
  if (Math.abs(amount(group.defaultBidAmount) - desired.defaultBidAmount) > 0.000001) {
    errors.push(`${desired.name}: default bid differs`);
  }

  const liveKeywords = group.keywords.filter((keyword) => !keyword.deleted && keyword.status !== "PAUSED");
  const desiredKeywordKeys = new Set(desired.keywords.map(key));
  const liveKeywordKeys = new Set(liveKeywords.map(key));
  for (const wanted of desired.keywords) {
    const wantedKey = key(wanted);
    const found = liveKeywords.find((candidate) => key(candidate) === wantedKey);
    if (!found) {
      errors.push(`${desired.name}: missing keyword ${wantedKey}`);
    } else if (Math.abs(amount(found.bidAmount) - wanted.bidAmount) > 0.000001) {
      errors.push(`${desired.name}: bid differs for ${wantedKey}`);
    }
  }
  for (const keyword of liveKeywords) {
    if (desiredKeywordKeys.has(key(keyword))) continue;
    keywordRemovals.push({
      kind: "keyword",
      campaignId: remote.id,
      campaignName: desired.name,
      adGroupId: group.id,
      id: Number(keyword.id),
      text: String(keyword.text),
      matchType: String(keyword.matchType),
    });
  }

  const desiredNegativeKeys = new Set(desired.negativeExact.map((text) => `EXACT:${normalize(text)}`));
  const campaignNegatives = remote.negativeKeywords.filter((negative) => !Boolean((negative as JsonRecord).deleted));
  const groupNegatives = group.negativeKeywords.filter((negative) => !Boolean((negative as JsonRecord).deleted));
  const liveNegativeKeys = new Set([...campaignNegatives, ...groupNegatives].map(key));
  for (const wanted of desiredNegativeKeys) {
    if (!liveNegativeKeys.has(wanted)) errors.push(`${desired.name}: missing negative ${wanted}`);
  }
  for (const negative of campaignNegatives) {
    if (desiredNegativeKeys.has(key(negative))) continue;
    negativeRemovals.push({
      kind: "campaign-negative",
      campaignId: remote.id,
      campaignName: desired.name,
      adGroupId: null,
      id: Number((negative as JsonRecord).id),
      text: String((negative as JsonRecord).text),
      matchType: String((negative as JsonRecord).matchType ?? "EXACT"),
    });
  }
  for (const negative of groupNegatives) {
    if (desiredNegativeKeys.has(key(negative))) continue;
    negativeRemovals.push({
      kind: "adgroup-negative",
      campaignId: remote.id,
      campaignName: desired.name,
      adGroupId: group.id,
      id: Number((negative as JsonRecord).id),
      text: String((negative as JsonRecord).text),
      matchType: String((negative as JsonRecord).matchType ?? "EXACT"),
    });
  }

  if (liveKeywordKeys.size < desiredKeywordKeys.size) {
    errors.push(`${desired.name}: keyword cardinality is below desired state`);
  }
  return { keywordRemovals, negativeRemovals, errors };
}

export function buildStagedReconcilePlan(
  desired: RebuildPlan["desiredCampaigns"],
  remoteCampaigns: RemoteCampaign[],
): StagedReconcilePlan {
  const result: StagedReconcilePlan = { keywordRemovals: [], negativeRemovals: [], errors: [] };
  for (const campaign of desired) {
    const matches = remoteCampaigns.filter((candidate) =>
      candidate.name === campaign.name && !Boolean((candidate as unknown as JsonRecord).deleted));
    if (matches.length !== 1) {
      result.errors.push(`${campaign.name}: expected one live campaign, got ${matches.length}`);
      continue;
    }
    const inspected = inspectCampaign(campaign, matches[0]);
    result.keywordRemovals.push(...inspected.keywordRemovals);
    result.negativeRemovals.push(...inspected.negativeRemovals);
    result.errors.push(...inspected.errors);
  }
  return result;
}
