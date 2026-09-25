import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { asaApiUrl } from '../api.ts';
import type { RankingRow } from '../lib/keywordsApi.ts';
import { KeywordTopFiveInline } from '../components/KeywordResultsDrawer.tsx';
import { useFoldOnScroll } from '../components/FillPage.tsx';
import { appStoreCountry } from '../lib/appStoreLocales.ts';
import { useCountry } from '../lib/CountryContext.tsx';
import { WORLD } from '../lib/countries.ts';
import { ScopeBadge } from '../components/CountrySwitcher.tsx';
import { SERIES, hbarPath, tipProps, useWidth, type TipRow } from '../../../shared/charts/Charts.tsx';
import './TrafficIntelligence.css';

export interface TrafficIntelligenceApp {
  id: string;
  name: string;
  iTunesId: string;
  bundle?: string;
  iconUrl?: string;
}

export interface TrafficIntelligenceProps {
  app: TrafficIntelligenceApp;
  locale: string;
  rankings?: RankingRow[];
  artworks?: Record<string, string>;
  sharedTopFive?: Record<string, RankingRow>;
  sharedTopFiveStatus?: Record<string, CachedTopFiveState>;
  onResolveTopFive?: (appId: string, iTunesId: string, country: string, keyword: string) => void;
  onEnsureArtworks?: (candidates: Array<{ id: string; tid?: number }>, country: string) => void;
  className?: string;
  onOpenCompetitor?: (bundleId: string) => void;
}

export interface ShareEstimate {
  value: number | null;
  lowerBound?: number | null;
  upperBound?: number | null;
  basis?: 'modeled' | 'bounded';
}

export interface ModeledMetricInput {
  value: number | null;
  modeled?: boolean;
  factors?: string[];
  formula?: string;
}

export interface TrafficKeywordInput {
  keyword: string;
  source?: string;
  tracked?: boolean;
  popularity?: number | null;
  impressionShare?: number | ShareEstimate | null;
  capturedShare?: number | ShareEstimate | null;
  paidRank?: number | null;
  relevance?: number | null;
  campaignCount?: number | null;
  matchTypes?: string[];
  impressions?: number | null;
  taps?: number | null;
  installs?: number | null;
  attributedInstalls?: number | null;
  spend?: number | null;
  currency?: string;
  suggestedBid?: number | null;
  bid?: number | null;
  bidRange?: { min: number; max: number } | null;
  paidRankRange?: { min: number; max: number } | null;
  countryCount?: number | null;
  signalCountryCount?: number | null;
  countries?: string[];
  confidence?: 'high' | 'medium' | 'low' | string;
  reason?: string;
  difficulty?: number | ModeledMetricInput | null;
  opportunity?: number | ModeledMetricInput | null;
  model?: {
    difficulty?: number | ModeledMetricInput | null;
    opportunity?: number | ModeledMetricInput | null;
    [key: string]: unknown;
  };
  competitors?: Array<{ id?: string; name: string; rank?: number | null; source?: string }>;
}

export interface TrafficPartialError {
  scope?: string;
  message: string;
}

export interface TrafficIntelligencePayload {
  generatedAt?: string | number | null;
  scope?: 'all' | 'country' | string;
  country?: string | null;
  stale?: boolean;
  servedFromCache?: boolean;
  cache?: {
    status?: string;
    persisted?: boolean;
    generatedAt?: string | number | null;
    expiresAt?: string | number | null;
    nextRetryAt?: string | number | null;
  };
  window?: { start?: string; end?: string; label?: string };
  summary?: Record<string, unknown>;
  availableCountries?: Array<{
    code: string;
    keywordCount?: number;
    attributedInstalls?: number;
    trials?: number;
    paid?: number;
    revenueUsd?: number;
  }>;
  limitations?: {
    allScope?: string;
    countryScope?: string;
    maturity?: string;
    relevance?: string;
  };
  keywords?: TrafficKeywordInput[];
  discovery?: TrafficKeywordInput[];
  unverifiedSuggestions?: TrafficKeywordInput[];
  competitors?: Array<{ id?: string; name: string; appearances?: number; averageRank?: number | null }>;
  partialErrors?: TrafficPartialError[];
  errors?: TrafficPartialError[];
  raw?: unknown;
}

export interface PlatformMethodDescriptor {
  id?: string;
  group?: string;
  name?: string;
  description?: string;
  method?: string;
  path?: string;
  access?: 'read' | 'write' | string;
  integrated?: boolean;
  status?: string;
  docsUrl?: string;
  responseFields?: string[];
  [key: string]: unknown;
}

export interface PlatformMethodsPayload {
  generatedAt?: string | number | null;
  baseUrl?: string;
  version?: string;
  methods?: PlatformMethodDescriptor[];
  partialErrors?: TrafficPartialError[];
  [key: string]: unknown;
}

type View = 'traffic' | 'discovery' | 'competitors' | 'coverage';
type RowFilter = 'all' | 'tracked' | 'opportunity' | 'measured' | 'unmeasured';
type SortKey = 'opportunity' | 'popularity' | 'captured' | 'difficulty' | 'keyword';

interface ScoreDetails {
  value: number | null;
  modeled: boolean;
  factors: string[];
  source: 'backend' | 'fallback';
  tooltip: string;
}

type TrafficKeywordRow = Omit<TrafficKeywordInput, 'difficulty' | 'opportunity' | 'raw'> & {
  captured: ShareEstimate;
  capturedMidpoint: number | null;
  availableMidpoint: number | null;
  difficulty: number | null;
  opportunity: number | null;
  difficultyDetails: ScoreDetails;
  opportunityDetails: ScoreDetails;
  organicRank: number | null;
  organicTop5: RankingRow['top5'];
  raw: TrafficKeywordInput;
};

interface OrganicCompetitorRow {
  key: string;
  name: string;
  developer: string;
  appearances: number;
  averageRank: number | null;
  keywords: string[];
}

type CachedTopFiveState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

