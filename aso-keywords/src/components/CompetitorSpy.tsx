import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import { useDismiss } from './useDismiss';
import { tipProps, type TipRow } from '../../../shared/charts/Charts';
import { spyApi, type GapClass, type SpyCheckJob, type SpyReport, type SpyRow } from '../competitorSpyApi';
import './CompetitorSpy.css';

export type SpyView = 'keywords' | 'gap';
type SortKey = 'keyword' | 'theirRank' | 'ourRank' | 'popularity' | 'difficulty' | 'chance' | 'opportunity';
type GapTab = Exclude<GapClass, 'none'>;

const GAP_TABS: Array<{ id: GapTab; label: string; hint: string }> = [
  { id: 'theirs', label: 'Только у них', hint: 'Конкурент в пределах порога, мы — нет' },
  { id: 'shared', label: 'Общие', hint: 'Оба приложения в пределах порога' },
  { id: 'ours', label: 'Только у нас', hint: 'Мы в пределах порога, конкурент — нет' },
];
const LIMITS = [10, 30, 100];
const CHECK_BATCH = 20;
const SOURCE_LABEL: Record<SpyRow['source'], string> = { full: 'полная выдача', cache: 'кэш поиска', snapshot: 'снимок топ-5' };

const fmtDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
};
const fmtNum = (value: number | null) => (value == null ? '—' : String(Math.round(value)));
const fmtPop = (value: number | null) => (value == null ? '—' : value <= 5 ? '≤5' : String(value));

function sortValue(row: SpyRow, key: SortKey): number | string | null {
  if (key === 'keyword') return row.keyword;
  return row[key];
}

/** Nulls always sink, whatever the direction (a missing rank is not "#0"). */
function sortRows(rows: SpyRow[], key: SortKey, dir: 1 | -1): SpyRow[] {
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va == null && vb == null) return a.keyword.localeCompare(b.keyword);
    if (va == null) return 1;
    if (vb == null) return -1;
    const diff = typeof va === 'string' ? va.localeCompare(String(vb)) : va - (vb as number);
    return diff * dir || a.keyword.localeCompare(b.keyword);
  });
}

