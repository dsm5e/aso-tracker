import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon';
import Picker from '../components/Picker';
import { useDismiss } from '../components/useDismiss';
import { LocaleChips } from '../components/CountryPalette';
import { tipProps, type TipRow } from '../../../shared/charts/Charts';
import {
  countriesApi,
  rankChange,
  rankTier,
  searchStorefronts,
  storefrontOf,
  type ColumnSetOption,
  type MatrixCell,
  type MatrixResponse,
} from '../countries';
import './CountryMatrix.css';

const ROW_H = 40;
const OVERSCAN = 10;

type SortKey = { by: 'best' | 'keyword' | 'locale'; locale?: string; dir: 1 | -1 };

interface RowModel {
  index: number;
  keyword: string;
  best: number;        // best rank across visible storefronts, Infinity when none
  bestLocale: string | null;
  top10: number;       // storefronts where it is in the top 10
}

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const formatDate = (value: string | undefined) => (value ? dateFmt.format(new Date(`${value}T00:00:00`)) : '—');

/** Sort value for a rank: ranked first, then «not in results», «no snapshot», «not tracked». */
const sortValue = (cell: MatrixCell | undefined) => {
  if (!cell) return 100_000;
  if (cell[1] == null) return 90_000;
  if (cell[1] === 0) return 80_000;
  return cell[1];
};

/**
 * «Все страны» — keyword × storefront matrix, the default Keywords screen.
 * Rows are virtualized (fixed 40px rows, simple windowing) so 1900 keywords scroll
 * smoothly; the first column and the header are sticky, storefront columns scroll
 * horizontally. A cell click opens the keyword drawer for that storefront.
 */
