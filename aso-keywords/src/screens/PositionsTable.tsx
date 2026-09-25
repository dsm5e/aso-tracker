import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import Icon from '../components/Icon';
import { useDismiss } from '../components/useDismiss';
import StorefrontSelect, { type StorefrontPreset } from '../components/StorefrontSelect';
import { Sparkline, tipProps, type TipRow } from '../../../shared/charts/Charts';
import { rankChange, rankTier, storefrontOf } from '../countries';
import { keywordTableApi, tagKey, type KeywordPair, type KeywordTableResponse, type KeywordTableRow } from '../keywordTableApi';
import type { RankingRow } from '../api';
import '../components/BulkAddDialog.css';
import './PositionsTable.css';

/**
 * «Позиции» — one storefront, one row per tracked keyword.
 * Columns can be shown/hidden and reordered (per app, localStorage); any column
 * sorts, with «не в выдаче» / «ещё не снимали» always last. Rows virtualize past
 * 200 (fixed 44px rows, same windowing as the matrix). Multi-select with
 * Shift / ⌘ click drives bulk tags, copy / remove across storefronts and CSV.
 */

type ColId = 'rank' | 'd1' | 'd7' | 'trend' | 'pop' | 'diff' | 'chance' | 'opp' | 'total' | 'top5' | 'tags' | 'note' | 'updated';
type SortId = ColId | 'keyword';

interface ColumnDef { id: ColId; label: string; width: number; align?: 'right' | 'center' }
const COLUMNS: ColumnDef[] = [
  { id: 'rank', label: 'Позиция', width: 84, align: 'center' },
  { id: 'd1', label: 'Δ1д', width: 76, align: 'center' },
  { id: 'd7', label: 'Δ7д', width: 76, align: 'center' },
  { id: 'trend', label: 'Тренд 30д', width: 120 },
  { id: 'pop', label: 'Популярность', width: 124 },
  { id: 'diff', label: 'Сложность', width: 96, align: 'right' },
  { id: 'chance', label: 'Шанс', width: 76, align: 'right' },
  { id: 'opp', label: 'Возможность', width: 112, align: 'right' },
  { id: 'total', label: 'Результатов', width: 108, align: 'right' },
  { id: 'top5', label: 'Топ‑5', width: 204 },
  { id: 'tags', label: 'Теги', width: 160 },
  { id: 'note', label: 'Заметка', width: 200 },
  { id: 'updated', label: 'Обновлено', width: 120 },
];
const DEFAULT_HIDDEN: ColId[] = ['updated'];
const BY_ID = new Map(COLUMNS.map((column) => [column.id, column]));
const ROW_H = 44;
const OVERSCAN = 10;
const VIRTUALIZE_AFTER = 200;

type WidthId = ColId | 'keyword';
interface Layout { order: ColId[]; hidden: ColId[]; sort: { by: SortId; dir: 1 | -1 }; widths: Partial<Record<WidthId, number>> }
const KEYWORD_W = 260;
const MIN_COL_W = 56;
const MAX_COL_W = 520;
const layoutKey = (appId: string) => `aso-keywords.positions-layout.v1.${appId}`;
function loadLayout(appId: string): Layout {
  const fallback: Layout = { order: COLUMNS.map((column) => column.id), hidden: DEFAULT_HIDDEN, sort: { by: 'rank', dir: 1 }, widths: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(layoutKey(appId)) || 'null') as Partial<Layout> | null;
    if (!raw) return fallback;
    const known = (raw.order ?? []).filter((id): id is ColId => BY_ID.has(id as ColId));
    const order = [...known, ...COLUMNS.map((column) => column.id).filter((id) => !known.includes(id))];
    const hidden = (raw.hidden ?? DEFAULT_HIDDEN).filter((id): id is ColId => BY_ID.has(id as ColId));
    const sort = raw.sort && (raw.sort.by === 'keyword' || BY_ID.has(raw.sort.by as ColId)) ? raw.sort : fallback.sort;
    const widths: Layout['widths'] = {};
    for (const [id, value] of Object.entries(raw.widths ?? {})) {
      if ((id === 'keyword' || BY_ID.has(id as ColId)) && typeof value === 'number') widths[id as WidthId] = Math.min(MAX_COL_W, Math.max(MIN_COL_W, value));
    }
    return { order, hidden, sort, widths };
  } catch {
    return fallback;
  }
}
function saveLayout(appId: string, layout: Layout) {
  try { localStorage.setItem(layoutKey(appId), JSON.stringify(layout)); } catch { /* private mode */ }
}

type RankState = 'ranked' | 'out' | 'pending';
interface RowModel {
  keyword: string;
  key: string;
  ranking?: RankingRow;
  m?: KeywordTableRow;
  pos: number | null;       // rank, 0 = out, null = pending
  state: RankState;
  d1: ReturnType<typeof rankChange>;
  d7: ReturnType<typeof rankChange>;
}

// Diacritics- and case-insensitive search (meteo finds météo).
const fold = (value: string) => value.toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ё/g, 'е');

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const fmtDate = (value: string | null | undefined) => (value ? dateFmt.format(new Date(`${value}T00:00:00`)) : '—');
const num = (value: number | null | undefined, digits = 0) => (value == null ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits: digits }));

function changeValue(change: ReturnType<typeof rankChange>): number | null {
  if (change.value != null) return change.value;
  if (change.label === 'вошёл в выдачу') return 1000;
  if (change.label === 'выпал из выдачи') return -1000;
  return null;
}

function sortValue(row: RowModel, by: SortId): number | string | null {
  const m = row.m;
  switch (by) {
    case 'keyword': return row.keyword.toLocaleLowerCase();
    case 'rank': return row.state === 'ranked' ? row.pos : null;
    case 'd1': return changeValue(row.d1);
    case 'd7': return changeValue(row.d7);
    case 'trend': {
      const values = (m?.trend ?? []).filter((value): value is number => value != null && value > 0);
      return values.length >= 2 ? values[0] - values[values.length - 1] : null;
    }
    case 'pop': return m?.popularity ?? null;
    case 'diff': return m?.difficulty ?? null;
    case 'chance': return m?.chance ?? null;
    case 'opp': return m?.opportunity ?? null;
    case 'total': return m?.total ?? null;
    case 'top5': return row.ranking?.top5?.[0]?.name?.toLocaleLowerCase() ?? null;
    case 'tags': return m?.tags?.[0]?.toLocaleLowerCase() ?? null;
    case 'note': return m?.note ? m.note.toLocaleLowerCase() : null;
    case 'updated': return row.ranking?.lastUpdated ?? null;
  }
}

