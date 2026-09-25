import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import StorefrontSelect, { type StorefrontPreset } from './StorefrontSelect';
import { STOREFRONTS } from '../countries';
import { LANGUAGE_LABEL, SCRIPT_LABEL, detectLanguage, parseKeywordList, storefrontsForLanguage, type KeywordLanguage } from '../../server/keyword-language';
import { keywordTableApi, tagKey, type KeywordPair } from '../keywordTableApi';
import { tipProps } from '../../../shared/charts/Charts';
import './BulkAddDialog.css';

const ALL_CODES = STOREFRONTS.map((storefront) => storefront.code);

const CONFIDENCE: Record<KeywordLanguage['confidence'], string> = {
  script: 'по письменности',
  letters: 'по буквам языка',
  words: 'по словам',
  default: 'по умолчанию для письменности',
};

/**
 * Bulk add: paste N keywords, pick M storefronts → preview «N × M = K pairs».
 * Each keyword's language is guessed (script + letters + words) and storefronts
 * that index it are preselected (storefronts.ts, Apple's localization table);
 * with «только где язык индексируется» a pair is created only where Apple
 * indexes the keyword's language. Pairs that already exist are shown and skipped.
 */
export default function BulkAddDialog({
  appId,
  currentLocale,
  keywordMap,
  favorites,
  presets,
  onClose,
  onDone,
}: {
  appId: string;
  currentLocale: string;
  keywordMap: Record<string, string[]>;
  favorites: string[];
  presets: StorefrontPreset[];
  onClose: () => void;
  onDone: (map: Record<string, string[]>, added: number) => void;
}) {
  const tracked = useMemo(() => Object.keys(keywordMap).sort(), [keywordMap]);
  const [text, setText] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [languageOnly, setLanguageOnly] = useState(false);
  // Default: every storefront the app is tracked in — adding a keyword country by
  // country was the chore. The language filter stays available, off by default.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(Object.keys(keywordMap).length ? Object.keys(keywordMap) : currentLocale ? [currentLocale] : []));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // «Во все страны» = the app's global list (also every storefront added later);
  // «В выбранные» = targeted pairs, for localized phrases.
  const [scope, setScope] = useState<'global' | 'targeted'>('global');

  const parsed = useMemo(() => parseKeywordList(text), [text]);
  const items = useMemo(() => parsed.keywords.map((keyword) => {
    const detected = detectLanguage(keyword);
    const lang = overrides[tagKey(keyword)] ?? detected.lang;
    return { keyword, detected, lang, indexing: new Set(storefrontsForLanguage(lang, ALL_CODES)) };
  }), [overrides, parsed.keywords]);

  // Auto preselect: every tracked storefront (or, with the language filter on, those
  // indexing a detected language) — until the user edits the selection.
  const autoSelection = useMemo(() => {
    if (!languageOnly) return new Set(tracked);
    const langs = new Set(items.map((item) => item.lang));
    const out = new Set<string>();
    for (const lang of langs) for (const code of storefrontsForLanguage(lang, tracked)) out.add(code);
    return out;
  }, [items, languageOnly, tracked]);
  useEffect(() => {
    if (!touched && items.length) setSelected(autoSelection);
  }, [autoSelection, items.length, touched]);

  const existingKeys = useMemo(() => {
    const out = new Map<string, Set<string>>();
    for (const [code, list] of Object.entries(keywordMap)) out.set(code, new Set(list.map(tagKey)));
    return out;
  }, [keywordMap]);

  const plan = useMemo(() => {
    const pairs: KeywordPair[] = [];
    let existing = 0, skippedLanguage = 0;
    const perKeyword = new Map<string, { target: number; existing: number }>();
    const perStorefront = new Map<string, number>();
    for (const item of items) {
      const stat = { target: 0, existing: 0 };
      for (const code of selected) {
        if (languageOnly && !item.indexing.has(code)) { skippedLanguage++; continue; }
        stat.target++;
        if (existingKeys.get(code)?.has(tagKey(item.keyword))) { existing++; stat.existing++; continue; }
        pairs.push({ keyword: item.keyword, storefront: code });
        perStorefront.set(code, (perStorefront.get(code) ?? 0) + 1);
      }
      perKeyword.set(item.keyword, stat);
    }
    return { pairs, existing, skippedLanguage, perKeyword, perStorefront };
  }, [existingKeys, items, languageOnly, selected]);

  const n = items.length, m = selected.size;
  const submit = async () => {
    if (scope === 'global') {
      if (!items.length) return;
      setBusy(true);
      setError(null);
      try {
        const result = await keywordTableApi.setGlobal(appId, items.map((item) => item.keyword));
        onDone(result.keywords, items.length);
      } catch (reason) {
        setError((reason as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!plan.pairs.length) return;
    setBusy(true);
    setError(null);
    try {
      const result = await keywordTableApi.bulk(appId, plan.pairs, []);
      onDone(result.keywords, result.added);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const languages = [...new Set(items.map((item) => item.lang))];

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="kb-card kba" role="dialog" aria-modal="true" aria-labelledby="kba-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="kb-head">
          <h2 id="kba-title">Добавить ключевые слова</h2>
          <div className="ds-seg kba-scope" role="tablist" aria-label="Куда добавить">
            <button type="button" role="tab" aria-selected={scope === 'global'} onClick={() => setScope('global')}>🌐 Во все страны</button>
            <button type="button" role="tab" aria-selected={scope === 'targeted'} onClick={() => setScope('targeted')}>В выбранные</button>
          </div>
          <button type="button" className="ds-icon-btn" onClick={onClose} aria-label="Закрыть"><Icon name="close" /></button>
        </header>
        <div className="kba-body">
          <div className="kba-left">
            <label className="kba-label" htmlFor="kba-text">Ключи — через запятую или с новой строки</label>
            <textarea id="kba-text" className="ds-textarea kba-text" autoFocus value={text} onChange={(event) => setText(event.target.value)}
              placeholder={'visor dicom, dicom viewer\nпросмотр dicom'} rows={5} />
            <div className="kba-parsed">
              {n ? <>
                <span><b>{n}</b> {plural(n, 'ключ', 'ключа', 'ключей')}</span>
                {parsed.duplicates > 0 && <span className="ds-badge ds-badge-muted">дубли убраны: {parsed.duplicates}</span>}
                {languages.map((lang) => <span key={lang} className="ds-badge">{LANGUAGE_LABEL[lang] ?? lang}</span>)}
              </> : <span className="ds-note">Язык каждого ключа определяется автоматически: по письменности, буквам и частым словам.</span>}
            </div>
            <div className="kba-keywords" role="list">
              {items.map((item) => {
                const stat = plan.perKeyword.get(item.keyword);
                return (
                  <div key={item.keyword} className="kba-kw" role="listitem">
                    <strong title={item.keyword}>{item.keyword}</strong>
                    <select className="ds-select kba-lang" value={item.lang} aria-label={`Язык ключа ${item.keyword}`}
                      onChange={(event) => setOverrides((current) => ({ ...current, [tagKey(item.keyword)]: event.target.value }))}
                      {...tipProps(item.keyword, [
                        [null, 'Письменность', SCRIPT_LABEL[item.detected.script]],
                        [null, 'Язык', `${LANGUAGE_LABEL[item.detected.lang] ?? item.detected.lang} — ${CONFIDENCE[item.detected.confidence]}`],
                        [null, 'Индексируют', `${storefrontsForLanguage(item.lang, tracked).length} из ${tracked.length} отслеживаемых витрин`],
                      ])}>
                      {Object.entries(LANGUAGE_LABEL).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                    </select>
                    {scope === 'targeted' && (
                    <span className="kba-kw-stat" {...tipProps(item.keyword, [
                      [null, 'Новые пары', [...selected].filter((code) => (!languageOnly || item.indexing.has(code)) && !existingKeys.get(code)?.has(tagKey(item.keyword))).map((code) => code.toUpperCase()).join(' ') || '—'],
                      [null, 'Уже отслеживается', [...selected].filter((code) => (!languageOnly || item.indexing.has(code)) && existingKeys.get(code)?.has(tagKey(item.keyword))).map((code) => code.toUpperCase()).join(' ') || '—'],
                    ])}>
                      → <b>{(stat?.target ?? 0) - (stat?.existing ?? 0)}</b>
                      {stat?.existing ? <em> · уже есть в {stat.existing}</em> : null}
                    </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {scope === 'global' ? (
          <div className="kba-right kba-global">
            <strong>Общий список приложения</strong>
            <p>Ключ отслеживается во всех {tracked.length} {plural(tracked.length, 'стране', 'странах', 'странах')} приложения и автоматически — в странах, добавленных позже. Удаление общего ключа убирает его отовсюду.</p>
            <p className="kba-global-muted">Для бренда, названий конкурентов и английских терминов. Локализованные фразы («визуализатор dicom», «ct ビューア») лучше добавлять «В выбранные» — в страны своего языка.</p>
            {languages.some((lang) => lang !== 'en') && (
              <p className="kba-global-hint">Среди ключей есть не английские ({languages.filter((lang) => lang !== 'en').map((lang) => LANGUAGE_LABEL[lang] ?? lang).join(', ')}). <button type="button" className="ds-btn ds-btn-sm" onClick={() => { setScope('targeted'); setLanguageOnly(true); setTouched(false); }}>В страны их языка</button></p>
            )}
          </div>
          ) : (
          <div className="kba-right">
            <div className="kba-right-head">
              <span className="kba-label">Витрины · {m}</span>
              <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" disabled={!items.length} onClick={() => { setTouched(false); setSelected(autoSelection); }}
                {...tipProps('Авто по языку', [[null, 'Отмечает витрины, где Apple индексирует язык ключей', ''], [null, 'Источник', 'таблица локализаций App Store Connect']])}>
                <Icon name="globe" size={14} /> Авто по языку
              </button>
            </div>
            <StorefrontSelect
              candidates={tracked}
              selected={selected}
              onChange={(next) => { setTouched(true); setSelected(next); }}
              presets={presets}
              favorites={favorites}
              allowUntracked
              height={300}
              annotate={(code) => {
                const count = plan.perStorefront.get(code);
                const langHit = languages.filter((lang) => items.some((item) => item.lang === lang && item.indexing.has(code)));
                return (
                  <span className="kba-sf-note">
                    {langHit.length ? <span className="kba-sf-lang">{langHit.join(' ')}</span> : null}
                    {count ? <b>+{count}</b> : null}
                  </span>
                );
              }}
            />
            <label className="kba-toggle">
              <input type="checkbox" checked={languageOnly} onChange={(event) => setLanguageOnly(event.target.checked)} />
              Только где язык ключа индексируется
            </label>
          </div>
          )}
        </div>
        <footer className="kba-foot">
          <div className="kba-preview" aria-live="polite">
            {scope === 'global' ? <>
              <strong>{n} {plural(n, 'ключ', 'ключа', 'ключей')} → общий список</strong>
              <span>будут отслеживаться во всех {tracked.length} {plural(tracked.length, 'стране', 'странах', 'странах')}</span>
            </> : <>
            <strong>{n} {plural(n, 'ключ', 'ключа', 'ключей')} × {m} {plural(m, 'страна', 'страны', 'стран')} = {n * m} пар</strong>
            <span>
              новых <b className="kba-new">{plan.pairs.length}</b>
              {plan.existing > 0 && <> · уже есть {plan.existing}</>}
              {languageOnly && plan.skippedLanguage > 0 && <> · язык не индексируется {plan.skippedLanguage}</>}
            </span>
            </>}
            {error && <span className="kba-error">{error}</span>}
          </div>
          <button type="button" className="ds-btn" onClick={onClose}>Отмена</button>
          <button type="button" className="ds-btn ds-btn-primary" disabled={busy || (scope === 'global' ? !n : !plan.pairs.length)} onClick={() => void submit()}>
            {busy ? 'Добавляем…' : scope === 'global' ? `Добавить в общий список (${n})` : `Добавить ${plan.pairs.length} ${plural(plan.pairs.length, 'пару', 'пары', 'пар')}`}
          </button>
        </footer>
      </section>
    </div>
  );
}

function plural(count: number, one: string, few: string, many: string) {
  const mod10 = count % 10, mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
