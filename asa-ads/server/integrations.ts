// Which integrations the studio screens need, whether they are connected, and how to
// connect them — the source of the «Подключить» gate in every product. Keys themselves
// never leave the server: the client only sees presence and a masked preview.
import { execFileSync } from "node:child_process";
import { getCredentialsMasked, type Provider } from "./credentials.ts";

interface FieldInfo { key: string; label: string; secret?: boolean; multiline?: boolean; hint: string }
interface ProviderInfo { name: string; purpose: string; where: string; fields: FieldInfo[] }

const INFO: Record<Provider, ProviderInfo> = {
  asa: {
    name: "Apple Ads",
    purpose: "ставки, показы и доля показов по ключам: все экраны Ads (матрицы, трафик, экономика)",
    where: "ads.apple.com → Account Settings → API → Create API user; Client ID, Team ID и Key ID показываются после загрузки публичного ключа",
    fields: [
      { key: "client_id", label: "Client ID", hint: "SEARCHADS.…" },
      { key: "team_id", label: "Team ID", hint: "SEARCHADS.…" },
      { key: "key_id", label: "Key ID", hint: "UUID ключа" },
      { key: "org_id", label: "Org ID", hint: "число, Account Settings → Org" },
      { key: "private_key", label: "Private key (PEM)", secret: true, multiline: true, hint: "-----BEGIN EC PRIVATE KEY----- …" },
    ],
  },
  asc: {
    name: "App Store Connect",
    purpose: "показы и конверсия страницы App Store, продажи: Воронка, Эксперименты",
    where: "appstoreconnect.apple.com → Users and Access → Integrations → App Store Connect API → ключ с ролью Sales/Finance; vendor number — Payments and Financial Reports",
    fields: [
      { key: "key_id", label: "Key ID", hint: "10 символов" },
      { key: "issuer_id", label: "Issuer ID", hint: "UUID" },
      { key: "vendor_number", label: "Vendor number", hint: "8 цифр" },
      { key: "private_key", label: "Private key (.p8)", secret: true, multiline: true, hint: "-----BEGIN PRIVATE KEY----- …" },
    ],
  },
  adapty: {
    name: "Adapty",
    purpose: "установки → триал → оплата и выручка когорт: Воронка",
    where: "app.adapty.io → App settings → General → Secret key (для каждого приложения свой)",
    fields: [{ key: "secret_key", label: "Secret API key", secret: true, hint: "secret_live_…" }],
  },
};

// MedScan's Adapty key historically lives in GCP Secret Manager; checked once and cached.
let gcpAdapty: { ok: boolean; at: number } | null = null;
function adaptyInSecretManager(): boolean {
  if (gcpAdapty && Date.now() - gcpAdapty.at < 10 * 60_000) return gcpAdapty.ok;
  let ok = false;
  try {
    execFileSync("gcloud", ["secrets", "versions", "access", "latest",
      `--secret=${process.env.ADAPTY_SECRET_NAME ?? "ADAPTY_SECRET_MEDSCAN"}`,
      `--project=${process.env.ADAPTY_GCP_PROJECT ?? "dream-journal-by-nomle"}`], { timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
    ok = true;
  } catch { ok = false; }
  gcpAdapty = { ok, at: Date.now() };
  return ok;
}

function agentPrompt(p: Provider, info: ProviderInfo, base: string): string {
  const body = info.fields.map((f) => `"${f.key}": "<${f.label}>"`).join(", ");
  return [
    `Подключи ${info.name} в студии.`,
    `1. Возьми ключи: ${info.where}. Не печатай значения в чат и не коммить их в git.`,
    `2. Сохрани их в сервер студии одним запросом (значения из файла/переменных, не из истории чата):`,
    `   curl -s -X PUT ${base}/asa-api/credentials/${p} -H 'content-type: application/json' -d '{${body}}'`,
    info.fields.some((f) => f.multiline) ? `   PEM/p8 передавай одной строкой с \\n вместо переносов (python: json.dumps(open(path).read())).` : ``,
    `3. Проверь: curl -s ${base}/asa-api/integrations — у ${p} должно быть connected: true.`,
    `4. Если статус «restartRequired» — перезапусти студию (npm run dev из корня aso-studio).`,
  ].filter(Boolean).join("\n");
}

export function integrationsStatus(base = "http://localhost:5173") {
  return (Object.keys(INFO) as Provider[]).map((p) => {
    const info = INFO[p];
    const masked = getCredentialsMasked(p);
    const missing = info.fields.filter((f) => !masked[f.key]?.present).map((f) => f.key);
    let source: string = missing.length ? "none" : Object.values(masked).some((m) => m.source === "db") ? "studio" : "env";
    let connected = missing.length === 0;
    if (!connected && p === "adapty" && adaptyInSecretManager()) { connected = true; source = "gcp-secret-manager (MedScan)"; }
    return {
      id: p, name: info.name, purpose: info.purpose, where: info.where, connected, source, missing,
      fields: info.fields.map((f) => ({ ...f, present: !!masked[f.key]?.present, preview: masked[f.key]?.preview ?? "" })),
      agentPrompt: agentPrompt(p, info, base),
    };
  });
}
