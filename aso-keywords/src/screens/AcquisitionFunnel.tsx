import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DataQualityPayload } from '../api';
import DataQuality from './DataQuality';
import './AcquisitionFunnel.css';

export interface AcquisitionFunnelApp {
  id: string;
  name: string;
  iTunesId: string;
}

export interface AcquisitionFunnelProps {
  app: AcquisitionFunnelApp;
  locale: string;
  countries?: string[];
}

type SourceKind = 'fact' | 'model' | 'unavailable';

interface FunnelRow {
  country: string;
  sourceType: string;
  impressions?: number;
  productPageViews?: number;
  taps?: number;
  firstTimeDownloads?: number;
  redownloads?: number;
  impressionToPageView?: number | null;
  pageViewToDownload?: number | null;
  impressionToDownload?: number | null;
}

interface AsaFunnel {
  impressions: number;
  taps: number;
  installs: number;
  spend: number;
  maxDate: string | null;
  source: string;
  fact: true;
  downstreamAvailable: false;
}

interface AdaptyStage {
  installs: number;
  paywallViews: number;
  trials: number;
  paid: number;
  secondRenewals: number;
}

interface AdaptyCountry {
  country: string;
  title: string;
  all: AdaptyStage;
  nonOrganic: AdaptyStage;
}

interface AdaptyFunnelPayload {
  available: boolean;
  reason?: string;
  source?: string;
  generatedAt?: string | null;
  stale?: boolean;
  country?: string | null;
  all?: AdaptyStage;
  nonOrganic?: AdaptyStage;
  countries?: AdaptyCountry[];
  window?: { start: string; end: string };
  cohort?: false;
  note?: string;
}

interface AdaptyCohortValue {
  day: number;
  installs: number;
  paidSubscribers: number;
  netRevenueUsd: number;
  proceedsUsd: number;
  grossRevenueUsd: number;
  netRevenuePerInstall: number;
  mature: boolean;
}

interface AdaptyCohortRow {
  startDate: string;
  endDate: string;
  title: string;
  installs: number;
  paidSubscribers: number;
  totalNetRevenueUsd: number;
  values: AdaptyCohortValue[];
}

interface AdaptyMatureCohortSummary {
  day: number;
  cohorts: number;
  installs: number;
  paidSubscribers: number;
  netRevenueUsd: number;
  netRevenuePerInstall: number;
}

interface AdaptyCohortPayload {
  available: boolean;
  reason?: string;
  source?: string;
  generatedAt?: string | null;
  stale?: boolean;
  refreshError?: string | null;
  country?: null;
  window?: { start: string; end: string; months: number };
  days?: number[];
  rows?: AdaptyCohortRow[];
  matureByDay?: AdaptyMatureCohortSummary[];
  summary?: {
    cohorts: number;
    installs: number;
    paidSubscribers: number;
    totalNetRevenueUsd: number;
  };
  maturityRule?: string;
  limitation?: string;
}

interface FunnelPayload {
  appId: number;
  country: string | null;
  start: string;
  end: string | null;
  rows: FunnelRow[];
  asa?: AsaFunnel;
  source: string;
  fact: true;
}

interface FunnelMetric {
  id: string;
  label: string;
  value: number | null;
  source: string;
  kind: SourceKind;
  detail?: string;
  currency?: string;
}

interface ConversionMetric {
  label: string;
  value: number | null;
  kind: SourceKind;
  detail: string;
}

/** Keeps an explicit zero, but never turns a missing report field into zero. */
function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sumRows(rows: FunnelRow[]): FunnelRow {
  const sum = (field: keyof Pick<FunnelRow, 'impressions' | 'productPageViews' | 'taps' | 'firstTimeDownloads' | 'redownloads'>) => {
    let total = 0;
    let present = false;
    rows.forEach((row) => {
      const value = number(row[field]);
      if (value !== null) {
        total += value;
        present = true;
      }
    });
    return present ? total : undefined;
  };

  return {
    country: rows.find((row) => row.country)?.country ?? '',
    sourceType: 'Итого',
    impressions: sum('impressions'),
    productPageViews: sum('productPageViews'),
    taps: sum('taps'),
    firstTimeDownloads: sum('firstTimeDownloads'),
    redownloads: sum('redownloads'),
  };
}

