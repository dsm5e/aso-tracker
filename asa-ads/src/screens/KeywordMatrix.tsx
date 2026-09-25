import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, asaApiUrl, type DataQualityPayload } from '../api.ts';
import { keywordsApiUrl, type RankingRow } from '../lib/keywordsApi.ts';
import type { ShareEstimate, TrafficIntelligencePayload, TrafficKeywordInput } from './TrafficIntelligence.tsx';
import DataQuality from '../components/DataQuality.tsx';
import KeywordResultsDrawer, { KeywordTopFiveInline } from '../components/KeywordResultsDrawer.tsx';
import { appStoreCountry } from '../lib/appStoreLocales.ts';
import './DecisionMatrix.css';

export interface DecisionMatrixApp {
  id: string;
  name: string;
  iTunesId: string;
  bundle: string;
  iconUrl?: string;
}

export interface DecisionMatrixProps {
  app: DecisionMatrixApp;
  locale: string;
  artworks?: Record<string, string>;
  sharedTopFive?: Record<string, RankingRow>;
  sharedTopFiveStatus?: Record<string, 'loading' | 'ready' | 'empty' | 'error'>;
  onResolveTopFive?: (appId: string, iTunesId: string, country: string, keyword: string) => void;
  onEnsureArtworks?: (candidates: Array<{ id: string; tid?: number }>, country: string) => void;
  className?: string;
}

type JsonRecord = Record<string, unknown>;
type ActionKind = 'scale' | 'test' | 'hold' | 'narrow' | 'pause' | 'collect';
type ActionFilter = 'all' | ActionKind;

interface RemoteState<T> {
  key: string;
  data: T | null;
  error: string | null;
}

interface Economics {
  attributedInstalls: number | null;
  trials: number | null;
  paid: number | null;
  revenue: number | null;
  roas: number | null;
  cpaTrial: number | null;
  cpaPaid: number | null;
  maturity: string | null;
  maturityState: 'mature' | 'immature' | null;
  source: string | null;
  present: boolean;
}

interface Recommendation {
  kind: ActionKind;
  label: string;
  reason: string;
  evidence: string[];
  missing: string[];
}

interface DecisionRow {
  keyword: string;
  geo: string;
  tracked: boolean;
  queue: 'account' | 'discovery' | 'unverified';
  organicRank: number | null;
  organicRankRange: { min: number; max: number } | null;
  organicCountryCount: number;
  popularity: number | null;
  share: ShareEstimate;
  shareMidpoint: number | null;
  paidRank: number | null;
  paidRankRange: { min: number; max: number } | null;
  bid: number | null;
  bidRange: { min: number; max: number } | null;
  currency: string | null;
  impressions: number | null;
  taps: number | null;
  installs: number | null;
  attributedInstalls: number | null;
  countryCount: number;
  signalCountryCount: number;
  relevanceStatus: string | null;
  economics: Economics;
  confidence: string | null;
  source: string | null;
  recommendation: Recommendation;
  raw: TrafficKeywordInput;
}

interface DecisionMatrixCountry {
  code: string;
  keywordCount: number;
  attributedInstalls: number;
  trials: number;
  paid: number;
  revenueUsd: number;
}

interface DecisionMatrixSummary {
  [key: string]: unknown;
  countries?: number;
  keywords?: number;
  discoveryCandidates?: number;
  rejectedDiscovery?: number;
  impressions?: number;
  taps?: number;
  installs?: number;
  attributedInstalls?: number;
  trials?: number;
  paid?: number;
  spend?: number;
  revenueUsd?: number;
  installToTrial?: number | null;
  trialToPaid?: number | null;
  installToPaid?: number | null;
  roas?: number | null;
}

interface DecisionMatrixPayload extends TrafficIntelligencePayload {
  scope?: 'all' | 'country';
  country?: string | null;
  availableCountries?: DecisionMatrixCountry[];
  summary?: DecisionMatrixSummary;
}

const NO_DATA = 'нет данных';
const HIGH_DEMAND = 60;
const LOW_DEMAND = 30;
const HIGH_SHARE = 60;
const LOW_SHARE = 30;
const MIN_TEST_IMPRESSIONS = 30;
const MIN_TEST_TAPS = 5;

