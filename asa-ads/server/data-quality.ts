import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getDb } from "./db.ts";

export type DataQualityStatus = "ok" | "stale" | "missing" | "error";

export interface DataQualitySource {
  id: string;
  name: string;
  status: DataQualityStatus;
  updatedAt?: string | null;
  window?: string;
  coverage?: number | null;
  kind: "fact" | "model";
  message: string;
}

const ASO_HOME = process.env.ASO_STUDIO_HOME ?? join(homedir(), ".aso-studio");
const RANKINGS_DB = join(ASO_HOME, "keywords", "rankings.db");
const APPS_JSON = join(ASO_HOME, "keywords", "apps.json");

function ageStatus(value: string | null, freshDays: number): DataQualityStatus {
  if (!value) return "missing";
  const parsed = new Date(value.length === 10 ? `${value}T23:59:59Z` : value).getTime();
  if (!Number.isFinite(parsed)) return "error";
  return Date.now() - parsed <= freshDays * 86_400_000 ? "ok" : "stale";
}

function asoSlug(appId: number): string | null {
  try {
    const apps = JSON.parse(readFileSync(APPS_JSON, "utf8")) as Array<{ id: string; iTunesId: string }>;
    return apps.find((app) => Number(app.iTunesId) === appId)?.id ?? null;
  } catch {
    return null;
  }
}

function organicSource(appId: number, country?: string): DataQualitySource {
  const slug = asoSlug(appId);
  if (!slug || !existsSync(RANKINGS_DB)) {
    return { id: "organic", name: "Органические позиции", status: "missing", kind: "fact", message: "Нет связанного ASO Tracker или базы позиций." };
  }
  let side: Database.Database | null = null;
  try {
    side = new Database(RANKINGS_DB, { readonly: true, fileMustExist: true });
    const localeFilter = country ? "AND UPPER(locale) = ?" : "";
    const args: Array<string> = [slug];
    if (country) args.push(country.toUpperCase());
    const row = side.prepare(`
      SELECT MAX(date) AS updatedAt,
             COUNT(DISTINCT locale || char(0) || keyword) AS rows,
             COUNT(DISTINCT locale) AS locales
        FROM snapshots
       WHERE app = ? ${localeFilter}
    `).get(...args) as { updatedAt: string | null; rows: number; locales: number };
    return {
      id: "organic",
      name: "Органические позиции",
      status: ageStatus(row.updatedAt, 8),
      updatedAt: row.updatedAt,
      kind: "fact",
      message: `${row.rows} пар запрос × витрина, ${row.locales} витрин. Последний снимок выбирается отдельно для каждой пары.`,
    };
  } catch (error) {
    return { id: "organic", name: "Органические позиции", status: "error", kind: "fact", message: error instanceof Error ? error.message : String(error) };
  } finally {
    side?.close();
  }
}