function formatValue(value: number | null, currency?: string) {
  if (value === null) return '—';
  if (currency) return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value * 100)}%`;
}

function formatUsd(value: number | null | undefined, maximumFractionDigits = 0) {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: maximumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

function formatCohortMonth(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T12:00:00Z`));
}

function conversion(numerator: number | null | undefined, denominator: number | null | undefined) {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  return numerator / denominator;
}

function kindLabel(kind: SourceKind) {
  return kind === 'fact' ? 'Факт' : kind === 'model' ? 'Модель' : 'Недоступно';
}

function windowLabel(payload: FunnelPayload | null) {
  if (!payload?.start) return 'Последние 30 дней';
  const format = (value: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00Z`));
  return `${format(payload.start)} — ${payload.end ? format(payload.end) : 'сейчас'}`;
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
  return body as T;
}

export function AcquisitionFunnel({ app, locale, countries = [] }: AcquisitionFunnelProps) {
  const [countryScope, setCountryScope] = useState('all');
  const [attributionScope, setAttributionScope] = useState<'all' | 'nonOrganic'>('all');
  const [funnel, setFunnel] = useState<FunnelPayload | null>(null);
  const [adapty, setAdapty] = useState<AdaptyFunnelPayload | null>(null);
  const [cohorts, setCohorts] = useState<AdaptyCohortPayload | null>(null);
  const [quality, setQuality] = useState<DataQualityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const country = countryScope === 'all' ? null : countryScope.split('-')[0].toUpperCase();
  const countryOptions = useMemo(() => {
    const values = new Set(countries.map((code) => code.split('-')[0].toLowerCase()));
    if (locale) values.add(locale.split('-')[0].toLowerCase());
    return [...values].sort();
  }, [countries, locale]);

  useEffect(() => { setCountryScope('all'); }, [app.iTunesId]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ app_id: app.iTunesId, days: '30' });
      if (country) params.set('country', country);
      const cohortParams = new URLSearchParams({ app_id: app.iTunesId, months: '3' });
      const [funnelResponse, qualityResponse, adaptyResponse, cohortResponse] = await Promise.all([
        fetch(`/asa-api/app-store-analytics/funnel?${params}`, { signal }),
        fetch(`/asa-api/data-quality?${params}`, { signal }),
        fetch(`/asa-api/adapty/funnel?${params}`, { signal }),
        fetch(`/asa-api/adapty/cohorts?${cohortParams}`, { signal }),
      ]);
      const nextFunnel = await responseJson<FunnelPayload>(funnelResponse);
      setFunnel(nextFunnel);
      setQuality(qualityResponse.ok ? await qualityResponse.json() as DataQualityPayload : null);
      setAdapty(adaptyResponse.ok ? await adaptyResponse.json() as AdaptyFunnelPayload : null);
      setCohorts(cohortResponse.ok ? await cohortResponse.json() as AdaptyCohortPayload : null);
    } catch (loadError) {
      if ((loadError as Error).name !== 'AbortError') setError((loadError as Error).message || 'Воронка временно недоступна.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [app.iTunesId, country]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const response = await fetch('/asa-api/app-store-analytics/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: Number(app.iTunesId) }),
      });
      await responseJson(response);
      setSyncMessage('Отчёты App Store синхронизированы. Экран обновлён.');
      await load();
    } catch (syncError) {
      setSyncMessage((syncError as Error).message || 'Не удалось синхронизировать отчёты.');
    } finally {
      setSyncing(false);
    }
  };

  const analysis = useMemo(() => {
    const rows = funnel?.rows ?? [];
    const searchRows = rows.filter((row) => row.sourceType.toLocaleLowerCase().includes('search'));
    const search = sumRows(searchRows);
    const asa = funnel?.asa;
    const appStoreMetric = (id: string, label: string, value: number | null, detail?: string): FunnelMetric => ({
      id, label, value, source: funnel?.source ?? 'App Store Analytics Reports API', kind: value === null ? 'unavailable' : 'fact', detail,
    });
    const appStore: FunnelMetric[] = [
      appStoreMetric('search-impressions', 'Показы в поиске App Store', number(search.impressions), 'Платные и органические показы в этом отчёте не разделены.'),
      appStoreMetric('search-views', 'Просмотры страницы из поиска', number(search.productPageViews)),
      appStoreMetric('search-downloads', 'Установки из поиска', number(search.firstTimeDownloads), 'Первые загрузки приложения по отчёту App Store.'),
    ];
    const asaImpressions = number(asa?.impressions);
    const asaTaps = number(asa?.taps);
    const asaInstalls = number(asa?.installs);
    const paid: FunnelMetric[] = [
      { id: 'asa-impressions', label: 'Показы Apple Ads', value: asaImpressions, source: asa?.source ?? 'Apple Ads', kind: asaImpressions === null ? 'unavailable' : 'fact' },
      { id: 'asa-taps', label: 'Тапы по рекламе', value: asaTaps, source: asa?.source ?? 'Apple Ads', kind: asaTaps === null ? 'unavailable' : 'fact' },
      { id: 'asa-installs', label: 'Установки из Apple Ads', value: asaInstalls, source: asa?.source ?? 'Apple Ads', kind: asaInstalls === null ? 'unavailable' : 'fact' },
    ];
    const searchPageConversion = conversion(search.productPageViews, search.impressions);
    const searchDownloadConversion = conversion(search.firstTimeDownloads, search.impressions);
    const paidTapConversion = conversion(asaTaps, asaImpressions);
    const paidInstallConversion = conversion(asaInstalls, asaTaps);
    const searchConversions: ConversionMetric[] = [
      { label: 'Показ → страница', value: searchPageConversion, kind: searchPageConversion === null ? 'unavailable' : 'fact', detail: 'Доля показов поиска, после которых открыли страницу продукта.' },
      { label: 'Показ → установка', value: searchDownloadConversion, kind: searchDownloadConversion === null ? 'unavailable' : 'fact', detail: 'Сквозная конверсия поиска App Store в первую загрузку.' },
    ];
    const paidConversions: ConversionMetric[] = [
      { label: 'Показ → тап', value: paidTapConversion, kind: paidTapConversion === null ? 'unavailable' : 'fact', detail: 'TTR рекламы Apple Ads.' },
      { label: 'Тап → установка', value: paidInstallConversion, kind: paidInstallConversion === null ? 'unavailable' : 'fact', detail: 'Конверсия тапа Apple Ads в установку.' },
    ];
    const adaptyStage = attributionScope === 'nonOrganic' ? adapty?.nonOrganic : adapty?.all;
    const adaptyKind: SourceKind = adapty?.available && adaptyStage ? 'fact' : 'unavailable';
    const adaptyMetrics: FunnelMetric[] = [
      { id: 'adapty-installs', label: 'Установки', value: adaptyStage?.installs ?? null, source: adapty?.source ?? 'Adapty Analytics API', kind: adaptyKind },
      { id: 'adapty-trials', label: 'Старты триала', value: adaptyStage?.trials ?? null, source: adapty?.source ?? 'Adapty Analytics API', kind: adaptyKind },
      { id: 'adapty-paid', label: 'Первые оплаты', value: adaptyStage?.paid ?? null, source: adapty?.source ?? 'Adapty Analytics API', kind: adaptyKind },
      { id: 'adapty-renewals', label: 'Вторые продления', value: adaptyStage?.secondRenewals ?? null, source: adapty?.source ?? 'Adapty Analytics API', kind: adaptyKind },
    ];
    const adaptyConversions: ConversionMetric[] = [
      { label: 'Установка → триал', value: conversion(adaptyStage?.trials, adaptyStage?.installs), kind: adaptyKind, detail: 'Доля установок периода, дошедших до старта триала.' },
      { label: 'Триал → оплата', value: conversion(adaptyStage?.paid, adaptyStage?.trials), kind: adaptyKind, detail: 'Доля стартов триала периода, дошедших до первой оплаты.' },
      { label: 'Установка → оплата', value: conversion(adaptyStage?.paid, adaptyStage?.installs), kind: adaptyKind, detail: 'Сквозная конверсия установки в первую оплату.' },
      { label: 'Оплата → 2-е продление', value: conversion(adaptyStage?.secondRenewals, adaptyStage?.paid), kind: adaptyKind, detail: 'Доля первых оплат, дошедших до следующего продления.' },
    ];
    return { rows, search, appStore, paid, asa, searchConversions, paidConversions, adaptyMetrics, adaptyConversions };
  }, [adapty, attributionScope, funnel]);

  const range = windowLabel(funnel);

  return (
    <section className="acquisition-funnel" aria-label="Воронка привлечения">
      <header className="acquisition-funnel-header">
        <div>
          <span className="acquisition-funnel-eyebrow">{countryScope === 'all' ? 'Все страны' : countryScope.toUpperCase()} · {range}</span>
          <h1>Воронка привлечения</h1>
          <p>{app.name}: от показа в App Store до выручки, без смешивания фактов и моделей.</p>
        </div>
        <div className="acquisition-funnel-actions">
          <label className="acquisition-funnel-country"><span className="acquisition-funnel-sr-only">Страна</span><select value={countryScope} onChange={(event) => setCountryScope(event.target.value)}><option value="all">Все страны</option>{countryOptions.map((code) => <option key={code} value={code}>{code.toUpperCase()}</option>)}</select></label>
          <button type="button" className="acquisition-funnel-sync" onClick={handleSync} disabled={syncing}>{syncing ? 'Синхронизация…' : 'Синхронизировать ASC'}</button>
          <button type="button" className="acquisition-funnel-refresh" onClick={() => void load()} disabled={loading}>Обновить экран</button>
        </div>
      </header>

      {syncMessage ? <p className="acquisition-funnel-message" role="status">{syncMessage}</p> : null}
      {error ? <div className="acquisition-funnel-error"><strong>Данные недоступны</strong><span>{error}</span><button type="button" onClick={() => void load()}>Повторить</button></div> : null}
      {loading && !funnel ? <div className="acquisition-funnel-loading" aria-live="polite"><span /><span /><span /></div> : null}

      {funnel ? <div className="acquisition-funnel-content">
        <section className="acquisition-funnel-section acquisition-funnel-primary">
          <div className="acquisition-funnel-section-heading"><div><h2>Установка → подписка · Adapty</h2><p>Главная продуктовая воронка за выбранный период.</p></div><div className="acquisition-funnel-scope" role="group" aria-label="Тип атрибуции"><button className={attributionScope === 'all' ? 'selected' : ''} onClick={() => setAttributionScope('all')}>Все установки</button><button className={attributionScope === 'nonOrganic' ? 'selected' : ''} onClick={() => setAttributionScope('nonOrganic')}>Неорганические</button></div></div>
          {adapty?.available ? <><div className="acquisition-funnel-steps acquisition-funnel-steps-four">{analysis.adaptyMetrics.map((metric, index) => <FunnelStep key={metric.id} metric={metric} index={index} />)}</div><ConversionStrip metrics={analysis.adaptyConversions} /><div className="acquisition-funnel-note"><strong>Как читать</strong><span>{adapty.note} Для зрелого LTV сравнивайте одинаковые когорты установок D7/D30/D60.</span></div></> : <div className="acquisition-funnel-gap"><strong>Adapty не подключён к экрану</strong><span>{adapty?.reason ?? 'Источник временно недоступен.'}</span></div>}
        </section>

        <CohortRevenueSection cohorts={cohorts} />

        <section className="acquisition-funnel-section">
          <div className="acquisition-funnel-section-heading"><div><h2>Поиск в App Store</h2><p>Фактический поток из источника «App Store search» для выбранной витрины.</p></div><span className="acquisition-funnel-window">{range}</span></div>
          <div className="acquisition-funnel-steps acquisition-funnel-steps-three">{analysis.appStore.map((metric, index) => <FunnelStep key={metric.id} metric={metric} index={index} />)}</div>
          <ConversionStrip metrics={analysis.searchConversions} />
          <div className="acquisition-funnel-note"><strong>Важно</strong><span>Apple отдаёт эти события раздельными агрегатами, поэтому «страница → установка» здесь не рассчитывается: при разных правилах подсчёта коэффициент мог бы превысить 100%.</span></div>
        </section>

        <section className="acquisition-funnel-section">
          <div className="acquisition-funnel-section-heading"><div><h2>Доставка Apple Ads</h2><p>Показы, тапы и установки из рекламного кабинета за то же окно.</p></div>{analysis.asa ? <span className="acquisition-funnel-spend">Расход: {formatValue(analysis.asa.spend, 'USD')}</span> : null}</div>
          <div className="acquisition-funnel-steps">{analysis.paid.map((metric, index) => <FunnelStep key={metric.id} metric={metric} index={index} />)}</div>
          <ConversionStrip metrics={analysis.paidConversions} />
          <div className="acquisition-funnel-note"><strong>Как связаны данные</strong><span>Общая неорганическая воронка может включать другие платные источники. Экономика по ключам берётся отдельно напрямую из Adapty с фильтром apple_search_ads и сопоставляется по Apple keyword ID.</span></div>
        </section>

        {adapty?.available && adapty.countries?.length ? <section className="acquisition-funnel-section"><div className="acquisition-funnel-section-heading"><div><h2>Воронка по странам</h2><p>Все страны в одном срезе; выберите страну сверху, чтобы сфокусировать остальные блоки.</p></div></div><div className="acquisition-funnel-table-wrap"><table className="acquisition-funnel-table"><thead><tr><th>Страна</th><th>Установки</th><th>Триалы</th><th>Оплаты</th><th>Установка → триал</th><th>Триал → оплата</th><th>Установка → оплата</th></tr></thead><tbody>{adapty.countries.map((row) => <tr key={row.country}><td><strong>{row.title}</strong><small>{row.country}</small></td><td>{formatValue(row.all.installs)}</td><td>{formatValue(row.all.trials)}</td><td>{formatValue(row.all.paid)}</td><td>{formatPercent(conversion(row.all.trials, row.all.installs))}</td><td>{formatPercent(conversion(row.all.paid, row.all.trials))}</td><td>{formatPercent(conversion(row.all.paid, row.all.installs))}</td></tr>)}</tbody></table></div></section> : null}

        <section className="acquisition-funnel-section">
          <div className="acquisition-funnel-section-heading"><div><h2>Разрез по источникам</h2><p>Помогает отличить поиск, browse, referrer и прочие каналы; это не разбивка paid/organic.</p></div></div>
          {analysis.rows.length ? <div className="acquisition-funnel-table-wrap"><table className="acquisition-funnel-table"><thead><tr><th>Источник</th><th>Показы</th><th>Страница</th><th>Первые загрузки</th><th>Показ → страница</th><th>Страница → загрузка</th></tr></thead><tbody>{analysis.rows.map((row) => <tr key={`${row.country}-${row.sourceType}`}><td><strong>{row.sourceType || 'Не определён'}</strong><small>{row.country}</small></td><td>{formatValue(number(row.impressions))}</td><td>{formatValue(number(row.productPageViews))}</td><td>{formatValue(number(row.firstTimeDownloads))}</td><td>{formatPercent(row.impressionToPageView)}</td><td>{formatPercent(row.pageViewToDownload)}</td></tr>)}</tbody></table></div> : <p className="acquisition-funnel-no-sources">Для выбранной витрины в локальном snapshot пока нет строк.</p>}
        </section>

        {quality ? (
          <details className="acquisition-funnel-quality">
            <summary>Диагностика источников и покрытия</summary>
            <DataQuality sources={quality.sources} title="Источники и покрытие" />
          </details>
        ) : null}
      </div> : null}
    </section>
  );
}

function FunnelStep({ metric, index }: { metric: FunnelMetric; index: number }) {
  return <article className={`acquisition-funnel-step acquisition-funnel-step-${metric.kind}`} title={metric.detail}><span className="acquisition-funnel-step-number">{index + 1}</span><div><span className="acquisition-funnel-step-label">{metric.label}</span><strong>{formatValue(metric.value, metric.currency)}</strong><small>{metric.source}</small>{metric.detail ? <p>{metric.detail}</p> : null}</div><span className={`acquisition-funnel-kind acquisition-funnel-kind-${metric.kind}`}>{kindLabel(metric.kind)}</span></article>;
}

function ConversionStrip({ metrics }: { metrics: ConversionMetric[] }) {
  return <div className="acquisition-funnel-conversions" aria-label="Конверсии между этапами">{metrics.map((metric) => <div className={`acquisition-funnel-conversion acquisition-funnel-conversion-${metric.kind}`} key={metric.label} title={metric.detail}><span>{metric.label}</span><strong>{formatPercent(metric.value)}</strong><small>{metric.detail}</small></div>)}</div>;
}

function CohortRevenueSection({ cohorts }: { cohorts: AdaptyCohortPayload | null }) {
  if (!cohorts?.available || !cohorts.rows?.length) {
    return <section className="acquisition-funnel-section"><div className="acquisition-funnel-section-heading"><div><h2>Когорты выручки D0–D60</h2><p>Чистая выручка созревших месячных когорт после установки. Когорты всегда считаются по всем странам и не меняются селектором выше.</p></div><span className="acquisition-funnel-window">Все страны</span></div><div className="acquisition-funnel-gap"><strong>Когортные данные недоступны</strong><span>{cohorts?.reason ?? 'Adapty пока не вернул когорты для приложения.'}</span></div></section>;
  }

  const days = cohorts.days ?? [0, 7, 14, 30, 60];
  const summaries = new Map((cohorts.matureByDay ?? []).map((row) => [row.day, row]));

  return <section className="acquisition-funnel-section acquisition-funnel-cohorts">
    <div className="acquisition-funnel-section-heading">
      <div><h2>Когорты выручки D0–D60</h2><p>Сколько чистой выручки приносит установка через 0, 7, 14, 30 и 60 дней. Всегда все страны: селектор страны выше на когорты не влияет.</p></div>
      <span className="acquisition-funnel-window">Все страны · {cohorts.window ? `${formatCohortMonth(cohorts.window.start)} — ${formatCohortMonth(cohorts.window.end)}` : '3 месяца'}</span>
    </div>

    <div className="acquisition-funnel-cohort-summary">
      {days.map((day) => {
        const row = summaries.get(day);
        return <article key={day} title={`Только месячные когорты, полностью созревшие до D${day}.`}>
          <div><span>D{day}</span><small>{row ? `${row.cohorts} ${row.cohorts === 1 ? 'когорта' : row.cohorts < 5 ? 'когорты' : 'когорт'}` : 'нет зрелых когорт'}</small></div>
          <strong>{row ? formatUsd(row.netRevenuePerInstall, 2) : '—'}<small>/ установка</small></strong>
          <p>{row ? `${formatUsd(row.netRevenueUsd)} чистыми · ${formatValue(row.installs)} установок` : 'Недостаточно времени для сравнения'}</p>
        </article>;
      })}
    </div>

    <div className="acquisition-funnel-table-wrap">
      <table className="acquisition-funnel-table acquisition-funnel-cohort-table">
        <thead><tr><th>Когорта установок</th><th>Установки</th>{days.map((day) => <th key={day}>D{day}<span className="acquisition-funnel-info" title={`Накопленная чистая выручка на D${day}; в решениях учитывается только после созревания окна.`}>?</span></th>)}<th>Выручка сейчас</th></tr></thead>
        <tbody>{cohorts.rows.map((row) => {
          const values = new Map(row.values.map((value) => [value.day, value]));
          return <tr key={row.startDate}>
            <td><strong>{formatCohortMonth(row.startDate)}</strong><small>{row.startDate} — {row.endDate}</small></td>
            <td>{formatValue(row.installs)}</td>
            {days.map((day) => {
              const value = values.get(day);
              return <td key={day} className={value?.mature ? 'acquisition-funnel-cohort-mature' : 'acquisition-funnel-cohort-immature'}>
                <strong>{value ? formatUsd(value.netRevenueUsd) : '—'}</strong>
                <small>{value ? `${formatUsd(value.netRevenuePerInstall, 2)} / уст.` : '—'}</small>
                <span>{value?.mature ? 'созрела' : 'не созрела'}</span>
              </td>;
            })}
            <td><strong>{formatUsd(row.totalNetRevenueUsd)}</strong><small>{formatValue(row.paidSubscribers)} платящих</small></td>
          </tr>;
        })}</tbody>
      </table>
    </div>

    <div className="acquisition-funnel-note"><strong>Как читать</strong><span>{cohorts.maturityRule} Незрелые ячейки видны для контроля, но не участвуют в сравнении. {cohorts.limitation}{cohorts.stale ? ` Показан последний хороший кэш: ${cohorts.refreshError ?? 'обновление не удалось'}.` : ''}</span></div>
  </section>;
}

export default AcquisitionFunnel;