const ACTION_LABELS: Record<ActionKind, string> = {
  scale: 'Масштабировать',
  test: 'Тестировать',
  hold: 'Удерживать',
  narrow: 'Сузить',
  pause: 'Остановить',
  collect: 'Собрать данные',
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(/[%,×$€£\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const number = finite(value);
    if (number != null) return number;
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function percent(value: unknown): number | null {
  const number = finite(value);
  if (number == null) return null;
  return Math.max(0, Math.min(100, number >= 0 && number <= 1 ? number * 100 : number));
}

function readShare(row: TrafficKeywordInput): ShareEstimate {
  const input = row.capturedShare ?? row.impressionShare;
  if (!isRecord(input)) return { value: percent(input), basis: 'modeled' };
  const lowerBound = percent(input.lowerBound ?? input.low ?? input.min);
  const upperBound = percent(input.upperBound ?? input.high ?? input.max);
  const direct = percent(input.value ?? input.mid ?? input.midpoint ?? input.share);
  return {
    value: direct ?? (lowerBound != null && upperBound != null ? (lowerBound + upperBound) / 2 : null),
    lowerBound,
    upperBound,
    basis: lowerBound != null || upperBound != null ? 'bounded' : 'modeled',
  };
}

function shareMidpoint(share: ShareEstimate) {
  if (share.value != null) return share.value;
  if (share.lowerBound != null && share.upperBound != null) return (share.lowerBound + share.upperBound) / 2;
  return null;
}

function nested(record: JsonRecord, key: string) {
  return isRecord(record[key]) ? record[key] : {};
}

function parseMaturity(value: string | null): Economics['maturityState'] {
  if (!value) return null;
  const normalized = value.toLocaleLowerCase();
  if (/(mature|complete|closed|созрел|зрел)/.test(normalized)) return 'mature';
  if (/(immature|incomplete|open|pending|partial|незрел|не созрел)/.test(normalized)) return 'immature';
  return null;
}

function readEconomics(input: TrafficKeywordInput): Economics {
  const row = input as unknown as JsonRecord;
  const economics = nested(row, 'economics');
  const observed = nested(nested(row, 'model'), 'observed');
  const cohort = nested(row, 'cohort');
  const maturity = firstString(row.maturity, row.cohortMaturity, row.cohort_maturity, economics.maturity, economics.cohortMaturity, cohort.maturity, cohort.status);
  const source = firstString(row.economicsGrain, economics.economicsGrain, economics.source, row.economicsSource, row.economics_source, cohort.source);
  const updatedAt = firstString(row.revenueUpdatedAt, row.revenue_updated_at, economics.updatedAt, economics.updated_at, cohort.updatedAt);
  const sourceSaysMissing = source?.toLocaleLowerCase() === 'missing';
  const explicitEconomics = ['attributedInstalls', 'trials', 'paid', 'revenue', 'revenueUsd', 'netRevenue', 'roas', 'roi', 'cpaTrial', 'cpaPaid']
    .some((key) => economics[key] != null);
  const hasAttribution = Boolean(updatedAt || (source && !sourceSaysMissing) || explicitEconomics);
  // The traffic API emits numeric zeros for aggregation convenience even when
  // no keyword-level revenue mapping exists. Do not turn those placeholders
  // into observed zero trials/revenue in the decision UI.
  const attributedInstalls = hasAttribution ? firstNumber(row.attributedInstalls, row.attributed_installs, economics.attributedInstalls, economics.attributed_installs) : null;
  const trials = hasAttribution ? firstNumber(row.trials, row.trialStarts, row.trial_starts, economics.trials, economics.trialStarts, observed.trials) : null;
  const paid = hasAttribution ? firstNumber(row.paid, row.paidSubscriptions, row.paid_subscriptions, economics.paid, economics.paidSubscriptions, observed.paid) : null;
  const revenue = hasAttribution ? firstNumber(row.revenue, row.revenueUsd, row.revenue_usd, economics.revenue, economics.revenueUsd, economics.netRevenue, economics.netProceeds) : null;
  const roas = hasAttribution ? firstNumber(row.realizedRoas, row.roas, row.roi, economics.realizedRoas, economics.roas, economics.roi) : null;
  const cpaTrial = hasAttribution ? firstNumber(row.cpaTrial, row.cpa_trial, economics.cpaTrial, economics.cpa_trial) : null;
  const cpaPaid = hasAttribution ? firstNumber(row.cpaPaid, row.cpa_paid, economics.cpaPaid, economics.cpa_paid) : null;
  return {
    attributedInstalls,
    trials,
    paid,
    revenue,
    roas,
    cpaTrial,
    cpaPaid,
    maturity,
    maturityState: parseMaturity(maturity),
    source,
    present: [attributedInstalls, trials, paid, revenue, roas, cpaTrial, cpaPaid].some((value) => value != null),
  };
}

function observedValue(economics: Economics): 'strong' | 'weak' | 'negative' | null {
  if (economics.roas != null) {
    if (economics.roas >= 1) return 'strong';
    if (economics.roas < 0.7) return 'negative';
    return 'weak';
  }
  if (economics.revenue != null) {
    // Revenue without spend-relative economics cannot prove profitability.
    return null;
  }
  return null;
}

function recommendationFor(input: {
  tracked: boolean;
  queue: DecisionRow['queue'];
  popularity: number | null;
  share: number | null;
  paidRank: number | null;
  bid: number | null;
  impressions: number | null;
  confidence: string | null;
  taps: number | null;
  installs: number | null;
  economics: Economics;
}): Recommendation {
  const { tracked, queue, popularity, share, paidRank, bid, impressions, confidence, taps, installs, economics } = input;
  const missing: string[] = [];
  if (popularity == null) missing.push('популярность Apple');
  if (share == null) missing.push('доля показов');
  if (!economics.present) missing.push('триалы / оплаты / экономика');
  if (economics.maturityState == null) missing.push('зрелость когорты');

  const evidence: string[] = [];
  if (popularity != null) evidence.push(`популярность ${Math.round(popularity)}/100`);
  if (share != null) evidence.push(`захвачено около ${Math.round(share)}%`);
  if (paidRank != null) evidence.push(`платная позиция #${paidRank}`);
  if (taps != null) evidence.push(`${taps} тапов`);
  if (economics.roas != null) evidence.push(`ROAS ${economics.roas.toFixed(2)}×`);
  if (economics.maturity) evidence.push(`когорта: ${economics.maturity}`);

  if (queue === 'unverified') {
    return {
      kind: 'collect',
      label: 'Проверить релевантность',
      reason: 'Кандидат не подтверждён спросом или данными аккаунта. Не добавлять автоматически.',
      evidence,
      missing,
    };
  }

  // A discovery term has no owned bid to raise. Apple share/rank can prove
  // that the app appeared for the query through broad/Search Match, but it is
  // not proof of semantic relevance. A capped exact test additionally needs
  // observed taps/installs from our account; otherwise inspect the top-5 first.
  if (!tracked) {
    const observedIntent = (installs ?? 0) > 0 || (taps ?? 0) >= MIN_TEST_TAPS;
    if (observedIntent && popularity != null && popularity >= HIGH_DEMAND && share != null && share < LOW_SHARE && paidRank != null && confidence !== 'low') {
      return {
        kind: 'test',
        label: 'Создать exact-тест',
        reason: 'Apple подтверждает спрос и слабое покрытие, но отдельного ключа и ставки в аккаунте нет. Создать ограниченный exact-тест с лимитом расхода и проверить установки.',
        evidence,
        missing,
      };
    }
    return {
      kind: 'collect',
      label: 'Проверить релевантность',
      reason: 'Это кандидат из поисковых сигналов без подтверждённых установок. Сначала проверить органический топ‑5 и медицинский интент; изменение ставки здесь неприменимо.',
      evidence,
      missing,
    };
  }

  if (popularity == null || share == null) {
    return {
      kind: 'collect',
      label: 'Дождаться сигналов Apple',
      reason: 'Без одновременных данных о спросе и доле показов нельзя отличить потолок спроса от проигрыша аукциона.',
      evidence,
      missing,
    };
  }

  const value = observedValue(economics);
  if ((value === 'negative' || value === 'weak') && economics.maturityState === 'mature') {
    return {
      kind: value === 'negative' ? 'pause' : 'narrow',
      label: value === 'negative' ? 'Снизить или остановить' : 'Сузить трафик',
      reason: value === 'negative'
        ? 'Зрелая наблюдаемая экономика отрицательна; сначала проверить атрибуцию, затем ограничить расход.'
        : 'Доля трафика уже оплачивается, но зрелая экономика ниже безубыточности; снизить ставку или сузить match.',
      evidence,
      missing,
    };
  }

  if ((value === 'negative' || value === 'weak') && economics.maturityState !== 'mature') {
    return {
      kind: 'hold',
      label: 'Не резать до созревания',
      reason: 'Ранний ROAS выглядит слабым, но зрелость когорты не подтверждена.',
      evidence,
      missing,
    };
  }

  if (popularity >= HIGH_DEMAND && share < LOW_SHARE) {
    if (value === 'strong' && economics.maturityState === 'mature') {
      return {
        kind: 'scale',
        label: 'Тест ставки +10–20%',
        reason: 'Высокий спрос, низкая доля и подтверждённая зрелая экономика: наиболее сильный кандидат на контролируемое расширение.',
        evidence,
        missing,
      };
    }
    if (bid == null) {
      return {
        kind: 'collect',
        label: 'Проверить структуру',
        reason: 'Ключ отмечен как активный, но текущая ставка отсутствует. До изменения bid нужно проверить владельца ключа и состояние группы.',
        evidence,
        missing,
      };
    }
    if ((impressions ?? 0) >= MIN_TEST_IMPRESSIONS && (taps ?? 0) >= MIN_TEST_TAPS && !economics.present) {
      return {
        kind: 'collect',
        label: installs && installs > 0 ? 'Восстановить экономику' : 'Не повышать ставку',
        reason: installs && installs > 0
          ? 'Выборка доставки уже есть, но подписочные события не связаны с текущим ключом. Сначала восстановить attribution, затем решать по ставке.'
          : 'Ключ уже набрал достаточную выборку без подтверждённых установок и экономики. Повышение ставки сейчас увеличит риск расхода.',
        evidence,
        missing,
      };
    }
    return {
      kind: 'test',
      label: 'Тест ставки +10%',
      reason: 'Активный ключ имеет высокий спрос и слабое покрытие, но выборка ещё мала. Повысить ставку только на 10% с лимитом расхода и контрольной точкой по установкам.',
      evidence,
      missing,
    };
  }

  if (popularity >= HIGH_DEMAND && share >= HIGH_SHARE) {
    if (value === 'strong' && economics.maturityState === 'mature') {
      return {
        kind: 'hold',
        label: 'Удерживать покрытие',
        reason: 'Высокий спрос уже хорошо покрыт и зрелая экономика положительна; следить за предельной эффективностью.',
        evidence,
        missing,
      };
    }
    return {
      kind: 'collect',
      label: 'Подтвердить ценность трафика',
      reason: 'Трафик уже преимущественно захвачен. Увеличивать ставку без зрелой экономики рискованно.',
      evidence,
      missing,
    };
  }

  if (popularity < LOW_DEMAND && share >= HIGH_SHARE) {
    return {
      kind: 'hold',
      label: 'Сохранить, искать смежный спрос',
      reason: 'Доля высокая, но спрос низкий: ставка или бюджет не создадут большой дополнительный объём.',
      evidence,
      missing,
    };
  }

  if (popularity < LOW_DEMAND && share < LOW_SHARE) {
    if (value === 'strong' && economics.maturityState === 'mature') {
      return {
        kind: 'test',
        label: 'Малый тест ставки',
        reason: 'Экономика положительна, но общий спрос ограничен. Тестировать небольшим шагом без ожидания большого объёма.',
        evidence,
        missing,
      };
    }
    return {
      kind: 'collect',
      label: 'Низкий приоритет',
      reason: 'Низкий спрос и низкая доля без доказанной экономики не оправдывают масштабирование.',
      evidence,
      missing,
    };
  }

  return {
    kind: 'hold',
    label: 'Удерживать и наблюдать',
    reason: 'Сигналы находятся в средней зоне; следующий шаг должен определяться зрелой подписочной экономикой.',
    evidence,
    missing,
  };
}

function unwrapTraffic(value: unknown): TrafficIntelligencePayload {
  if (!isRecord(value)) return {};
  const payload = isRecord(value.data) ? value.data : value;
  return payload as TrafficIntelligencePayload;
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json() as { error?: string; message?: string };
      detail = body.message ?? body.error ?? '';
    } catch {
      // Keep HTTP status as the fallback diagnostic.
    }
    throw new Error(`${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`);
  }
  return response.json();
}

function formatInteger(value: number | null) {
  return value == null ? NO_DATA : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function formatDecimal(value: number | null) {
  return value == null ? NO_DATA : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

function formatMoney(value: number | null, currency: string | null) {
  if (value == null) return NO_DATA;
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: currency ?? 'USD', maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency ?? ''}`.trim();
  }
}

function formatShare(share: ShareEstimate) {
  if (share.lowerBound != null && share.upperBound != null) return `${Math.round(share.lowerBound)}–${Math.round(share.upperBound)}%`;
  return share.value == null ? NO_DATA : `~${Math.round(share.value)}%`;
}

function formatPercentRatio(value: number | null | undefined) {
  return value == null || !Number.isFinite(value)
    ? NO_DATA
    : new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 }).format(value);
}

function numericRange(value: unknown): { min: number; max: number } | null {
  if (!isRecord(value)) return null;
  const min = finite(value.min);
  const max = finite(value.max);
  return min == null || max == null ? null : { min, max };
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatNumberRange(value: { min: number; max: number } | null, prefix = '') {
  if (!value) return NO_DATA;
  if (Math.abs(value.max - value.min) < 0.001) return `${prefix}${formatDecimal(value.min)}`;
  return `${prefix}${formatDecimal(value.min)}–${prefix}${formatDecimal(value.max)}`;
}

function countryName(code: string) {
  try {
    return new Intl.DisplayNames(['ru'], { type: 'region' }).of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function countryFlag(code: string) {
  const normalized = code.toUpperCase();
  return /^[A-Z]{2}$/.test(normalized)
    ? String.fromCodePoint(...[...normalized].map((letter) => 127397 + letter.charCodeAt(0)))
    : '🌐';
}

function basisLabel(value: ShareEstimate['basis']) {
  return value === 'bounded' ? 'диапазон Apple' : 'модель';
}

function confidenceLabel(value: string | null) {
  if (!value) return NO_DATA;
  const labels: Record<string, string> = { high: 'высокая', medium: 'средняя', low: 'низкая' };
  return labels[value.toLocaleLowerCase()] ?? value;
}

function sourceLabel(value: string | null) {
  if (!value) return `источник: ${NO_DATA}`;
  const labels: Record<string, string> = {
    'apple-keyword-suggestion': 'предложение Apple',
    'owned-keyword': 'ключ из аккаунта',
    'impression-share': 'доля показов Apple',
    'search-term': 'поисковый запрос Apple Ads',
    missing: 'нет фактической связи',
    backend: 'серверная модель',
    'attributed-keyword-global': 'Adapty · ключ · все страны',
    'attributed-keyword-country': 'Adapty · ключ × страна',
    'adapty · profile_install_date': 'Adapty · когорта установки',
  };
  return labels[value.toLocaleLowerCase()] ?? value;
}

function queueLabel(value: DecisionRow['queue']) {
  return value === 'account' ? 'в аккаунте' : value === 'unverified' ? 'не проверен' : 'поиск идей';
}

function maturityLabel(value: string | null) {
  if (!value) return `зрелость: ${NO_DATA}`;
  const labels: Record<string, string> = { mature: 'зрелая', immature: 'не созрела', unknown: 'неизвестна' };
  return labels[value.toLocaleLowerCase()] ?? value;
}

function freshness(value: string | number | null | undefined) {
  if (value == null) return NO_DATA;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function EconomicsCell({ economics, currency }: { economics: Economics; currency: string | null }) {
  if (economics.roas != null) {
    return <><strong>{formatDecimal(economics.roas)}× ROAS</strong><small>{economics.revenue == null ? `выручка: ${NO_DATA}` : formatMoney(economics.revenue, currency)}</small></>;
  }
  if (economics.revenue != null) {
    return <><strong>{formatMoney(economics.revenue, currency)}</strong><small>ROAS: {NO_DATA}</small></>;
  }
  if (economics.cpaTrial != null || economics.cpaPaid != null) {
    return <><strong>CPA триала: {formatMoney(economics.cpaTrial, currency)}</strong><small>CPA подписки: {formatMoney(economics.cpaPaid, currency)}</small></>;
  }
  return <span className="decision-no-data">{NO_DATA}</span>;
}

function Notice({ tone, title, children }: { tone: 'info' | 'warning' | 'error'; title: string; children: string }) {
  return (
    <div className={`decision-notice decision-notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span aria-hidden="true">{tone === 'error' ? '!' : tone === 'warning' ? '△' : 'i'}</span>
      <div><strong>{title}</strong><small>{children}</small></div>
    </div>
  );
}

function DecisionDrawer({ row, onClose }: { row: DecisionRow; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className="decision-drawer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <aside className="decision-drawer" role="dialog" aria-modal="true" aria-labelledby="decision-drawer-title">
        <header className="decision-drawer-header">
          <div><span>{row.geo} · {queueLabel(row.queue)}</span><h2 id="decision-drawer-title">{row.keyword}</h2></div>
          <button type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>
        <div className="decision-drawer-body">
          <section className={`decision-verdict decision-verdict-${row.recommendation.kind}`}>
            <span>{ACTION_LABELS[row.recommendation.kind]}</span>
            <h3>{row.recommendation.label}</h3>
            <p>{row.recommendation.reason}</p>
          </section>
          <section className="decision-drawer-section">
            <h3>Основания</h3>
            {row.recommendation.evidence.length
              ? <ul>{row.recommendation.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
              : <p>{NO_DATA}</p>}
          </section>
          <section className="decision-drawer-section">
            <h3>Чего не хватает</h3>
            {row.recommendation.missing.length
              ? <ul>{row.recommendation.missing.map((item) => <li key={item}>{item}</li>)}</ul>
              : <p>Ключевые поля присутствуют.</p>}
          </section>
          <section className="decision-drawer-section">
            <h3>Экономика</h3>
            <dl className="decision-detail-grid">
              <div><dt>Установки Adapty</dt><dd>{formatInteger(row.economics.attributedInstalls)}</dd></div>
              <div><dt>Триалы</dt><dd>{formatInteger(row.economics.trials)}</dd></div>
              <div><dt>Оплаты</dt><dd>{formatInteger(row.economics.paid)}</dd></div>
              <div><dt>Выручка</dt><dd>{formatMoney(row.economics.revenue, row.currency)}</dd></div>
              <div><dt>ROAS</dt><dd>{row.economics.roas == null ? NO_DATA : `${formatDecimal(row.economics.roas)}×`}</dd></div>
              <div><dt>CPA триала</dt><dd>{formatMoney(row.economics.cpaTrial, row.currency)}</dd></div>
              <div><dt>CPA оплаты</dt><dd>{formatMoney(row.economics.cpaPaid, row.currency)}</dd></div>
              <div><dt>Зрелость</dt><dd>{maturityLabel(row.economics.maturity)}</dd></div>
              <div><dt>Источник</dt><dd>{sourceLabel(row.economics.source)}</dd></div>
            </dl>
          </section>
          <details className="decision-raw" open>
            <summary>Исходные данные ключа</summary>
            <pre>{JSON.stringify(row.raw, null, 2)}</pre>
          </details>
        </div>
      </aside>
    </div>
  );
}

export default function DecisionMatrix({ app, locale, artworks = {}, sharedTopFive = {}, sharedTopFiveStatus = {}, onResolveTopFive, onEnsureArtworks, className = '' }: DecisionMatrixProps) {
  const [traffic, setTraffic] = useState<RemoteState<DecisionMatrixPayload>>({ key: '', data: null, error: null });
  const [organic, setOrganic] = useState<RemoteState<RankingRow[]>>({ key: '', data: null, error: null });
  const [quality, setQuality] = useState<RemoteState<DataQualityPayload>>({ key: '', data: null, error: null });
  const [countryScope, setCountryScope] = useState('all');
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [action, setAction] = useState<ActionFilter>('all');
  const [selected, setSelected] = useState<DecisionRow | null>(null);
  const [resultsRow, setResultsRow] = useState<DecisionRow | null>(null);
  const requestKey = `${app.id}:${app.iTunesId}:${countryScope}:${refresh}`;
  const top5ContextLocale = locale.toLocaleLowerCase();
  const localeCountry = appStoreCountry(locale);
  const top5Country = countryScope === 'all' || countryScope.toLocaleLowerCase() === localeCountry
    ? top5ContextLocale
    : countryScope.toLocaleLowerCase();
  const scopeReady = Boolean(app.id && app.iTunesId);
  const loading = scopeReady && traffic.key !== requestKey;
  const organicLoading = scopeReady && organic.key !== requestKey;

  useEffect(() => {
    setCountryScope('all');
    setSelected(null);
    setResultsRow(null);
  }, [app.id]);

  useEffect(() => {
    if (!scopeReady) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ app_id: app.iTunesId, country: countryScope === 'all' ? 'ALL' : countryScope, days: '30' });
    fetchJson(asaApiUrl(`/api/decision-matrix?${params}`), controller.signal)
      .then((value) => setTraffic({ key: requestKey, data: unwrapTraffic(value) as DecisionMatrixPayload, error: null }))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setTraffic({ key: requestKey, data: null, error: reason instanceof Error ? reason.message : String(reason) });
      });
    return () => controller.abort();
  }, [app.iTunesId, countryScope, requestKey, scopeReady]);

  useEffect(() => {
    if (!scopeReady) return;
    const controller = new AbortController();
    const countryQuery = countryScope === 'all' ? '' : `?locale=${encodeURIComponent(top5Country)}`;
    fetchJson(keywordsApiUrl(`/apps/${encodeURIComponent(app.id)}/rankings${countryQuery}`), controller.signal)
      .then((value) => setOrganic({ key: requestKey, data: Array.isArray(value) ? value as RankingRow[] : [], error: null }))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setOrganic({ key: requestKey, data: [], error: reason instanceof Error ? reason.message : String(reason) });
    });
    return () => controller.abort();
  }, [app.id, countryScope, requestKey, scopeReady, top5Country]);

  useEffect(() => {
    if (!scopeReady) return;
    api.dataQuality(app.iTunesId, countryScope === 'all' ? undefined : countryScope)
      .then((data) => setQuality({ key: requestKey, data, error: null }))
      .catch((reason: unknown) => setQuality({ key: requestKey, data: null, error: reason instanceof Error ? reason.message : String(reason) }));
  }, [app.iTunesId, countryScope, requestKey, scopeReady]);

  const organicRows = useMemo(() => {
    const grouped = new Map<string, RankingRow[]>();
    for (const row of organic.data ?? []) {
      const key = row.keyword.toLocaleLowerCase();
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    return grouped;
  }, [organic.data]);

  const selectedRankingForKeyword = useCallback((keyword: string) => {
    const options = organicRows.get(keyword.toLocaleLowerCase()) ?? [];
    if (countryScope !== 'all') return options.find((candidate) => candidate.locale.toLocaleLowerCase() === top5Country) ?? sharedTopFive[`${app.id}:${top5Country}:${keyword.toLocaleLowerCase()}`];
    // All-country metrics never imply a fictional global SERP: the inline
    // result remains the current contextual storefront only.
    return options.find((candidate) => candidate.locale.toLowerCase() === top5ContextLocale) ?? sharedTopFive[`${app.id}:${top5Country}:${keyword.toLocaleLowerCase()}`];
  }, [app.id, countryScope, organicRows, sharedTopFive, top5ContextLocale, top5Country]);
  const selectedRanking = useCallback((row: DecisionRow | null) => row ? selectedRankingForKeyword(row.keyword) : undefined, [selectedRankingForKeyword]);

  const requestVisibleArtwork = useCallback((keyword: string) => {
    const ranking = selectedRankingForKeyword(keyword);
    if (ranking?.top5.length) onEnsureArtworks?.(ranking.top5, ranking.locale ?? top5Country);
    else onResolveTopFive?.(app.id, app.iTunesId, top5Country, keyword);
  }, [app.id, app.iTunesId, onEnsureArtworks, onResolveTopFive, selectedRankingForKeyword, top5Country]);

  useEffect(() => {
    if (!resultsRow) return;
    const ranking = selectedRanking(resultsRow);
    if (ranking?.top5.length) onEnsureArtworks?.(ranking.top5, ranking.locale ?? top5Country);
  }, [onEnsureArtworks, resultsRow, selectedRanking, top5Country]);

  const rows = useMemo(() => {
    const payload = traffic.data;
    const inputs: Array<{ row: TrafficKeywordInput; queue: DecisionRow['queue'] }> = [
      ...(payload?.keywords ?? []).map((row) => ({ row, queue: 'account' as const })),
      ...(payload?.discovery ?? []).map((row) => ({ row, queue: 'discovery' as const })),
    ];
    const deduplicated = new Map<string, { row: TrafficKeywordInput; queue: DecisionRow['queue'] }>();
    for (const input of inputs) {
      const key = input.row.keyword.toLocaleLowerCase();
      if (!deduplicated.has(key) || input.queue === 'account') deduplicated.set(key, input);
    }
    return [...deduplicated.values()].map(({ row, queue }): DecisionRow => {
      const share = readShare(row);
      const midpoint = shareMidpoint(share);
      const economics = readEconomics(row);
      const popularity = percent(row.popularity);
      const confidence = row.confidence ?? firstString(nested((row.model ?? {}) as JsonRecord, 'validation').status);
      const tracked = row.tracked ?? queue === 'account';
      const taps = finite(row.taps);
      const bid = finite(row.bid);
      const impressions = finite(row.impressions);
      const installs = finite(row.installs);
      const attributedInstalls = finite(row.attributedInstalls);
      const organicMatches = organicRows.get(row.keyword.toLocaleLowerCase()) ?? [];
      const organicPositions = organicMatches.map((match) => match.today).filter((value): value is number => value != null);
      const organicRank = countryScope === 'all' ? median(organicPositions) : organicPositions[0] ?? null;
      return {
        keyword: row.keyword,
        geo: countryScope === 'all' ? 'ALL' : countryScope.toUpperCase(),
        tracked,
        queue,
        organicRank,
        organicRankRange: organicPositions.length ? { min: Math.min(...organicPositions), max: Math.max(...organicPositions) } : null,
        organicCountryCount: organicPositions.length,
        popularity,
        share,
        shareMidpoint: midpoint,
        paidRank: finite(row.paidRank),
        paidRankRange: numericRange(row.paidRankRange),
        bid,
        bidRange: numericRange(row.bidRange),
        currency: firstString(row.currency),
        impressions,
        taps,
        installs,
        attributedInstalls,
        countryCount: finite(row.countryCount) ?? 0,
        signalCountryCount: finite(row.signalCountryCount) ?? 0,
        relevanceStatus: firstString((row as unknown as JsonRecord).relevanceStatus),
        economics,
        confidence,
        source: firstString(row.source),
        recommendation: recommendationFor({ tracked, queue, popularity, share: midpoint, paidRank: finite(row.paidRank), bid, impressions, confidence, taps, installs, economics }),
        raw: row,
      };
    });
  }, [countryScope, organicRows, traffic.data]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return rows
      .filter((row) => (!needle || row.keyword.toLocaleLowerCase().includes(needle)) && (action === 'all' || row.recommendation.kind === action))
      .sort((a, b) => {
        const actionPriority: Record<ActionKind, number> = { scale: 0, test: 1, pause: 2, narrow: 3, hold: 4, collect: 5 };
        return actionPriority[a.recommendation.kind] - actionPriority[b.recommendation.kind]
          || Number(b.tracked) - Number(a.tracked)
          || (b.economics.trials ?? -1) - (a.economics.trials ?? -1)
          || (b.attributedInstalls ?? -1) - (a.attributedInstalls ?? -1)
          || (b.popularity ?? -1) - (a.popularity ?? -1)
          || a.keyword.localeCompare(b.keyword);
      });
  }, [action, query, rows]);

  const counts = useMemo(() => Object.fromEntries(
    (Object.keys(ACTION_LABELS) as ActionKind[]).map((kind) => [kind, rows.filter((row) => row.recommendation.kind === kind).length]),
  ) as Record<ActionKind, number>, [rows]);

  const payload = traffic.data;
  const summary = payload?.summary;
  const countries = payload?.availableCountries ?? [];
  const unverifiedCount = payload?.unverifiedSuggestions?.length ?? 0;
  const partialErrors = payload?.partialErrors ?? payload?.errors ?? [];
  const stale = payload?.stale === true;

  if (!scopeReady) {
    return <main className={`decision-workspace ${className}`.trim()}><div className="decision-empty"><strong>Выберите приложение</strong><span>Матрица объединяет все доступные страны и позволяет сузить срез фильтром.</span></div></main>;
  }

  return (
    <main className={`decision-workspace ${className}`.trim()}>
      <header className="decision-header">
        <div>
          <span className="decision-eyebrow">Apple Ads · только чтение</span>
          <div className="decision-title-line"><h1>Матрица ключей</h1>{stale ? <span className="decision-stale">Устаревший снимок</span> : null}</div>
          <p>{app.name} · {countryScope === 'all' ? 'все страны' : `${countryName(countryScope)} (${countryScope.toUpperCase()})`} · {app.bundle}</p>
        </div>
        <div className="decision-header-actions">
          <label className="decision-country-select">
            <span>Страна</span>
            <select value={countryScope} onChange={(event) => { setCountryScope(event.target.value); setAction('all'); }}>
              <option value="all">Все страны</option>
              {countries.map((country) => <option key={country.code} value={country.code}>{countryFlag(country.code)} {countryName(country.code)} · {country.code}</option>)}
            </select>
          </label>
          <small>Обновлено: {freshness(payload?.generatedAt)}</small>
          <button type="button" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>↻ {loading ? 'Обновляем' : 'Обновить срез'}</button>
        </div>
      </header>

      <section className="decision-rules" aria-label="Правила решений">
        <div><strong>Высокий спрос</strong><span>популярность ≥{HIGH_DEMAND}</span></div>
        <div><strong>Низкая доля</strong><span>захвачено &lt;{LOW_SHARE}%</span></div>
        <div><strong>Высокая доля</strong><span>захвачено ≥{HIGH_SHARE}%</span></div>
        <div><strong>Изменение ставки</strong><span>тест 10–20%</span></div>
        <p>Масштабирование и сокращение требуют наблюдаемой зрелой экономики. Популярность Apple — индекс, доля передаётся диапазоном или моделью; это не абсолютный объём поиска.</p>
      </section>

      {loading ? <div className="decision-loading"><span /><strong>Собираем спрос, долю и фактические показатели…</strong></div> : null}
      {!loading && traffic.error ? <Notice tone="error" title="Матрицу не удалось загрузить">{traffic.error}</Notice> : null}
      {!loading && !traffic.error && organic.error ? <Notice tone="warning" title="Органические позиции недоступны">{`${organic.error} Остальная матрица остаётся рабочей.`}</Notice> : null}
      {stale ? <Notice tone="warning" title="Показан сохранённый снимок">Не принимайте решения о ставках до успешного обновления Apple-данных.</Notice> : null}
      {partialErrors.map((error, index) => <Notice key={`${error.scope}-${index}`} tone="warning" title={`${error.scope ?? 'Часть источников'}: нет данных`}>{error.message}</Notice>)}
      {unverifiedCount > 0 ? <Notice tone="info" title="Сырые предложения не смешиваются с решениями">{`${unverifiedCount} неподтверждённых предложений Apple оставлены во вкладке «Идеи ключей». В матрице показаны только активные ключи и кандидаты с фактическим поисковым сигналом.`}</Notice> : null}

      {!loading && !traffic.error ? (
        <>
          <section className="decision-summary" aria-label="Итоги среза">
            <article><span>Страны</span><strong>{formatInteger(finite(summary?.countries))}</strong><small>{countryScope === 'all' ? 'в агрегате' : 'выбрана одна'}</small></article>
            <article><span>Активные ключи</span><strong>{formatInteger(finite(summary?.keywords))}</strong><small>текущий аккаунт</small></article>
            <article><span>Установки Adapty</span><strong>{formatInteger(finite(summary?.attributedInstalls))}</strong><small>Apple Ads attribution</small></article>
            <article><span>Триалы</span><strong>{formatInteger(finite(summary?.trials))}</strong><small>{formatPercentRatio(finite(summary?.installToTrial))} от установок</small></article>
            <article><span>Оплаты</span><strong>{formatInteger(finite(summary?.paid))}</strong><small>{formatPercentRatio(finite(summary?.trialToPaid))} от триалов · {formatPercentRatio(finite(summary?.installToPaid))} от установок</small></article>
            <article><span>Чистая выручка</span><strong>{formatMoney(finite(summary?.revenueUsd), 'USD')}</strong><small>{finite(summary?.roas) == null ? `ROAS: ${NO_DATA}` : `ROAS ${formatDecimal(finite(summary?.roas))}×`}</small></article>
          </section>

          <nav className="decision-action-filters" aria-label="Фильтр рекомендаций">
            <button type="button" className={action === 'all' ? 'decision-filter-active' : ''} onClick={() => setAction('all')}>Все <span>{rows.length}</span></button>
            {(Object.keys(ACTION_LABELS) as ActionKind[]).map((kind) => (
              <button type="button" key={kind} className={action === kind ? `decision-filter-active decision-filter-${kind}` : `decision-filter-${kind}`} onClick={() => setAction(kind)}>{ACTION_LABELS[kind]} <span>{counts[kind]}</span></button>
            ))}
          </nav>

          <section className="decision-panel">
            <header className="decision-panel-header">
              <div><span className="decision-eyebrow">{countryScope === 'all' ? 'Ключ · агрегат всех гео' : 'Гео × ключ'}</span><h2>Решения по ключам</h2></div>
              <div className="decision-panel-tools"><span className="decision-scope-note">{countryScope === 'all' ? 'Суммы по всем странам · спрос и доля — среднее доступных витрин' : `Только ${countryScope.toUpperCase()}`}</span><label className="decision-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти ключ" /></label></div>
            </header>
            {organicLoading ? <div className="decision-organic-loading">Органические позиции обновляются отдельно…</div> : null}
            {visible.length ? (
              <div className="decision-table-scroll">
                <table className="decision-table">
                  <thead><tr>
                    <th>Гео / ключ / источник</th>
                    <th title="Органическая позиция из Keywords">Органика</th>
                    <th title="Реальный порядок приложений в последнем сохранённом snapshot Keywords">{countryScope === 'all' ? `Топ‑5 · ${top5ContextLocale.toUpperCase()} (метрики: все страны)` : `Топ‑5 · ${top5Country.toUpperCase()}`}</th>
                    <th title="Относительный индекс Apple 1–100, не число поисков">Спрос</th>
                    <th title="Диапазон или модель доли показов и позиция в платной выдаче">Доля / позиция</th>
                    <th>Ставка</th>
                    <th>Выборка</th>
                    <th>Триалы / оплаты</th>
                    <th>Экономика</th>
                    <th>Доверие / зрелость</th>
                    <th>Решение</th>
                    <th><span className="decision-sr-only">Подробности</span></th>
                  </tr></thead>
                  <tbody>{visible.map((row) => (
                    <tr key={`${row.geo}-${row.queue}-${row.keyword}`}>
                      <td><div className="decision-keyword"><span>{row.geo}</span><button type="button" className="decision-keyword-open" onClick={() => setResultsRow(row)}>{row.keyword}</button><small>{queueLabel(row.queue)} · {sourceLabel(row.source)}</small></div></td>
                      <td>{row.organicRank == null ? <span className="decision-no-data">{NO_DATA}</span> : <><strong className="decision-tabular">{countryScope === 'all' ? `медиана #${formatDecimal(row.organicRank)}` : `#${formatInteger(row.organicRank)}`}</strong><small>{countryScope === 'all' ? `${row.organicCountryCount} витрин · диапазон ${formatNumberRange(row.organicRankRange, '#')}` : 'Keywords'}</small></>}</td>
                      <td><KeywordTopFiveInline keyword={row.keyword} scopeKey={`${app.id}:${top5Country}`} ranking={selectedRanking(row)} app={app} artworks={artworks} status={organicLoading ? 'loading' : selectedRanking(row) ? 'ready' : sharedTopFiveStatus[`${app.id}:${top5Country}:${row.keyword.toLocaleLowerCase()}`] ?? (organic.error ? 'error' : 'empty')} onVisible={requestVisibleArtwork} /></td>
                      <td><strong className="decision-demand">{formatInteger(row.popularity)}</strong><small>{countryScope === 'all' ? `среднее · ${row.signalCountryCount} витрин` : 'индекс Apple'}</small></td>
                      <td><strong>{formatShare(row.share)}</strong><small>{countryScope === 'all' ? `средняя доля · paid rank ${formatNumberRange(row.paidRankRange, '#')}` : `${row.paidRank == null ? `позиция: ${NO_DATA}` : `позиция #${row.paidRank}`} · ${basisLabel(row.share.basis)}`}</small></td>
                      <td>{countryScope === 'all' ? <><strong className="decision-tabular">{row.bidRange ? formatNumberRange(row.bidRange, '$') : NO_DATA}</strong><small>диапазон, не среднее</small></> : <strong className="decision-tabular">{formatMoney(row.bid, row.currency)}</strong>}</td>
                      <td><strong>{formatInteger(row.impressions)} показов ASA</strong><small>{formatInteger(row.taps)} тапов · {formatInteger(row.installs)} установок ASA</small></td>
                      <td><strong>{formatInteger(row.economics.attributedInstalls)} → {formatInteger(row.economics.trials)} → {formatInteger(row.economics.paid)}</strong><small>установки → триалы → оплаты · Adapty</small></td>
                      <td><EconomicsCell economics={row.economics} currency={row.currency} /></td>
                      <td><strong>{confidenceLabel(row.confidence)}</strong><small>{maturityLabel(row.economics.maturity)}</small></td>
                      <td><span className={`decision-action decision-action-${row.recommendation.kind}`}>{row.recommendation.label}</span><small>{row.recommendation.reason}</small></td>
                      <td><button type="button" className="decision-row-action" onClick={() => setSelected(row)} aria-label={`Подробности решения для ${row.keyword}`}>•••</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <div className="decision-empty"><strong>Нет строк для выбранного фильтра</strong><span>Измените действие или поисковый запрос.</span></div>}
          </section>

          <footer className="decision-footer">
            <span>{visible.length} из {rows.length} ключей</span>
            <span>{payload?.window?.start ?? NO_DATA} — {payload?.window?.end ?? NO_DATA}</span>
            {finite(summary?.rejectedDiscovery) ? <span>{formatInteger(finite(summary?.rejectedDiscovery))} нерелевантных сигналов скрыто</span> : null}
            <span>Никакие изменения в Apple Ads не выполняются</span>
          </footer>

          <details className="decision-quality">
            <summary>Источники и качество данных</summary>
            <div>{quality.data ? <DataQuality sources={quality.data.sources} /> : quality.error ? <Notice tone="warning" title="Статус источников недоступен">{quality.error}</Notice> : <span>Загрузка статусов…</span>}</div>
          </details>
        </>
      ) : null}
      {selected ? <DecisionDrawer row={selected} onClose={() => setSelected(null)} /> : null}
      {resultsRow ? <KeywordResultsDrawer keyword={resultsRow.keyword} country={top5Country} ranking={selectedRanking(resultsRow)} app={app} artworks={artworks} paidRank={resultsRow.paidRank} onClose={() => setResultsRow(null)} /> : null}
    </main>
  );
}
