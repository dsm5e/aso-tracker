import { useEffect, useMemo, useState } from 'react';
import './Competitors.css';
import { Sparkline } from '../../../shared/charts/Charts';
import {
  api,
  type AdRepositoryAd,
  type AdRepositoryPayload,
  type CompetitorInfo,
  type CompetitorKeywordRow,
  type CompetitorSummary,
  type PaidObservationsPayload,
  type PricingInfo,
  type ReviewsPayload,
} from '../api';

export interface CompetitorsProps {
  app: { id: string; name: string; iTunesId: string };
  locale: string;
}

type AppleTrafficTerm = {
  keyword?: string;
  term?: string;
  popularity?: number | null;
  demandIndex?: number | null;
  availableIndex?: number | null;
  capturedShare?: number | { value?: number | null } | null;
  impressionShare?: number | { value?: number | null } | null;
  signalCountryCount?: number | null;
};

type DetailState = {
  info: CompetitorInfo | null;
  keywords: CompetitorKeywordRow[];
  pricing: PricingInfo | null;
  reviews: ReviewsPayload | null;
  repository: AdRepositoryPayload | null;
  repositoryError: string | null;
  loading: boolean;
  error: string | null;
};

const emptyDetail: DetailState = {
  info: null,
  keywords: [],
  pricing: null,
  reviews: null,
  repository: null,
  repositoryError: null,
  loading: false,
  error: null,
};

function position(value: number | null | undefined) {
  return value == null ? '—' : `#${value}`;
}

function normalizedTerm(value: string) {
  return value.trim().toLocaleLowerCase();
}

function score(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value >= 0 && value <= 1 ? value * 100 : value;
}

function signalValue(value: number | { value?: number | null } | null | undefined) {
  if (typeof value === 'number') return score(value);
  return score(value?.value);
}

function factLabel(kind: 'fact' | 'estimate' | 'unavailable') {
  return kind === 'fact' ? 'Факт' : kind === 'estimate' ? 'Оценка' : 'Недоступно';
}

function formattedDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('ru-RU');
}

function repositoryPlacement(value: string) {
  const labels: Record<string, string> = {
    APPSTORE_SEARCH_RESULTS: 'Результаты поиска',
    APPSTORE_SEARCH_RESULT: 'Результаты поиска',
    APPSTORE_SEARCH_TAB: 'Вкладка «Поиск»',
    APPSTORE_TODAY_TAB: 'Вкладка «Сегодня»',
    APPSTORE_PRODUCT_PAGES_BROWSE: 'Страницы приложений',
    APPSTORE_PRODUCT_PAGE: 'Страницы приложений',
    SEARCH_RESULTS: 'Результаты поиска',
    SEARCH_TAB: 'Вкладка «Поиск»',
    TODAY_TAB: 'Вкладка «Сегодня»',
    PRODUCT_PAGES: 'Страницы приложений',
  };
  return labels[value] ?? value.replaceAll('_', ' ').toLocaleLowerCase('ru-RU');
}

function repositoryCacheLabel(payload: AdRepositoryPayload) {
  if (payload.cacheStatus === 'fresh') return `кэш от ${new Date(payload.fetchedAt).toLocaleString('ru-RU')}`;
  if (payload.cacheStatus === 'refreshed') return 'обновлено из Apple сейчас';
  if (payload.cacheStatus === 'partial') return 'частичный ответ Apple';
  return `последняя сохранённая версия от ${new Date(payload.fetchedAt).toLocaleString('ru-RU')}`;
}

function repositoryTargeting(ad: AdRepositoryAd) {
  const labels: string[] = [];
  if (ad.audienceRefinement.ageTarget) labels.push('возраст');
  if (ad.audienceRefinement.genderTarget) labels.push('пол');
  if (ad.audienceRefinement.locationTarget) labels.push('геолокация');
  if (ad.audienceRefinement.customerTypeTarget) labels.push('тип пользователя');
  return labels;
}

function FactBadge({ kind }: { kind: 'fact' | 'estimate' | 'unavailable' }) {
  return <small className={`competitor-evidence competitor-evidence-${kind}`}>{factLabel(kind)}</small>;
}

function HistoryLine({ rows }: { rows: CompetitorKeywordRow[] }) {
  const points = rows.flatMap((row) => row.history.filter((point): point is { date: string; rank: number } => point.rank != null));
  if (points.length < 2) return <span className="competitor-history-empty" title="Для графика нужны минимум две точки" aria-label="Недостаточно данных">—</span>;
  const recent = points.slice(-24);
  // Lower App Store rank is better, so it is shown higher on the line.
  return (
    <div className="competitor-history" style={{ width: "100%", minWidth: 64 }} aria-label="История позиций: меньший номер позиции находится выше">
      <Sparkline values={recent.map((point) => point.rank)} labels={recent.map((point) => point.date)} height={42} invert label="Позиция" fmt={(rank) => `#${rank}`} />
    </div>
  );
}

