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
}

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
  };
}
