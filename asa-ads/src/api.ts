export interface Campaign {
  id: number; name: string; country: string; status: string; serving_status: string | null;
  app_id: number; daily_budget: number; lifetime_budget: number; bidding_strategy: string | null;
  start_time: string | null; end_time: string | null;
  impressions: number; taps: number; installs: number; spend: number;
  cpi: number; cpt: number; ttr: number; install_rate: number; trial_starts: number;
}

export interface Keyword {
  id: number; campaign_id: number; ad_group_id: number; campaign_name: string; country: string;
  text: string; match_type: string; bid: number; status: string;
  impressions: number; taps: number; installs: number; spend: number; cpt: number;
}

export interface SearchTerm {
  campaign_id: number; campaign_name: string; country: string; term: string;
  source_keyword_id: number | null; match_type: string | null;
  impressions: number; taps: number; installs: number; spend: number; is_negative: number;
}

export interface BidRec {
  keyword_id: number; text: string; match_type: string;
  current_bid: number; recommended_bid: number; reason: string;
  confidence: "low" | "medium" | "high"; expected_cpi_change: number;
}

export interface SearchTermSuggestion {
  campaign_id: number; campaign_name: string; term: string;
  impressions: number; taps: number; installs: number; spend: number;
  suggestion: "negative" | "add_as_keyword"; reason: string;
}

export interface ActionRow {
  id: number; type: string; payload: string; status: string;
  created_at: string; applied_at: string | null; result: string | null; error: string | null;
}

export interface Projection {
  confidence: "high" | "medium" | "low" | "insufficient";
  spend_so_far: number;
  installs_so_far: number;
  days_running: number;
  cpi: number;
  install_to_trial_rate: number;
  trial_rate_source: string;
  proposed_spend: number;
  projected_installs: number;
  projected_trials: number;
  projected_paid: number;
  projected_revenue: number;
  projected_roi: number;
  projected_cpa_trial: number;
  projected_cpa_paid: number;
  verdict: { kind: "scale" | "hold" | "cut" | "unknown"; label: string; reason: string };
  next_step?: string;
}

// When served directly at :5193 → /api hits ASA backend on :5194 via vite proxy.
// When proxied via Keywords origin :5173/asa/ → /asa-api hits ASA backend.
const API_BASE = import.meta.env.BASE_URL === "/" ? "" : "/asa-api";

function url(path: string): string {
  if (!API_BASE) return path;
  return path.startsWith("/api/") ? API_BASE + path.slice(4) : path;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(url(path));
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}
async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(url(path), { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export interface DailyTotals {
  date: string;
  impressions: number; taps: number; installs: number; spend: number;
  cpi: number; cpt: number; ttr: number; trial_starts: number;
}

export interface AppRow {
  app_id: number;
  app_name: string | null;
  campaign_count: number;
  active_count: number;
  spend_14d: number;
  installs_14d: number;
}

function appQ(appId?: number | "all"): string {
  return appId && appId !== "all" ? `&app_id=${appId}` : "";
}

export const api = {
  apps: () => get<AppRow[]>("/api/apps"),
  negatives: () => get<Array<{ id: number; campaign_id: number; campaign_name: string; country: string; text: string; match_type: string; remote_id: number | null; added_at: string }>>("/api/negatives"),
  geo: (days = 14, appId?: number | "all") =>
    get<Array<{ country: string; impressions: number; taps: number; installs: number; spend: number; cpi: number; campaigns: number; trials: number }>>(`/api/geo?days=${days}${appQ(appId)}`),
  campaigns: (days = 14, appId?: number | "all") => get<Campaign[]>(`/api/campaigns?days=${days}${appQ(appId)}`),
  daily: (days = 14, campaignId?: number, appId?: number | "all") =>
    get<DailyTotals[]>(`/api/daily?days=${days}${campaignId ? `&campaign_id=${campaignId}` : ""}${appQ(appId)}`),
  keywords: (days = 14, campaignId?: number) => get<Keyword[]>(`/api/keywords?days=${days}${campaignId ? `&campaign_id=${campaignId}` : ""}`),
  searchTerms: (days = 14) => get<SearchTerm[]>(`/api/search-terms?days=${days}`),
  bidRecs: (days = 7, campaignId?: number) => get<BidRec[]>(`/api/recommendations/bids?days=${days}${campaignId ? `&campaign_id=${campaignId}` : ""}`),
  stRecs: (days = 14) => get<SearchTermSuggestion[]>(`/api/recommendations/search-terms?days=${days}`),
  actions: () => get<ActionRow[]>("/api/actions"),
  alerts: () => get<Array<{ id: number; campaign_id: number | null; alert_type: string; message: string; sent_at: string; delivered: number }>>("/api/alerts"),
  checkAlerts: () => post<{ checked: number; sent: number; skipped: number }>("/api/alerts/check"),
  roiCampaign: (id: number, spend = 1000, days = 14) =>
    get<Projection>(`/api/roi/campaign/${id}?spend=${spend}&days=${days}`),
  roiKeyword: (id: number, spend = 100, days = 14) =>
    get<Projection>(`/api/roi/keyword/${id}?spend=${spend}&days=${days}`),
  keywordDaily: (id: number, days = 14) =>
    get<Array<{ date: string; impressions: number; taps: number; installs: number; spend: number; cpt: number; cpi: number }>>(`/api/keywords/${id}/daily?days=${days}`),
  enqueueAction: (body: unknown) => post<{ id: number }>("/api/actions", body),
  applyAction: (id: number) => post<{ ok: boolean; error?: string }>(`/api/actions/${id}/apply`),
  cancelAction: (id: number) => post<{ ok: boolean }>(`/api/actions/${id}/cancel`),
  sync: (days = 14) => post<{ ok: boolean; started: boolean }>(`/api/sync`, { days }),
  syncStatus: () => get<{ active: boolean; phase: string; label: string; progress: number; started_at: string | null; finished_at: string | null; ok: number | null; error: string | null }>(`/api/sync/status`),
};