const DIFFICULTY_FORMULA = 'Расчётная сложность = 45% популярности + 35% незахваченной доли + 20% давления платной позиции.';
const OPPORTUNITY_FORMULA = 'Расчётный потенциал = индекс популярности Apple × доступная доля × релевантность. Если релевантность не задана, используется 100%.';
const BACKEND_SCORE_NOTE = 'Показатель смоделирован сервером; факторы приведены для каждого ключа.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKeywordInput(value: unknown): value is TrafficKeywordInput {
  return isRecord(value) && typeof value.keyword === 'string';
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace('%', ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function asPercent(value: unknown): number | null {
  const numeric = finiteNumber(value);
  if (numeric == null) return null;
  return clamp(numeric >= 0 && numeric <= 1 ? numeric * 100 : numeric);
}

function normalizeEstimate(input: TrafficKeywordInput): ShareEstimate {
  const source = input.capturedShare ?? input.impressionShare;
  if (isRecord(source)) {
    const lowerBound = asPercent(source.lowerBound ?? source.min ?? source.lower);
    const upperBound = asPercent(source.upperBound ?? source.max ?? source.upper);
    const direct = asPercent(source.value ?? source.midpoint ?? source.share);
    const value = direct ?? (lowerBound != null && upperBound != null ? (lowerBound + upperBound) / 2 : null);
    return {
      value,
      lowerBound,
      upperBound,
      basis: lowerBound != null || upperBound != null ? 'bounded' : source.basis === 'bounded' ? 'bounded' : 'modeled',
    };
  }
  return { value: asPercent(source), basis: 'modeled' };
}

function estimateMidpoint(estimate: ShareEstimate) {
  if (estimate.value != null) return clamp(estimate.value);
  if (estimate.lowerBound != null && estimate.upperBound != null) {
    return clamp((estimate.lowerBound + estimate.upperBound) / 2);
  }
  return null;
}

function normalizeScore(value: unknown): number | null {
  const numeric = finiteNumber(value);
  if (numeric == null) return null;
  return clamp(numeric >= 0 && numeric <= 1 ? numeric * 100 : numeric);
}

function derivedMetrics(row: TrafficKeywordInput, captured: number | null) {
  const popularity = normalizeScore(row.popularity);
  if (popularity == null || captured == null) return { difficulty: null, opportunity: null };
  const available = 100 - captured;
  const relevance = normalizeScore(row.relevance) ?? 100;
  const paidRank = finiteNumber(row.paidRank);
  const rankPressure = paidRank == null ? 50 : clamp((paidRank - 1) * 12.5);
  return {
    difficulty: Math.round(0.45 * popularity + 0.35 * available + 0.2 * rankPressure),
    opportunity: Math.round(popularity * (available / 100) * (relevance / 100)),
  };
}

function resolveScore(
  input: number | ModeledMetricInput | null | undefined,
  fallbackValue: number | null,
  fallbackFormula: string,
  label: string,
): ScoreDetails {
  if (input !== undefined && input !== null) {
    const inputRecord = isRecord(input) ? input : null;
    const value = normalizeScore(inputRecord ? inputRecord.value : input);
    const factors = inputRecord && Array.isArray(inputRecord.factors)
      ? inputRecord.factors.filter((factor): factor is string => typeof factor === 'string')
      : [];
    const explicitFormula = inputRecord && typeof inputRecord.formula === 'string' ? inputRecord.formula : null;
    const explanation = explicitFormula ?? (factors.length ? factors.join(' · ') : `Значение «${label}» получено с сервера; факторы недоступны.`);
    return {
      value,
      modeled: inputRecord?.modeled !== false,
      factors,
      source: 'backend',
      tooltip: `${BACKEND_SCORE_NOTE} ${explanation}`,
    };
  }
  return {
    value: fallbackValue,
    modeled: true,
    factors: [fallbackFormula],
    source: 'fallback',
    tooltip: `Расчёт в интерфейсе: сервер не передал этот показатель. ${fallbackFormula}`,
  };
}

function buildTrafficRows(
  items: TrafficKeywordInput[],
  organicByKeyword: Map<string, RankingRow>,
  discovery = false,
): TrafficKeywordRow[] {
  return items.map((item) => {
    const captured = normalizeEstimate(item);
    const capturedMidpoint = estimateMidpoint(captured);
    const ranking = organicByKeyword.get(item.keyword.toLocaleLowerCase());
    const derived = derivedMetrics(item, capturedMidpoint);
    const difficultyDetails = resolveScore(item.difficulty ?? item.model?.difficulty, derived.difficulty, DIFFICULTY_FORMULA, 'Сложность');
    const opportunityDetails = resolveScore(item.opportunity ?? item.model?.opportunity, derived.opportunity, OPPORTUNITY_FORMULA, 'Потенциал');
    return {
      ...item,
      tracked: item.tracked ?? !discovery,
      captured,
      capturedMidpoint,
      availableMidpoint: capturedMidpoint == null ? null : 100 - capturedMidpoint,
      difficulty: difficultyDetails.value,
      opportunity: opportunityDetails.value,
      difficultyDetails,
      opportunityDetails,
      organicRank: ranking?.today ?? null,
      organicTop5: ranking?.top5 ?? [],
      raw: item,
    };
  });
}

function unwrapTrafficPayload(value: unknown): TrafficIntelligencePayload {
  if (!isRecord(value)) return {};
  const inner = isRecord(value.data) ? value.data : value;
  const keywords = Array.isArray(inner.keywords)
    ? inner.keywords
    : Array.isArray(inner.rows)
      ? inner.rows
      : [];
  const discovery = Array.isArray(inner.discovery)
    ? inner.discovery
    : Array.isArray(inner.suggestions)
      ? inner.suggestions
      : [];
  return {
    ...(inner as TrafficIntelligencePayload),
    keywords: keywords.filter(isKeywordInput),
    discovery: discovery.filter(isKeywordInput),
  };
}

function unwrapMethodsPayload(value: unknown): PlatformMethodsPayload {
  if (Array.isArray(value)) return { methods: value.filter(isRecord) as PlatformMethodDescriptor[] };
  if (!isRecord(value)) return { methods: [] };
  const inner = isRecord(value.data) ? value.data : value;
  const methods = Array.isArray(inner.methods)
    ? inner.methods
    : Array.isArray(inner.endpoints)
      ? inner.endpoints
      : [];
  return { ...(inner as PlatformMethodsPayload), methods: methods.filter(isRecord) as PlatformMethodDescriptor[] };
}

async function requestJson(url: string, signal: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const relayAbort = () => controller.abort();
  signal.addEventListener('abort', relayAbort, { once: true });
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 45_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json() as { error?: string; message?: string };
        detail = body.message ?? body.error ?? '';
      } catch {
        // The status remains useful when an upstream proxy returned HTML.
      }
      throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`);
    }
    return response.json();
  } catch (error) {
    if (timedOut) throw new Error('Apple не ответила за 45 секунд. Автоматические повторы остановлены, чтобы не усиливать ограничение API.');
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener('abort', relayAbort);
  }
}

function formatPercent(value: number | null, approximate = false) {
  if (value == null) return '—';
  return `${approximate ? '~' : ''}${Math.round(value)}%`;
}

function formatEstimate(estimate: ShareEstimate) {
  if (estimate.lowerBound != null && estimate.upperBound != null) {
    if (Math.abs(estimate.lowerBound - estimate.upperBound) < 0.05) {
      return `${Math.round(estimate.lowerBound)}%`;
    }
    return `${Math.round(estimate.lowerBound)}–${Math.round(estimate.upperBound)}%`;
  }
  return formatPercent(estimate.value, true);
}

function formatNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
}

function formatRank(value: number | null | undefined, range?: { min: number; max: number } | null) {
  if (value != null) return `#${formatNumber(value)}`;
  if (range) return `#${formatNumber(range.min)}–${formatNumber(range.max)}`;
  return '—';
}

