import { useMemo, useState, type ReactNode } from 'react';
import Icon from './Icon';
import { LocaleChips } from './CountryPalette';
import { searchStorefronts, storefrontOf, STOREFRONTS } from '../countries';
import './StorefrontSelect.css';

export interface StorefrontPreset {
  id: string;
  name: string;
  locales: string[];
  hint?: string;
}

/**
 * Palette-style storefront multi-select (same fuzzy search as ⌘K: name, ISO,
 * indexed language). Presets replace the selection; «Избранные» first.
 * With `allowUntracked`, a query also lists storefronts the app does not track yet.
 */
export default function StorefrontSelect({
  candidates,
  selected,
  onChange,
  presets = [],
  favorites = [],
  allowUntracked = false,
  annotate,
  height = 280,
}: {
  candidates: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  presets?: StorefrontPreset[];
  favorites?: string[];
  allowUntracked?: boolean;
  annotate?: (code: string) => ReactNode;
  height?: number;
}) {
  const [query, setQuery] = useState('');
  const candidateSet = useMemo(() => new Set(candidates), [candidates]);
  const ordered = useMemo(() => {
    const fav = favorites.filter((code) => candidateSet.has(code));
    const rest = candidates.filter((code) => !fav.includes(code)).sort((a, b) => storefrontOf(a).name.localeCompare(storefrontOf(b).name, 'ru'));
    // Selected untracked storefronts stay visible after the query is cleared.
    const extra = [...selected].filter((code) => !candidateSet.has(code));
    return [...fav, ...rest, ...extra];
  }, [candidateSet, candidates, favorites, selected]);
  const list = useMemo(() => {
    if (!query.trim()) return ordered;
    const hits = searchStorefronts(query, ordered.map((code) => storefrontOf(code))).map((hit) => hit.storefront.code);
    if (!allowUntracked) return hits;
    const others = searchStorefronts(query, STOREFRONTS.filter((storefront) => !ordered.includes(storefront.code))).slice(0, 8).map((hit) => hit.storefront.code);
    return [...hits, ...others];
  }, [allowUntracked, ordered, query]);

  const toggle = (code: string) => {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code); else next.add(code);
    onChange(next);
  };
  const favoriteCodes = favorites.filter((code) => candidateSet.has(code));
  const allPresets: StorefrontPreset[] = [
    ...(favoriteCodes.length ? [{ id: 'fav', name: 'Избранные', locales: favoriteCodes }] : []),
    ...presets.filter((preset) => preset.locales.some((code) => candidateSet.has(code))),
  ];
  const sameSet = (codes: string[]) => codes.length === selected.size && codes.every((code) => selected.has(code));

  return (
    <div className="sfs">
      <div className="sfs-presets" role="group" aria-label="Наборы стран">
        {allPresets.map((preset) => {
          const codes = preset.locales.filter((code) => candidateSet.has(code));
          return (
            <button key={preset.id} type="button" className={`sfs-chip ${sameSet(codes) ? 'on' : ''}`} title={preset.hint ?? `${codes.length} стран`}
              onClick={() => onChange(new Set(codes))}>
              {preset.id === 'fav' && <Icon name="star" size={12} />}{preset.name} <small>{codes.length}</small>
            </button>
          );
        })}
        <button type="button" className={`sfs-chip ${sameSet(candidates) ? 'on' : ''}`} onClick={() => onChange(new Set(candidates))}>Все <small>{candidates.length}</small></button>
        <button type="button" className="sfs-chip" onClick={() => onChange(new Set())} disabled={!selected.size}>Снять</button>
      </div>
      <label className="picker-search sfs-search">
        <Icon name="search" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Страна, ISO или язык: мекс, MX, es, ru" aria-label="Поиск страны" />
        {query && <button type="button" className="ds-icon-btn" onClick={() => setQuery('')} aria-label="Очистить"><Icon name="close" size={12} /></button>}
      </label>
      {query && list.length > 0 && (
        <div className="sfs-bulk">
          <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => onChange(new Set([...selected, ...list.filter((code) => candidateSet.has(code) || allowUntracked)]))}>Отметить найденные · {list.length}</button>
          <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => onChange(new Set([...selected].filter((code) => !list.includes(code))))}>Снять найденные</button>
        </div>
      )}
      <div className="sfs-list" style={{ maxHeight: height }} role="listbox" aria-multiselectable="true">
        {list.map((code) => {
          const storefront = storefrontOf(code);
          const tracked = candidateSet.has(code);
          return (
            <label key={code} className={`ds-pop-row sfs-row ${selected.has(code) ? 'on' : ''}`} role="option" aria-selected={selected.has(code)}>
              <input type="checkbox" checked={selected.has(code)} onChange={() => toggle(code)} />
              <span className="picker-flag">{storefront.flag}</span>
              <span className="sfs-name">{storefront.name}{!tracked && <em> · новая витрина</em>}</span>
              <LocaleChips locales={storefront.locales} max={3} />
              {annotate?.(code)}
              <small className="sfs-code">{code.toUpperCase()}</small>
            </label>
          );
        })}
        {list.length === 0 && <div className="picker-empty">Ничего не найдено. Попробуйте ISO-код (MX) или язык (es).</div>}
      </div>
    </div>
  );
}
