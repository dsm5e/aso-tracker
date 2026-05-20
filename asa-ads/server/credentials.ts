import { getDb } from "./db.ts";

export type Provider = "asa" | "asc";

const ASA_FIELDS = ["client_id", "team_id", "key_id", "private_key", "org_id"] as const;
const ASC_FIELDS = ["key_id", "issuer_id", "private_key", "vendor_number"] as const;

export type AsaField = (typeof ASA_FIELDS)[number];
export type AscField = (typeof ASC_FIELDS)[number];

const SECRET_FIELDS = new Set(["private_key"]);

interface StoredCred {
  field: string;
  value: string;
  updated_at: string;
}

export function getCredentials(provider: Provider): Record<string, string> {
  const rows = getDb().prepare(`SELECT field, value FROM credentials WHERE provider = ?`).all(provider) as StoredCred[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.field] = r.value;
  return out;
}

function envValueFor(provider: Provider, field: string): string | undefined {
  const map: Record<string, string> = provider === "asa" ? {
    client_id: process.env.ASA_CLIENT_ID ?? "",
    team_id: process.env.ASA_TEAM_ID ?? "",
    key_id: process.env.ASA_KEY_ID ?? "",
    org_id: process.env.ASA_ORG_ID ?? "",
    private_key: process.env.ASA_PRIVATE_KEY_PATH ? "[loaded from file]" : "",
  } : {
    key_id: process.env.ASC_KEY_ID ?? "",
    issuer_id: process.env.ASC_ISSUER_ID ?? "",
    vendor_number: process.env.ASC_VENDOR_NUMBER ?? "",
    private_key: process.env.ASC_PRIVATE_KEY_PATH ? "[loaded from file]" : "",
  };
  const v = map[field];
  return v ? v : undefined;
}

export function getCredentialsMasked(provider: Provider): Record<string, { present: boolean; preview: string; source: "db" | "env" | "none"; updated_at?: string }> {
  const rows = getDb().prepare(`SELECT field, value, updated_at FROM credentials WHERE provider = ?`).all(provider) as StoredCred[];
  const map = new Map(rows.map((r) => [r.field, r]));
  const fields = provider === "asa" ? ASA_FIELDS : ASC_FIELDS;
  const out: Record<string, { present: boolean; preview: string; source: "db" | "env" | "none"; updated_at?: string }> = {};
  for (const f of fields) {
    const r = map.get(f);
    if (r && r.value) {
      const v = r.value;
      let preview: string;
      if (SECRET_FIELDS.has(f)) {
        preview = `••• (${v.length} chars, ends ${v.replace(/\n+/g, "").slice(-6)})`;
      } else if (v.length > 10) {
        preview = `${v.slice(0, 6)}…${v.slice(-4)}`;
      } else {
        preview = v;
      }
      out[f] = { present: true, preview, source: "db", updated_at: r.updated_at };
    } else {
      const env = envValueFor(provider, f);
      if (env) {
        const preview = SECRET_FIELDS.has(f) ? env : env.length > 10 ? `${env.slice(0, 6)}…${env.slice(-4)}` : env;
        out[f] = { present: true, preview, source: "env" };
      } else {
        out[f] = { present: false, preview: "", source: "none" };
      }
    }
  }
  return out;
}

export function setCredentials(provider: Provider, patch: Record<string, string | null>): void {
  const db = getDb();
  const ts = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO credentials (provider, field, value, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(provider, field) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const del = db.prepare(`DELETE FROM credentials WHERE provider = ? AND field = ?`);
  db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") {
        del.run(provider, k);
      } else {
        upsert.run(provider, k, v, ts);
      }
    }
  })();
}

/** Build config object, preferring DB credentials over .env values. */
export function resolveAsaConfig(envFallback: {
  clientId?: string; teamId?: string; keyId?: string; privateKeyPem?: string; orgId?: string;
}): { clientId: string; teamId: string; keyId: string; privateKeyPem: string; orgId: string } | null {
  const db = getCredentials("asa");
  const clientId = db.client_id ?? envFallback.clientId ?? "";
  const teamId = db.team_id ?? envFallback.teamId ?? "";
  const keyId = db.key_id ?? envFallback.keyId ?? "";
  const privateKeyPem = db.private_key ?? envFallback.privateKeyPem ?? "";
  const orgId = db.org_id ?? envFallback.orgId ?? "";
  if (!clientId || !teamId || !keyId || !privateKeyPem || !orgId) return null;
  return { clientId, teamId, keyId, privateKeyPem, orgId };
}

export function resolveAscConfig(envFallback: {
  keyId?: string; issuerId?: string; privateKeyPem?: string; vendorNumber?: string;
}): { keyId: string; issuerId: string; privateKeyPem: string; vendorNumber: string } | null {
  const db = getCredentials("asc");
  const keyId = db.key_id ?? envFallback.keyId ?? "";
  const issuerId = db.issuer_id ?? envFallback.issuerId ?? "";
  const privateKeyPem = db.private_key ?? envFallback.privateKeyPem ?? "";
  const vendorNumber = db.vendor_number ?? envFallback.vendorNumber ?? "";
  if (!keyId || !issuerId || !privateKeyPem || !vendorNumber) return null;
  return { keyId, issuerId, privateKeyPem, vendorNumber };
}