function formatMoney(value: number | null | undefined, currency = 'USD') {
  if (value == null || !Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function dateTimeLabel(value: string | number | null | undefined) {
  if (value == null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function summaryNumber(summary: Record<string, unknown> | undefined, key: string) {
  return finiteNumber(summary?.[key]);
}

function isStale(payload: TrafficIntelligencePayload | null) {
  if (payload?.stale) return true;
  if (!payload?.generatedAt) return false;
  const generatedAt = new Date(payload.generatedAt).getTime();
  return Number.isFinite(generatedAt) && Date.now() - generatedAt > 48 * 60 * 60 * 1000;
}

function isOptionalSuggestionError(item: TrafficPartialError) {
  return /^(phraseSuggestions|categorySuggestions)$/i.test(item.scope?.trim() ?? '');
}

function methodStatusLabel(status: string) {
  if (status === 'integrated') return 'подключён';
  if (status === 'available') return 'доступен';
  return status;
}

function metricTone(value: number | null, reverse = false) {
  if (value == null) return 'neutral';
  if (value >= 65) return reverse ? 'negative' : 'positive';
  if (value >= 35) return 'warning';
  return reverse ? 'positive' : 'neutral';
}

function ScorePill({ value, kind, title }: { value: number | null; kind: 'difficulty' | 'opportunity'; title: string }) {
  return (
    <span
      className={`traffic-score traffic-score-${metricTone(value, kind === 'difficulty')}`}
      title={title}
      aria-label={`${kind === 'difficulty' ? 'Сложность' : 'Потенциал'}: ${value ?? 'нет данных'}. ${title}`}
    >
      {value ?? '—'}
    </span>
  );
}

function InfoHint({ text }: { text: string }) {
  return <button type="button" className="traffic-info-button" data-tooltip={text} title={text} aria-label={`Справка: ${text}`}>ⓘ</button>;
}

function StatusNotice({ tone, title, children }: { tone: 'info' | 'warning' | 'error'; title: string; children: string }) {
  return (
    <div className={`traffic-notice traffic-notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="traffic-notice-icon" aria-hidden="true">{tone === 'error' ? '!' : tone === 'warning' ? '△' : 'i'}</span>
      <span><strong>{title}</strong><small>{children}</small></span>
    </div>
  );
}

const TRAFFIC_POPULARITY = SERIES[0];
const TRAFFIC_CAPTURED = SERIES[1];
const TRAFFIC_AVAILABLE = SERIES[2];

function TrafficChart({ rows }: { rows: TrafficKeywordRow[] }) {
  const chartRows = rows
    .filter((row) => row.popularity != null && row.capturedMidpoint != null)
    .sort((a, b) => (b.opportunity ?? -1) - (a.opportunity ?? -1))
    .slice(0, 4);
  if (chartRows.length === 0) {
    return <div className="traffic-chart-empty">Для карты спроса нужны данные о популярности и доле показов.</div>;
  }
  return <TrafficBars rows={chartRows} />;
}

/** Two bars per keyword on a shared 0–100 axis: Apple popularity index, and the
 *  impression share split into captured + still available (stacked). Kit look:
 *  --ds-grid gridlines, --ds-axis baseline, 4px rounded data-ends, kit tooltip. */
function TrafficBars({ rows }: { rows: TrafficKeywordRow[] }) {
  const [ref, width] = useWidth<HTMLDivElement>(920);
  const labelWidth = Math.min(174, width * 0.3);
  const plotWidth = Math.max(1, width - labelWidth - 24);
  const rowHeight = 44;
  const top = 22;
  const height = top + rows.length * rowHeight + 4;
  const X = (value: number) => labelWidth + (plotWidth * value) / 100;
  return (
    <div className="traffic-chart-wrap">
      <div className="dsc" ref={ref}>
        <svg viewBox={`0 0 ${width} ${height}`} height={height} role="img" aria-label="Спрос по ключам и захват трафика">
          {[0, 25, 50, 75, 100].map((tick) => (
            <g key={tick}>
              <line x1={X(tick)} x2={X(tick)} y1={top - 6} y2={height - 4} stroke={tick ? 'var(--ds-grid)' : 'var(--ds-axis)'} />
              <text x={X(tick)} y={11} textAnchor={tick === 0 ? 'start' : tick === 100 ? 'end' : 'middle'}>{tick}</text>
            </g>
          ))}
          {rows.map((row, index) => {
            const y = top + index * rowHeight;
            const popularity = normalizeScore(row.popularity) ?? 0;
            const captured = row.capturedMidpoint ?? 0;
            const available = 100 - captured;
            const tip: TipRow[] = [
              [TRAFFIC_POPULARITY, 'Индекс популярности', `${Math.round(popularity)}/100`],
              [TRAFFIC_CAPTURED, 'Захвачено (модель)', `${Math.round(captured)}%`],
              [TRAFFIC_AVAILABLE, 'Доступно (модель)', `${Math.round(available)}%`],
            ];
            const capturedW = (plotWidth * captured) / 100;
            const availableW = (plotWidth * available) / 100;
            return (
              <g key={row.keyword} {...tipProps(row.keyword, tip)}>
                <rect className="dsc-hit" x={0} y={y - 4} width={width} height={rowHeight} fill="transparent" />
                <text className="lab" x={0} y={y + 16}>{row.keyword}</text>
                <path d={hbarPath(labelWidth, y + 2, Math.max(2, (plotWidth * popularity) / 100), 10)} fill={TRAFFIC_POPULARITY} />
                {capturedW > 0 && (availableW > 0
                  ? <rect x={labelWidth} y={y + 18} width={Math.max(0, capturedW - 2)} height={10} fill={TRAFFIC_CAPTURED} />
                  : <path d={hbarPath(labelWidth, y + 18, capturedW, 10)} fill={TRAFFIC_CAPTURED} />)}
                {availableW > 0 && <path d={hbarPath(labelWidth + capturedW, y + 18, availableW, 10)} fill={TRAFFIC_AVAILABLE} />}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function KpiCard({ label, value, note, tone = 'neutral', tooltip }: {
  label: string;
  value: string;
  note: string;
  tone?: 'neutral' | 'positive' | 'warning';
  tooltip?: string;
}) {
  return (
    <article className={`traffic-kpi traffic-kpi-${tone}`} title={tooltip}>
      <div className="traffic-kpi-label">{label}{tooltip ? <InfoHint text={tooltip} /> : null}</div>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function RawDrawer({ row, onClose }: { row: TrafficKeywordRow; onClose: () => void }) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const competitors = row.competitors?.length ? row.competitors : row.organicTop5.map((item) => ({
    id: item.id,
    name: item.name,
    rank: item.pos,
    source: 'organic_top5',
  }));
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(drawerRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      ) ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !drawerRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);
  return (
    <div className="traffic-drawer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <aside ref={drawerRef} className="traffic-drawer" role="dialog" aria-modal="true" aria-labelledby="traffic-drawer-title">
        <header className="traffic-drawer-header">
          <div>
            <span className="traffic-eyebrow">Детали ключевого слова</span>
            <h2 id="traffic-drawer-title">{row.keyword}</h2>
          </div>
          <button ref={closeButtonRef} className="traffic-icon-button" type="button" onClick={onClose} aria-label="Закрыть детали">×</button>
        </header>
        <div className="traffic-drawer-body">
          <section className="traffic-detail-grid" aria-label="Расчётные показатели">
            <div><span>Популярность</span><strong>{formatNumber(row.popularity)}</strong><small>индекс Apple, не число запросов</small></div>
            <div><span>Захвачено</span><strong>{formatEstimate(row.captured)}</strong><small>{row.captured.basis === 'bounded' ? 'ограниченная' : 'смоделированная'} оценка</small></div>
            <div><span>Доступно</span><strong>{formatPercent(row.availableMidpoint, true)}</strong><small>смоделированный остаток</small></div>
            <div><span>Платная позиция</span><strong>{formatNumber(row.paidRank)}</strong><small>отчёт Apple о доле показов</small></div>
            <div><span>Сложность</span><strong>{formatNumber(row.difficulty)}</strong><small>{row.difficultyDetails.source === 'backend' ? 'серверная' : 'локальная'} модель</small></div>
            <div><span>Потенциал</span><strong>{formatNumber(row.opportunity)}</strong><small>{row.opportunityDetails.source === 'backend' ? 'серверная' : 'локальная'} модель</small></div>
          </section>
          <section className="traffic-drawer-section">
            <h3>Факторы расчёта</h3>
            <div className="traffic-score-explanation">
              <strong>Сложность · {row.difficultyDetails.source === 'backend' ? 'модель сервера' : 'расчёт интерфейса'}</strong>
              <ul>{row.difficultyDetails.factors.map((factor) => <li key={factor}>{factor}</li>)}</ul>
            </div>
            <div className="traffic-score-explanation">
              <strong>Потенциал · {row.opportunityDetails.source === 'backend' ? 'модель сервера' : 'расчёт интерфейса'}</strong>
              <ul>{row.opportunityDetails.factors.map((factor) => <li key={factor}>{factor}</li>)}</ul>
            </div>
          </section>
          <section className="traffic-drawer-section">
            <h3>Данные о конкурентах</h3>
            <p className="traffic-muted">Apple не раскрывает названия платных конкурентов. Эти приложения из органического топ‑5 служат ориентиром по тому же ключу.</p>
            {competitors.length ? (
              <ul className="traffic-competitor-list">
                {competitors.map((competitor, index) => (
                  <li key={`${competitor.id ?? competitor.name}-${index}`}>
                    <span>{competitor.name}</span>
                    <small>{competitor.rank ? `#${competitor.rank}` : 'позиция недоступна'} · {competitor.source ?? 'ориентир'}</small>
                  </li>
                ))}
              </ul>
            ) : <div className="traffic-inline-empty">Для этого ключа пока нет ориентира по конкурентам.</div>}
          </section>
          <details className="traffic-raw" open>
            <summary>Исходная запись API</summary>
            <pre>{JSON.stringify(row.raw, null, 2)}</pre>
          </details>
        </div>
      </aside>
    </div>
  );
}