/** Metrics where bigger is better sort descending first. */
const DESC_FIRST = new Set<SortId>(['d1', 'd7', 'trend', 'pop', 'chance', 'opp', 'total', 'updated']);

export default function PositionsTable({
  appId,
  appName,
  locale,
  keywords,
  keywordMap,
  rankings,
  loading,
  query,
  rowUpdates,
  refreshKey,
  favorites,
  presets,
  renderKeywordExtra,
  renderTop5,
  renderUpdated,
  onOpenDetail,
  onRefresh,
  onKeywordsChanged,
  toolbarLead,
  toolbarTrail,
  liveCells,
}: {
  /** `${locale}|${keyword lowercased}` → queued / updating / just done (refresh glow). */
  liveCells?: Map<string, 'queued' | 'updating' | 'done'>;
  /** Page actions rendered at the start / end of the table's single toolbar row. */
  toolbarLead?: ReactNode;
  toolbarTrail?: ReactNode;
  appId: string;
  appName: string;
  locale: string;
  keywords: string[];
  keywordMap: Record<string, string[]>;
  rankings: Map<string, RankingRow>;
  loading: boolean;
  query: string;
  rowUpdates: Record<string, unknown>;
  refreshKey: number;
  favorites: string[];
  presets: StorefrontPreset[];
  renderKeywordExtra: (keyword: string) => ReactNode;
  renderTop5: (ranking: RankingRow | undefined) => ReactNode;
  renderUpdated: (keyword: string, ranking: RankingRow | undefined) => ReactNode;
  onOpenDetail: (keyword: string) => void;
  onRefresh: (keyword: string) => void;
  onKeywordsChanged: (map: Record<string, string[]>) => void;
}) {
  // --- layout (per app) --------------------------------------------------------
  const [layout, setLayout] = useState<Layout>(() => loadLayout(appId));
  useEffect(() => { setLayout(loadLayout(appId)); }, [appId]);
  const updateLayout = useCallback((next: Layout) => { setLayout(next); saveLayout(appId, next); }, [appId]);
  const visible = useMemo(() => layout.order.filter((id) => !layout.hidden.includes(id)).map((id) => BY_ID.get(id)!), [layout]);

  // --- metrics -----------------------------------------------------------------
  const [data, setData] = useState<KeywordTableResponse | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const keywordsKey = keywords.join('\u0001');
  const [pollTick, setPollTick] = useState(0);
  const polls = useRef(0);
  useEffect(() => { polls.current = 0; setData(null); }, [appId, locale]);
  useEffect(() => {
    if (!appId || !locale) return;
    const controller = new AbortController();
    keywordTableApi.table(appId, locale, controller.signal)
      .then((response) => { setData(response); setMetricsError(null); })
      .catch((reason: Error) => {
        if (reason.name === 'AbortError') return;
        setMetricsError(reason.message);
        // The API restarts with the dev server (tsx watch) — retry a few times.
        if (polls.current < 30) retry = window.setTimeout(() => { polls.current += 1; setPollTick((tick) => tick + 1); }, 4_000);
      });
    let retry = 0;
    return () => { controller.abort(); window.clearTimeout(retry); };
  }, [appId, locale, keywordsKey, refreshKey, pollTick]);
  // Popularity fills in the background on the Ads side — poll while values are pending.
  useEffect(() => {
    if (!data || data.popularity.pending <= 0 || polls.current >= 30) return;
    const timer = window.setTimeout(() => { polls.current += 1; setPollTick((tick) => tick + 1); }, 5_000);
    return () => window.clearTimeout(timer);
  }, [data]);
  const metrics = useMemo(() => new Map((data?.rows ?? []).map((row) => [tagKey(row.keyword), row])), [data]);
  const patchMetrics = (keys: Set<string>, patch: (row: KeywordTableRow) => KeywordTableRow) => setData((current) => current && ({
    ...current,
    rows: current.rows.map((row) => (keys.has(tagKey(row.keyword)) ? patch(row) : row)),
  }));

  // --- filters -----------------------------------------------------------------
  const [rankMin, setRankMin] = useState('');
  const [rankMax, setRankMax] = useState('');
  const [popMin, setPopMin] = useState(0);
  const [tagFilter, setTagFilter] = useState('');
  const [move, setMove] = useState<'all' | 'entered' | 'dropped'>('all');
  const filtersOn = Boolean(rankMin || rankMax || popMin || tagFilter || move !== 'all');
  const resetFilters = () => { setRankMin(''); setRankMax(''); setPopMin(0); setTagFilter(''); setMove('all'); };

  const allRows = useMemo<RowModel[]>(() => keywords.map((keyword) => {
    const key = tagKey(keyword);
    const ranking = rankings.get(keyword.toLocaleLowerCase());
    const m = metrics.get(key);
    let pos: number | null;
    if (ranking?.lastUpdated != null) pos = ranking.today ?? 0;
    else pos = m?.current ?? null;
    const state: RankState = pos == null ? 'pending' : pos > 0 ? 'ranked' : 'out';
    return { keyword, key, ranking, m, pos, state, d1: rankChange(pos, m?.prev1 ?? null), d7: rankChange(pos, m?.prev7 ?? null) };
  }), [keywords, metrics, rankings]);

  const rows = useMemo(() => {
    const needle = fold(query.trim());
    const lo = Number(rankMin) || 0, hi = Number(rankMax) || 0;
    const out = allRows.filter((row) => {
      if (needle && !fold(row.keyword).includes(needle)) return false;
      if ((lo || hi) && (row.state !== 'ranked' || (lo && row.pos! < lo) || (hi && row.pos! > hi))) return false;
      if (popMin && (row.m?.popularity == null || row.m.popularity < popMin)) return false;
      if (tagFilter === '__none' && row.m?.tags.length) return false;
      if (tagFilter && tagFilter !== '__none' && !row.m?.tags.some((tag) => tag.toLocaleLowerCase() === tagFilter.toLocaleLowerCase())) return false;
      if (move === 'entered' && !row.m?.entered7) return false;
      if (move === 'dropped' && !row.m?.dropped7) return false;
      return true;
    });
    const { by, dir } = layout.sort;
    const stateRank = (row: RowModel) => (row.state === 'ranked' ? 0 : row.state === 'out' ? 1 : 2);
    out.sort((a, b) => {
      // «Не в выдаче» and «ещё не снимали» stay last in every sort.
      const s = stateRank(a) - stateRank(b);
      if (s) return s;
      const va = sortValue(a, by), vb = sortValue(b, by);
      if (va == null && vb != null) return 1;
      if (vb == null && va != null) return -1;
      if (va != null && vb != null && va !== vb) return (typeof va === 'string' ? va.localeCompare(String(vb), 'ru') : (va as number) - (vb as number)) * dir;
      return (a.pos ?? 9999) - (b.pos ?? 9999) || a.keyword.localeCompare(b.keyword);
    });
    return out;
  }, [allRows, layout.sort, move, popMin, query, rankMax, rankMin, tagFilter]);

  const toggleSort = (by: SortId) => {
    const current = layout.sort;
    const dir: 1 | -1 = current.by === by ? (current.dir === 1 ? -1 : 1) : DESC_FIRST.has(by) ? -1 : 1;
    updateLayout({ ...layout, sort: { by, dir } });
  };

  // --- selection -----------------------------------------------------------------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  useEffect(() => { setSelected(new Set()); anchor.current = null; }, [appId, locale]);
  // Drop keys that disappeared (removed / copied away).
  useEffect(() => {
    setSelected((current) => {
      const present = new Set(allRows.map((row) => row.key));
      const next = new Set([...current].filter((key) => present.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [allRows]);
  const selectRow = useCallback((key: string, mode: 'toggle' | 'range') => {
    setSelected((current) => {
      const next = new Set(current);
      if (mode === 'range' && anchor.current) {
        const keys = rowsRef.current.map((row) => row.key);
        const a = keys.indexOf(anchor.current), b = keys.indexOf(key);
        if (a >= 0 && b >= 0) {
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(keys[i]);
          return next;
        }
      }
      if (next.has(key)) next.delete(key); else next.add(key);
      anchor.current = key;
      return next;
    });
  }, []);
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.key));
  const someSelected = !allSelected && rows.some((row) => selected.has(row.key));
  const headerBox = useRef<HTMLInputElement>(null);
  useEffect(() => { if (headerBox.current) headerBox.current.indeterminate = someSelected; }, [someSelected]);
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.key)));
  const selectedKeywords = useMemo(() => allRows.filter((row) => selected.has(row.key)).map((row) => row.keyword), [allRows, selected]);

  // ⌘F — search (diacritics-insensitive), ⌘A — select all shown, Esc — clear selection.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'f') {
        const input = document.getElementById('kw-search') as HTMLInputElement | null;
        if (input) { event.preventDefault(); input.focus(); input.select(); }
      } else if (!typing && mod && event.key.toLowerCase() === 'a') {
        event.preventDefault(); setSelected(new Set(rowsRef.current.map((row) => row.key)));
      } else if (!typing && event.key === 'Escape' && !document.querySelector('.dialog-backdrop')) {
        setSelected(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- bulk actions ----------------------------------------------------------------
  const [dialog, setDialog] = useState<'copy' | 'remove' | null>(null);
  const makeGlobal = async () => {
    if (!selectedKeywords.length) return;
    try {
      const result = await keywordTableApi.setGlobal(appId, selectedKeywords);
      setNotice(`${selectedKeywords.length} ${selectedKeywords.length === 1 ? 'ключ теперь общий' : 'ключей теперь общие'} — отслеживаются во всех странах.`);
      setSelected(new Set());
      onKeywordsChanged(result.keywords);
    } catch (reason) {
      setNotice(`Не получилось: ${(reason as Error).message}`);
    }
  };
  /** The row whose × was pressed — the remove dialog then targets just that keyword. */
  const [rowRemove, setRowRemove] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 5000); return () => window.clearTimeout(timer); }, [notice]);
  const applyTags = async (add: string[], remove: string[]) => {
    const keys = new Set(selectedKeywords.map(tagKey));
    const result = await keywordTableApi.tag(appId, selectedKeywords, add, remove);
    patchMetrics(keys, (row) => ({ ...row, tags: result.tags[tagKey(row.keyword)] ?? [] }));
    setData((current) => current && ({ ...current, palette: result.palette }));
  };
  const saveNote = async (keyword: string, note: string) => {
    const result = await keywordTableApi.note(appId, locale, keyword, note);
    patchMetrics(new Set([tagKey(keyword)]), (row) => ({ ...row, note: result.note }));
  };
  const exportCsv = () => {
    const source = selected.size ? rows.filter((row) => selected.has(row.key)) : rows;
    const header = ['keyword', 'storefront', 'rank', 'delta_1d', 'delta_7d', 'popularity', 'popularity_day', 'difficulty', 'chance', 'opportunity', 'results', 'top5', 'tags', 'note'];
    const cell = (value: unknown) => {
      const text = value == null ? '' : String(value);
      return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [header.join(',')];
    for (const row of source) {
      lines.push([
        row.keyword, locale.toUpperCase(),
        row.state === 'ranked' ? row.pos : row.state === 'out' ? 0 : '',
        row.d1.value ?? (row.d1.label === '—' ? '' : row.d1.label), row.d7.value ?? (row.d7.label === '—' ? '' : row.d7.label),
        row.m?.popularity ?? '', row.m?.popularityDay ?? '', row.m?.difficulty ?? '', row.m?.chance ?? '', row.m?.opportunity ?? '', row.m?.total ?? '',
        (row.ranking?.top5 ?? []).map((app) => app.name).join(' | '), (row.m?.tags ?? []).join(' | '), row.m?.note ?? '',
      ].map(cell).join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${appName}-${locale}-keywords-${new Date().toISOString().slice(0, 10)}.csv`.replace(/\s+/g, '-');
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // --- windowing ---------------------------------------------------------------------
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
    frame.current = requestAnimationFrame(() => { frame.current = 0; setScrollTop(scrollRef.current?.scrollTop ?? 0); });
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const virtual = rows.length > VIRTUALIZE_AFTER;
  const start = virtual ? Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN) : 0;
  const end = virtual ? Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_H) + OVERSCAN) : rows.length;
  const windowRows = rows.slice(start, end);

  // --- header tooltips (formula + source) -------------------------------------------------
  const pop = data?.popularity;
  const formula = data?.formula ?? [];
  const headerTips: Record<ColId, [string, TipRow[]]> = {
    rank: ['Позиция', [[null, 'Что', 'место в поиске App Store, до 200'], [null, '«—»', 'снимок есть, приложения нет в выдаче'], [null, '«…»', 'ещё не снимали'], [null, 'Источник', `снимки Keywords · ${fmtDate(data?.latestDate)}`]]],
    d1: ['Δ1д', [[null, 'Формула', 'позиция на снимке ≥1 дня раньше − текущая'], ['var(--ds-good)', '↑', 'рост (меньше номер)'], ['var(--ds-bad)', '↓', 'падение']]],
    d7: ['Δ7д', [[null, 'Формула', 'позиция на снимке ≥7 дней раньше − текущая'], [null, 'Вошёл / выпал', 'смена «не в выдаче» ↔ в выдаче']]],
    trend: ['Тренд 30 дней', [[null, 'Что', 'позиция по дням, 1 — вверху'], [null, 'Разрывы', 'нет снимка или не в выдаче']]],
    pop: ['Популярность Apple Ads', [[null, 'Шкала', '5–100, как в Apple Ads'], [null, '≤5', 'минимум шкалы: низкий объём, не ноль'], [null, 'Источник', pop?.sourceLabel ?? 'Apple Ads'], [null, 'Дата', pop?.day ? fmtDate(pop.day) : '—'], ...(pop?.pending ? [['var(--ds-warn)', 'Догружается', `${pop.pending} ключей`] as TipRow] : [])]],
    diff: ['Сложность 0–100', [[null, 'Сила S', formula[0] ?? ''], [null, 'D', formula[1] ?? ''], [null, 'Ориентир', 'брать ключи ниже 75']]],
    chance: ['Шанс 0–100', [[null, 'Формула', formula[2] ?? ''], [null, 'A (наше)', data?.ourStrength != null ? String(data.ourStrength) : '—']]],
    opp: ['Возможность', [[null, 'Формула', formula[3] ?? ''], [null, 'Нет популярности', 'нет Возможности']]],
    total: ['Результатов', [[null, 'Что', 'сколько приложений вернул поиск App Store'], [null, 'Источник', 'последний снимок']]],
    top5: ['Топ‑5 выдачи', [[null, 'Что', 'первые пять приложений на последнем снимке'], [null, '✓', 'наше приложение']]],
    tags: ['Теги', [[null, 'Где', 'общие для ключа во всех витринах приложения'], [null, 'Как', 'выделите строки → «Тег…»']]],
    note: ['Заметка', [[null, 'Где', 'своя для ключа в этой витрине'], [null, 'Как', 'клик по ячейке, Enter — сохранить']]],
    updated: ['Обновлено', [[null, 'Что', 'время последнего снимка ключа']]],
  };

  const tags = data?.palette ?? [];
  const widthOf = (id: WidthId) => layout.widths[id] ?? (id === 'keyword' ? KEYWORD_W : BY_ID.get(id)!.width);
  const tableWidth = 44 + widthOf('keyword') + visible.reduce((sum, column) => sum + widthOf(column.id), 0) + 76;
  // Drag the right edge of a header to resize; double-click resets. Saved with the layout.
  const startResize = (id: WidthId) => (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startW = widthOf(id);
    let latest = layout;
    const move = (ev: PointerEvent) => {
      const w = Math.round(Math.min(MAX_COL_W, Math.max(MIN_COL_W, startW + ev.clientX - startX)));
      latest = { ...layout, widths: { ...layout.widths, [id]: w } };
      setLayout(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('pt-resizing');
      saveLayout(appId, latest);
    };
    document.body.classList.add('pt-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const resetWidth = (id: WidthId) => {
    const widths = { ...layout.widths };
    delete widths[id];
    updateLayout({ ...layout, widths });
  };
  const resizer = (id: WidthId, label: string) => (
    <span className="pt-resizer" role="separator" aria-orientation="vertical" aria-label={`Ширина колонки «${label}»`}
      title="Потяните, чтобы изменить ширину · двойной клик — по умолчанию"
      onPointerDown={startResize(id)} onDoubleClick={() => resetWidth(id)} onClick={(event) => event.stopPropagation()} />
  );
  const sortMark = (by: SortId) => (layout.sort.by === by ? <Icon name={layout.sort.dir === 1 ? 'arrowUp' : 'arrowDown'} size={12} className="mx-sort-mark" /> : null);
  const storefront = storefrontOf(locale);

  return (
    <div className="pt">
      <div className="toolbar pt-filters" role="group" aria-label="Действия и фильтры">
        {toolbarLead}
        <FilterMenu active={[rankMin || rankMax, popMin, tagFilter].filter(Boolean).length}>
          <span className="pt-filter" {...tipProps('Позиция в диапазоне', [[null, 'Только ключи в выдаче', 'от — до включительно']])}>
            <span className="pt-filter-label">Позиция</span>
            <input className="ds-input pt-num" inputMode="numeric" value={rankMin} onChange={(event) => setRankMin(event.target.value.replace(/\D/g, ''))} placeholder="от" aria-label="Позиция от" />
            –
            <input className="ds-input pt-num" inputMode="numeric" value={rankMax} onChange={(event) => setRankMax(event.target.value.replace(/\D/g, ''))} placeholder="до" aria-label="Позиция до" />
          </span>
          <label className="pt-filter">
            <span className="pt-filter-label">Популярность ≥</span>
            <select className="ds-select pt-select" value={popMin} onChange={(event) => setPopMin(Number(event.target.value))} aria-label="Популярность не ниже">
              {[0, 6, 10, 20, 25, 30, 40, 50, 60].map((value) => <option key={value} value={value}>{value === 0 ? 'любая' : value === 6 ? '>5' : value}</option>)}
            </select>
          </label>
          <label className="pt-filter">
            <span className="pt-filter-label">Тег</span>
            <select className="ds-select pt-select" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} aria-label="Тег">
              <option value="">все</option>
              <option value="__none">без тега</option>
              {tags.map((tag) => <option key={tag.tag} value={tag.tag}>{tag.tag} · {tag.count}</option>)}
            </select>
          </label>
        </FilterMenu>
        <div className="ds-seg pt-seg" role="tablist" aria-label="Движение за 7 дней">
          {([['all', 'Все'], ['entered', 'Вошли за 7 дн'], ['dropped', 'Выпали за 7 дн']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={move === id} onClick={() => setMove(id)}>{label}</button>
          ))}
        </div>
        {filtersOn && <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={resetFilters}>Сбросить</button>}
        <span className="toolbar-spacer" />
        {rows.length !== allRows.length && <span className="pt-count">{rows.length} из {allRows.length}</span>}
        <ColumnMenu layout={layout} onChange={updateLayout} />
        <button type="button" className="ds-icon-btn pt-csv" onClick={exportCsv} disabled={!rows.length} title="Экспорт видимых строк (или выделенных) в CSV" aria-label="Экспорт в CSV">
          <Icon name="external" size={16} />
        </button>
        {toolbarTrail}
      </div>

      {selected.size > 0 && (
        <div className="pt-bulk" role="toolbar" aria-label="Действия с выделенными">
          <strong>Выбрано {selected.size}</strong>
          <TagMenu palette={tags} selectedRows={allRows.filter((row) => selected.has(row.key))} onApply={applyTags} />
          <button type="button" className="ds-btn ds-btn-sm" onClick={() => void makeGlobal()} title="Отслеживать выделенные ключи во всех странах приложения, включая будущие">🌐 Сделать общими</button>
          <button type="button" className="ds-btn ds-btn-sm" onClick={() => setDialog('copy')}><Icon name="plus" size={14} /> Скопировать в страны…</button>
          <button type="button" className="ds-btn ds-btn-sm ds-btn-danger" onClick={() => setDialog('remove')}><Icon name="close" size={14} /> Удалить из стран…</button>
          <button type="button" className="ds-btn ds-btn-sm" onClick={exportCsv}>Экспорт CSV</button>
          <span className="toolbar-spacer" />
          <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => setSelected(new Set())}>Снять выделение <kbd>esc</kbd></button>
        </div>
      )}
      {notice && <div className="pt-notice" role="status">{notice}</div>}

      <div className="pt-scroll" ref={scrollRef} onScroll={onScroll}>
        <table className="pt-table" style={{ width: tableWidth }}>
          <colgroup>
            <col style={{ width: 44 }} />
            <col style={{ width: widthOf('keyword') }} />
            {visible.map((column) => <col key={column.id} style={{ width: widthOf(column.id) }} />)}
            <col style={{ width: 76 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="pt-sel pt-sticky-0">
                <input ref={headerBox} type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Выделить все показанные" />
              </th>
              <th className="pt-kw pt-sticky-1">
                <button type="button" onClick={() => toggleSort('keyword')}>Ключевое слово {sortMark('keyword')}</button>
                {resizer('keyword', 'Ключевое слово')}
              </th>
              {visible.map((column) => (
                <th key={column.id} className={`pt-th-${column.align ?? 'left'} ${layout.sort.by === column.id ? 'pt-sorted' : ''}`}>
                  <button type="button" onClick={() => toggleSort(column.id)} {...tipProps(headerTips[column.id][0], headerTips[column.id][1])}>
                    {column.label}{column.id === 'pop' && pop?.pending ? <i className="pt-dot" aria-label="догружается" /> : null} {sortMark(column.id)}
                  </button>
                  {resizer(column.id, column.label)}
                </th>
              ))}
              <th aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {loading && !allRows.length ? Array.from({ length: 10 }, (_, index) => (
              <tr key={index} className="mx-skeleton"><td colSpan={visible.length + 3}><i /></td></tr>
            )) : rows.length === 0 ? (
              <tr><td colSpan={visible.length + 3}><div className="table-empty">{allRows.length ? 'Нет ключей под фильтр.' : 'В этом регионе пока нет ключевых слов.'}</div></td></tr>
            ) : <>
              {start > 0 && <tr className="mx-spacer" style={{ height: start * ROW_H }}><td colSpan={visible.length + 3} /></tr>}
              {windowRows.map((row, offset) => (
                <PositionRow
                  key={row.key}
                  alt={(start + offset) % 2 === 1}
                  live={liveCells?.get(`${locale}|${row.keyword.toLocaleLowerCase()}`)}
                  row={row}
                  columns={visible}
                  selected={selected.has(row.key)}
                  updateState={rowUpdates[row.keyword]}
                  trendDates={data?.trendDates ?? EMPTY}
                  popularityUnavailable={pop?.status === 'unavailable'}
                  onSelect={selectRow}
                  renderKeywordExtra={renderKeywordExtra}
                  renderTop5={renderTop5}
                  renderUpdated={renderUpdated}
                  onOpenDetail={onOpenDetail}
                  onRefresh={onRefresh}
                  onRemove={(keyword: string) => { setRowRemove(keyword); setDialog('remove'); }}
                  onSaveNote={saveNote}
                />
              ))}
              {end < rows.length && <tr className="mx-spacer" style={{ height: (rows.length - end) * ROW_H }}><td colSpan={visible.length + 3} /></tr>}
            </>}
          </tbody>
        </table>
      </div>
      <footer className="statusbar">
        <span>{storefront.flag} {storefront.name} · {allRows.length} ключевых слов</span>
        {pop && <span {...tipProps('Популярность', [[null, 'Источник', pop.sourceLabel], [null, 'Шкала', '5–100; 5 = «≤5»'], [null, 'Пояснение', pop.note]])}>
          Популярность: {pop.status === 'unavailable' ? 'Apple Ads недоступен' : `Apple Ads · ${fmtDate(pop.day)}`}{pop.pending ? ` · догружается ${pop.pending}` : ''}
        </span>}
        {metricsError && <span className="pt-error">Метрики: {metricsError}</span>}
        <span className="statusbar-spacer" />
        <span>Последний снимок: <strong>{fmtDate(data?.latestDate)}</strong></span>
      </footer>

      {dialog && (
        <StorefrontActionDialog
          mode={dialog}
          appId={appId}
          locale={locale}
          keywords={rowRemove ? [rowRemove] : selectedKeywords}
          keywordMap={keywordMap}
          favorites={favorites}
          presets={presets}
          onClose={() => { setDialog(null); setRowRemove(null); }}
          onDone={(map, message) => { setDialog(null); setRowRemove(null); setNotice(message); onKeywordsChanged(map); }}
        />
      )}
    </div>
  );
}

const EMPTY: string[] = [];

const PositionRow = memo(function PositionRow({
  alt, live, row, columns, selected, updateState, trendDates, popularityUnavailable, onSelect,
  renderKeywordExtra, renderTop5, renderUpdated, onOpenDetail, onRefresh, onRemove, onSaveNote,
}: {
  alt: boolean;
  live?: 'queued' | 'updating' | 'done';
  row: RowModel;
  columns: ColumnDef[];
  selected: boolean;
  updateState: unknown;
  trendDates: string[];
  popularityUnavailable: boolean;
  onSelect: (key: string, mode: 'toggle' | 'range') => void;
  renderKeywordExtra: (keyword: string) => ReactNode;
  renderTop5: (ranking: RankingRow | undefined) => ReactNode;
  renderUpdated: (keyword: string, ranking: RankingRow | undefined) => ReactNode;
  onOpenDetail: (keyword: string) => void;
  onRefresh: (keyword: string) => void;
  onRemove: (keyword: string) => void;
  onSaveNote: (keyword: string, note: string) => Promise<void>;
}) {
  void updateState; // re-render trigger for the «Обновлено» cell
  const { m } = row;
  const onRowClick = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, input, a, select, textarea')) return;
    if (event.shiftKey) { event.preventDefault(); onSelect(row.key, 'range'); }
    else if (event.metaKey || event.ctrlKey) onSelect(row.key, 'toggle');
  };
  const cell = (column: ColumnDef): ReactNode => {
    switch (column.id) {
      case 'rank': {
        const tier = rankTier(row.pos);
        if (row.state === 'pending') return <span className="mx-pending" {...tipProps(row.keyword, [[null, 'Позиция', 'ещё не снимали']])}>…</span>;
        if (row.state === 'out') return <span className="mx-rank mx-zero" {...tipProps(row.keyword, [[null, 'Позиция', 'не в выдаче']])}>0</span>;
        return <span className={`mx-rank mx-${tier}`}>{row.pos}</span>;
      }
      case 'd1':
      case 'd7': {
        const change = column.id === 'd1' ? row.d1 : row.d7;
        const prev = column.id === 'd1' ? m?.prev1 : m?.prev7;
        const text = change.value != null ? (change.value === 0 ? '0' : `${change.value > 0 ? '↑' : '↓'} ${Math.abs(change.value)}`) : change.label === '—' ? '—' : change.tone === 'up' ? 'вошёл' : 'выпал';
        return <span className={`pt-delta pt-delta-${change.tone}`} {...tipProps(`${row.keyword} · ${column.label}`, [[null, 'Было', prev == null ? 'нет снимка' : prev === 0 ? 'не в выдаче' : `#${prev}`], [null, 'Стало', row.state === 'ranked' ? `#${row.pos}` : row.state === 'out' ? 'не в выдаче' : 'нет снимка'], [change.tone === 'up' ? 'var(--ds-good)' : change.tone === 'down' ? 'var(--ds-bad)' : null, 'Изменение', change.label]])}>{text}</span>;
      }
      case 'trend': {
        const values = (m?.trend ?? []).map((value) => (value && value > 0 ? value : null));
        if (values.filter((value) => value != null).length < 2) return <span className="muted-cell">—</span>;
        const labels = trendDates.map((date) => fmtDate(date));
        const nums = values.filter((value): value is number => value != null);
        const color = nums[nums.length - 1] < nums[0] ? 'var(--ds-good)' : nums[nums.length - 1] > nums[0] ? 'var(--ds-bad)' : 'var(--ds-c1)';
        return <div className="pt-trend"><Sparkline values={values} labels={labels} color={color} height={28} invert label="Позиция" fmt={(value) => `#${value}`} /></div>;
      }
      case 'pop': {
        if (popularityUnavailable) return <span className="muted-cell" {...tipProps('Популярность', [[null, 'Apple Ads', 'сервис недоступен']])}>—</span>;
        if (!m || m.popularityStatus === 'pending') return <span className="pt-pending" {...tipProps(row.keyword, [[null, 'Популярность', 'запрашивается у Apple Ads']])}>…</span>;
        if (m.popularity == null) return <span className="muted-cell" {...tipProps(row.keyword, [[null, 'Популярность', m.popularityStatus === 'error' ? 'Apple Ads вернул ошибку, повтор через 10 мин' : 'Apple не вернул значение']])}>нет</span>;
        const low = m.popularity <= 5;
        return (
          <span className={`pt-pop ${low ? 'pt-pop-low' : ''}`} {...tipProps(row.keyword, [
            [null, 'Популярность', low ? '≤5 — низкий объём (не ноль)' : `${m.popularity} из 100`],
            [null, 'Источник', 'Apple Ads · рекомендации ключей'],
            [m.popularityStatus === 'stale' ? 'var(--ds-warn)' : null, 'Дата', `${fmtDate(m.popularityDay)}${m.popularityStatus === 'stale' ? ' · обновляется' : ''}`],
          ])}>
            <b>{m.popularityLabel ?? m.popularity}</b>
            <i className="pt-bar"><i style={{ width: `${Math.max(4, m.popularity)}%` }} /></i>
          </span>
        );
      }
      case 'diff': {
        if (m?.difficulty == null) return <span className="muted-cell" {...tipProps(row.keyword, [[null, 'Сложность', 'нужны оценки минимум у 3 приложений топ-10'], [null, 'Выдача', m?.serpSource ? `${m.serpDepth} результатов (${SERP_LABEL[m.serpSource]})` : 'ещё не снимали']])}>—</span>;
        const tone = m.difficulty >= 75 ? 'bad' : m.difficulty <= 40 ? 'good' : '';
        return <span className={`pt-num-cell ${tone ? `pt-${tone}` : ''}`} {...tipProps(row.keyword, [[null, 'Сложность', `${m.difficulty} из 100`], [null, 'По выдаче', `${m.serpDepth} результатов · ${SERP_LABEL[m.serpSource ?? 'snapshot']}`], [null, 'Ориентир', 'ниже 75 — брать']])}>{m.difficulty}</span>;
      }
      case 'chance': {
        if (m?.chance == null) return <span className="muted-cell">—</span>;
        const tone = m.chance >= 60 ? 'good' : m.chance < 25 ? 'bad' : '';
        return <span className={`pt-num-cell ${tone ? `pt-${tone}` : ''}`}>{m.chance}</span>;
      }
      case 'opp': {
        if (m?.opportunity == null) return <span className="muted-cell" {...tipProps(row.keyword, [[null, 'Возможность', 'нет популярности Apple Ads — не считается']])}>—</span>;
        const r = row.state === 'ranked' && row.pos! <= 3 ? 1 : row.state === 'ranked' && row.pos! <= 10 ? 0.5 : 0;
        return <span className={`pt-num-cell ${m.opportunity >= 10 ? 'pt-strong' : ''}`} {...tipProps(row.keyword, [
          [null, 'O = Pop × C/100 × (1 − R)', ''],
          [null, 'Pop', String(m.popularity)],
          [m.chance == null ? 'var(--ds-warn)' : null, 'C', m.chance == null ? '50 (нет Сложности — принято 50)' : String(m.chance)],
          [null, 'R', `${r} (${r === 1 ? 'мы в топ-3' : r === 0.5 ? 'мы в топ-10' : 'не в топ-10'})`],
          [null, 'O', num(m.opportunity, 1)],
        ])}>{num(m.opportunity, 1)}</span>;
      }
      case 'total': return <span className="pt-num-cell">{num(m?.total)}</span>;
      case 'top5': return renderTop5(row.ranking);
      case 'tags': return m?.tags.length ? <span className="pt-tags">{m.tags.map((tag) => <span key={tag} className="ds-badge">{tag}</span>)}</span> : <span className="muted-cell" />;
      case 'note': return <NoteCell keyword={row.keyword} note={m?.note ?? ''} onSave={onSaveNote} />;
      case 'updated': return renderUpdated(row.keyword, row.ranking);
    }
  };
  return (
    <tr className={[selected ? 'pt-row-selected' : '', alt ? 'pt-alt' : '', live ? `pt-live-${live}` : ''].filter(Boolean).join(' ') || undefined} onClick={onRowClick} aria-selected={selected}>
      <td className="pt-sel pt-sticky-0">
        <input type="checkbox" checked={selected} aria-label={`Выделить ${row.keyword}`}
          onClick={(event) => { event.preventDefault(); onSelect(row.key, event.shiftKey ? 'range' : 'toggle'); }} onChange={() => { /* handled on click */ }} />
      </td>
      <td className="pt-kw pt-sticky-1">
        <button className="keyword-open" type="button" onClick={() => onOpenDetail(row.keyword)} aria-label={`Открыть аналитику ключевого слова ${row.keyword}`}>
          <strong title={row.keyword}>{row.keyword}</strong>
          {row.m?.global ? <span className="pt-global" {...tipProps(row.keyword, [[null, 'Общий ключ', 'отслеживается во всех странах приложения'], [null, 'Удаление', 'убирает из всех стран']])}>🌐</span> : null}
          {renderKeywordExtra(row.keyword)}
        </button>
      </td>
      {columns.map((column) => <td key={column.id} className={`pt-td-${column.align ?? 'left'}`}>{cell(column)}</td>)}
      <td>
        <div className="row-actions">
          <button className="ds-icon-btn row-action" onClick={() => onRefresh(row.keyword)} title="Обновить это ключевое слово" aria-label={`Обновить ${row.keyword}`}><Icon name="refresh" /></button>
          <button className="ds-icon-btn row-action row-remove" onClick={() => onRemove(row.keyword)} title="Удалить ключ из всех стран" aria-label={`Удалить ${row.keyword}`}><Icon name="close" /></button>
        </div>
      </td>
    </tr>
  );
});