export default function CompetitorSpy({
  appId,
  appName,
  competitor,
  storefront,
  storefronts,
  view,
  onKeywordsChanged,
}: {
  appId: string;
  appName: string;
  /** Competitor bundle id or numeric App Store id. */
  competitor: string;
  storefront: string;
  /** Storefronts the app tracks (targets for «Добавить в отслеживание»). */
  storefronts: string[];
  view: SpyView;
  onKeywordsChanged?: (keywords: Record<string, string[]>) => void;
}) {
  const [limit, setLimit] = useState(10);
  const [result, setResult] = useState<{ scope: string; key: string; report: SpyReport | null; error: string | null } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [gapTab, setGapTab] = useState<GapTab>('theirs');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anyJob, setJob] = useState<SpyCheckJob | null>(null);
  // Result sets are per storefront, not per competitor: a job stays visible across competitors.
  const job = anyJob?.storefront === storefront ? anyJob : null;
  const [trackState, setTrackState] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });

  // A report belongs to competitor × storefront; limit/reload changes keep the
  // previous rows on screen while the new ones load.
  const scope = `${appId}|${competitor}|${storefront}`;
  const requestKey = `${scope}|${limit}|${reloadTick}`;
  useEffect(() => {
    const controller = new AbortController();
    spyApi.report(appId, competitor, storefront, limit, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setResult({ scope, key: requestKey, report: value, error: null }); })
      .catch((err: Error) => { if (!controller.signal.aborted) setResult((current) => ({ scope, key: requestKey, report: current?.scope === scope ? current.report : null, error: err.message })); });
    return () => controller.abort();
  }, [appId, competitor, storefront, limit, scope, requestKey]);
  const report = result?.scope === scope ? result.report : null;
  const loading = result?.key !== requestKey;
  const error = actionError ?? (result?.key === requestKey ? result.error : null);

  // Reset selection/filter when the table's meaning changes (render-time reset).
  const viewKey = `${scope}|${view}|${gapTab}`;
  const [prevViewKey, setPrevViewKey] = useState(viewKey);
  if (prevViewKey !== viewKey) {
    setPrevViewKey(viewKey);
    setSelected(new Set());
    setQuery('');
  }

  // Poll the rate-limited check job; reload the report as terms land.
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const timer = window.setInterval(() => {
      spyApi.job(job.id)
        .then((next) => {
          setJob(next);
          if (next.status !== 'running' || next.done % 5 === 0 && next.done !== job.done) setReloadTick((tick) => tick + 1);
        })
        .catch(() => {/* next tick retries */});
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job]);

  const rows = useMemo(() => {
    if (!report) return [];
    const needle = query.trim().toLocaleLowerCase();
    const scoped = report.rows.filter((row) => (view === 'keywords' ? row.theirRank != null : row.gap === gapTab))
      .filter((row) => !needle || row.keyword.includes(needle));
    const active = sort ?? (view === 'keywords' ? { key: 'theirRank' as const, dir: 1 as const } : null);
    return active ? sortRows(scoped, active.key, active.dir) : scoped; // server order = Opportunity
  }, [report, view, gapTab, query, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((current) => {
      const lowerFirst = key === 'keyword' || key === 'theirRank' || key === 'ourRank' || key === 'difficulty';
      if (!current || current.key !== key) return { key, dir: lowerFirst ? 1 : -1 };
      return { key, dir: current.dir === 1 ? -1 : 1 };
    });
  };

  const startCheck = async () => {
    if (!report?.candidates.length) return;
    try {
      setActionError(null);
      setJob(await spyApi.startCheck(storefront, report.candidates.slice(0, CHECK_BATCH)));
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  const track = async (targets: string[]) => {
    const keywords = [...selected];
    if (!keywords.length || !targets.length) return;
    setTrackState({ busy: true, message: null });
    try {
      const result = await spyApi.track(appId, keywords, targets);
      onKeywordsChanged?.(result.keywords);
      setTrackState({ busy: false, message: `Добавлено ${result.added} пар «ключ × витрина» (${targets.map((code) => code.toUpperCase()).join(', ')}). Позиции появятся после обновления снимка.` });
      setSelected(new Set());
      setReloadTick((tick) => tick + 1);
    } catch (err) {
      setTrackState({ busy: false, message: `Не удалось добавить: ${(err as Error).message}` });
    }
  };

  if (!report) {
    return <div className="competitor-panel competitor-state" role={error ? 'alert' : undefined}>{error ? `Не удалось собрать ключи конкурента: ${error}` : 'Собираем выдачи, в которых встречается конкурент…'}</div>;
  }

  const { coverage, competitor: meta } = report;
  const cc = storefront.toUpperCase();
  const selectable = view === 'gap';
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.keyword));
  const running = job?.status === 'running';

  return (
    <section className="competitor-panel spy" aria-busy={loading}>
      <header className="spy-head">
        {meta.iconUrl ? <img src={meta.iconUrl} alt="" width={40} height={40} className="spy-icon" /> : <div className="spy-icon spy-icon-empty" aria-hidden="true">{meta.name.slice(0, 1)}</div>}
        <div className="spy-head-text">
          <h3>{view === 'keywords' ? 'По каким ключам ранжируется' : 'Gap-анализ'} · {meta.name}</h3>
          <p className="ds-note">
            {meta.subtitle ? <>Подзаголовок: «{meta.subtitle}»</> : 'Подзаголовка нет'} · {cc}
            {view === 'gap' ? <> · сравнение с {appName}</> : null}
          </p>
        </div>
        <span className="ds-badge ds-badge-muted" {...tipProps('Витрина', [[null, 'Следует за текущей страной приложения', cc]])}>{cc}</span>
      </header>

      <div className="spy-coverage">
        <p {...tipProps('Покрытие', coverageTip(report))}>
          Найден в <b>{coverage.found}</b> из <b>{coverage.checked}</b> проверенных выдач {cc}.{' '}
          <span className="spy-muted">Глубина: {coverage.full} полных (топ-200), {coverage.cache} из кэша поиска (топ-15), {coverage.snapshot} снимков (топ-5).{coverage.trackedUnchecked ? ` Ещё ${coverage.trackedUnchecked} отслеживаемых ключей без выдачи.` : ''}</span>
        </p>
        <div className="spy-check">
          {running && job ? (
            <div className="spy-progress" role="status">
              <div className="spy-progress-bar"><span style={{ width: `${(job.done / Math.max(1, job.terms.length)) * 100}%` }} /></div>
              <small>Проверено {job.done} из {job.terms.length}{job.current ? ` · «${job.current}»` : ''}{job.note ? ` · ${job.note}` : ''}</small>
              <button type="button" className="ds-btn ds-btn-sm" onClick={() => spyApi.abort(job.id).then(setJob).catch(() => {})}>Остановить</button>
            </div>
          ) : (
            <button
              type="button"
              className="ds-btn"
              disabled={!report.candidates.length}
              onClick={startCheck}
              {...tipProps('Новые запросы в App Store', [
                [null, 'Сначала фразы из названия и подзаголовка конкурента, которых нет в наших выдачах,', ''], [null, 'затем перепроверка неглубоких выдач (топ-5/15) до топ-200', ''],
                [null, 'Скорость', '≈18 запросов в минуту'],
                ...report.candidates.slice(0, CHECK_BATCH).slice(0, 8).map((term): TipRow => [null, term, '']),
              ])}
            >
              <Icon name="search" />{report.candidates.length ? `Проверить ещё ${Math.min(CHECK_BATCH, report.candidates.length)} ${plural(Math.min(CHECK_BATCH, report.candidates.length), 'ключ', 'ключа', 'ключей')}` : 'Все кандидаты проверены'}
            </button>
          )}
          {job && job.status !== 'running' ? <small className="spy-muted">{job.status === 'done' ? `Готово: проверено ${job.done}.` : job.status === 'aborted' ? `Остановлено на ${job.done} из ${job.terms.length}.` : `Ошибка: ${job.error}`}</small> : null}
        </div>
      </div>

      <div className="spy-controls">
        {view === 'gap' ? (
          <div className="ds-seg" role="tablist" aria-label="Группы gap-анализа">
            {GAP_TABS.map((tab) => (
              <button key={tab.id} role="tab" aria-selected={gapTab === tab.id} className={gapTab === tab.id ? 'on' : ''} onClick={() => setGapTab(tab.id)} {...tipProps(tab.label, [[null, tab.hint, `топ-${limit}`]])}>
                {tab.label} <span className="spy-count">{report.counts[tab.id]}</span>
              </button>
            ))}
          </div>
        ) : null}
        {view === 'gap' ? (
          <div className="ds-seg" aria-label="Порог позиции">
            {LIMITS.map((value) => <button key={value} className={limit === value ? 'on' : ''} aria-pressed={limit === value} onClick={() => setLimit(value)}>топ-{value}</button>)}
          </div>
        ) : null}
        <input className="ds-input spy-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти ключ" aria-label="Фильтр по ключу" />
        <span className="spy-muted spy-pop-status" {...tipProps('Популярность Apple Ads', report.formula.map((line): TipRow => [null, line, '']))}>
          {report.popularity === 'ok' ? 'Популярность: Apple Ads' : report.popularity === 'no-data' ? 'Apple Ads не вернул популярность' : 'Apple Ads недоступен — Opportunity не считается'}
          <Icon name="info" size={14} />
        </span>
      </div>

      {selectable && selected.size > 0 ? (
        <BulkBar key={storefront} count={selected.size} storefront={storefront} storefronts={storefronts} busy={trackState.busy} onTrack={track} onClear={() => setSelected(new Set())} />
      ) : null}
      {trackState.message ? <p className="spy-message" role="status">{trackState.message}</p> : null}

      {rows.length === 0 ? (
        <p className="competitor-state spy-empty">{emptyText(view, gapTab, report, limit)}</p>
      ) : (
        <div className="ds-table-wrap spy-table-wrap">
          <table className="ds-table spy-table">
            <thead>
              <tr>
                {selectable ? (
                  <th className="spy-check-col">
                    <input type="checkbox" checked={allSelected} aria-label="Выбрать все" onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.keyword)))} />
                  </th>
                ) : null}
                <SortTh label="Ключ" k="keyword" sort={sort} onSort={toggleSort} />
                <SortTh label="Конкурент" k="theirRank" sort={sort} onSort={toggleSort} num />
                <SortTh label={appName} k="ourRank" sort={sort} onSort={toggleSort} num />
                <SortTh label="Pop" k="popularity" sort={sort} onSort={toggleSort} num tip="Popularity: Apple Ads, шкала 5–100; ≤5 — низкий объём, не ноль" />
                <SortTh label="Diff" k="difficulty" sort={sort} onSort={toggleSort} num tip="Difficulty: сила топ-10 выдачи, 0–100" />
                <SortTh label="Chance" k="chance" sort={sort} onSort={toggleSort} num tip="Шанс попасть в топ-10 для нас, 0–100" />
                <SortTh label="Opp." k="opportunity" sort={sort} onSort={toggleSort} num tip="Opportunity = Pop × Chance/100 × (1 − R)" />
                <th>Выдача</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.keyword} className={selected.has(row.keyword) ? 'spy-row-selected' : undefined}>
                  {selectable ? (
                    <td className="spy-check-col">
                      <input type="checkbox" checked={selected.has(row.keyword)} aria-label={`Выбрать «${row.keyword}»`} onChange={() => setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(row.keyword)) next.delete(row.keyword); else next.add(row.keyword);
                        return next;
                      })} />
                    </td>
                  ) : null}
                  <td className="spy-kw">
                    <span className="spy-kw-text">{row.keyword}</span>
                    <span className="spy-markers">
                      {row.inTheirTitle ? <span className="ds-badge" {...tipProps('В названии конкурента', [[null, meta.name, '']])}>название</span> : null}
                      {row.inTheirSubtitle ? <span className="ds-badge" {...tipProps('В подзаголовке конкурента', [[null, meta.subtitle ?? '', '']])}>подзаголовок</span> : null}
                      {!row.inTheirTitle && !row.inTheirSubtitle && row.wordsInTheirMeta ? <span className="ds-badge ds-badge-muted" {...tipProps('Слова есть в метаданных', [[null, 'Все слова ключа есть в названии/подзаголовке, но не подряд', '']])}>из слов</span> : null}
                      {row.tracked ? <span className="ds-badge ds-badge-good">отслеживаем</span> : row.trackedBy.length ? <span className="ds-badge ds-badge-muted" {...tipProps('Пул ключей', [[null, 'Отслеживается другим нашим приложением', row.trackedBy.join(', ')]])}>пул</span> : null}
                    </span>
                  </td>
                  <RankCell rank={row.theirRank} depth={row.theirDepth} />
                  <RankCell rank={row.ourRank} depth={row.ourDepth} uncertain={row.uncertain && row.gap === 'theirs'} />
                  <td className="spy-num" {...tipProps('Популярность', [[null, 'Apple Ads', fmtPop(row.popularity)]])}>{fmtPop(row.popularity)}</td>
                  <td className="spy-num">{fmtNum(row.difficulty)}</td>
                  <td className="spy-num">{fmtNum(row.chance)}</td>
                  <td className="spy-num spy-opp" {...tipProps(`Opportunity · ${row.keyword}`, oppTip(row))}>{row.opportunity == null ? '—' : row.opportunity.toFixed(1)}</td>
                  <td className="spy-src" {...tipProps('Источник выдачи', [[null, SOURCE_LABEL[row.source], `топ-${Math.min(row.theirDepth, 200)}`], [null, 'Проверено', fmtDate(row.checkedAt)]])}>
                    топ-{Math.min(row.theirDepth, 200)} · {fmtDate(row.checkedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function coverageTip(report: SpyReport): TipRow[] {
  return [
    [null, 'Проверенных выдач', String(report.coverage.checked)],
    [null, 'Конкурент найден', String(report.coverage.found)],
    [null, 'Полная выдача (топ-200)', String(report.coverage.full)],
    [null, 'Кэш поиска (топ-15)', String(report.coverage.cache)],
    [null, 'Снимок трекера (топ-5)', String(report.coverage.snapshot)],
    [null, 'Отсутствие в неглубокой выдаче не значит «не ранжируется»', ''],
  ];
}

function oppTip(row: SpyRow): TipRow[] {
  const r = row.ourRank != null && row.ourRank <= 3 ? 1 : row.ourRank != null && row.ourRank <= 10 ? 0.5 : 0;
  return [
    [null, 'Popularity', fmtPop(row.popularity)],
    [null, 'Chance', row.chance == null ? 'нет оценок топ-10 → 50' : String(row.chance)],
    [null, 'R (мы уже в топе)', String(r)],
    [null, 'Opportunity', row.opportunity == null ? 'нет популярности' : row.opportunity.toFixed(1)],
  ];
}

function emptyText(view: SpyView, tab: GapTab, report: SpyReport, limit: number) {
  if (view === 'keywords') return `В ${report.coverage.checked} проверенных выдачах конкурент не найден. Нажмите «Проверить ещё», чтобы запросить фразы из его названия.`;
  if (tab === 'theirs') return `Нет ключей, где конкурент в топ-${limit}, а мы — нет.`;
  if (tab === 'shared') return `Нет ключей, где оба приложения в топ-${limit}.`;
  return `Нет ключей, где мы в топ-${limit}, а конкурент — нет.`;
}

function SortTh({ label, k, sort, onSort, num, tip }: {
  label: string; k: SortKey; sort: { key: SortKey; dir: 1 | -1 } | null; onSort: (key: SortKey) => void; num?: boolean; tip?: string;
}) {
  const active = sort?.key === k;
  return (
    <th className={num ? 'spy-num' : undefined} aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`spy-sort${active ? ' on' : ''}`} onClick={() => onSort(k)} {...(tip ? tipProps(label, [[null, tip, '']]) : {})}>
        {label}{active ? <span aria-hidden="true">{sort!.dir === 1 ? '↑' : '↓'}</span> : null}
      </button>
    </th>
  );
}

function RankCell({ rank, depth, uncertain }: { rank: number | null; depth: number; uncertain?: boolean }) {
  const shown = Math.min(depth, 200);
  if (rank != null) {
    return <td className={`spy-num spy-rank${rank <= 3 ? ' spy-rank-top' : rank <= 10 ? ' spy-rank-ten' : ''}`}>#{rank}</td>;
  }
  return (
    <td className="spy-num spy-rank-none" {...tipProps('Нет в выдаче', [[null, uncertain ? `Проверен только топ-${shown}: глубже не смотрели` : `Не найден в топ-${shown}`, '']])}>
      {uncertain ? `>${shown}?` : '—'}
    </td>
  );
}

function BulkBar({ count, storefront, storefronts, busy, onTrack, onClear }: {
  count: number; storefront: string; storefronts: string[]; busy: boolean;
  onTrack: (targets: string[]) => void; onClear: () => void;
}) {
  const [targets, setTargets] = useState<string[]>([storefront]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useDismiss(rootRef, open, () => setOpen(false));
  const options = [storefront, ...Array.from(new Set(storefronts)).filter((code) => code !== storefront).sort()];
  const toggle = (code: string) => setTargets((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  const label = targets.length === 0 ? 'Витрины не выбраны' : targets.length <= 3 ? targets.map((code) => code.toUpperCase()).join(', ') : `${targets.length} витрин`;

  return (
    <div className="spy-bulk" role="region" aria-label="Действия с выбранными ключами">
      <strong>Выбрано {count}</strong>
      <div className="picker" ref={rootRef}>
        <button type="button" className="picker-btn" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((value) => !value)}>
          <span className="picker-value">Витрины: {label}</span>
          <Icon name="chevronDown" className="picker-caret" />
        </button>
        {open ? (
          <div className="ds-pop picker-pop spy-sf-pop">
            <div className="spy-sf-presets">
              <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => setTargets([storefront])}>Только {storefront.toUpperCase()}</button>
              <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => setTargets(options)}>Все ({options.length})</button>
            </div>
            <div className="picker-list" role="listbox" aria-multiselectable="true">
              {options.map((code) => (
                <button key={code} type="button" role="option" aria-selected={targets.includes(code)} className="ds-pop-row" onClick={() => toggle(code)}>
                  <span className="picker-row-label">{code.toUpperCase()}</span>
                  {targets.includes(code) ? <Icon name="check" className="picker-check" /> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <button type="button" className="ds-btn ds-btn-primary" disabled={busy || !targets.length} onClick={() => onTrack(targets)}>
        <Icon name="plus" />{busy ? 'Добавляем…' : 'Добавить в отслеживание'}
      </button>
      <button type="button" className="ds-btn ds-btn-ghost" onClick={onClear}>Снять выбор</button>
    </div>
  );
}