function KeywordTable({ rows, app, scopeCountry, top5Country, top5Scope, organicScope, rankingsByKeyword, top5States, artworks, onVisibleTopFive, onOpen, onOpenCompetitor }: {
  rows: TrafficKeywordRow[];
  app: TrafficIntelligenceApp;
  scopeCountry: string;
  top5Country: string;
  top5Scope: string;
  organicScope: string | null;
  rankingsByKeyword: Map<string, RankingRow>;
  top5States: Record<string, CachedTopFiveState>;
  artworks: Record<string, string>;
  onVisibleTopFive: (keyword: string) => void;
  onOpen: (row: TrafficKeywordRow) => void;
  onOpenCompetitor?: (bundleId: string) => void;
}) {
  if (!rows.length) {
    return <div className="traffic-empty"><strong>Нет подходящих ключевых слов</strong><span>Измените фильтры или дождитесь следующего обновления данных Apple.</span></div>;
  }
  return (
    <div className="traffic-table-scroll">
      <table className="traffic-table">
        <thead>
          <tr>
            <th>Ключевое слово</th>
            <th><span>Популярность <InfoHint text="Относительный индекс популярности Apple; это не количество поисковых запросов." /></span></th>
            <th><span>Захвачено <InfoHint text="Смоделированная или ограниченная диапазоном оценка по данным Apple о доле показов." /></span></th>
            <th><span>Доступно <InfoHint text="Расчётный остаток после захваченной доли. Это не гарантированно доступный трафик." /></span></th>
            <th>Платная позиция</th>
            <th><span>Сложность <InfoHint text="Модель сервера, если она передана; иначе расчёт интерфейса. Наведите на оценку или откройте детали, чтобы увидеть факторы." /></span></th>
            <th><span>Потенциал <InfoHint text="Модель сервера, если она передана; иначе расчёт интерфейса. Наведите на оценку или откройте детали, чтобы увидеть факторы." /></span></th>
            <th>Наша органика {organicScope ? `· ${organicScope}` : '· скрыта'}</th>
            <th><span>Топ‑5 · {top5Country.toUpperCase()}{scopeCountry === 'ALL' ? ' (метрики: все страны)' : appStoreCountry(top5Country).toUpperCase() !== scopeCountry ? ` (${scopeCountry} не отслеживается в Keywords)` : ''} <InfoHint text="Фактический порядок пяти приложений в последнем сохранённом ASO snapshot этой витрины. При «Все страны» метрики агрегированы, но выдача остаётся витриной контекста; это не global SERP и не список платных рекламодателей." /></span></th>
            <th>Расход</th>
            <th><span className="traffic-sr-only">Детали</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = row.keyword.toLocaleLowerCase();
            const ranking = rankingsByKeyword.get(key);
            return <tr key={`${row.source ?? 'keyword'}-${row.keyword}`}>
              <td>
                <div className="traffic-keyword-cell">
                  <strong>{row.keyword}</strong>
                  <span>{row.source ?? (row.tracked ? 'ключ из аккаунта' : 'предложение')} · {row.confidence ?? 'уверенность неизвестна'}</span>
                </div>
              </td>
              <td><strong className="traffic-tabular">{formatNumber(row.popularity)}</strong><small className="traffic-cell-note">{scopeCountry === 'ALL' ? row.signalCountryCount != null ? `ср. ${row.signalCountryCount} витрин` : 'среднее доступных витрин' : scopeCountry}</small></td>
              <td>
                <span className="traffic-share-value">{formatEstimate(row.captured)}</span>
                <small className="traffic-cell-note">{scopeCountry === 'ALL' ? row.signalCountryCount != null ? `ср. ${row.signalCountryCount} витрин` : 'среднее доступных витрин' : row.captured.basis === 'bounded' ? 'диапазон' : 'модель'}</small>
              </td>
              <td>
                <span className="traffic-share-value traffic-share-available">{formatPercent(row.availableMidpoint, true)}</span>
                <small className="traffic-cell-note">модель</small>
              </td>
              <td><span className="traffic-rank">{formatRank(row.paidRank, row.paidRankRange)}</span></td>
              <td><ScorePill kind="difficulty" value={row.difficulty} title={row.difficultyDetails.tooltip} /></td>
              <td><ScorePill kind="opportunity" value={row.opportunity} title={row.opportunityDetails.tooltip} /></td>
              <td><span className="traffic-rank">{organicScope && row.organicRank != null ? `#${row.organicRank}` : '—'}</span><small className="traffic-cell-note">{organicScope ?? 'не global'}</small></td>
              <td><KeywordTopFiveInline keyword={row.keyword} scopeKey={top5Scope} ranking={ranking} app={app} artworks={artworks} status={top5States[key] === 'idle' ? 'empty' : top5States[key] ?? (ranking ? 'ready' : 'empty')} onVisible={onVisibleTopFive} onOpenCompetitor={onOpenCompetitor} /></td>
              <td><span className="traffic-tabular">{formatMoney(row.spend, row.currency)}</span></td>
              <td><button type="button" className="traffic-row-action" onClick={() => onOpen(row)} aria-label={`Открыть детали: ${row.keyword}`}>•••</button></td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
  );
}