export function dataQuality(appId: number, country?: string): { generatedAt: string; sources: DataQualitySource[] } {
  const db = getDb();
  const geoClause = country ? "AND UPPER(c.country) = ?" : "";
  const appGeoArgs: Array<number | string> = [appId];
  if (country) appGeoArgs.push(country.toUpperCase());

  const paid = db.prepare(`
    SELECT MAX(d.date) AS updatedAt, COUNT(*) AS rows
      FROM asa_kw_daily d
      JOIN asa_keywords k ON k.id = d.keyword_id
      JOIN asa_campaigns c ON c.id = k.campaign_id
     WHERE c.app_id = ? ${geoClause}
  `).get(...appGeoArgs) as { updatedAt: string | null; rows: number };

  const activeKeywords = db.prepare(`
    SELECT COUNT(*) AS total
      FROM asa_keywords k
      JOIN asa_campaigns c ON c.id = k.campaign_id
      JOIN asa_ad_groups g ON g.id = k.ad_group_id
     WHERE c.app_id = ? ${geoClause}
       AND c.status = 'ENABLED' AND g.status = 'ENABLED'
       AND k.status = 'ACTIVE' AND k.deleted = 0
  `).get(...appGeoArgs) as { total: number };
  const revenue = db.prepare(`
    SELECT COUNT(*) AS rows,
           COALESCE(SUM(CASE WHEN c.status = 'ENABLED' AND g.status = 'ENABLED'
                              AND k.status = 'ACTIVE' AND k.deleted = 0 THEN 1 ELSE 0 END), 0) AS activeRows,
           MAX(r.updated_at) AS updatedAt
      FROM asa_kw_revenue r
      JOIN asa_campaigns c ON c.id = r.campaign_id
      JOIN asa_keywords k ON k.id = r.keyword_id AND k.campaign_id = r.campaign_id
      JOIN asa_ad_groups g ON g.id = k.ad_group_id
     WHERE c.app_id = ? ${geoClause} AND r.bounded = 1
  `).get(...appGeoArgs) as { rows: number; activeRows: number; updatedAt: string | null };
  const revenueCoverage = activeKeywords.total > 0 ? Math.min(100, (revenue.activeRows / activeKeywords.total) * 100) : null;

  const ascArgs: Array<number | string> = [appId];
  let ascGeo = "";
  if (country) {
    ascGeo = "AND UPPER(country) = ?";
    ascArgs.push(country.toUpperCase());
  }
  const asc = db.prepare(`
    SELECT MAX(date) AS updatedAt, COUNT(*) AS rows
      FROM asc_events_daily
     WHERE app_id = ? ${ascGeo}
  `).get(...ascArgs) as { updatedAt: string | null; rows: number };

  const trafficRows = db.prepare(`SELECT cache_key, generated_at FROM traffic_intelligence_cache`).all() as Array<{ cache_key: string; generated_at: string }>;
  const matchingTraffic = trafficRows.filter((row) => {
    try {
      const key = JSON.parse(row.cache_key) as { appId?: number; country?: string };
      return key.appId === appId && (!country || key.country === country.toUpperCase());
    } catch {
      return false;
    }
  });
  const trafficUpdated = matchingTraffic.map((row) => row.generated_at).sort().at(-1) ?? null;
  const acquisition = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM asc_store_engagement_daily WHERE app_id = ?) +
      (SELECT COUNT(*) FROM asc_downloads_daily WHERE app_id = ?) AS rows,
      MAX(max_date) AS maxDate,
      MAX(synced_at) AS syncedAt
    FROM (
      SELECT MAX(date) max_date, MAX(synced_at) synced_at FROM asc_store_engagement_daily WHERE app_id = ?
      UNION ALL
      SELECT MAX(date), MAX(synced_at) FROM asc_downloads_daily WHERE app_id = ?
    )
  `).get(appId, appId, appId, appId) as { rows: number; maxDate: string | null; syncedAt: string | null };
  const adaptyFunnel = db.prepare(`SELECT MAX(generated_at) AS updatedAt, COUNT(*) AS rows FROM adapty_funnel_cache`).get() as { updatedAt: string | null; rows: number };
  const adaptyCohorts = db.prepare(`SELECT MAX(generated_at) AS updatedAt, COUNT(*) AS rows FROM adapty_cohort_cache`).get() as { updatedAt: string | null; rows: number };

  const sources: DataQualitySource[] = [
    {
      id: "asa",
      name: "Доставка Apple Ads",
      status: ageStatus(paid.updatedAt, 3),
      updatedAt: paid.updatedAt,
      kind: "fact",
      message: `${paid.rows} дневных строк по ключам: показы, тапы, установки и расход.`,
    },
    {
      id: "apple-insights",
      name: "Спрос Apple и доля показов",
      status: ageStatus(trafficUpdated, 1),
      updatedAt: trafficUpdated,
      window: "завершённые недели Apple",
      kind: "fact",
      message: matchingTraffic.length ? `${matchingTraffic.length} сохранённых срезов; popularity и share — данные Apple.` : "Для этой витрины ещё нет сохранённого среза.",
    },
    organicSource(appId, country),
    {
      id: "keyword-revenue",
      name: "Атрибуция Apple Ads из Adapty по ключам",
      status: revenue.activeRows > 0 ? ageStatus(revenue.updatedAt, 3) : "missing",
      updatedAt: revenue.updatedAt,
      coverage: revenueCoverage,
      kind: "fact",
      message: revenue.activeRows > 0
        ? `${revenue.activeRows} из ${activeKeywords.total} текущих активных ключей сопоставлены с фактами Adapty: установки, триалы, оплаты и net revenue; нулевые значения сохранены честно.`
        : revenue.rows
          ? `Исторические атрибуционные связи: ${revenue.rows}; совпадений с ${activeKeywords.total} текущими активными ключами нет. Данные удалённых кампаний не используются для решений по ставкам.`
        : "Adapty пока не вернул атрибутированные Apple Ads данные на уровне ключей.",
    },
    {
      id: "asc-events",
      name: "События подписок App Store",
      status: ageStatus(asc.updatedAt, 3),
      updatedAt: asc.updatedAt,
      kind: "fact",
      message: asc.rows ? `${asc.rows} агрегатов по дате, продукту и стране; это не когортная воронка привлечения.` : "Отчёты о событиях подписки не загружены.",
    },
    {
      id: "asc-analytics",
      name: "Аналитические отчёты App Store",
      status: ageStatus(acquisition.maxDate, 4),
      updatedAt: acquisition.maxDate,
      kind: "fact",
      message: acquisition.rows
        ? `${acquisition.rows} строк воронки: показы → просмотры страницы → первые загрузки по источнику и стране.`
        : "Воронка привлечения ещё не синхронизирована в локальную базу.",
    },
    {
      id: "adapty-funnel",
      name: "Воронка установок и подписок Adapty",
      status: ageStatus(adaptyFunnel.updatedAt, 1),
      updatedAt: adaptyFunnel.updatedAt,
      kind: "fact",
      message: adaptyFunnel.rows
        ? "Доступны установки, просмотры пейвола, старты триала, оплаты и продления по странам."
        : "Периодная воронка Adapty ещё не загружена.",
    },
    {
      id: "cohorts",
      name: "Зрелые когорты D0–D60",
      status: adaptyCohorts.rows ? ageStatus(adaptyCohorts.updatedAt, 1) : "missing",
      updatedAt: adaptyCohorts.updatedAt,
      kind: "fact",
      message: adaptyCohorts.rows
        ? "Сохранены месячные когорты Adapty с net revenue на D0/D7/D14/D30/D60 и собственным флагом зрелости."
        : "Когорты Adapty D0/D7/D14/D30/D60 ещё не загружены.",
    },
  ];
  return { generatedAt: new Date().toISOString(), sources };
}