export default function Competitors({ app, locale }: CompetitorsProps) {
  const [competitors, setCompetitors] = useState<CompetitorSummary[]>([]);
  const [selectedBundle, setSelectedBundle] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [detail, setDetail] = useState<DetailState>(emptyDetail);
  const [appleTerms, setAppleTerms] = useState<Map<string, AppleTrafficTerm>>(new Map());
  const [appleSourceStatus, setAppleSourceStatus] = useState<'idle' | 'loading' | 'available' | 'unavailable'>('idle');
  const [keywordQuery, setKeywordQuery] = useState('');
  const [keywordScope, setKeywordScope] = useState<'locale' | 'all'>('all');
  const [paidFocus, setPaidFocus] = useState<CompetitorKeywordRow | null>(null);
  const [paidObservation, setPaidObservation] = useState<{ loading: boolean; data: PaidObservationsPayload | null; error: string | null }>({ loading: false, data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    setSelectedBundle(null);
    api.competitors(app.id)
      .then((items) => {
        if (cancelled) return;
        setCompetitors(items);
        setSelectedBundle(items[0]?.bundleId ?? null);
      })
      .catch((error: Error) => { if (!cancelled) setListError(error.message); })
      .finally(() => { if (!cancelled) setListLoading(false); });
    return () => { cancelled = true; };
  }, [app.id]);

  useEffect(() => {
    if (!selectedBundle) { setDetail(emptyDetail); return; }
    let cancelled = false;
    setDetail({ ...emptyDetail, loading: true });
    Promise.all([
      api.competitorInfo(selectedBundle, locale).catch(() => null),
      api.competitorKeywords(app.id, selectedBundle).catch(() => []),
    ])
      .then(async ([info, keywords]) => {
        let pricing: PricingInfo | null = null;
        let reviews: ReviewsPayload | null = null;
        let repository: AdRepositoryPayload | null = null;
        let repositoryError: string | null = null;
        if (info?.iTunesId) {
          [pricing, reviews, repository] = await Promise.all([
            api.competitorPricing(info.iTunesId, locale).catch(() => null),
            api.competitorReviews(info.iTunesId, locale).catch(() => null),
            api.competitorAds(info.iTunesId).catch((error: Error) => {
              repositoryError = error.message;
              return null;
            }),
          ]);
        }
        if (!cancelled) setDetail({ info, keywords, pricing, reviews, repository, repositoryError, loading: false, error: null });
      })
      .catch((error: Error) => { if (!cancelled) setDetail({ ...emptyDetail, error: error.message }); });
    return () => { cancelled = true; };
  }, [app.id, locale, selectedBundle]);

  useEffect(() => {
    if (!app.iTunesId || detail.keywords.length === 0) { setAppleTerms(new Map()); setAppleSourceStatus('idle'); return; }
    const controller = new AbortController();
    setAppleSourceStatus('loading');
    const storefront = locale.split('-')[0].toUpperCase();
    const country = keywordScope === 'all' ? 'ALL' : storefront;
    const params = new URLSearchParams({ app_id: app.iTunesId, country, days: '30' });
    fetch(`/asa-api/decision-matrix?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
        const nested = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : record;
        const rows = [nested.keywords, nested.discovery, nested.terms]
          .flatMap((value) => Array.isArray(value) ? value : []);
        const next = new Map<string, AppleTrafficTerm>();
        rows.forEach((row) => {
          if (row && typeof row === 'object') {
            const term = row as AppleTrafficTerm;
            const name = term.keyword ?? term.term;
            if (typeof name === 'string') next.set(normalizedTerm(name), term);
          }
        });
        if (!controller.signal.aborted) { setAppleTerms(next); setAppleSourceStatus(next.size ? 'available' : 'unavailable'); }
      })
      .catch(() => { if (!controller.signal.aborted) { setAppleTerms(new Map()); setAppleSourceStatus('unavailable'); } });
    return () => controller.abort();
  }, [app.iTunesId, detail.keywords, keywordScope, locale]);

  // Paid SERP observations are intentionally fetched only for the one keyword
  // the operator opens. Apple does not expose competitor keyword bids or SOV.
  useEffect(() => {
    if (!paidFocus || !selectedBundle) return;
    let cancelled = false;
    const loadingTimer = window.setTimeout(() => {
      if (!cancelled) setPaidObservation({ loading: true, data: null, error: null });
    }, 0);
    api.paidObservations(app.id, {
      locale: paidFocus.locale,
      keyword: paidFocus.keyword,
      competitorId: detail.info?.iTunesId || selectedBundle,
      limit: 90,
    })
      .then((data) => { if (!cancelled) setPaidObservation({ loading: false, data, error: null }); })
      .catch((error: Error) => { if (!cancelled) setPaidObservation({ loading: false, data: null, error: error.message }); });
    return () => { cancelled = true; window.clearTimeout(loadingTimer); };
  }, [app.id, detail.info?.iTunesId, paidFocus, selectedBundle]);

  const selected = useMemo(() => competitors.find((item) => item.bundleId === selectedBundle) ?? null, [competitors, selectedBundle]);
  const localeKeywords = useMemo(() => detail.keywords.filter((row) => row.locale.toLowerCase() === locale.toLowerCase()), [detail.keywords, locale]);
  const averageRank = useMemo(() => {
    const ranks = localeKeywords.map((row) => row.theirRank).filter(Number.isFinite);
    return ranks.length ? ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length : null;
  }, [localeKeywords]);
  const scopedKeywords = useMemo(() => keywordScope === 'all' ? detail.keywords : localeKeywords, [detail.keywords, keywordScope, localeKeywords]);
  const visibleKeywords = useMemo(() => {
    const needle = normalizedTerm(keywordQuery);
    return scopedKeywords.filter((row) => !needle || normalizedTerm(`${row.keyword} ${row.locale}`).includes(needle));
  }, [keywordQuery, scopedKeywords]);
  const allStorefrontOrganic = useMemo(() => {
    const ranks = visibleKeywords.map((row) => row.theirRank).filter(Number.isFinite).sort((a, b) => a - b);
    const middle = Math.floor(ranks.length / 2);
    const medianRank = ranks.length === 0 ? null : ranks.length % 2 ? ranks[middle] : (ranks[middle - 1] + ranks[middle]) / 2;
    const locales = new Set(visibleKeywords.map((row) => row.locale.toLowerCase()));
    return {
      medianRank,
      locales: locales.size,
      observedRows: visibleKeywords.length,
      availableRows: scopedKeywords.length,
    };
  }, [scopedKeywords.length, visibleKeywords]);
  const title = detail.info?.name ?? selected?.name ?? '';
  const titleTokens = useMemo(() => new Set(normalizedTerm(title).match(/[\p{L}\p{N}]+/gu) ?? []), [title]);
  const titleCovered = useMemo(() => detail.keywords.filter((row) => {
    const tokens = normalizedTerm(row.keyword).match(/[\p{L}\p{N}]+/gu) ?? [];
    return tokens.length > 0 && tokens.every((token) => titleTokens.has(token));
  }).length, [detail.keywords, titleTokens]);
  const localeBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    detail.keywords.forEach((row) => counts.set(row.locale, (counts.get(row.locale) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [detail.keywords]);
  const takeover = useMemo(() => {
    const rows = scopedKeywords;
    const gaps = rows.filter((row) => row.theirRank <= 3 && (row.yourRank == null || row.yourRank > row.theirRank));
    const quickWins = gaps.filter((row) => row.yourRank != null && row.yourRank >= 4 && row.yourRank <= 20);
    const weLead = rows.filter((row) => row.yourRank != null && row.yourRank <= row.theirRank);
    const priority = [...gaps].sort((a, b) => {
      const demandA = score(appleTerms.get(normalizedTerm(a.keyword))?.popularity) ?? -1;
      const demandB = score(appleTerms.get(normalizedTerm(b.keyword))?.popularity) ?? -1;
      if (demandA !== demandB) return demandB - demandA;
      const gapA = (a.yourRank ?? 151) - a.theirRank;
      const gapB = (b.yourRank ?? 151) - b.theirRank;
      return gapB - gapA || a.theirRank - b.theirRank;
    }).slice(0, 8);
    return { gaps, quickWins, weLead, priority };
  }, [appleTerms, scopedKeywords]);
  const repositoryAds = useMemo(() => {
    const unique = new Map<string, AdRepositoryAd>();
    for (const ad of detail.repository?.ads ?? []) {
      const key = `${ad.countryOrRegion}:${ad.placement}:${ad.creativeSignature}`;
      if (!unique.has(key)) unique.set(key, ad);
    }
    return [...unique.values()];
  }, [detail.repository]);
  const repositoryCountryBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ad of detail.repository?.ads ?? []) {
      counts.set(ad.countryOrRegion, (counts.get(ad.countryOrRegion) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [detail.repository]);

  return (
    <section className="content" aria-label="Конкуренты">
      <header className="view-header">
        <div className="page-title-row">
          <div>
            <h1>Конкуренты</h1>
            <p>Органические конкуренты {app.name} в App Store. Список строится по пересечениям в выдаче, а не по рекламным кабинетам.</p>
          </div>
        </div>
      </header>

      <div className="competitors-workspace">
        <aside className="competitor-panel competitor-sidebar" aria-label="Список конкурентов">
          <div className="competitor-panel-title">
            <h2>В органической выдаче</h2><FactBadge kind="fact" />
          </div>
          <p className="competitor-muted">Показы — число появлений в отслеживаемом топе; средняя позиция — агрегированная оценка по снимкам.</p>
          {listLoading ? <p>Загрузка конкурентов…</p> : listError ? <p role="alert">Не удалось загрузить список: {listError}</p> : competitors.length === 0 ? <p>Конкуренты пока не обнаружены. Сначала обновите позиции ключевых слов.</p> : (
            <div className="competitors-list">
              {competitors.map((competitor) => (
                <button key={competitor.bundleId} onClick={() => setSelectedBundle(competitor.bundleId)} aria-pressed={selectedBundle === competitor.bundleId} className={selectedBundle === competitor.bundleId ? 'selected' : ''}>
                  <strong>{competitor.name}</strong>
                  <small>{competitor.dev} · ср. {position(competitor.avgRank)} · {competitor.appearances} появл.</small>
                </button>
              ))}
            </div>
          )}
        </aside>

        <main className="competitor-profile">
          {!selected ? <div className="competitor-panel competitor-state">Выберите конкурента слева, чтобы увидеть профиль и пересечения по ключевым словам.</div> : detail.loading ? <div className="competitor-panel competitor-state">Загрузка профиля конкурента…</div> : detail.error ? <div className="competitor-panel competitor-state" role="alert">Не удалось загрузить профиль: {detail.error}</div> : (
            <>
              <section className="competitor-panel">
                <div className="competitor-profile-header">
                  {detail.info?.iconUrl ? <img className="competitor-profile-icon" src={detail.info.iconUrl} alt="" width={56} height={56} /> : <div className="competitor-profile-fallback" aria-hidden="true">{selected.name.slice(0, 1)}</div>}
                  <div>
                    <div className="competitor-profile-name"><h2>{detail.info?.name ?? selected.name}</h2><FactBadge kind={detail.info ? 'fact' : 'unavailable'} /></div>
                    <p className="competitor-developer">{detail.info?.dev ?? selected.dev}{detail.info?.category ? ` · ${detail.info.category}` : ''}</p>
                    {detail.info?.storeUrl ? <a href={detail.info.storeUrl} target="_blank" rel="noreferrer">Открыть в App Store ↗</a> : <small>Ссылка на App Store недоступна.</small>}
                  </div>
                </div>
                <div className="competitor-kpi-grid competitor-kpi-grid-four">
                  <Kpi label="Пересечений" value={String(selected.appearances)} kind="fact" />
                  <Kpi label="Средняя позиция" value={position(selected.avgRank)} kind="estimate" />
                  <Kpi label="Топ-3" value={String(selected.top3Count)} kind="fact" />
                  <Kpi label="Лучшее место" value={position(selected.bestRank)} kind="fact" />
                </div>
              </section>

              <section className="competitor-panel">
                <div className="competitor-section-heading">
                  <div>
                    <h3>Почему приложение держится высоко</h3>
                    <p>Наблюдаемые сигналы, а не доказательство причинности: алгоритм ранжирования и конверсия конкурента закрыты.</p>
                  </div>
                  <FactBadge kind="estimate" />
                </div>
                <div className="competitor-signal-grid">
                  <article><strong>{selected.top1Count} первых мест</strong><span>из {selected.appearances} пересечений в нашей отслеживаемой выдаче</span></article>
                  <article><strong>{selected.localesCount} витрин</strong><span>широкое локализованное присутствие по наблюдаемым запросам</span></article>
                  <article><strong>{titleCovered} запросов</strong><span>полностью покрываются словами публичного title «{title}»</span></article>
                  <article><strong>{detail.info?.rating != null ? `★ ${detail.info.rating.toFixed(1)}` : 'Рейтинг скрыт'}</strong><span>{detail.info?.ratingCount?.toLocaleString('ru-RU') ?? 'нет'} оценок — публичный trust signal</span></article>
                  <article><strong>{detail.info?.languages?.length ?? '—'} языков</strong><span>заявлено в публичных данных текущей витрины</span></article>
                  <article><strong>{detail.info?.currentVersionReleaseDate ? new Date(detail.info.currentVersionReleaseDate).toLocaleDateString('ru-RU') : '—'}</strong><span>последнее публичное обновление версии</span></article>
                </div>
                <p className="competitor-caveat">Title доступен и проверяется напрямую. Subtitle и скрытое поле keywords конкурента публичный lookup не отдаёт; description показываем для анализа позиционирования, но не выдаём за индексируемое поле.</p>
              </section>

              <section className="competitor-panel">
                <div className="competitor-section-heading">
                  <div>
                    <h3>Карта перехвата</h3>
                    <p>Где конкурент уже в топ‑3, а MedScan ниже или ещё не ранжируется.</p>
                  </div>
                  <FactBadge kind="fact" />
                </div>
                <div className="competitor-kpi-grid competitor-kpi-grid-three">
                  <Kpi label="Разрывов в топ‑3" value={String(takeover.gaps.length)} kind="fact" hint="Строки гео × ключ, где конкурент в топ‑3 и стоит выше MedScan." />
                  <Kpi label="Быстрых побед" value={String(takeover.quickWins.length)} kind="estimate" hint="MedScan уже на позиции 4–20: такие запросы обычно реалистичнее дотолкнуть в топ‑3." />
                  <Kpi label="Уже обгоняем" value={String(takeover.weLead.length)} kind="fact" hint="Строки гео × ключ, где позиция MedScan не хуже позиции конкурента." />
                </div>
                {takeover.priority.length ? <div className="competitor-takeover-list">{takeover.priority.map((row) => {
                  const apple = appleTerms.get(normalizedTerm(row.keyword));
                  const demand = score(apple?.popularity ?? apple?.demandIndex);
                  return <article key={`${row.locale}-${row.keyword}`}>
                    <span className="competitor-takeover-locale">{row.locale.toUpperCase()}</span>
                    <div><strong>{row.keyword}</strong><small>конкурент {position(row.theirRank)} · MedScan {position(row.yourRank)}</small></div>
                    <span title="Apple popularity; для режима всех витрин — среднее доступных storefronts.">{demand == null ? 'спрос —' : `спрос ${Math.round(demand)}`}</span>
                  </article>;
                })}</div> : <p className="competitor-state">По наблюдаемым запросам разрывов в топ‑3 нет.</p>}
              </section>

              <section className="competitor-panel">
                <h3>Ключевые слова и география <FactBadge kind="fact" /></h3>
                <p className="competitor-muted">Показаны пересечения с вашим отслеживанием. Это не полный список ключевых слов конкурента.</p>
                {keywordScope === 'all' ? (
                  <>
                    <div className="competitor-kpi-grid competitor-kpi-grid-three">
                      <Kpi label="Строк в выборке" value={String(allStorefrontOrganic.observedRows)} kind="fact" hint="Количество видимых органических пересечений после текущего фильтра." />
                      <Kpi label="Витрин в выборке" value={String(allStorefrontOrganic.locales)} kind="fact" hint="Витрины, в которых конкурент замечен в отслеживаемом top-5." />
                      <Kpi label="Медиана позиции" value={position(allStorefrontOrganic.medianRank == null ? null : Math.round(allStorefrontOrganic.medianRank))} kind={allStorefrontOrganic.medianRank == null ? 'unavailable' : 'estimate'} hint="Медиана наблюдаемых organic-позиций по видимым строкам всех витрин; не глобальный рейтинг App Store." />
                    </div>
                    <p className="competitor-coverage-note"><FactBadge kind="fact" /> Покрытие: {allStorefrontOrganic.observedRows} из {allStorefrontOrganic.availableRows} доступных пересечений показано в текущей выборке. Полное число запросов конкурента и глобальное покрытие App Store недоступны.</p>
                  </>
                ) : (
                  <div className="competitor-kpi-grid competitor-kpi-grid-three">
                    <Kpi label={`Ключи в ${locale.toUpperCase()}`} value={String(localeKeywords.length)} kind="fact" />
                    <Kpi label="Регионов в данных" value={String(new Set(detail.keywords.map((row) => row.locale)).size)} kind="fact" />
                    <Kpi label="Ср. позиция в регионе" value={position(averageRank)} kind={averageRank == null ? 'unavailable' : 'estimate'} />
                  </div>
                )}
                <p className="competitor-source-note"><FactBadge kind={appleSourceStatus === 'available' ? 'fact' : 'unavailable'} /> {appleSourceStatus === 'loading' ? 'Загружаем сохранённые Apple traffic signals…' : appleSourceStatus === 'available' ? keywordScope === 'all' ? 'Demand и доля MedScan — агрегат сохранённых Apple signals по всем доступным витринам. Demand усредняется, доставка не запрашивается повторно у Apple.' : `Demand и доля MedScan — сохранённые Apple signals для ${locale.split('-')[0].toUpperCase()}. «Видимость конкурента» остаётся моделью organic rank × demand, а не его installs.` : 'Сохранённые Apple traffic signals для текущего среза недоступны: значения показаны прочерком.'}</p>
                <div className="competitor-keyword-controls">
                  <div className="competitor-scope" role="group" aria-label="География ключевых слов">
                    <button className={keywordScope === 'locale' ? 'selected' : ''} onClick={() => setKeywordScope('locale')}>{locale.toUpperCase()}</button>
                    <button className={keywordScope === 'all' ? 'selected' : ''} onClick={() => setKeywordScope('all')}>Все витрины</button>
                  </div>
                  <input value={keywordQuery} onChange={(event) => setKeywordQuery(event.target.value)} placeholder="Найти запрос или регион" aria-label="Поиск по ключевым словам конкурента" />
                </div>
                {visibleKeywords.length ? <div className="competitor-keyword-table"><table className="keyword-table"><thead><tr><th>Регион</th><th>Ключевое слово</th><th>Конкурент</th><th>Ваше приложение</th><th>Apple demand</th><th>Доступный индекс</th><th>Оценка видимости</th><th>История</th><th>Paid evidence</th></tr></thead><tbody>{visibleKeywords.map((row) => {
                  const apple = appleTerms.get(normalizedTerm(row.keyword));
                  const demand = score(apple?.popularity ?? apple?.demandIndex);
                  const rankWeight = [0, 1, .65, .45, .32, .25][Math.min(5, Math.max(1, row.theirRank))] ?? .2;
                  const competitorVisibility = demand == null ? null : Math.round(demand * rankWeight);
                  const captured = signalValue(apple?.capturedShare ?? apple?.impressionShare);
                  const available = score(apple?.availableIndex) ?? (demand != null && captured != null ? demand * Math.max(0, 1 - captured / 100) : null);
                  const inScope = keywordScope === 'all' || row.locale.toLowerCase() === locale.toLowerCase();
                  const focused = paidFocus?.locale === row.locale && paidFocus.keyword === row.keyword;
                  return <tr key={`${row.locale}-${row.keyword}`}><td>{row.locale.toUpperCase()}</td><td>{row.keyword}</td><td>{position(row.theirRank)}</td><td>{position(row.yourRank)}</td><td title="Факт Apple: относительный индекс спроса, не число установок. В режиме всех витрин — среднее доступных storefronts.">{demand == null || !inScope ? '—' : Math.round(demand)}</td><td title="Apple demand × незахваченная MedScan доля. Это не доля конкурента.">{available == null || !inScope ? '—' : Math.round(available)}</td><td title="Модель видимости: Apple demand × вес органической позиции. Не installs конкурента.">{competitorVisibility == null || !inScope ? '—' : competitorVisibility}</td><td><HistoryLine rows={[row]} /></td><td><button type="button" className={focused ? 'competitor-observation-link selected' : 'competitor-observation-link'} onClick={() => setPaidFocus(row)} title="Показывает только сохранённые наблюдения платной выдачи, не оценку доли трафика.">Наблюдения</button></td></tr>;
                })}</tbody></table></div> : <p>Для выбранного региона пересечений пока нет.</p>}
                {keywordScope === 'all' && localeBreakdown.length > 0 ? <div className="competitor-locale-chips">{localeBreakdown.map(([code, count]) => <span key={code}>{code.toUpperCase()} <b>{count}</b></span>)}</div> : null}
                {paidFocus ? <PaidObservationPanel focus={paidFocus} state={paidObservation} onClose={() => setPaidFocus(null)} /> : null}
              </section>

              <section className="competitor-panel">
                <h3>Метаданные, монетизация и отзывы</h3>
                <div className="competitor-meta-grid">
                  <div><FactBadge kind={detail.info ? 'fact' : 'unavailable'} /><p>Версия: {detail.info?.version ?? 'не указана'}<br />Языки: {detail.info?.languages?.join(', ') || 'не указаны'}<br />Цена: {detail.info?.formattedPrice ?? 'не указана'}</p></div>
                  <div><FactBadge kind={detail.pricing ? 'fact' : 'unavailable'} /><p>{detail.pricing ? `Подписок: ${detail.pricing.subscriptions.length}; покупок: ${detail.pricing.iap.length}` : 'Данные о подписках и покупках недоступны.'}<br />Отзывы: {detail.reviews?.totalCount ?? 'неизвестно'}{detail.reviews?.avgRating != null ? ` · средняя оценка ${detail.reviews.avgRating.toFixed(1)}` : ''}</p></div>
                </div>
                {detail.info?.description && <details><summary>Описание из App Store</summary><p>{detail.info.description}</p></details>}
              </section>

              <section className="competitor-panel">
                <div className="competitor-section-heading competitor-repository-heading">
                  <div>
                    <h3>Реклама Apple в ЕС</h3>
                    <p>Подтверждённые Apple записи о фактически доставленной рекламе за последний год.</p>
                  </div>
                  <FactBadge kind={detail.repository ? 'fact' : 'unavailable'} />
                </div>
                {detail.repositoryError ? (
                  <p className="competitor-repository-warning" role="status">Репозиторий Apple сейчас недоступен: {detail.repositoryError}. Остальные данные конкурента сохранены.</p>
                ) : !detail.repository ? (
                  <p className="competitor-state">У приложения нет числового Apple ID или ответ репозитория ещё не получен.</p>
                ) : (
                  <>
                    <p className="competitor-source-note"><FactBadge kind="fact" /> <a href={detail.repository.sourceUrl} target="_blank" rel="noreferrer">Официальный Apple App Store Advertising Repository ↗</a> · данные {formattedDate(detail.repository.dataStartDate)}–{formattedDate(detail.repository.dataEndDate)} · {repositoryCacheLabel(detail.repository)}.</p>
                    <div className="competitor-kpi-grid competitor-kpi-grid-four">
                      <Kpi label="Рекламных записей" value={String(detail.repository.summary.adCount)} kind="fact" hint="Количество записей Apple, не количество показов рекламы." />
                      <Kpi label="Стран с доставкой" value={String(detail.repository.summary.countryCount)} kind="fact" hint="Поддерживаемые страны ЕС, где Apple зафиксировала доставку рекламы." />
                      <Kpi label="Плейсментов" value={String(detail.repository.summary.placementCount)} kind="fact" />
                      <Kpi label="Вариантов креатива" value={String(detail.repository.summary.creativeVariantCount)} kind="fact" hint="Уникальные наборы формата, текста и ассетов. Это не обязательно отдельные CPP." />
                    </div>
                    {detail.repository.summary.adCount === 0 ? (
                      <p className="competitor-repository-empty">За выбранный период Apple не зафиксировала доставку рекламы этого приложения в поддерживаемых странах ЕС. Это не означает, что рекламы не было в США, Бразилии или других регионах вне репозитория.</p>
                    ) : (
                      <>
                        <div className="competitor-locale-chips competitor-repository-countries" aria-label="Рекламные записи по странам">
                          {repositoryCountryBreakdown.map(([country, count]) => <span key={country}>{country} <b>{count}</b></span>)}
                        </div>
                        <p className="competitor-cpp-status">
                          <FactBadge kind={detail.repository.summary.confirmedCppCount > 0 ? 'fact' : 'unavailable'} />{' '}
                          {detail.repository.summary.confirmedCppCount > 0
                            ? `Подтверждённых CPP: ${detail.repository.summary.confirmedCppCount}. Apple вернула идентификатор product page.`
                            : 'CPP не подтверждён: Apple не вернула product page identifier. Отличающиеся креативы сами по себе не доказывают использование CPP.'}
                        </p>
                        <div className="competitor-repository-grid">
                          {repositoryAds.slice(0, 18).map((ad) => {
                            const targeting = repositoryTargeting(ad);
                            const pictures = ad.assets.filter((asset) => asset.pictureUrl).slice(0, 3);
                            const video = ad.assets.find((asset) => asset.videoUrl);
                            return <article className="competitor-ad-card" key={`${ad.countryOrRegion}-${ad.placement}-${ad.creativeSignature}`}>
                              <div className="competitor-ad-head">
                                <span className="competitor-takeover-locale">{ad.countryOrRegion || 'EU'}</span>
                                <strong>{repositoryPlacement(ad.placement)}</strong>
                                <small>{ad.format.replaceAll('_', ' ').toLocaleLowerCase('ru-RU')}</small>
                              </div>
                              {pictures.length || video?.videoUrl ? <div className="competitor-ad-assets">
                                {pictures.map((asset, index) => <img key={`${asset.pictureUrl}-${index}`} src={asset.pictureUrl ?? ''} alt={`Креатив ${ad.appName || 'приложения'} в ${ad.countryOrRegion}`} loading="lazy" />)}
                                {pictures.length === 0 && video?.videoUrl ? <video src={video.videoUrl} controls muted preload="metadata" aria-label={`Видео-креатив ${ad.appName || 'приложения'}`} /> : null}
                              </div> : ad.iconPictureUrl ? <img className="competitor-ad-icon" src={ad.iconPictureUrl} alt="" loading="lazy" /> : null}
                              {ad.subtitle ? <p className="competitor-ad-subtitle">{ad.subtitle}</p> : null}
                              <div className="competitor-ad-dates"><span>первый: {formattedDate(ad.firstImpressionDate)}</span><span>последний: {formattedDate(ad.lastImpressionDate)}</span></div>
                              {targeting.length ? <small className="competitor-ad-targeting">Уточнение аудитории: {targeting.join(', ')}</small> : <small className="competitor-ad-targeting">Уточнение аудитории не заявлено</small>}
                              {ad.productPageId ? <small className="competitor-ad-cpp">CPP · {ad.productPageId}</small> : null}
                            </article>;
                          })}
                        </div>
                        {repositoryAds.length > 18 ? <p className="competitor-muted">Показаны 18 последних сочетаний страна × плейсмент × креатив из {repositoryAds.length}; агрегаты выше рассчитаны по всем записям.</p> : null}
                      </>
                    )}
                    {detail.repository.partialErrors.length ? <p className="competitor-repository-warning">Часть стран временно не ответила ({detail.repository.partialErrors.flatMap((item) => item.countries).join(', ')}). Показанные факты не смешиваются с модельными данными.</p> : null}
                    <details className="competitor-repository-limitations"><summary>Границы этих данных</summary><ul>{detail.repository.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details>
                  </>
                )}
              </section>

              <section className="competitor-panel">
                <h3>Текущая карточка App Store</h3>
                {detail.info?.screenshotUrls?.length ? <div className="competitor-screenshots">{detail.info.screenshotUrls.map((url) => <img key={url} src={url} alt="Скриншот App Store" />)}</div> : <p>Публичные скриншоты не обнаружены.</p>}
                <p className="competitor-muted">Здесь показана стандартная публичная страница текущей витрины. Подтверждённые рекламные креативы и CPP, для которых Apple вернула <code>ppid</code>, отображаются отдельно выше.</p>
              </section>

              <section className="competitor-panel competitor-disclosure">
                <h3>Что нельзя увидеть по чужому приложению</h3>
                <p><FactBadge kind="unavailable" /> Чужие кампании Apple Ads, ставки, ключевые слова в кампаниях, private traffic, показы, расходы, конверсии и Search Ads ROI закрыты. Эти данные доступны только владельцу рекламного кабинета и не выводятся как оценка.</p>
              </section>
            </>
          )}
        </main>
      </div>
    </section>
  );
}

function Kpi({ label, value, kind, hint }: { label: string; value: string; kind: 'fact' | 'estimate' | 'unavailable'; hint?: string }) {
  return <div className="competitor-kpi" title={hint}><FactBadge kind={kind} /><strong>{value}</strong><small>{label}</small></div>;
}

function PaidObservationPanel({
  focus,
  state,
  onClose,
}: {
  focus: CompetitorKeywordRow;
  state: { loading: boolean; data: PaidObservationsPayload | null; error: string | null };
  onClose: () => void;
}) {
  const rate = state.data?.summary.observedPaidAppearanceRate;
  return (
    <section className="competitor-observation-panel" aria-live="polite">
      <header>
        <div><h4>Наблюдение paid выдачи: «{focus.keyword}»</h4><p>{focus.locale.toUpperCase()} · отдельный доказательный слой, не оценка чужого трафика.</p></div>
        <button type="button" onClick={onClose} aria-label="Закрыть paid evidence">×</button>
      </header>
      {state.loading ? <p className="competitor-state">Загружаем сохранённые наблюдения…</p> : state.error ? <p className="competitor-repository-warning" role="alert">Наблюдения временно недоступны: {state.error}</p> : !state.data ? null : (
        <>
          {!state.data.capability.available ? <p className="competitor-repository-empty">{state.data.capability.reason || 'Наблюдений paid выдачи по этому запросу пока нет.'} Apple не публикует чужие ключи, ставки, расходы или долю показов.</p> : null}
          <div className="competitor-observation-kpis">
            <Kpi label="Снимков выдачи" value={String(state.data.summary.observationCount)} kind="fact" hint="Число сохранённых наблюдений, не число показов рекламы." />
            <Kpi label="Наблюдаемая частота появления" value={rate == null ? '—' : `${Math.round(rate * 100)}%`} kind={rate == null ? 'unavailable' : 'fact'} hint="Доля сохранённых наблюдений, где конкурент был отмечен в paid results. Это не impression share, не SOV и не доля трафика." />
            <Kpi label="Последний снимок" value={formattedDate(state.data.summary.latestObservedAt)} kind={state.data.summary.latestObservedAt ? 'fact' : 'unavailable'} />
            <Kpi label="Подтверждённые CPP" value={String(state.data.summary.confirmedCppIds.length)} kind={state.data.summary.confirmedCppIds.length ? 'fact' : 'unavailable'} hint="Только product page ID, найденный в реальной рекламной/evidence ссылке." />
          </div>
          {state.data.observations.length ? <div className="competitor-observation-list">{state.data.observations.slice(0, 8).map((observation) => <article key={observation.id}>
            <div><strong>{formattedDate(observation.observedAt)}</strong><small>{observation.source === 'authorized_partner_export' ? 'авторизованный partner export' : 'ручное наблюдение App Store'}</small></div>
            <p>{observation.paidResults.length ? observation.paidResults.map((result) => `${result.name} · ${result.placement} #${result.rank}${result.productPageId ? ` · CPP ${result.productPageId}` : ''}`).join(' · ') : 'Платные результаты в снимке не перечислены.'}</p>
            {observation.evidenceUrl ? <a href={observation.evidenceUrl} target="_blank" rel="noreferrer">Открыть evidence ↗</a> : <small>Ссылка-доказательство не приложена</small>}
          </article>)}</div> : null}
          <p className="competitor-observation-caveat">{state.data.capability.sourceScope.join(' · ') || 'Источник не указан'}. Частота показывается только при сохранённых наблюдениях и никогда не подменяет Apple impression share.</p>
        </>
      )}
    </section>
  );
}
