import { useEffect, useMemo, useRef, useState } from 'react';
import type { RankingRow } from '../lib/keywordsApi.ts';
import './KeywordResultsDrawer.css';

export interface KeywordResultApp {
  id: string;
  name: string;
  dev: string;
  tid?: number;
  pos?: number;
}

export interface KeywordResultsDrawerProps {
  keyword: string;
  country: string;
  ranking?: Pick<RankingRow, 'locale' | 'today' | 'yesterday' | 'w1' | 'w4' | 'top5' | 'lastUpdated'>;
  app: { name: string; bundle?: string; iTunesId: string; iconUrl?: string };
  artworks?: Record<string, string>;
  status?: 'ready' | 'loading' | 'error' | 'empty';
  error?: string | null;
  paidRank?: number | null;
  onClose: () => void;
  onOpenCompetitor?: (bundleId: string) => void;
}

export interface KeywordTopFiveInlineProps {
  keyword: string;
  scopeKey?: string;
  ranking?: Pick<RankingRow, 'top5' | 'lastUpdated'>;
  app: KeywordResultsDrawerProps['app'];
  artworks?: Record<string, string>;
  status?: 'ready' | 'loading' | 'error' | 'empty';
  onVisible?: (keyword: string) => void;
  onOpenCompetitor?: (bundleId: string) => void;
}

/** Keeps every top-five cell visually stable while the actual App Store icon loads. */
export function TopFiveArtwork({ url, label, fallback = '', className = '' }: { url?: string; label: string; fallback?: string; className?: string }) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const loaded = Boolean(url && loadedUrl === url);
  const failed = Boolean(url && failedUrl === url);
  if (!url || failed) return <span className={`top-five-artwork top-five-artwork-unavailable ${className}`.trim()} aria-label={`${label}: иконка недоступна`}>{fallback.trim().slice(0, 1).toUpperCase()}</span>;
  return <span className={`top-five-artwork ${loaded ? 'top-five-artwork-loaded' : ''} ${className}`.trim()} aria-label={label}>
    <i aria-hidden="true" />
    <img src={url} alt="" loading="lazy" onLoad={() => setLoadedUrl(url)} onError={() => setFailedUrl(url)} />
  </span>;
}

function formatFreshness(value: number | null | undefined) {
  if (!value) return 'время снимка неизвестно';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'время снимка неизвестно';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

function delta(current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null) return '—';
  const value = previous - current;
  return value > 0 ? `↑ ${value}` : value < 0 ? `↓ ${Math.abs(value)}` : '—';
}

function isOwn(result: KeywordResultApp, app: KeywordResultsDrawerProps['app']) {
  const bundle = app.bundle?.toLocaleLowerCase();
  return (Number(app.iTunesId) === result.tid)
    || Boolean(bundle && (result.id.toLocaleLowerCase() === bundle || result.id.toLocaleLowerCase().startsWith(bundle)));
}