function CompetitorProxy({ rows, apiCompetitors, organicScope }: {
  rows: OrganicCompetitorRow[];
  apiCompetitors: TrafficIntelligencePayload['competitors'];
  organicScope: string | null;
}) {
  const merged = useMemo(() => {
    const result = new Map(rows.map((row) => [row.key, row]));
    for (const competitor of apiCompetitors ?? []) {
      const key = competitor.id || competitor.name.toLocaleLowerCase();
      if (result.has(key)) continue;
      result.set(key, {
        key,
        name: competitor.name,
        developer: 'Разработчик не указан',
        appearances: competitor.appearances ?? 0,
        averageRank: competitor.averageRank ?? null,
        keywords: [],
      });
    }
    return [...result.values()].sort((a, b) => b.appearances - a.appearances);
  }, [apiCompetitors, rows]);
  return (
    <section className="traffic-panel traffic-competitors-panel">
      <header className="traffic-section-header">
        <div><span className="traffic-eyebrow">Органический ориентир{organicScope ? ` · ${organicScope}` : ''}</span><h2>Кто показывается по этому намерению</h2></div>
      </header>
      <StatusNotice tone="info" title={organicScope ? 'Названия платных конкурентов недоступны' : 'Глобальной органической выдачи не существует'}>
        {organicScope
          ? `Показан органический топ‑5 витрины ${organicScope}. Это ориентир релевантности, а не доля голоса в рекламе.`
          : 'Выберите отдельную страну. Переданные позиции относятся к текущей locale и намеренно не выдаются за глобальные.'}
      </StatusNotice>
      {merged.length ? (
        <div className="traffic-competitor-grid">
          {merged.map((competitor) => (
            <article className="traffic-competitor-card" key={competitor.key}>
              <div className="traffic-competitor-avatar" aria-hidden="true">{competitor.name.slice(0, 1).toUpperCase()}</div>
              <div className="traffic-competitor-copy">
                <strong>{competitor.name}</strong>
                <span>{competitor.developer}</span>
              </div>
              <dl>
                <div><dt>Появлений в топ‑5</dt><dd>{competitor.appearances}</dd></div>
                <div><dt>Средняя позиция</dt><dd>{competitor.averageRank == null ? '—' : `#${competitor.averageRank.toFixed(1)}`}</dd></div>
              </dl>
              <div className="traffic-keyword-chips">
                {competitor.keywords.slice(0, 4).map((keyword) => <span key={keyword}>{keyword}</span>)}
                {competitor.keywords.length > 4 ? <small>+{competitor.keywords.length - 4}</small> : null}
              </div>
            </article>
          ))}
        </div>
      ) : <div className="traffic-empty"><strong>Ориентиров по конкурентам пока нет</strong><span>Обновите органические позиции, чтобы получить приложения из топ‑5.</span></div>}
    </section>
  );
}

function ApiCoverage({ payload, loading, error }: {
  payload: PlatformMethodsPayload | null;
  loading: boolean;
  error: string | null;
}) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const methods = useMemo(() => payload?.methods ?? [], [payload?.methods]);
  const groups = useMemo(() => [...new Set(methods.map((method) => method.group ?? 'Другое'))].sort(), [methods]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return methods.filter((method) => {
      const methodGroup = method.group ?? 'Другое';
      if (group !== 'all' && methodGroup !== group) return false;
      const haystack = `${method.name ?? ''} ${method.method ?? ''} ${method.path ?? ''} ${method.description ?? ''}`.toLocaleLowerCase();
      return !needle || haystack.includes(needle);
    });
  }, [group, methods, query]);
  const integrated = methods.filter((method) => method.integrated || method.status === 'integrated' || method.status === 'live').length;
  if (loading) return <div className="traffic-loading"><span className="traffic-spinner" /><strong>Загрузка методов Platform API…</strong></div>;
  if (error) return <StatusNotice tone="error" title="Не удалось загрузить покрытие API">{error}</StatusNotice>;
  return (
    <section className="traffic-panel traffic-coverage-panel">
      <header className="traffic-section-header">
        <div><span className="traffic-eyebrow">Apple Ads Platform API</span><h2>Покрытие API</h2></div>
        <div className="traffic-coverage-summary"><strong>{integrated}/{methods.length}</strong><span>подключено методов</span></div>
      </header>
      <div className="traffic-disclosure">
        <strong>{payload?.version ?? 'Platform API'}</strong>
        <span>{payload?.baseUrl ?? 'api.ads.apple.com/v1'} · актуальный список endpoint’ов, включая чтение и запись</span>
      </div>
      <div className="traffic-filters traffic-coverage-filters">
        <label className="traffic-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти метод или путь" /></label>
        <label className="traffic-field"><span>Группа</span><select className="ds-select" value={group} onChange={(event) => setGroup(event.target.value)}><option value="all">Все группы</option>{groups.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
      </div>
      {visible.length ? (
        <div className="traffic-method-list">
          {visible.map((method, index) => {
            const status = method.integrated || method.status === 'integrated' || method.status === 'live' ? 'integrated' : method.status ?? 'available';
            return (
              <article className="traffic-method-row" key={method.id ?? `${method.method}-${method.path}-${index}`}>
                <span className={`traffic-http traffic-http-${(method.method ?? 'query').toLocaleLowerCase()}`}>{method.method ?? 'QUERY'}</span>
                <code>{method.path ?? method.name ?? 'Неизвестный путь'}</code>
                <div><strong>{method.name ?? 'Метод без названия'}</strong><small>{method.description ?? `${method.group ?? 'Другое'} · ${method.access ?? 'доступ не классифицирован'}`}</small></div>
                <span className={`traffic-method-status traffic-method-status-${status}`}>{methodStatusLabel(status)}</span>
                {method.docsUrl ? <a href={method.docsUrl} target="_blank" rel="noreferrer" aria-label={`Открыть документацию: ${method.name ?? method.path}`}>↗</a> : <span />}
              </article>
            );
          })}
        </div>
      ) : <div className="traffic-empty"><strong>Методы не найдены</strong><span>Очистите фильтр или проверьте endpoint со списком методов.</span></div>}
      {payload?.partialErrors?.map((item, index) => <StatusNotice key={`${item.scope}-${index}`} tone="warning" title={item.scope ?? 'Часть API-инвентаря недоступна'}>{item.message}</StatusNotice>)}
    </section>
  );
}

