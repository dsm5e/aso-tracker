import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Icon from './Icon';
import { LOCALE_NAMES, searchStorefronts, storefrontOf, STOREFRONTS, type ColumnSetOption, type Storefront } from '../countries';
import { tipProps } from '../../../shared/charts/Charts';
import './CountryPalette.css';

export interface PaletteLocaleStat {
  keywords: number;
  avg: number | null;
}

type Item =
  | { kind: 'matrix'; key: string }
  | { kind: 'set'; key: string; set: ColumnSetOption }
  | { kind: 'storefront'; key: string; storefront: Storefront; tracked: boolean; shortcut?: number; reason?: string };

const REASON: Record<string, string> = {
  'lang-primary': 'основной',
  'lang-secondary': 'вторичный',
};

/**
 * ⌘K storefront palette: fuzzy search by name / ISO / indexed language, with
 * favorites (⌘1…⌘9), recents and every tracked storefront (keyword count + avg rank).
 * Untracked storefronts appear only for a query and are added on Enter.
 */
export default function CountryPalette({
  current,
  matrixActive,
  stats,
  favorites,
  recent,
  sets,
  activeSetId,
  onSelect,
  onSelectMatrix,
  onSelectSet,
  onToggleFavorite,
  onAdd,
  onClose,
}: {
  current: string;
  matrixActive: boolean;
  stats: Record<string, PaletteLocaleStat>;
  favorites: string[];
  recent: string[];
  sets: ColumnSetOption[];
  activeSetId?: string;
  onSelect: (code: string) => void;
  onSelectMatrix: () => void;
  onSelectSet: (id: string) => void;
  onToggleFavorite: (code: string) => void;
  onAdd: (code: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const tracked = useMemo(() => Object.keys(stats), [stats]);
  const trackedSet = useMemo(() => new Set(tracked), [tracked]);
  const favoriteList = useMemo(() => favorites.filter((code) => trackedSet.has(code)), [favorites, trackedSet]);

  const sections = useMemo(() => {
    const out: Array<{ title: string; items: Item[] }> = [];
    const row = (code: string, extra: Partial<Extract<Item, { kind: 'storefront' }>> = {}): Item => ({
      kind: 'storefront', key: `${extra.shortcut ? 'fav' : 'sf'}:${code}:${extra.reason ?? ''}`, storefront: storefrontOf(code), tracked: trackedSet.has(code), ...extra,
    });
    const needle = query.trim();
    if (!needle) {
      out.push({ title: '', items: [{ kind: 'matrix', key: 'matrix' }] });
      if (favoriteList.length) out.push({ title: 'Избранные', items: favoriteList.map((code, index) => row(code, { key: `fav:${code}`, shortcut: index < 9 ? index + 1 : undefined })) });
      const recents = recent.filter((code) => trackedSet.has(code) && !favoriteList.includes(code)).slice(0, 5);
      if (recents.length) out.push({ title: 'Недавние', items: recents.map((code) => row(code, { key: `recent:${code}` })) });
      const all = [...tracked].sort((a, b) => (stats[b]?.keywords ?? 0) - (stats[a]?.keywords ?? 0) || storefrontOf(a).name.localeCompare(storefrontOf(b).name, 'ru'));
      out.push({ title: `Все отслеживаемые · ${all.length}`, items: all.map((code) => row(code, { key: `all:${code}` })) });
      if (sets.length) out.push({ title: 'Наборы колонок матрицы', items: sets.map((set) => ({ kind: 'set' as const, key: `set:${set.id}`, set })) });
      return out;
    }
    const hits = searchStorefronts(needle, tracked.map((code) => storefrontOf(code)));
    if (hits.length) out.push({ title: 'Отслеживаемые', items: hits.map((hit) => row(hit.storefront.code, { key: `hit:${hit.storefront.code}`, reason: REASON[hit.reason] })) });
    const others = searchStorefronts(needle, STOREFRONTS.filter((storefront) => !trackedSet.has(storefront.code))).slice(0, 8);
    if (others.length) out.push({ title: 'Не отслеживаются — Enter добавит регион', items: others.map((hit) => row(hit.storefront.code, { key: `new:${hit.storefront.code}`, reason: REASON[hit.reason] })) });
    const setHits = sets.filter((set) => set.name.toLocaleLowerCase().includes(needle.toLocaleLowerCase()));
    if (setHits.length) out.push({ title: 'Наборы колонок матрицы', items: setHits.map((set) => ({ kind: 'set' as const, key: `set:${set.id}`, set })) });
    return out;
  }, [favoriteList, query, recent, sets, stats, tracked, trackedSet]);

  const items = useMemo(() => sections.flatMap((section) => section.items), [sections]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === 'matrix') onSelectMatrix();
    else if (item.kind === 'set') onSelectSet(item.set.id);
    else if (item.tracked) onSelect(item.storefront.code);
    else onAdd(item.storefront.code);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(items.length - 1, index + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
    else if (event.key === 'PageDown') { event.preventDefault(); setActive((index) => Math.min(items.length - 1, index + 8)); }
    else if (event.key === 'PageUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 8)); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(items[active]); }
    else if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    else if (!query && /^[1-9]$/.test(event.key) && !event.metaKey && !event.ctrlKey) {
      // Empty query: a digit jumps to that favorite, like ⌘digit outside the palette.
      const code = favoriteList[Number(event.key) - 1];
      if (code) { event.preventDefault(); onSelect(code); }
    } else if (!query && event.key === '0' && !event.metaKey && !event.ctrlKey) {
      event.preventDefault(); onSelectMatrix();
    }
  };

  let index = -1;
  return (
    <div className="cp-backdrop" onMouseDown={onClose}>
      <div className="ds-pop cp" role="dialog" aria-label="Выбор витрины" onMouseDown={(event) => event.stopPropagation()} onKeyDown={onKeyDown}>
        <label className="cp-search">
          <Icon name="search" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActive(0); }}
            placeholder="Страна, ISO или язык: мекс, MX, es, ru"
            aria-label="Поиск витрины"
            aria-controls="cp-list"
            aria-activedescendant={`cp-item-${active}`}
          />
          <kbd>esc</kbd>
        </label>
        <div className="cp-list" id="cp-list" role="listbox" ref={listRef}>
          {sections.map((section) => (
            <div className="cp-section" key={section.title || 'top'}>
              {section.title && <div className="cp-section-title">{section.title}</div>}
              {section.items.map((item) => {
                index += 1;
                const itemIndex = index;
                const common = {
                  id: `cp-item-${itemIndex}`,
                  'data-index': itemIndex,
                  role: 'option',
                  'aria-selected': itemIndex === active,
                  className: `cp-row ${itemIndex === active ? 'cp-row-active' : ''}`,
                  onMouseMove: () => { if (active !== itemIndex) setActive(itemIndex); },
                  onClick: () => choose(item),
                } as const;
                if (item.kind === 'matrix') {
                  return (
                    <div key={item.key} {...common} className={`${common.className} cp-row-wide`}>
                      <span className="cp-flag cp-flag-globe" aria-hidden="true"><Icon name="grid" /></span>
                      <span className="cp-name"><strong>Все страны</strong><small>матрица «ключ × страна»</small></span>
                      {matrixActive && <Icon name="check" className="cp-check" />}
                      <kbd className="cp-kbd">⌘0</kbd>
                    </div>
                  );
                }
                if (item.kind === 'set') {
                  return (
                    <div key={item.key} {...common} className={`${common.className} cp-row-wide`}>
                      <span className="cp-flag cp-flag-globe" aria-hidden="true"><Icon name="columns" /></span>
                      <span className="cp-name"><strong>{item.set.name}</strong><small>{item.set.hint}</small></span>
                      <span className="cp-set-flags" aria-hidden="true">{item.set.locales.slice(0, 8).map((code) => storefrontOf(code).flag).join(' ')}{item.set.locales.length > 8 ? ` +${item.set.locales.length - 8}` : ''}</span>
                      {matrixActive && activeSetId === item.set.id && <Icon name="check" className="cp-check" />}
                    </div>
                  );
                }
                const { storefront } = item;
                const stat = stats[storefront.code];
                const favorite = favorites.includes(storefront.code);
                return (
                  <div key={item.key} {...common} className={`${common.className} ${item.tracked ? '' : 'cp-row-untracked'}`}>
                    <span className="cp-flag" aria-hidden="true">{storefront.flag}</span>
                    <span className="cp-name">
                      <strong>{storefront.name}</strong>
                      <small>{storefront.code.toUpperCase()}{item.reason ? ` · ${item.reason}` : ''}</small>
                    </span>
                    <LocaleChips locales={storefront.locales} />
                    {item.tracked ? (
                      <span className="cp-stats">
                        <b>{stat?.keywords ?? 0}</b> кл.
                        <span className={`cp-avg ${stat?.avg != null && stat.avg <= 10 ? 'cp-avg-good' : ''}`}>{stat?.avg != null ? `ср. #${Math.round(stat.avg)}` : 'нет позиций'}</span>
                      </span>
                    ) : (
                      <span className="cp-stats cp-add"><Icon name="plus" size={14} /> добавить</span>
                    )}
                    {current === storefront.code && !matrixActive ? <Icon name="check" className="cp-check" /> : null}
                    {item.shortcut ? <kbd className="cp-kbd">⌘{item.shortcut}</kbd> : null}
                    {item.tracked && (
                      <button
                        type="button"
                        className={`cp-star ${favorite ? 'cp-star-on' : ''}`}
                        aria-pressed={favorite}
                        aria-label={favorite ? `Убрать ${storefront.name} из избранного` : `Добавить ${storefront.name} в избранное`}
                        onClick={(event) => { event.stopPropagation(); onToggleFavorite(storefront.code); }}
                      >
                        <Icon name="star" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {items.length === 0 && <div className="cp-empty">Ничего не найдено. Попробуйте ISO-код (MX) или язык (es).</div>}
        </div>
        <footer className="cp-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> выбор</span>
          <span><kbd>↵</kbd> открыть</span>
          <span><kbd>⌘1</kbd>…<kbd>⌘9</kbd> избранные</span>
          <span><kbd>⌘[</kbd><kbd>⌘]</kbd> соседняя</span>
          <span><kbd>⌘0</kbd> все страны</span>
        </footer>
      </div>
    </div>
  );
}

/** Indexed App Store localizations: the default language first (bold), then the additional ones. */
export function LocaleChips({ locales, max = 4 }: { locales: string[]; max?: number }): ReactNode {
  if (!locales.length) return <span className="cp-locales" />;
  const shown = locales.slice(0, max);
  const rows = locales.map((locale, index) => [index === 0 ? 'var(--ds-accent)' : null, `${locale}${index === 0 ? ' · основной' : ''}`, LOCALE_NAMES[locale] ?? locale] as [string | null, string, string]);
  return (
    <span className="cp-locales" {...tipProps('Индексируемые локализации', rows)}>
      {shown.map((locale, index) => <span key={locale} className={index === 0 ? 'cp-locale cp-locale-primary' : 'cp-locale'}>{locale}</span>)}
      {locales.length > max && <span className="cp-locale cp-locale-more">+{locales.length - max}</span>}
    </span>
  );
}