export default function CountryMatrix({
  appId,
  sets,
  activeSet,
  onSetChange,
  onSaveSet,
  onDeleteSet,
  onOpenCell,
  onOpenStorefront,
  refreshKey,
}: {
  appId: string;
  sets: ColumnSetOption[];
  activeSet: ColumnSetOption | undefined;
  onSetChange: (id: string) => void;
  onSaveSet: (name: string, locales: string[]) => Promise<void>;
  onDeleteSet: (id: string) => Promise<void>;
  onOpenCell: (keyword: string, locale: string) => void;
  onOpenStorefront: (locale: string) => void;
  refreshKey: number;
}) {
  // An edited column list belongs to the set it was made from; switching sets drops it.
  const draftScope = `${appId}:${activeSet?.id ?? ''}`;
  const [draftState, setDraftState] = useState<{ scope: string; locales: string[] } | null>(null);
  const draft = draftState?.scope === draftScope ? draftState.locales : null;
  const setDraft = useCallback((locales: string[] | null) => setDraftState(locales ? { scope: draftScope, locales } : null), [draftScope]);
  const columns = useMemo(() => draft ?? activeSet?.locales ?? [], [activeSet, draft]);
  const [data, setData] = useState<MatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [onlyTop10, setOnlyTop10] = useState(false);
  const [sort, setSort] = useState<SortKey>({ by: 'best', dir: 1 });

  // Fetch the matrix for the visible columns; poll like the positions view.
  const columnsKey = columns.join(',');
  useEffect(() => {
    if (!appId || !columnsKey) return;
    const controller = new AbortController();
    let first = true;
    const load = () => {
      const started = performance.now();
      if (first) setLoading(true);
      countriesApi.matrix(appId, columnsKey.split(','), controller.signal)
        .then((response) => { setData(response); setError(null); setLatency(Math.round(performance.now() - started)); })
        .catch((reason: Error) => { if (reason.name !== 'AbortError') setError(reason.message); })
        .finally(() => { if (first) setLoading(false); first = false; });
    };
    load();
    const timer = window.setInterval(load, 60_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [appId, columnsKey, refreshKey]);

  // Only columns the response knows about (a storefront could have been removed).
  const visibleColumns = useMemo(() => columns.filter((code) => data?.cells[code]), [columns, data]);

  // kw index → cell, per storefront.
  const lookup = useMemo(() => {
    const out = new Map<string, Array<MatrixCell | undefined>>();
    if (!data) return out;
    for (const code of visibleColumns) {
      const list: Array<MatrixCell | undefined> = new Array(data.keywords.length);
      for (const cell of data.cells[code] ?? []) list[cell[0]] = cell;
      out.set(code, list);
    }
    return out;
  }, [data, visibleColumns]);

  const rows = useMemo<RowModel[]>(() => {
    if (!data) return [];
    const needle = query.trim().toLocaleLowerCase();
    const out: RowModel[] = [];
    data.keywords.forEach((keyword, index) => {
      if (needle && !keyword.toLocaleLowerCase().includes(needle)) return;
      let best = Infinity, bestLocale: string | null = null, top10 = 0, tracked = false;
      for (const code of visibleColumns) {
        const cell = lookup.get(code)?.[index];
        if (!cell) continue;
        tracked = true;
        const pos = cell[1];
        if (pos != null && pos > 0) {
          if (pos < best) { best = pos; bestLocale = code; }
          if (pos <= 10) top10++;
        }
      }
      if (!tracked) return;
      if (onlyTop10 && !top10) return;
      out.push({ index, keyword, best, bestLocale, top10 });
    });
    const byKeyword = (a: RowModel, b: RowModel) => a.keyword.localeCompare(b.keyword);
    if (sort.by === 'keyword') out.sort((a, b) => sort.dir * byKeyword(a, b));
    else if (sort.by === 'best') {
      // Unranked rows stay last in both directions.
      out.sort((a, b) => (a.best === Infinity ? 1 : 0) - (b.best === Infinity ? 1 : 0) || sort.dir * (a.best - b.best) || b.top10 - a.top10 || byKeyword(a, b));
    } else {
      const list = lookup.get(sort.locale!) ?? [];
      out.sort((a, b) => {
        const va = sortValue(list[a.index]), vb = sortValue(list[b.index]);
        const ra = va >= 80_000 ? va : 0, rb = vb >= 80_000 ? vb : 0;
        return ra - rb || sort.dir * (va - vb) || byKeyword(a, b);
      });
    }
    return out;
  }, [data, lookup, onlyTop10, query, sort, visibleColumns]);

  const anyTop10 = useMemo(() => rows.filter((row) => row.top10 > 0).length, [rows]);

  // --- windowing -----------------------------------------------------------
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setViewport(node.clientHeight));
    observer.observe(node);
    setViewport(node.clientHeight);
    return () => observer.disconnect();
  }, []);
  const frame = useRef(0);
  const onScroll = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setScrollTop(scrollRef.current?.scrollTop ?? 0);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [query, onlyTop10, sort, appId]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_H) + OVERSCAN);
  const windowRows = rows.slice(start, end);

  const toggleSort = (next: SortKey['by'], locale?: string) => {
    setSort((current) => current.by === next && current.locale === locale
      ? { by: next, locale, dir: current.dir === 1 ? -1 : 1 }
      : { by: next, locale, dir: 1 });
  };
  const sortMark = (by: SortKey['by'], locale?: string) => (sort.by === by && sort.locale === locale
    ? <Icon name={sort.dir === 1 ? 'arrowUp' : 'arrowDown'} size={12} className="mx-sort-mark" />
    : null);

  const setOptions = sets.map((set) => ({
    value: set.id,
    label: set.name,
    hint: String(set.locales.length),
    lead: <Icon name={set.kind === 'user' ? 'star' : set.id === 'all' ? 'globe' : 'columns'} />,
  }));

  return (
    <div className="mx">
      <div className="toolbar mx-toolbar">
        {activeSet && (
          <Picker
            className="mx-set-picker"
            label="Набор стран"
            searchPlaceholder="Найти набор"
            value={draft ? '' : activeSet.id}
            onChange={(id) => { setDraft(null); onSetChange(id); }}
            options={draft ? [{ value: '', label: `Свой набор · ${draft.length}`, lead: <Icon name="columns" /> }, ...setOptions] : setOptions}
          />
        )}
        <ColumnsEditor
          columns={columns}
          allLocales={sets.find((set) => set.id === 'all')?.locales ?? columns}
          activeSet={activeSet}
          draft={draft}
          onDraft={setDraft}
          onSave={onSaveSet}
          onDelete={onDeleteSet}
        />
        <button
          type="button"
          className={`ds-btn mx-filter ${onlyTop10 ? 'active' : ''}`}
          aria-pressed={onlyTop10}
          onClick={() => setOnlyTop10((on) => !on)}
          title="Только ключи, которые в топ-10 хотя бы в одной из показанных стран"
        ><Icon name="target" /> В топ‑10 где-либо</button>
        <span className="toolbar-spacer" />
        <label className="search-field">
          <Icon name="search" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск ключевых слов" />
        </label>
      </div>

      <div className="mx-summary">
        <span><b>{rows.length.toLocaleString('ru-RU')}</b> {plural(rows.length, 'ключ', 'ключа', 'ключей')}</span>
        <span><b>{visibleColumns.length}</b> {plural(visibleColumns.length, 'страна', 'страны', 'стран')}</span>
        <span>в топ‑10 где-либо: <b>{anyTop10}</b></span>
        <span className="mx-legend" aria-label="Шкала позиций">
          <i className="mx-rank mx-top3">1–3</i><i className="mx-rank mx-top10">4–10</i><i className="mx-rank mx-top50">11–50</i><i className="mx-rank mx-deep">51+</i><i className="mx-rank mx-out">—</i> не в выдаче · пусто — не отслеживается
        </span>
        <span className="toolbar-spacer" />
        {data?.latestDate && <span>снимок {formatDate(data.latestDate)}</span>}
        {latency != null && <span className="mx-latency" title={`сервер ${data?.ms ?? '?'} мс${data?.cached ? ' (кэш)' : ''}`}>{latency} мс</span>}
      </div>

      <div className="mx-scroll" ref={scrollRef} onScroll={onScroll}>
        {error && !data ? (
          <div className="mx-empty">Не удалось загрузить матрицу: {error}</div>
        ) : !loading && data && rows.length === 0 ? (
          <div className="mx-empty">{query || onlyTop10 ? 'Нет ключей под фильтр.' : 'В выбранных странах пока нет ключевых слов.'}</div>
        ) : (
          <table className="mx-table" style={{ width: `calc(var(--mx-kw-w) + ${64 + visibleColumns.length * 84}px)` }}>
            <colgroup>
              <col style={{ width: 'var(--mx-kw-w)' }} />
              <col style={{ width: 64 }} />
              {visibleColumns.map((code) => <col key={code} style={{ width: 84 }} />)}
            </colgroup>
            <thead>
              <tr>
                <th className="mx-sticky mx-kw-head">
                  <button type="button" onClick={() => toggleSort('keyword')}>Ключевое слово {sortMark('keyword')}</button>
                </th>
                <th className="mx-sticky-2">
                  <button type="button" onClick={() => toggleSort('best')} {...tipProps('Лучшая позиция', [[null, 'среди показанных стран', '']])}>Лучшая {sortMark('best')}</button>
                </th>
                {visibleColumns.map((code) => {
                  const storefront = storefrontOf(code);
                  const stat = data?.stats[code];
                  const rowsTip: TipRow[] = [
                    [null, 'Ключей', String(stat?.tracked ?? 0)],
                    [null, 'В выдаче', String(stat?.ranked ?? 0)],
                    ['var(--ds-good)', 'В топ-10', String(stat?.top10 ?? 0)],
                    [null, 'Средняя позиция', stat?.avg != null ? `#${stat.avg}` : '—'],
                    [null, 'Индексирует', storefront.locales.join(', ') || '—'],
                  ];
                  return (
                    <th key={code} className={`mx-col-head ${sort.by === 'locale' && sort.locale === code ? 'mx-col-sorted' : ''}`}>
                      <button type="button" onClick={() => toggleSort('locale', code)} {...tipProps(`${storefront.flag} ${storefront.name}`, rowsTip)}>
                        <span className="mx-col-flag">{storefront.flag}</span>
                        <span className="mx-col-code">{code.toUpperCase()}{sortMark('locale', code)}</span>
                        <small>{stat?.avg != null ? `ср. ${Math.round(stat.avg)}` : '—'}</small>
                      </button>
                      <button type="button" className="mx-col-open" onClick={() => onOpenStorefront(code)} aria-label={`Открыть позиции: ${storefront.name}`} title="Открыть позиции этой страны">
                        <Icon name="external" size={12} />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading && !data ? Array.from({ length: 14 }, (_, index) => (
                <tr key={index} className="mx-skeleton"><td className="mx-sticky"><i /></td><td className="mx-sticky-2" />{columns.slice(0, 12).map((code) => <td key={code}><i /></td>)}</tr>
              )) : <>
                {start > 0 && <tr className="mx-spacer" style={{ height: start * ROW_H }}><td colSpan={2 + visibleColumns.length} /></tr>}
                {windowRows.map((row) => (
                  <MatrixRow key={row.index} row={row} columns={visibleColumns} lookup={lookup} dates={data?.dates ?? EMPTY_DATES} onOpen={onOpenCell} />
                ))}
                {end < rows.length && <tr className="mx-spacer" style={{ height: (rows.length - end) * ROW_H }}><td colSpan={2 + visibleColumns.length} /></tr>}
              </>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const EMPTY_DATES: string[] = [];

/** One keyword row. Memoized: scrolling only renders rows entering the window. */
const MatrixRow = memo(function MatrixRow({ row, columns, lookup, dates, onOpen }: {
  row: RowModel;
  columns: string[];
  lookup: Map<string, Array<MatrixCell | undefined>>;
  dates: string[];
  onOpen: (keyword: string, locale: string) => void;
}) {
  return (
    <tr>
      <td className="mx-sticky mx-kw" title={row.keyword}>{row.keyword}</td>
      <td className="mx-sticky-2 mx-best">
        {row.best === Infinity ? <span className="mx-out-text">—</span> : (
          <span className={`mx-rank mx-${rankTier(row.best)}`} {...tipProps(row.keyword, [[null, 'Лучшая позиция', `#${row.best}`], [null, 'Страна', row.bestLocale ? `${storefrontOf(row.bestLocale).flag} ${storefrontOf(row.bestLocale).name}` : '—'], ['var(--ds-good)', 'В топ-10 в странах', String(row.top10)]])}>{row.best}</span>
        )}
      </td>
      {columns.map((code) => (
        <Cell key={code} cell={lookup.get(code)?.[row.index]} keyword={row.keyword} code={code} dates={dates} onOpen={onOpen} />
      ))}
    </tr>
  );
});

function Cell({ cell, keyword, code, dates, onOpen }: {
  cell: MatrixCell | undefined;
  keyword: string;
  code: string;
  dates: string[];
  onOpen: (keyword: string, locale: string) => void;
}) {
  if (!cell) return <td className="mx-cell mx-untracked" aria-label="Не отслеживается" />;
  const [, pos, prev1, prev7, dateIndex] = cell;
  const tier = rankTier(pos);
  const week = rankChange(pos, prev7);
  const day = rankChange(pos, prev1);
  const storefront = storefrontOf(code);
  const tip: TipRow[] = [
    [null, 'Позиция', pos == null ? 'ещё не снимали' : pos === 0 ? 'не в выдаче' : `#${pos}`],
    [day.tone === 'up' ? 'var(--ds-good)' : day.tone === 'down' ? 'var(--ds-bad)' : null, 'С прошлого снимка', day.label],
    [week.tone === 'up' ? 'var(--ds-good)' : week.tone === 'down' ? 'var(--ds-bad)' : null, 'За 7 дней', week.label],
    [null, 'Снимок', dateIndex >= 0 ? formatDate(dates[dateIndex]) : '—'],
  ];
  return (
    <td className="mx-cell">
      <button type="button" className="mx-cell-btn" onClick={() => onOpen(keyword, code)} {...tipProps(`${keyword} · ${storefront.flag} ${storefront.name}`, tip)} aria-label={`${keyword}, ${storefront.name}: ${tip[0][2]}`}>
        {tier === 'pending' ? <span className="mx-pending">…</span>
          : tier === 'out' ? <span className="mx-out-text">—</span>
            : <span className={`mx-rank mx-${tier}`}>{pos}</span>}
        {week.tone !== 'flat' && (
          <span className={`mx-delta mx-delta-${week.tone}`}>{week.value != null ? `${week.tone === 'up' ? '↑' : '↓'}${Math.abs(week.value)}` : week.tone === 'up' ? '↑' : '↓'}</span>
        )}
      </button>
    </td>
  );
}

function ColumnsEditor({ columns, allLocales, activeSet, draft, onDraft, onSave, onDelete }: {
  columns: string[];
  allLocales: string[];
  activeSet: ColumnSetOption | undefined;
  draft: string[] | null;
  onDraft: (next: string[] | null) => void;
  onSave: (name: string, locales: string[]) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => { setOpen(false); setFilter(''); }, []);
  useDismiss(rootRef, open, close);
  const chosen = new Set(columns);
  // Same fuzzy search as the ⌘K palette (name, ISO, indexed language), list order kept.
  const matched = filter.trim() ? new Set(searchStorefronts(filter, allLocales.map((code) => storefrontOf(code))).map((hit) => hit.storefront.code)) : null;
  const list = matched ? allLocales.filter((code) => matched.has(code)) : allLocales;
  const toggle = (code: string) => {
    const next = chosen.has(code) ? columns.filter((item) => item !== code) : [...columns, code];
    onDraft(next.length ? next : columns);
  };
  const save = async () => {
    if (!name.trim() || !columns.length) return;
    setBusy(true);
    try { await onSave(name.trim(), columns); setName(''); close(); } finally { setBusy(false); }
  };
  return (
    <div className="picker mx-columns" ref={rootRef}>
      <button type="button" className="ds-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <Icon name="columns" /> Колонки <span className="mx-count">{columns.length}</span>
      </button>
      {open && (
        <div className="ds-pop picker-pop mx-columns-pop" role="dialog" aria-label="Колонки матрицы">
          <label className="picker-search">
            <Icon name="search" />
            <input autoFocus value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Страна, ISO или язык" aria-label="Фильтр стран" />
          </label>
          <div className="mx-columns-actions">
            <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => onDraft([...new Set([...columns, ...list])])}>Отметить найденные</button>
            <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => { const next = columns.filter((code) => !list.includes(code)); onDraft(next.length ? next : columns); }}>Снять найденные</button>
            {draft && <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => onDraft(null)}>Сбросить</button>}
          </div>
          <div className="picker-list mx-columns-list">
            {list.map((code) => {
              const storefront = storefrontOf(code);
              return (
                <label key={code} className="ds-pop-row mx-columns-row">
                  <input type="checkbox" checked={chosen.has(code)} onChange={() => toggle(code)} />
                  <span className="picker-flag">{storefront.flag}</span>
                  <span className="picker-row-label">{storefront.name}</span>
                  <LocaleChips locales={storefront.locales} max={2} />
                  <small>{code.toUpperCase()}</small>
                </label>
              );
            })}
            {list.length === 0 && <div className="picker-empty">Ничего не найдено</div>}
          </div>
          <form className="mx-columns-save" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <input className="ds-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Название набора, напр. «EU core»" maxLength={40} aria-label="Название набора" />
            <button type="submit" className="ds-btn ds-btn-primary" disabled={busy || !name.trim()}>Сохранить</button>
          </form>
          {activeSet?.kind === 'user' && !draft && (
            <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost ds-btn-danger mx-columns-delete" onClick={() => { void onDelete(activeSet.id).then(close); }}>
              Удалить набор «{activeSet.name}»
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function plural(count: number, one: string, few: string, many: string) {
  const mod10 = count % 10, mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