/** Viewport-lazy rendering only; parents provide cached data in bounded batches. */
export function KeywordTopFiveInline({ keyword, scopeKey = '', ranking, app, artworks = {}, status = ranking ? 'ready' : 'empty', onVisible, onOpenCompetitor }: KeywordTopFiveInlineProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const onVisibleRef = useRef(onVisible);
  const notifiedRef = useRef('');
  useEffect(() => { onVisibleRef.current = onVisible; }, [onVisible]);
  useEffect(() => {
    const node = rootRef.current;
    const notificationKey = `${scopeKey}:${keyword.toLocaleLowerCase()}`;
    const notify = () => {
      setVisible(true);
      if (notifiedRef.current === notificationKey) return;
      notifiedRef.current = notificationKey;
      onVisibleRef.current?.(keyword);
    };
    if (!node || typeof IntersectionObserver === 'undefined') { notify(); return; }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      notify();
      observer.disconnect();
    }, { rootMargin: '240px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [keyword, scopeKey]);
  const apps = ranking?.top5 ?? [];
  if (status === 'loading') return <div ref={rootRef} className="keyword-top-five keyword-top-five-state" aria-label={`Загружаем топ-5 по запросу ${keyword}`}><i /><i /><i /><i /><i /></div>;
  if (status === 'error') return <div ref={rootRef} className="keyword-top-five keyword-top-five-empty" title="Сохранённый snapshot недоступен">—</div>;
  if (!apps.length) return <div ref={rootRef} className="keyword-top-five keyword-top-five-empty" title="Сохранённого топ-5 нет">—</div>;
  return <div ref={rootRef} className="keyword-top-five" aria-label={`Топ-5 органической выдачи по запросу ${keyword}; сохранённый snapshot`}>
    {visible ? apps.slice(0, 5).map((result, index) => {
      const own = isOwn(result, app);
      const artwork = own ? app.iconUrl : (result.tid ? artworks[String(result.tid)] : undefined) ?? artworks[result.id];
      const label = `Позиция ${result.pos ?? index + 1}: ${result.name}${own ? ', MedScan' : ''}`;
      const icon = <TopFiveArtwork url={artwork} label={label} fallback={result.name} />;
      return own ? <span key={`${result.id}-${index}`} className="keyword-top-five-icon keyword-top-five-own" title={label} aria-label={label}>{icon}<b>{result.pos ?? index + 1}</b></span> : (
        <button key={`${result.id}-${index}`} type="button" className="keyword-top-five-icon" title={label} aria-label={label} onClick={() => result.id && onOpenCompetitor?.(result.id)} disabled={!result.id || !onOpenCompetitor}>{icon}<b>{result.pos ?? index + 1}</b></button>
      );
    }) : <><i /><i /><i /><i /><i /></>}
  </div>;
}

export default function KeywordResultsDrawer({
  keyword,
  country,
  ranking,
  app,
  artworks = {},
  status = ranking ? 'ready' : 'empty',
  error,
  paidRank,
  onClose,
  onOpenCompetitor,
}: KeywordResultsDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const apps = useMemo(() => ranking?.top5 ?? [], [ranking?.top5]);
  const ownInTopFive = useMemo(() => apps.some((item) => isOwn(item, app)), [app, apps]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(drawerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [onClose]);

  return (
    <div className="keyword-results-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <aside ref={drawerRef} className="keyword-results-drawer" role="dialog" aria-modal="true" aria-labelledby="keyword-results-title">
        <header className="keyword-results-header">
          <div><span>Органическая выдача App Store · {ranking?.locale?.toUpperCase() ?? country.toUpperCase()}</span><h2 id="keyword-results-title">{keyword}</h2></div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Закрыть выдачу">×</button>
        </header>
        <div className="keyword-results-body">
          <section className="keyword-results-summary" aria-label="Позиции MedScan">
            <div><span>MedScan</span><strong>{ranking?.today == null ? 'Не в выдаче' : `#${ranking.today}`}</strong><small>{ownInTopFive ? 'показан в реальном слоте ниже' : 'в топ-5 сохранённого снимка не найден'}</small></div>
            <div><span>24 часа</span><strong>{delta(ranking?.today, ranking?.yesterday)}</strong><small>меньше номер — лучше</small></div>
            <div><span>7 дней</span><strong>{delta(ranking?.today, ranking?.w1)}</strong><small>меньше номер — лучше</small></div>
            <div><span>ASA позиция</span><strong>{paidRank == null ? '—' : `#${paidRank}`}</strong><small>не смешивается с органикой</small></div>
          </section>
          <section className="keyword-results-section">
            <header><div><h3>Топ‑5 приложений</h3><p>Последний сохранённый snapshot Keywords; это не paid выдача.</p></div><span title="Источник и свежесть">Кэш · {formatFreshness(ranking?.lastUpdated)}</span></header>
            {status === 'loading' ? <div className="keyword-results-state"><i />Загружаем сохранённый снимок…</div> : null}
            {status === 'error' ? <div className="keyword-results-state keyword-results-state-error" role="alert">Снимок недоступен: {error || 'неизвестная ошибка'}</div> : null}
            {!['loading', 'error'].includes(status) && apps.length ? <ol className="keyword-results-list">{apps.map((result, index) => {
              const own = isOwn(result, app);
              const artwork = own ? app.iconUrl : (result.tid ? artworks[String(result.tid)] : undefined) ?? artworks[result.id];
              const title = `Позиция ${result.pos ?? index + 1}: ${result.name}${own ? ', MedScan' : ''}`;
              return <li key={`${result.id}-${result.tid ?? index}`} className={own ? 'keyword-results-own' : ''}>
                <b>#{result.pos ?? index + 1}</b>
                <TopFiveArtwork url={artwork} label={title} fallback={result.name} className="keyword-results-icon" />
                <span><strong>{result.name}</strong><small>{result.dev || 'Разработчик не указан'}</small></span>
                {own ? <em>MedScan</em> : null}
                {!own && onOpenCompetitor && result.id ? <button type="button" className="keyword-results-competitor" onClick={() => onOpenCompetitor(result.id)} aria-label={`Открыть конкурента ${result.name}`} title={title}>Открыть</button> : null}
              </li>;
            })}</ol> : null}
            {!['loading', 'error'].includes(status) && !apps.length ? <div className="keyword-results-state"><strong>Сохранённого топ‑5 нет</strong><span>Ключ ещё не отслеживается в этой витрине или его snapshot не готов. Live App Store не запрашивается автоматически.</span></div> : null}
          </section>
        </div>
        <footer className="keyword-results-footer"><span>Источник: Keywords cached rankings · {formatFreshness(ranking?.lastUpdated)}</span><button type="button" onClick={onClose}>Готово</button></footer>
      </aside>
    </div>
  );
}
