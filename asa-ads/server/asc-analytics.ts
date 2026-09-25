import { createHash } from "node:crypto";
import { getDb } from "./db.ts";
import type { AscClient, AnalyticsReport, AnalyticsReportInstance, AnalyticsReportRequest } from "./asc-client.ts";

const ENGAGEMENT_REPORT = "App Store Discovery and Engagement Detailed";
const DOWNLOADS_REPORT = "App Downloads Detailed";

type Row = Record<string, string>;

function parseTsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function count(value: string | undefined): number {
  const parsed = Number(String(value ?? "0").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestDaily(instances: AnalyticsReportInstance[]): AnalyticsReportInstance | null {
  return instances
    .filter((instance) => instance.attributes?.granularity === "DAILY")
    .sort((a, b) => String(b.attributes?.processingDate ?? "").localeCompare(String(a.attributes?.processingDate ?? "")))[0] ?? null;
}

function preferredRequest(requests: AnalyticsReportRequest[]): AnalyticsReportRequest | null {
  return requests.find((request) => request.attributes?.accessType === "ONGOING" && !request.attributes?.stoppedDueToInactivity)
    ?? requests.find((request) => !request.attributes?.stoppedDueToInactivity)
    ?? requests[0]
    ?? null;
}

function reportByName(reports: AnalyticsReport[], name: string): AnalyticsReport | null {
  return reports.find((report) => report.attributes?.name === name) ?? null;
}

async function downloadRows(client: AscClient, instance: AnalyticsReportInstance): Promise<{ rows: Row[]; segments: number }> {
  const segments = await client.analyticsReportSegments(instance.id);
  const texts = await Promise.all(segments.map(async (segment) => {
    const url = segment.attributes?.url;
    return url ? client.analyticsSegmentText(url) : "";
  }));
  return { rows: texts.flatMap(parseTsv), segments: segments.length };
}

export interface AscAnalyticsStatus {
  appId: number;
  connected: boolean;
  requestId: string | null;
  accessType: string | null;
  stoppedDueToInactivity: boolean;
  reports: number;
  available: { engagement: boolean; downloads: boolean };
  local: { rows: number; minDate: string | null; maxDate: string | null; syncedAt: string | null };
}

export class AscAnalyticsService {
  private readonly client: AscClient;

  constructor(client: AscClient) {
    this.client = client;
    this.ensureSchema();
  }

  private ensureSchema() {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS asc_store_engagement_daily (
        app_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        country TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_info TEXT NOT NULL,
        campaign TEXT NOT NULL,
        page_type TEXT NOT NULL,
        page_title TEXT NOT NULL,
        event TEXT NOT NULL,
        counts INTEGER NOT NULL DEFAULT 0,
        unique_counts INTEGER NOT NULL DEFAULT 0,
        row_hash TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (app_id, row_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_asc_engagement_app_date ON asc_store_engagement_daily(app_id, date, country, source_type);

      CREATE TABLE IF NOT EXISTS asc_downloads_daily (
        app_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        country TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_info TEXT NOT NULL,
        campaign TEXT NOT NULL,
        page_type TEXT NOT NULL,
        page_title TEXT NOT NULL,
        download_type TEXT NOT NULL,
        counts INTEGER NOT NULL DEFAULT 0,
        row_hash TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (app_id, row_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_asc_downloads_app_date ON asc_downloads_daily(app_id, date, country, source_type);

      CREATE TABLE IF NOT EXISTS asc_analytics_sync (
        app_id INTEGER PRIMARY KEY,
        request_id TEXT,
        access_type TEXT,
        processing_date TEXT,
        synced_at TEXT NOT NULL,
        engagement_rows INTEGER NOT NULL DEFAULT 0,
        download_rows INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
    `);
  }

  localStatus(appId: number): AscAnalyticsStatus["local"] {
    const db = getDb();
    const row = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM asc_store_engagement_daily WHERE app_id = ?) +
        (SELECT COUNT(*) FROM asc_downloads_daily WHERE app_id = ?) AS rows,
        MIN(min_date) AS minDate,
        MAX(max_date) AS maxDate,
        MAX(synced_at) AS syncedAt
      FROM (
        SELECT MIN(date) min_date, MAX(date) max_date, MAX(synced_at) synced_at FROM asc_store_engagement_daily WHERE app_id = ?
        UNION ALL
        SELECT MIN(date), MAX(date), MAX(synced_at) FROM asc_downloads_daily WHERE app_id = ?
      )
    `).get(appId, appId, appId, appId) as { rows: number; minDate: string | null; maxDate: string | null; syncedAt: string | null };
    return row ?? { rows: 0, minDate: null, maxDate: null, syncedAt: null };
  }

  async status(appId: number): Promise<AscAnalyticsStatus> {
    const requests = await this.client.analyticsReportRequests(appId);
    const request = preferredRequest(requests);
    if (!request) {
      return { appId, connected: false, requestId: null, accessType: null, stoppedDueToInactivity: false, reports: 0, available: { engagement: false, downloads: false }, local: this.localStatus(appId) };
    }
    const reports = await this.client.analyticsReports(request.id);
    return {
      appId,
      connected: true,
      requestId: request.id,
      accessType: request.attributes?.accessType ?? null,
      stoppedDueToInactivity: request.attributes?.stoppedDueToInactivity ?? false,
      reports: reports.length,
      available: { engagement: Boolean(reportByName(reports, ENGAGEMENT_REPORT)), downloads: Boolean(reportByName(reports, DOWNLOADS_REPORT)) },
      local: this.localStatus(appId),
    };
  }

  async createRequest(appId: number, accessType: "ONE_TIME_SNAPSHOT" | "ONGOING") {
    return this.client.createAnalyticsReportRequest(appId, accessType);
  }

  async sync(appId: number): Promise<AscAnalyticsStatus & { downloaded: { engagementRows: number; downloadRows: number; segments: number } }> {
    const db = getDb();
    const syncedAt = new Date().toISOString();
    try {
      const requests = await this.client.analyticsReportRequests(appId);
      const request = preferredRequest(requests);
      if (!request) throw new Error("Для приложения нет Analytics Report Request. Создайте ONE_TIME_SNAPSHOT или ONGOING.");
      const reports = await this.client.analyticsReports(request.id);
      const engagementReport = reportByName(reports, ENGAGEMENT_REPORT);
      const downloadsReport = reportByName(reports, DOWNLOADS_REPORT);
      if (!engagementReport || !downloadsReport) throw new Error("В snapshot отсутствуют обязательные отчёты discovery/downloads.");
      const [engagementInstance, downloadsInstance] = await Promise.all([
        this.client.analyticsReportInstances(engagementReport.id).then(latestDaily),
        this.client.analyticsReportInstances(downloadsReport.id).then(latestDaily),
      ]);
      if (!engagementInstance || !downloadsInstance) throw new Error("Daily instances ещё не готовы.");
      const [engagement, downloads] = await Promise.all([
        downloadRows(this.client, engagementInstance),
        downloadRows(this.client, downloadsInstance),
      ]);

      const insertEngagement = db.prepare(`
        INSERT INTO asc_store_engagement_daily
          (app_id,date,country,source_type,source_info,campaign,page_type,page_title,event,counts,unique_counts,row_hash,synced_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      const insertDownload = db.prepare(`
        INSERT INTO asc_downloads_daily
          (app_id,date,country,source_type,source_info,campaign,page_type,page_title,download_type,counts,row_hash,synced_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      db.transaction(() => {
        db.prepare(`DELETE FROM asc_store_engagement_daily WHERE app_id = ?`).run(appId);
        db.prepare(`DELETE FROM asc_downloads_daily WHERE app_id = ?`).run(appId);
        for (const row of engagement.rows) {
          const identity = JSON.stringify(row);
          insertEngagement.run(
            appId, row.Date, row.Territory, row["Source Type"], row["Source Info"], row.Campaign,
            row["Page Type"], row["Page Title"], row.Event, count(row.Counts), count(row["Unique Counts"]),
            createHash("sha1").update(identity).digest("hex"), syncedAt,
          );
        }
        for (const row of downloads.rows) {
          const identity = JSON.stringify(row);
          insertDownload.run(
            appId, row.Date, row.Territory, row["Source Type"], row["Source Info"], row.Campaign,
            row["Page Type"], row["Page Title"], row["Download Type"], count(row.Counts),
            createHash("sha1").update(identity).digest("hex"), syncedAt,
          );
        }
        const processingDate = [engagementInstance.attributes?.processingDate, downloadsInstance.attributes?.processingDate].filter(Boolean).sort().at(-1) ?? null;
        db.prepare(`
          INSERT INTO asc_analytics_sync (app_id,request_id,access_type,processing_date,synced_at,engagement_rows,download_rows,error)
          VALUES (?,?,?,?,?,?,?,NULL)
          ON CONFLICT(app_id) DO UPDATE SET request_id=excluded.request_id, access_type=excluded.access_type,
            processing_date=excluded.processing_date, synced_at=excluded.synced_at,
            engagement_rows=excluded.engagement_rows, download_rows=excluded.download_rows, error=NULL
        `).run(appId, request.id, request.attributes?.accessType ?? null, processingDate, syncedAt, engagement.rows.length, downloads.rows.length);
      })();
      const status = await this.status(appId);
      return { ...status, downloaded: { engagementRows: engagement.rows.length, downloadRows: downloads.rows.length, segments: engagement.segments + downloads.segments } };
    } catch (error) {
      db.prepare(`
        INSERT INTO asc_analytics_sync (app_id,synced_at,error) VALUES (?,?,?)
        ON CONFLICT(app_id) DO UPDATE SET synced_at=excluded.synced_at,error=excluded.error
      `).run(appId, syncedAt, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  funnel(appId: number, country?: string, days = 30) {
    const db = getDb();
    const start = new Date(Date.now() - Math.max(1, Math.min(days, 180)) * 86_400_000).toISOString().slice(0, 10);
    const geo = country ? "AND UPPER(country) = ?" : "";
    const args: Array<number | string> = [appId, start];
    if (country) args.push(country.toUpperCase());
    const engagement = db.prepare(`
      SELECT country, source_type AS sourceType,
        SUM(CASE WHEN event='Impression' THEN counts ELSE 0 END) AS impressions,
        SUM(CASE WHEN event='Page view' AND page_type='Product page' THEN counts ELSE 0 END) AS productPageViews,
        SUM(CASE WHEN event='Tap' THEN counts ELSE 0 END) AS taps,
        MAX(date) AS maxDate
      FROM asc_store_engagement_daily
      WHERE app_id = ? AND date >= ? ${geo}
      GROUP BY country, source_type
    `).all(...args) as Array<{ country: string; sourceType: string; impressions: number; productPageViews: number; taps: number; maxDate: string }>;
    const downloads = db.prepare(`
      SELECT country, source_type AS sourceType,
        SUM(CASE WHEN download_type='First-time download' THEN counts ELSE 0 END) AS firstTimeDownloads,
        SUM(CASE WHEN download_type='Redownload' THEN counts ELSE 0 END) AS redownloads,
        MAX(date) AS maxDate
      FROM asc_downloads_daily
      WHERE app_id = ? AND date >= ? ${geo}
      GROUP BY country, source_type
    `).all(...args) as Array<{ country: string; sourceType: string; firstTimeDownloads: number; redownloads: number; maxDate: string }>;
    const keyed = new Map<string, Record<string, unknown>>();
    for (const row of engagement) keyed.set(`${row.country}\u0000${row.sourceType}`, { ...row });
    for (const row of downloads) keyed.set(`${row.country}\u0000${row.sourceType}`, { ...(keyed.get(`${row.country}\u0000${row.sourceType}`) ?? { country: row.country, sourceType: row.sourceType }), ...row });
    const rows = [...keyed.values()].map((row) => {
      const impressions = Number(row.impressions ?? 0);
      const views = Number(row.productPageViews ?? 0);
      const firstTimeDownloads = Number(row.firstTimeDownloads ?? 0);
      return {
        country: row.country,
        sourceType: row.sourceType,
        impressions,
        productPageViews: views,
        taps: Number(row.taps ?? 0),
        firstTimeDownloads,
        redownloads: Number(row.redownloads ?? 0),
        impressionToPageView: impressions > 0 ? views / impressions : null,
        pageViewToDownload: views > 0 ? firstTimeDownloads / views : null,
        impressionToDownload: impressions > 0 ? firstTimeDownloads / impressions : null,
      };
    }).sort((a, b) => b.impressions - a.impressions);

    const asaArgs: Array<number | string> = [appId, start];
    const asaGeo = country ? "AND UPPER(c.country) = ?" : "";
    if (country) asaArgs.push(country.toUpperCase());
    const asa = db.prepare(`
      SELECT
        COALESCE(SUM(d.impressions), 0) AS impressions,
        COALESCE(SUM(d.taps), 0) AS taps,
        COALESCE(SUM(d.installs), 0) AS installs,
        COALESCE(SUM(d.spend), 0) AS spend,
        MAX(d.date) AS maxDate
      FROM asa_kw_daily d
      JOIN asa_keywords k ON k.id = d.keyword_id
      JOIN asa_campaigns c ON c.id = k.campaign_id
      WHERE c.app_id = ? AND d.date >= ? ${asaGeo}
    `).get(...asaArgs) as { impressions: number; taps: number; installs: number; spend: number; maxDate: string | null };

    return {
      appId,
      country: country?.toUpperCase() ?? null,
      start,
      end: this.localStatus(appId).maxDate,
      rows,
      asa: {
        impressions: Number(asa.impressions ?? 0),
        taps: Number(asa.taps ?? 0),
        installs: Number(asa.installs ?? 0),
        spend: Number(asa.spend ?? 0),
        maxDate: asa.maxDate,
        source: "Apple Ads Campaign Management API",
        fact: true,
        downstreamAvailable: false,
      },
      source: "App Store Analytics Reports API",
      fact: true,
    };
  }
}
