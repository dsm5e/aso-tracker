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
  /** asaRevenueByKeyword Cloud Function URL — real per-keyword ASA revenue
   * (deterministic AdServices attribution × Adapty revenue). Optional: when
   * unset the ROI engine stays on the country-average estimate. */
  asaRevenueFnUrl?: string;
  /** Optional shared secret if the function is locked with ASA_PULL_TOKEN. */
  asaRevenuePullToken?: string;
  /** elaraRevenueByCountry Cloud Function — geo-level real revenue for Elara
   * (Adapty event log aggregated by store country). Feeds geo-level ROAS. */
  elaraRevenueFnUrl?: string;
  /** ?key= for the Elara revenue function (shared ADAPTY_WEBHOOK_TOKEN). */
  elaraRevenueKey?: string;
}

/** Apple adamId for Elara — its revenue is geo-level (no per-keyword attribution yet). */
export const ELARA_APP_ID = 6771391236;

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
    asaRevenueFnUrl: process.env.ASA_REVENUE_FN_URL
      ?? "https://us-central1-dream-journal-by-nomle.cloudfunctions.net/asaRevenueByKeyword",
    asaRevenuePullToken: process.env.ASA_PULL_TOKEN,
    elaraRevenueFnUrl: process.env.ELARA_REVENUE_FN_URL
      ?? "https://us-central1-elara-16e09.cloudfunctions.net/elaraRevenueByCountry",
    elaraRevenueKey: process.env.ELARA_REVENUE_KEY,
  };
}