export default function TrafficIntelligence({ app, locale, rankings = [], artworks: sharedArtworks = {}, sharedTopFive = {}, sharedTopFiveStatus = {}, onResolveTopFive, onEnsureArtworks, className = '', onOpenCompetitor }: TrafficIntelligenceProps) {
  const [view, setView] = useState<View>('traffic');
  const [compactHeader, workspaceRef] = useFoldOnScroll();
  // Storefront scope comes from the global «Страна» filter in the sidebar.
  const { country: globalCountry, label: scopeLabelText } = useCountry();
  const [trafficRemote, setTrafficRemote] = useState<{
    requestKey: string;
    payloadScope: string;
    payload: TrafficIntelligencePayload | null;
    error: string | null;
  }>({ requestKey: '', payloadScope: '', payload: null, error: null });
  const [methodsRemote, setMethodsRemote] = useState<{
    requestKey: string;
    payload: PlatformMethodsPayload | null;
    error: string | null;
  }>({ requestKey: '', payload: null, error: null });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RowFilter>('all');
  const [sort, setSort] = useState<SortKey>('opportunity');
  const [selectedRow, setSelectedRow] = useState<TrafficKeywordRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // A drawer row belongs to the previous storefront scope.
  useEffect(() => { setSelectedRow(null); }, [globalCountry]);
  const countryScope = globalCountry === WORLD ? 'ALL' : globalCountry;
  const localeCountry = appStoreCountry(locale).toUpperCase();
  const organicScope = countryScope !== 'ALL' && countryScope === localeCountry ? countryScope : null;
  const trafficScope = `${app.id}:${app.iTunesId}:${countryScope}`;
  // One real storefront gives the ASO context: the chosen country when
  // Keywords tracks it, else the app's default storefront (the bridge picks
  // it). It is deliberately not an invented global search result.
  const top5Country = locale.toLocaleLowerCase();
  const top5Scope = `${app.id}:${app.iTunesId}:${top5Country}`;
  const artworks = sharedArtworks;
  const trafficRequestKey = `${trafficScope}:${refreshKey}`;
  const methodsRequestKey = 'platform-methods-v1';
  const hasTrafficScope = Boolean(app.id && app.iTunesId && locale);
  const loading = hasTrafficScope && trafficRemote.requestKey !== trafficRequestKey;
  const payload = trafficRemote.payloadScope === trafficScope ? trafficRemote.payload : null;
  const error = trafficRemote.requestKey === trafficRequestKey ? trafficRemote.error : null;
  const methodsLoading = methodsRemote.requestKey !== methodsRequestKey;
  const methods = methodsRemote.payload;
  const methodsError = methodsRemote.requestKey === methodsRequestKey ? methodsRemote.error : null;

  const requestVisibleTopFive = useCallback((keyword: string) => {
    const key = keyword.toLocaleLowerCase();
    const sharedKey = `${app.id}:${top5Country.toLocaleLowerCase()}:${key}`;
    const shared = sharedTopFive[sharedKey];
    if (shared) {
      if (shared.top5.length) onEnsureArtworks?.(shared.top5, top5Country.toLocaleLowerCase());
      return;
    }
    const existing = rankings.find((row) => row.locale.toLocaleLowerCase() === top5Country && row.keyword.toLocaleLowerCase() === key);
    if (existing) {
      if (existing.top5.length) onEnsureArtworks?.(existing.top5, top5Country.toLocaleLowerCase());
      return;
    }
    onResolveTopFive?.(app.id, app.iTunesId, top5Country, keyword);
  }, [app.id, app.iTunesId, onEnsureArtworks, onResolveTopFive, rankings, sharedTopFive, top5Country]);

  useEffect(() => {
    if (!app.id || !app.iTunesId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ app_id: app.iTunesId, country: countryScope, days: '30' });
    requestJson(asaApiUrl(`/api/decision-matrix?${params}`), controller.signal)
      .then((value) => {
        const nextPayload = unwrapTrafficPayload(value);
        setTrafficRemote({ requestKey: trafficRequestKey, payloadScope: trafficScope, payload: nextPayload, error: null });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setTrafficRemote((current) => ({
            requestKey: trafficRequestKey,
            payloadScope: current.payloadScope,
            payload: current.payload,
            error: reason instanceof Error ? reason.message : String(reason),
          }));
        }
      });
    return () => controller.abort();
  }, [app.id, app.iTunesId, countryScope, trafficRequestKey, trafficScope]);

  useEffect(() => {
    const controller = new AbortController();
    requestJson(asaApiUrl('/api/platform/methods'), controller.signal)
      .then((value) => setMethodsRemote({ requestKey: methodsRequestKey, payload: unwrapMethodsPayload(value), error: null }))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setMethodsRemote((current) => ({
            requestKey: methodsRequestKey,
            payload: current.payload,
            error: reason instanceof Error ? reason.message : String(reason),
          }));
        }
      });
    return () => controller.abort();
  }, [methodsRequestKey]);

  const organicByKeyword = useMemo(
    () => new Map((organicScope ? rankings : []).map((row) => [row.keyword.toLocaleLowerCase(), row])),
    [organicScope, rankings],
  );
  const top5VisibleRankings = useMemo(() => {
    const contextualSnapshots = rankings.filter((row) => row.locale.toLocaleLowerCase() === top5Country);
    const merged = new Map(contextualSnapshots.map((row) => [row.keyword.toLocaleLowerCase(), row]));
    const prefix = `${app.id}:${top5Country.toLocaleLowerCase()}:`;
    for (const [key, ranking] of Object.entries(sharedTopFive)) {
      if (key.startsWith(prefix)) merged.set(key.slice(prefix.length), ranking);
    }
    return merged;
  }, [app.id, rankings, sharedTopFive, top5Country]);
  const top5DisplayStates = useMemo(() => {
    const prefix = `${app.id}:${top5Country.toLocaleLowerCase()}:`;
    const next: Record<string, CachedTopFiveState> = {};
    for (const [key, status] of Object.entries(sharedTopFiveStatus)) if (key.startsWith(prefix)) next[key.slice(prefix.length)] = status;
    return next;
  }, [app.id, sharedTopFiveStatus, top5Country]);

  const trafficRows = useMemo(() => buildTrafficRows(payload?.keywords ?? [], organicByKeyword), [organicByKeyword, payload?.keywords]);
  const discoveryRows = useMemo(() => buildTrafficRows(payload?.discovery ?? [], organicByKeyword, true), [organicByKeyword, payload?.discovery]);
  const activeRows = view === 'discovery' ? discoveryRows : trafficRows;

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return activeRows
      .filter((row) => {
        if (needle && !row.keyword.toLocaleLowerCase().includes(needle)) return false;
        if (filter === 'tracked') return Boolean(row.tracked);
        if (filter === 'opportunity') return (row.opportunity ?? 0) >= 25;
        if (filter === 'measured') return row.capturedMidpoint != null;
        if (filter === 'unmeasured') return row.capturedMidpoint == null;
        return true;
      })
      .sort((a, b) => {
        if (sort === 'keyword') return a.keyword.localeCompare(b.keyword);
        const left = sort === 'popularity' ? normalizeScore(a.popularity) : sort === 'captured' ? a.capturedMidpoint : sort === 'difficulty' ? a.difficulty : a.opportunity;
        const right = sort === 'popularity' ? normalizeScore(b.popularity) : sort === 'captured' ? b.capturedMidpoint : sort === 'difficulty' ? b.difficulty : b.opportunity;
        if (left == null && right == null) return a.keyword.localeCompare(b.keyword);
        if (left == null) return 1;
        if (right == null) return -1;
        return sort === 'captured' || sort === 'difficulty' ? left - right : right - left;
      });
  }, [activeRows, filter, query, sort]);

  const competitorRows = useMemo(() => {
    const map = new Map<string, { key: string; name: string; developer: string; ranks: number[]; keywords: Set<string> }>();
    const ownTid = Number(app.iTunesId);
    const ownBundle = app.bundle?.toLocaleLowerCase() ?? '';
    for (const ranking of organicScope ? rankings : []) {
      for (let index = 0; index < ranking.top5.length; index += 1) {
        const competitor = ranking.top5[index];
        const bundle = competitor.id.toLocaleLowerCase();
        const own = (Number.isFinite(ownTid) && competitor.tid === ownTid)
          || Boolean(ownBundle && (bundle === ownBundle || bundle.startsWith(ownBundle)));
        if (own) continue;
        const key = competitor.id || competitor.name.toLocaleLowerCase();
        const current = map.get(key) ?? { key, name: competitor.name, developer: competitor.dev, ranks: [], keywords: new Set<string>() };
        current.ranks.push(competitor.pos ?? index + 1);
        current.keywords.add(ranking.keyword);
        map.set(key, current);
      }
    }
    return [...map.values()].map((item) => ({
      key: item.key,
      name: item.name,
      developer: item.developer,
      appearances: item.ranks.length,
      averageRank: item.ranks.length ? item.ranks.reduce((sum, rank) => sum + rank, 0) / item.ranks.length : null,
      keywords: [...item.keywords],
    })).sort((a, b) => b.appearances - a.appearances);
  }, [app.bundle, app.iTunesId, organicScope, rankings]);

  const weighted = useMemo(() => {
    let demand = 0;
    let capturedDemand = 0;
    for (const row of trafficRows) {
      const popularity = normalizeScore(row.popularity);
      if (popularity == null || row.capturedMidpoint == null) continue;
      demand += popularity;
      capturedDemand += popularity * row.capturedMidpoint;
    }
    return demand ? capturedDemand / demand : null;
  }, [trafficRows]);
  const available = weighted == null ? null : 100 - weighted;
  const highOpportunity = trafficRows.filter((row) => (row.opportunity ?? 0) >= 25).length;
  const measured = trafficRows.filter((row) => row.capturedMidpoint != null).length;
  const partialErrors = payload?.partialErrors ?? payload?.errors ?? [];
  const generatedAt = dateTimeLabel(payload?.generatedAt);
  const totalImpressions = summaryNumber(payload?.summary, 'impressions');
  const totalSpend = summaryNumber(payload?.summary, 'spend');
  const totalTrials = summaryNumber(payload?.summary, 'trials');
  const totalPaid = summaryNumber(payload?.summary, 'paid');
  const scopeStorefronts = summaryNumber(payload?.summary, 'countries');
  const scopeExplanation = countryScope === 'ALL'
    ? payload?.limitations?.allScope ?? 'Доставка и экономика суммируются; популярность и доля усредняются только по витринам с доступным сигналом Apple.'
    : 'Trials, paid и net revenue отфильтрованы по выбранной стране. Доставка и расход мультигео-кампаний — доля этой страны из отчёта Apple «ключ × страна»; кампании без такой разбивки не учитываются.';
  const forceRefresh = () => {
    setRefreshKey((value) => value + 1);
  };

  useEffect(() => {
    if (!payload || loading) return;
    const stale = isStale(payload);
    const refreshAt = stale ? payload.cache?.nextRetryAt ?? payload.cache?.expiresAt : payload.cache?.expiresAt;
    const parsedRefreshAt = refreshAt == null ? Number.NaN : new Date(refreshAt).getTime();
    if (!Number.isFinite(parsedRefreshAt) && !stale) return;
    const untilRefresh = Number.isFinite(parsedRefreshAt) ? parsedRefreshAt - Date.now() + 1_000 : 60_000;
    const delay = stale
      ? Math.min(5 * 60 * 1000, Math.max(15_000, untilRefresh))
      : Math.max(15_000, untilRefresh);
    const timer = window.setTimeout(() => setRefreshKey((value) => value + 1), delay);
    return () => window.clearTimeout(timer);
  }, [loading, payload, trafficRemote.requestKey]);

  return (
    <main ref={workspaceRef} className={`traffic-workspace ${compactHeader ? 'is-compact' : ''} ${className}`.trim()}>
      <header className="traffic-header">
        <div className="traffic-title-block">
          <div className="traffic-title-line"><h1 className="ds-page-title">Аналитика трафика</h1>{isStale(payload) ? <span className="traffic-stale-badge">Данные устарели</span> : null}</div>
          <p className="ds-page-sub fold">{app.name} · {scopeLabelText} · последние 30 дней · Apple ID {app.iTunesId}</p>
        </div>
        <div className="traffic-header-actions">
          <ScopeBadge />
          <span className="traffic-freshness">{generatedAt ? `Обновлено: ${generatedAt}${payload?.servedFromCache ? ' · сохранённый снимок' : ''}` : 'Время обновления неизвестно'}</span>
          <button className="ds-btn traffic-refresh-button" type="button" onClick={forceRefresh} disabled={loading}>↻ <span>{loading ? 'Обновление' : 'Обновить'}</span></button>
        </div>
      </header>

      <nav className="traffic-tabs" aria-label="Разделы аналитики трафика">
        {([
          ['traffic', 'Карта трафика', trafficRows.length, 'Спрос, захваченная и расчётно доступная доля по отслеживаемым ключам.'],
          ['discovery', 'Идеи ключей', discoveryRows.length, 'Кандидаты для ручной проверки; они не добавляются в кампании автоматически.'],
          ['competitors', 'Ориентир по конкурентам', competitorRows.length, 'Органический топ‑5 по ключам, а не список платных рекламодателей.'],
          ['coverage', 'Покрытие API', methods?.methods?.length ?? 0, 'Справочник подключённых методов и диагностика частичных ошибок API.'],
        ] as Array<[View, string, number, string]>).map(([id, label, count, description]) => (
          <button key={id} type="button" title={description} aria-label={`${label}. ${description}`} className={view === id ? 'traffic-tab-active' : ''} onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined}>{label}<span>{count}</span></button>
        ))}
      </nav>

      <div className="traffic-content">
        {payload ? <section className="traffic-scope-summary" aria-label="Область и способ агрегации данных">
          <div><span>Область</span><strong>{countryScope === 'ALL' ? `Все страны${scopeStorefronts != null ? ` · ${formatNumber(scopeStorefronts)} витрин` : ''}` : countryScope}</strong></div>
          <div><span>Доставка · сумма</span><strong>{formatNumber(totalImpressions)} показов · {formatMoney(totalSpend)}</strong></div>
          <div><span>Экономика · сумма</span><strong>{formatNumber(totalTrials)} trials · {formatNumber(totalPaid)} paid</strong></div>
          <p><strong>{countryScope === 'ALL' ? 'Средние по витринам:' : 'Одна витрина:'}</strong> {scopeExplanation} {organicScope ? `Органика показана только для ${organicScope}.` : 'Органическая позиция скрыта: переданная locale не является global/не совпадает со scope.'}</p>
        </section> : null}
        {view === 'coverage' ? <ApiCoverage payload={methods} loading={methodsLoading} error={methodsError} /> : null}
        {view === 'competitors' ? <CompetitorProxy rows={competitorRows} apiCompetitors={payload?.competitors} organicScope={organicScope} /> : null}
        {(view === 'traffic' || view === 'discovery') && loading && !payload ? (
          <div className="traffic-loading"><span className="traffic-spinner" /><strong>Загрузка единого снимка…</strong><small>Один агрегирующий запрос возвращает ключи выбранной страны или всех стран без fan-out по Apple API.</small></div>
        ) : null}
        {(view === 'traffic' || view === 'discovery') && !loading && error && !payload ? (
          <section className="traffic-error-state"><StatusNotice tone="error" title="Не удалось загрузить данные о трафике">{error}</StatusNotice><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>Повторить</button></section>
        ) : null}
        {(view === 'traffic' || view === 'discovery') && payload ? (
          <>
            {error ? <StatusNotice tone="warning" title="Не удалось обновить снимок">{`Сохранённые данные оставлены на экране. Ошибка обновления: ${error}`}</StatusNotice> : null}
            {loading ? <StatusNotice tone="info" title="Обновляем данные в фоне">Текущий сохранённый снимок остаётся доступен до завершения запроса.</StatusNotice> : null}
            {partialErrors.filter((item) => !isOptionalSuggestionError(item)).map((item, index) => <StatusNotice key={`${item.scope}-${index}`} tone="warning" title="Часть данных недоступна">{item.message}</StatusNotice>)}
            {view === 'discovery' && partialErrors.some(isOptionalSuggestionError) ? <StatusNotice tone="info" title="Часть источников идей временно недоступна">Это не влияет на основные данные о трафике. Подробности доступны в разделе «Покрытие API» и диагностике.</StatusNotice> : null}
            {isStale(payload) ? <StatusNotice tone="warning" title="Этот снимок может быть устаревшим">Данные остаются на экране; система попробует обновить их автоматически после паузы, не усиливая лимит Apple.</StatusNotice> : null}
            {view === 'traffic' ? (
              <>
                <section className="traffic-kpi-grid" aria-label="Обзор трафика">
                  <KpiCard label="Ключи с измеренной долей" value={`${measured}/${trafficRows.length}`} note="есть данные о доле показов" tooltip="Учитываются только ключи, для которых Apple передала или позволила оценить долю показов." />
                  <KpiCard label="Захваченная доля · модель" value={formatPercent(weighted, true)} note="с весом по популярности" tone={weighted != null && weighted >= 50 ? 'positive' : 'neutral'} tooltip="Взвешено по относительному индексу популярности Apple; это не оценка размера рынка." />
                  <KpiCard label="Доступная доля · модель" value={formatPercent(available, true)} note="остаток модели или диапазона" tone={available != null && available >= 40 ? 'warning' : 'neutral'} tooltip="Незахваченные показы не означают гарантированно доступный трафик." />
                  <KpiCard label="Высокий потенциал" value={String(highOpportunity)} note="расчётный балл ≥25" tone={highOpportunity ? 'warning' : 'neutral'} tooltip={`${BACKEND_SCORE_NOTE} Расчёт интерфейса используется, только когда сервер не передал показатель.`} />
                </section>
                <section className="traffic-panel traffic-chart-panel">
                  <header className="traffic-section-header">
                    <div><span className="traffic-eyebrow">Карта спроса</span><h2>Где остаётся спрос</h2><p className="traffic-muted">Верхняя линия — популярность ключа; нижняя — какая доля уже захвачена и какая остаётся расчётно доступной.</p></div>
                    <div className="dsc-legend" aria-label="Легенда графика"><span><i style={{ background: TRAFFIC_POPULARITY }} />Индекс популярности <InfoHint text="Верхняя полоса. Шкала от 0 до 100 показывает относительную популярность Apple, не число поисков." /></span><span><i style={{ background: TRAFFIC_CAPTURED }} />Захвачено <InfoHint text="Левая часть нижней полосы: смоделированная или ограниченная диапазоном доля показов вашего приложения." /></span><span><i style={{ background: TRAFFIC_AVAILABLE }} />Доступно <InfoHint text="Правая часть нижней полосы: остаток после захваченной доли. Он не гарантирует получение трафика." /></span></div>
                  </header>
                  <TrafficChart rows={trafficRows} />
                </section>
              </>
            ) : (
              <section className="traffic-discovery-intro">
                <div><span className="traffic-eyebrow">Подбор кандидатов</span><h2>Очередь идей</h2><p>Пробелы в доле показов и найденные поисковые запросы ранжированы по прозрачному потенциалу. Проверьте релевантность перед добавлением в аккаунт.</p></div>
                <div className="traffic-discovery-rule"><strong>Без автоматического добавления</strong><span>{payload?.unverifiedSuggestions?.length ? `${payload.unverifiedSuggestions.length} предложений только от Apple удерживаются как непроверенные. ` : ''}Для добавления в точное соответствие нужны релевантность и положительная экономика.</span></div>
              </section>
            )}

            <section className="traffic-panel traffic-keywords-panel">
              <header className="traffic-section-header">
                <div><span className="traffic-eyebrow">{view === 'discovery' ? 'Неотслеживаемые кандидаты' : 'Данные по ключам'}</span><h2>{view === 'discovery' ? 'Кандидаты с подтверждением' : 'Трафик по ключевым словам'}</h2></div>
                <span className="traffic-row-count">{visibleRows.length} строк</span>
              </header>
              <div className="traffic-filters">
                <label className="traffic-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти ключевое слово" /></label>
                <label className="traffic-field"><span>Фильтр</span><select className="ds-select" value={filter} onChange={(event) => setFilter(event.target.value as RowFilter)}><option value="all">Все строки</option><option value="tracked">Отслеживаемые</option><option value="opportunity">Высокий потенциал</option><option value="measured">Доля измерена</option><option value="unmeasured">Доля недоступна</option></select></label>
                <label className="traffic-field"><span>Сортировка</span><select className="ds-select" value={sort} onChange={(event) => setSort(event.target.value as SortKey)}><option value="opportunity">Потенциал ↓</option><option value="popularity">Популярность ↓</option><option value="captured">Захвачено ↑</option><option value="difficulty">Сложность ↑</option><option value="keyword">Ключевое слово А–Я</option></select></label>
              </div>
              <div className="traffic-formula-strip"><span><strong>Популярность</strong> — относительный индекс Apple, не число поисков.</span><span><strong>Захвачено / доступно</strong> — модель или оценка в диапазоне.</span><span><strong>Сложность / потенциал</strong> берутся из модели сервера; наведите на балл или откройте детали, чтобы увидеть факторы.</span></div>
              <KeywordTable
                rows={visibleRows}
                app={app}
                scopeCountry={countryScope}
                top5Country={top5Country}
                top5Scope={top5Scope}
                organicScope={organicScope}
                rankingsByKeyword={top5VisibleRankings}
                top5States={top5DisplayStates}
                artworks={artworks}
                onVisibleTopFive={requestVisibleTopFive}
                onOpen={setSelectedRow}
                onOpenCompetitor={onOpenCompetitor}
              />
            </section>
          </>
        ) : null}
      </div>
      {selectedRow ? <RawDrawer row={selectedRow} onClose={() => setSelectedRow(null)} /> : null}
    </main>
  );
}
