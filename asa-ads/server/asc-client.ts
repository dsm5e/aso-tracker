import { importPKCS8, SignJWT } from "jose";
import { request } from "undici";
import { gunzipSync } from "node:zlib";
import type { AscConfig } from "./config.ts";

const ASC_AUDIENCE = "appstoreconnect-v1";
const ASC_BASE = "https://api.appstoreconnect.apple.com/v1";

export class AscClient {
  constructor(private cfg: AscConfig) {}

  private async jwt(): Promise<string> {
    const key = await importPKCS8(this.cfg.privateKeyPem, "ES256");
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.cfg.keyId, typ: "JWT" })
      .setIssuer(this.cfg.issuerId)
      .setAudience(ASC_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 19 * 60)
      .sign(key);
  }

  /**
   * Fetch SUBSCRIPTION_EVENT daily report (gzipped TSV).
   * Returns parsed rows or empty if no data for that date.
   */
  async subscriptionEvents(date: string): Promise<SubscriptionEventRow[]> {
    const token = await this.jwt();
    const url = new URL(`${ASC_BASE}/salesReports`);
    url.searchParams.set("filter[frequency]", "DAILY");
    url.searchParams.set("filter[reportType]", "SUBSCRIPTION_EVENT");
    url.searchParams.set("filter[reportSubType]", "SUMMARY");
    url.searchParams.set("filter[reportDate]", date);
    url.searchParams.set("filter[vendorNumber]", this.cfg.vendorNumber);
    url.searchParams.set("filter[version]", "1_4");

    const res = await request(url.toString(), {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/a-gzip" },
    });
    if (res.statusCode === 404) return []; // no report for this date
    const buf = Buffer.from(await res.body.arrayBuffer());
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`ASC ${res.statusCode}: ${buf.toString("utf-8").slice(0, 200)}`);
    }
    const text = gunzipSync(buf).toString("utf-8");
    return parseTsv(text);
  }
}

export interface SubscriptionEventRow {
  date: string;
  appId: number;
  country: string;
  product: string;
  eventType: string;
  events: number;
}

function parseTsv(text: string): SubscriptionEventRow[] {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split("\t");
  const idx = (name: string): number => header.indexOf(name);
  const iDate = idx("Event Date");
  const iApp = idx("App Apple ID");
  const iCountry = idx("Country");
  const iProduct = idx("Subscription Name");
  const iEvent = idx("Event");
  const iCount = idx("Quantity");
  const out: SubscriptionEventRow[] = [];
  for (let n = 1; n < lines.length; n++) {
    const c = lines[n].split("\t");
    out.push({
      date: c[iDate] ?? "",
      appId: Number(c[iApp] ?? 0),
      country: c[iCountry] ?? "",
      product: c[iProduct] ?? "",
      eventType: c[iEvent] ?? "",
      events: Number(c[iCount] ?? 0),
    });
  }
  return out;
}
