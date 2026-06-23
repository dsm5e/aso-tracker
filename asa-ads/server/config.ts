import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface AsaConfig {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKeyPem: string;
  orgId: string;
  apiBaseUrl: string;
  tokenUrl: string;
  tokenAudience: string;
}

export interface AscConfig {
  keyId: string;
  issuerId: string;
  privateKeyPem: string;
  vendorNumber: string;
}

export interface AppConfig {
  asa: AsaConfig;
  asc: AscConfig;
  port: number;
  dataDir: string;
  /** Per-keyword revenue Cloud Function URL — real per-keyword revenue
   * (deterministic AdServices attribution × subscription revenue). Optional:
   * when unset the ROI engine stays on the country-average estimate. */
  keywordRevenueFnUrl?: string;
  /** Optional shared secret if the keyword-revenue function is locked. */
  keywordRevenuePullToken?: string;
  /** App slug the keyword-revenue function expects in its `app` query param. */
  keywordRevenueAppSlug?: string;
  /** Geo-level revenue Cloud Function — real revenue aggregated by store
   * country (e.g. a subscription event log). Feeds the geo-level ROAS view. */
  geoRevenueFnUrl?: string;
  /** ?key= shared secret for the geo-revenue function. */
  geoRevenueKey?: string;
}

/** Apple adamId of the app whose revenue is reported at geo (country) grain.
 *  Set via env; 0 disables the geo-revenue cross-match. */
export const GEO_REVENUE_APP_ID = Number(process.env.GEO_REVENUE_APP_ID ?? 0);
/** Apple adamId of the app with real per-keyword revenue (AdServices attribution),
 *  aggregated to country grain for the geo ROAS view. 0 disables it. */
export const KEYWORD_REVENUE_APP_ID = Number(process.env.KEYWORD_REVENUE_APP_ID ?? 0);

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function readPem(path: string): string {
  return readFileSync(resolve(path), "utf-8");
}

export function loadConfig(): AppConfig {
  return {
    asa: {
      clientId: need("ASA_CLIENT_ID"),
      teamId: need("ASA_TEAM_ID"),
      keyId: need("ASA_KEY_ID"),
      privateKeyPem: readPem(need("ASA_PRIVATE_KEY_PATH")),
      orgId: need("ASA_ORG_ID"),
      apiBaseUrl: "https://api.searchads.apple.com/api/v5",
      tokenUrl: "https://appleid.apple.com/auth/oauth2/token",
      tokenAudience: "https://appleid.apple.com",
    },
    asc: {
      keyId: need("ASC_KEY_ID"),
      issuerId: need("ASC_ISSUER_ID"),
      privateKeyPem: readPem(need("ASC_PRIVATE_KEY_PATH")),
      vendorNumber: need("ASC_VENDOR_NUMBER"),
    },
    port: Number(process.env.PORT ?? 5181),
    dataDir: process.env.DATA_DIR ?? "./data",
    keywordRevenueFnUrl: process.env.KEYWORD_REVENUE_FN_URL,
    keywordRevenuePullToken: process.env.KEYWORD_REVENUE_KEY,
    keywordRevenueAppSlug: process.env.KEYWORD_REVENUE_APP_SLUG,
    geoRevenueFnUrl: process.env.GEO_REVENUE_FN_URL,
    geoRevenueKey: process.env.GEO_REVENUE_KEY,
  };
}