const SERP_LABEL: Record<'full' | 'cache' | 'snapshot', string> = { full: 'полная выдача', cache: 'кэш поиска, топ-15', snapshot: 'снимок, топ-5' };

function NoteCell({ keyword, note, onSave }: { keyword: string; note: string; onSave: (keyword: string, note: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(note);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!editing) setValue(note); }, [editing, note]);
  const commit = async () => {
    if (value.trim() === note) { setEditing(false); return; }
    setBusy(true);
    try { await onSave(keyword, value); setEditing(false); } finally { setBusy(false); }
  };
  if (editing) {
    return (
      <input className="ds-input pt-note-input" autoFocus value={value} disabled={busy} maxLength={500} aria-label={`Заметка к ${keyword}`}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => { if (event.key === 'Enter') void commit(); if (event.key === 'Escape') { event.stopPropagation(); setValue(note); setEditing(false); } }} />
    );
  }
  return (
    <button type="button" className={`pt-note ${note ? '' : 'pt-note-empty'}`} onClick={() => setEditing(true)} title={note || 'Добавить заметку'}>
      {note || <><Icon name="plus" size={12} /> заметка</>}
    </button>
  );
}

function FilterMenu({ active, children }: { active: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);
  return (
    <div className="picker" ref={rootRef}>
      <button type="button" className={`ds-btn ${active ? 'pt-filter-on' : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Icon name="filter" size={14} /> Фильтр {active ? <span className="mx-count">{active}</span> : null}
      </button>
      {open && (
        <div className="ds-pop picker-pop pt-filter-pop" role="dialog" aria-label="Фильтры">
          {children}
        </div>
      )}
    </div>
  );
}

function ColumnMenu({ layout, onChange }: { layout: Layout; onChange: (layout: Layout) => void }) {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState<ColId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);
  const toggle = (id: ColId) => onChange({ ...layout, hidden: layout.hidden.includes(id) ? layout.hidden.filter((item) => item !== id) : [...layout.hidden, id] });
  const move = (id: ColId, to: ColId) => {
    if (id === to) return;
    const order = layout.order.filter((item) => item !== id);
    order.splice(order.indexOf(to), 0, id);
    onChange({ ...layout, order });
  };
  const shown = layout.order.length - layout.hidden.length;
  return (
    <div className="picker" ref={rootRef}>
      <button type="button" className="ds-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Icon name="columns" size={14} /> Колонки <span className="mx-count">{shown}</span>
      </button>
      {open && (
        <div className="ds-pop picker-pop picker-pop-end pt-columns-pop" role="dialog" aria-label="Колонки таблицы">
          <div className="pt-columns-hint">Перетащите, чтобы поменять порядок</div>
          <div className="picker-list">
            {layout.order.map((id) => (
              <label key={id} className={`ds-pop-row pt-columns-row ${dragging === id ? 'dragging' : ''}`} draggable
                onDragStart={(event) => { setDragging(id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); }}
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
                onDrop={(event) => { event.preventDefault(); const from = event.dataTransfer.getData('text/plain') as ColId; if (BY_ID.has(from)) move(from, id); setDragging(null); }}
                onDragEnd={() => setDragging(null)}>
                <span className="pt-grip" aria-hidden="true">⋮⋮</span>
                <input type="checkbox" checked={!layout.hidden.includes(id)} onChange={() => toggle(id)} />
                <span className="picker-row-label">{BY_ID.get(id)!.label}</span>
                <span className="pt-columns-move">
                  <button type="button" className="ds-icon-btn" aria-label="Выше" onClick={(event) => { event.preventDefault(); const index = layout.order.indexOf(id); if (index > 0) move(id, layout.order[index - 1]); }}><Icon name="arrowUp" size={12} /></button>
                  <button type="button" className="ds-icon-btn" aria-label="Ниже" onClick={(event) => {
                    event.preventDefault();
                    const index = layout.order.indexOf(id);
                    if (index < layout.order.length - 1) { const order = [...layout.order]; [order[index], order[index + 1]] = [order[index + 1], order[index]]; onChange({ ...layout, order }); }
                  }}><Icon name="arrowDown" size={12} /></button>
                </span>
              </label>
            ))}
          </div>
          <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => onChange({ ...layout, order: COLUMNS.map((column) => column.id), hidden: DEFAULT_HIDDEN, widths: {} })}>Сбросить колонки</button>
        </div>
      )}
    </div>
  );
}

function TagMenu({ palette, selectedRows, onApply }: {
  palette: Array<{ tag: string; count: number }>;
  selectedRows: RowModel[];
  onApply: (add: string[], remove: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => { setOpen(false); setDraft(''); }, []);
  useDismiss(rootRef, open, close);
  const state = (tag: string) => {
    const n = selectedRows.filter((row) => row.m?.tags.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase())).length;
    return n === 0 ? 'none' : n === selectedRows.length ? 'all' : 'some';
  };
  const run = async (add: string[], remove: string[]) => {
    setBusy(true);
    try { await onApply(add, remove); } finally { setBusy(false); }
  };
  const filtered = palette.filter((item) => !draft.trim() || item.tag.toLocaleLowerCase().includes(draft.trim().toLocaleLowerCase()));
  const exact = palette.some((item) => item.tag.toLocaleLowerCase() === draft.trim().toLocaleLowerCase());
  return (
    <div className="picker" ref={rootRef}>
      <button type="button" className="ds-btn ds-btn-sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        # Тег…
      </button>
      {open && (
        <div className="ds-pop picker-pop pt-tag-pop" role="dialog" aria-label="Теги выделенных ключей">
          <form className="picker-search" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) void run([draft.trim()], []).then(() => setDraft('')); }}>
            <span aria-hidden="true">#</span>
            <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Новый или найти тег" maxLength={32} aria-label="Тег" />
          </form>
          <div className="picker-list">
            {draft.trim() && !exact && (
              <button type="button" className="ds-pop-row" disabled={busy} onClick={() => void run([draft.trim()], []).then(() => setDraft(''))}>
                <Icon name="plus" size={14} /> Создать «{draft.trim()}» для {selectedRows.length}
              </button>
            )}
            {filtered.map((item) => {
              const current = state(item.tag);
              return (
                <button key={item.tag} type="button" className="ds-pop-row" disabled={busy} aria-pressed={current === 'all'}
                  onClick={() => void (current === 'all' ? run([], [item.tag]) : run([item.tag], []))}>
                  <span className={`pt-tristate pt-tristate-${current}`} aria-hidden="true">{current === 'all' ? '✓' : current === 'some' ? '–' : ''}</span>
                  <span className="picker-row-label">{item.tag}</span>
                  <small>{item.count}</small>
                </button>
              );
            })}
            {!palette.length && !draft.trim() && <div className="picker-empty">Тегов пока нет — введите название.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function StorefrontActionDialog({ mode, appId, locale, keywords, keywordMap, favorites, presets, onClose, onDone }: {
  mode: 'copy' | 'remove';
  appId: string;
  locale: string;
  keywords: string[];
  keywordMap: Record<string, string[]>;
  favorites: string[];
  presets: StorefrontPreset[];
  onClose: () => void;
  onDone: (map: Record<string, string[]>, message: string) => void;
}) {
  const keys = useMemo(() => new Set(keywords.map(tagKey)), [keywords]);
  const presence = useMemo(() => {
    const out = new Map<string, number>();
    for (const [code, list] of Object.entries(keywordMap)) out.set(code, list.filter((keyword) => keys.has(tagKey(keyword))).length);
    return out;
  }, [keys, keywordMap]);
  const candidates = useMemo(() => (mode === 'copy'
    ? Object.keys(keywordMap).filter((code) => code !== locale)
    : Object.keys(keywordMap).filter((code) => (presence.get(code) ?? 0) > 0)
  ).sort(), [keywordMap, locale, mode, presence]);
  // Removing defaults to «everywhere»: a keyword lives in many storefronts, and
  // cleaning it up one country at a time is the chore this dialog exists to avoid.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(mode === 'remove'
    ? Object.keys(keywordMap).filter((code) => (keywordMap[code] ?? []).some((item) => keywords.some((keyword) => tagKey(keyword) === tagKey(item))))
    : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pairs: KeywordPair[] = [];
  let existing = 0;
  for (const code of selected) {
    const have = presence.get(code) ?? 0;
    if (mode === 'copy') {
      existing += have;
      for (const keyword of keywords) if (!(keywordMap[code] ?? []).some((item) => tagKey(item) === tagKey(keyword))) pairs.push({ keyword, storefront: code });
    } else {
      for (const keyword of keywords) if ((keywordMap[code] ?? []).some((item) => tagKey(item) === tagKey(keyword))) pairs.push({ keyword, storefront: code });
    }
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await keywordTableApi.bulk(appId, mode === 'copy' ? pairs : [], mode === 'remove' ? pairs : []);
      onDone(result.keywords, mode === 'copy'
        ? `Скопировано ${result.added} пар в ${selected.size} стран${result.existing ? `, ${result.existing} уже были` : ''}.`
        : `Удалено ${result.removed} пар из ${selected.size} стран.`);
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  };
  const n = keywords.length, m = selected.size;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="kb-card kb-narrow" role="dialog" aria-modal="true" aria-labelledby="sfa-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="kb-head">
          <h2 id="sfa-title">{mode === 'copy' ? 'Скопировать в страны' : m === candidates.length ? `Удалить из всех ${m} стран` : `Удалить из ${m} стран`}</h2>
          <button type="button" className="ds-icon-btn" onClick={onClose} aria-label="Закрыть"><Icon name="close" /></button>
        </header>
        <p className="kb-sub">{n} {n % 10 === 1 && n % 100 !== 11 ? 'ключ' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'ключа' : 'ключей'}: {keywords.slice(0, 4).join(', ')}{n > 4 ? ` и ещё ${n - 4}` : ''}</p>
        {mode === 'remove' && <p className="kb-sub kba-warn">{m === candidates.length ? `Ключ перестанет отслеживаться во всех странах (${m}). История позиций сохранится — при повторном добавлении вернётся.` : `Удалится из выбранных ${m} из ${candidates.length} стран.`} Снимите страны ниже, если нужно оставить.</p>}
        <StorefrontSelect
          candidates={candidates}
          selected={selected}
          onChange={setSelected}
          presets={presets}
          favorites={favorites}
          allowUntracked={mode === 'copy'}
          height={320}
          annotate={(code) => {
            const have = presence.get(code) ?? 0;
            return <span className="kba-sf-note">{have ? <span className="kba-sf-lang">есть {have}/{n}</span> : null}</span>;
          }}
        />
        <footer className="kba-foot">
          <div className="kba-preview" aria-live="polite">
            <strong>{n} × {m} = {n * m} пар</strong>
            <span>{mode === 'copy' ? <>новых <b className="kba-new">{pairs.length}</b>{existing ? ` · уже есть ${existing}` : ''}</> : <>будет удалено <b>{pairs.length}</b></>}</span>
            {error && <span className="kba-error">{error}</span>}
          </div>
          <button type="button" className="ds-btn" onClick={onClose}>Отмена</button>
          <button type="button" className={`ds-btn ${mode === 'remove' ? 'dialog-button-danger' : 'ds-btn-primary'}`} disabled={busy || !pairs.length} onClick={() => void submit()}>
            {busy ? 'Выполняется…' : mode === 'copy' ? `Скопировать ${pairs.length}` : `Удалить ${pairs.length}`}
          </button>
        </footer>
      </section>
    </div>
  );
}
