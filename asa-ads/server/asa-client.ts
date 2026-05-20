import { importPKCS8, SignJWT, type KeyLike } from "jose";
import { request } from "undici";
import type { AsaConfig } from "./config.ts";

const REFRESH_SKEW_SECONDS = 30;
const ASSERTION_LIFETIME_SECONDS = 60 * 60 * 24 * 180;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

export class AsaApiError extends Error {
  constructor(message: string, public status: number, public body: string) {
    super(message);
  }
}

export class AsaClient {
  private cached?: CachedToken;
  private keyPromise?: Promise<KeyLike | Uint8Array>;
  private inflight?: Promise<string>;

  constructor(private cfg: AsaConfig) {}

  private getKey(): Promise<KeyLike | Uint8Array> {
    if (!this.keyPromise) {
      this.keyPromise = importPKCS8(this.cfg.privateKeyPem, "ES256");
    }
    return this.keyPromise;
  }

  private async signAssertion(): Promise<string> {
    const key = await this.getKey();
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.cfg.keyId, typ: "JWT" })
      .setIssuer(this.cfg.teamId)
      .setSubject(this.cfg.clientId)
      .setAudience(this.cfg.tokenAudience)
      .setIssuedAt(now)
      .setExpirationTime(now + ASSERTION_LIFETIME_SECONDS)
      .sign(key);
  }

  private async exchange(): Promise<CachedToken> {
    const assertion = await this.signAssertion();
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.cfg.clientId,
      client_secret: assertion,
      scope: "searchadsorg",
    });
    const res = await request(this.cfg.tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        host: new URL(this.cfg.tokenUrl).host,
        accept: "application/json",
      },
      body: body.toString(),
    });
    const text = await res.body.text();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new AsaApiError(`OAuth ${res.statusCode}`, res.statusCode, text);
    }
    const parsed = JSON.parse(text) as TokenResponse;
    return {
      accessToken: parsed.access_token,
      expiresAt: Date.now() + (parsed.expires_in - REFRESH_SKEW_SECONDS) * 1000,
    };
  }

  async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.accessToken;
    }
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        this.cached = await this.exchange();
        return this.cached.accessToken;
      } finally {
        this.inflight = undefined;
      }
    })();
    return this.inflight;
  }

  async req<T = unknown>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    opts: { body?: unknown; query?: Record<string, string | number> } = {},
  ): Promise<T> {
    const token = await this.token();
    const url = new URL(`${this.cfg.apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "x-ap-context": `orgId=${this.cfg.orgId}`,
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers["content-type"] = "application/json";
    }
    const res = await request(url.toString(), { method, headers, body });
    const text = await res.body.text();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new AsaApiError(`${method} ${path} ${res.statusCode}: ${text.slice(0, 300)}`, res.statusCode, text);
    }
    if (res.statusCode === 204 || !text) return null as T;
    return JSON.parse(text) as T;
  }

  // ─── High-level methods ─────────────────────────────────────────────

  async listCampaigns(): Promise<RawCampaign[]> {
    const r = await this.req<{ data: RawCampaign[] }>("GET", "/campaigns", { query: { limit: 1000 } });
    return r.data;
  }

  async listAdGroups(campaignId: number): Promise<RawAdGroup[]> {
    const r = await this.req<{ data: RawAdGroup[] }>("GET", `/campaigns/${campaignId}/adgroups`, { query: { limit: 1000 } });
    return r.data;
  }

  async listKeywords(campaignId: number, adGroupId: number): Promise<RawKeyword[]> {
    const r = await this.req<{ data: RawKeyword[] }>("GET", `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords`, { query: { limit: 1000 } });
    return r.data;
  }

  async campaignReport(startDate: string, endDate: string): Promise<RawCampaignReport[]> {
    const r = await this.req<{ data: { reportingDataResponse: { row: RawCampaignReport[] } } }>(
      "POST",
      "/reports/campaigns",
      {
        body: {
          startTime: startDate,
          endTime: endDate,
          granularity: "DAILY",
          returnRowTotals: true,
          returnRecordsWithNoMetrics: true,
          selector: {
            orderBy: [{ field: "localSpend", sortOrder: "DESCENDING" }],
            pagination: { limit: 1000 },
          },
        },
      },
    );
    return r.data.reportingDataResponse.row;
  }

  async keywordReport(campaignId: number, startDate: string, endDate: string): Promise<RawKeywordReport[]> {
    const r = await this.req<{ data: { reportingDataResponse: { row: RawKeywordReport[] } } }>(
      "POST",
      `/reports/campaigns/${campaignId}/keywords`,
      {
        body: {
          startTime: startDate,
          endTime: endDate,
          granularity: "DAILY",
          returnRowTotals: true,
          selector: {
            orderBy: [{ field: "localSpend", sortOrder: "DESCENDING" }],
            pagination: { limit: 1000 },
          },
        },
      },
    );
    return r.data.reportingDataResponse.row;
  }

  async searchTermReport(campaignId: number, startDate: string, endDate: string): Promise<RawSearchTermReport[]> {
    // searchTerms reports do not allow both granularity AND returnRowTotals — pick granularity only
    const r = await this.req<{ data: { reportingDataResponse: { row: RawSearchTermReport[] } } }>(
      "POST",
      `/reports/campaigns/${campaignId}/searchterms`,
      {
        body: {
          startTime: startDate,
          endTime: endDate,
          granularity: "DAILY",
          timeZone: "ORTZ",
          selector: {
            orderBy: [{ field: "impressions", sortOrder: "DESCENDING" }],
            pagination: { limit: 1000 },
          },
        },
      },
    );
    return r.data.reportingDataResponse.row;
  }

  // ─── Mutations ──────────────────────────────────────────────────────

  async updateKeywordBid(campaignId: number, adGroupId: number, keywordId: number, amount: string): Promise<void> {
    await this.req("PUT", `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`, {
      body: [{ id: keywordId, bidAmount: { amount, currency: "USD" } }],
    });
  }

  async updateAdGroupDefaultBid(campaignId: number, adGroupId: number, amount: string): Promise<void> {
    await this.req("PUT", `/campaigns/${campaignId}/adgroups/${adGroupId}`, {
      body: { defaultBidAmount: { amount, currency: "USD" } },
    });
  }

  async addCampaignNegative(campaignId: number, term: string, matchType: "BROAD" | "EXACT" = "EXACT"): Promise<{ id: number }> {
    const r = await this.req<{ data: Array<{ id: number }> }>(
      "POST",
      `/campaigns/${campaignId}/negativekeywords/bulk`,
      { body: [{ text: term, matchType }] },
    );
    return r.data[0];
  }

  async pauseCampaign(campaignId: number): Promise<void> {
    await this.req("PUT", `/campaigns/${campaignId}`, { body: { campaign: { status: "PAUSED" } } });
  }

  async resumeCampaign(campaignId: number): Promise<void> {
    await this.req("PUT", `/campaigns/${campaignId}`, { body: { campaign: { status: "ENABLED" } } });
  }

  async updateCampaignDailyBudget(campaignId: number, amount: string): Promise<void> {
    await this.req("PUT", `/campaigns/${campaignId}`, {
      body: { campaign: { dailyBudgetAmount: { amount, currency: "USD" } } },
    });
  }

  async pauseKeyword(campaignId: number, adGroupId: number, keywordId: number): Promise<void> {
    await this.req("PUT", `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`, {
      body: [{ id: keywordId, status: "PAUSED" }],
    });
  }
}

// ─── Raw API types ────────────────────────────────────────────────────

export interface RawCampaign {
  id: number;
  name: string;
  adamId: number;
  status: string;
  servingStatus: string;
  displayStatus: string;
  countriesOrRegions: string[];
  dailyBudgetAmount: { amount: string; currency: string };
  budgetAmount: { amount: string; currency: string };
  biddingStrategy: string;
  targetCpa: { amount: string } | null;
  startTime: string;
  endTime: string | null;
  modificationTime: string;
}

export interface RawAdGroup {
  id: number;
  campaignId: number;
  name: string;
  defaultBidAmount: { amount: string };
  status: string;
  cpaGoal: { amount: string } | null;
}

export interface RawKeyword {
  id: number;
  adGroupId: number;
  campaignId: number;
  text: string;
  matchType: "EXACT" | "BROAD";
  bidAmount: { amount: string };
  status: "ACTIVE" | "PAUSED";
  deleted: boolean;
}

export interface ReportTotals {
  localSpend: { amount: string };
  impressions: number;
  taps: number;
  totalInstalls: number;
  tapInstalls: number;
  ttr: number;
  avgCPT: { amount: string };
  totalAvgCPI: { amount: string };
  totalInstallRate: number;
}

export interface RawCampaignReport {
  metadata: { campaignId: number; campaignName: string; countriesOrRegions: string[] };
  total: ReportTotals;
  granularity: Array<ReportTotals & { date: string }>;
}

export interface RawKeywordReport {
  metadata: { keywordId: number; keyword: string; matchType: string; adGroupId: number; campaignId: number; bidAmount?: { amount: string } };
  total: ReportTotals;
  granularity: Array<ReportTotals & { date: string }>;
}

export interface RawSearchTermReport {
  metadata: { searchTermText: string; searchTermSource: string; keywordId?: number; matchType?: string; campaignId: number };
  total: ReportTotals;
  granularity: Array<ReportTotals & { date: string }>;
}
