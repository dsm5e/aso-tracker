import type { AppStats, LocaleAvg } from '../api';
import { Sparkline } from '../../../shared/charts/Charts';
import Icon from '../components/Icon';
import './Overview.css';

export interface OverviewProps {
  apps: AppStats[];
  localeAvgByApp: Record<string, LocaleAvg[]>;
  onOpenApp: (id: string) => void;
  onDeleteApp: (app: AppStats) => void;
  onRunAll: () => void;
  refreshing: boolean;
  /** Событие обновления намеренно не привязано к транспортному типу. */
  progress?: unknown;
}

function localeFlag(locale: string) {
  const country = locale.split('-')[0].toLowerCase();
  if (!/^[a-z]{2}$/.test(country)) return '🌐';
  return String.fromCodePoint(...[...country.toUpperCase()].map((letter) => letter.charCodeAt(0) + 127397));
}

function formatDelta(value: number | null | undefined) {
  if (value === null || value === undefined) return 'нет базы за неделю';
  if (value === 0) return 'Без изменений';
  return value > 0 ? `↑ ${value}` : `↓ ${Math.abs(value)}`;
}

function PortfolioTrend({ values }: { values: number[] }) {
  const clean = values.filter(Number.isFinite);
  // A table/card cell must not grow just because historical data is absent.
  // The accessible name preserves the explanation without adding visual noise.
  if (clean.length < 2) return <span className="overview2-trend-empty" title="Для тренда нужны минимум два снимка" aria-label="Для тренда нужны минимум два снимка">—</span>;
  const labels = clean.map((_, index) => `Снимок ${index + 1} из ${clean.length}`);
  return (
    <div className="overview2-trend" style={{ marginTop: 8 }} role="img" aria-label="Динамика ключевых слов в топ-10">
      <Sparkline values={clean} labels={labels} height={48} label="Ключей в топ-10" />
    </div>
  );
}

function AppArtwork({ app }: { app: AppStats }) {
  if (app.iconUrl) return <img className="overview2-app-icon" src={app.iconUrl} alt="" />;
  return <span className="overview2-app-icon overview2-app-icon-fallback" aria-hidden="true">{app.emoji || app.name.slice(0, 1)}</span>;
}

/**
 * Новый обзор портфеля. Стили намеренно вынесены в namespace overview2-*,
 * чтобы экран можно было подключить рядом со старым без конфликтов.
 */
export function Overview({ apps, localeAvgByApp, onOpenApp, onDeleteApp, onRunAll, refreshing, progress }: OverviewProps) {
  const totals = apps.reduce((total, app) => ({
    keywords: total.keywords + app.keywords,
    ranked: total.ranked + app.ranked,
    top10: total.top10 + app.top10,
    snapshots: total.snapshots + (app.lastSnapshot ? 1 : 0),
  }), { keywords: 0, ranked: 0, top10: 0, snapshots: 0 });
  const visibility = totals.keywords ? Math.round((totals.ranked / totals.keywords) * 100) : 0;
  const top10Coverage = totals.keywords ? Math.round((totals.top10 / totals.keywords) * 100) : 0;
  const portfolioHistory = apps.reduce<number[]>((sum, app) => {
    app.history.top10.forEach((value, index) => { sum[index] = (sum[index] ?? 0) + value; });
    return sum;
  }, []);
  const progressText = refreshing
    ? (typeof progress === 'object' && progress && 'message' in progress && typeof progress.message === 'string' ? progress.message : 'Собираем позиции по витринам…')
    : null;

  return (
    <section className="overview2" aria-label="Обзор портфеля">
      <header className="overview2-header">
        <div className="overview2-heading">
          <h1 className="ds-page-title">Обзор портфеля</h1>
          <p className="ds-page-sub">Видимость, покрытие и изменения по отслеживаемым приложениям.</p>
        </div>
        <div className="overview2-actions">
          {progressText ? <span className="overview2-progress" role="status"><i />{progressText}</span> : null}
          <button className="ds-btn ds-btn-primary" type="button" onClick={onRunAll} disabled={refreshing}>
            <Icon name="refresh" className={refreshing ? 'spinning' : ''} />{refreshing ? 'Обновляем…' : 'Обновить всё'}
          </button>
        </div>
      </header>

      <div className="overview2-body">
        <section className="overview2-kpis" aria-label="Ключевые показатели">
          <article className="overview2-kpi"><span>Приложения</span><strong>{apps.length}</strong><small>В отслеживаемом портфеле</small></article>
          <article className="overview2-kpi"><span>Ключевые слова</span><strong>{totals.keywords}</strong><small>Во всех регионах</small></article>
          <article className="overview2-kpi"><span>Видимость</span><strong>{visibility}%</strong><small>{totals.ranked} в поисковой выдаче</small></article>
          <article className="overview2-kpi"><span>Топ-10</span><strong>{top10Coverage}%</strong><small>{totals.top10} ключей в топ-10</small></article>
        </section>

        <section className="overview2-portfolio" aria-label="Динамика и качество данных">
          <div className="overview2-portfolio-trend">
            <div className="overview2-section-heading"><div><h2>Портфельный тренд</h2><p>Количество ключевых слов в топ-10 по снимкам</p></div><strong>{totals.top10}</strong></div>
            <PortfolioTrend values={portfolioHistory} />
          </div>
          <div className="overview2-coverage">
            <span className="overview2-coverage-label">Качество данных</span>
            <strong>{apps.length ? `${totals.snapshots} / ${apps.length}` : '—'}</strong>
            <span>приложений со снимком</span>
            <div className="overview2-coverage-bar" aria-label={`Покрытие данными: ${apps.length ? Math.round((totals.snapshots / apps.length) * 100) : 0}%`}><i style={{ width: `${apps.length ? (totals.snapshots / apps.length) * 100 : 0}%` }} /></div>
          </div>
        </section>

        <div className="overview2-section-heading overview2-results-heading"><div><h2>Приложения</h2><p>Откройте карточку для позиций, ключевых слов и детальной аналитики.</p></div><span>{apps.length} всего</span></div>
        {apps.length === 0 ? (
          <div className="overview2-empty"><strong>Портфель пока пуст</strong><span>Добавьте приложение, чтобы начать собирать позиции.</span></div>
        ) : (
          <div className="overview2-grid">
            {apps.map((app) => {
              const locales = localeAvgByApp[app.id] ?? [];
              const movers = [...app.winners.slice(0, 1), ...app.losers.slice(0, 1)];
              const dataStatus = app.lastSnapshot ? 'Данные получены' : 'Нет снимка';

              return (
                <article className="overview2-card" key={app.id}>
                  <button className="overview2-card-open" type="button" onClick={() => onOpenApp(app.id)} aria-label={`Открыть ${app.name}`}>
                    <header className="overview2-card-header"><AppArtwork app={app} /><div><strong>{app.name}</strong><small>{app.keywords} ключей · {app.locales.length} регионов</small></div><span className={`overview2-data-status ${app.lastSnapshot ? 'overview2-data-status-ready' : 'overview2-data-status-empty'}`}>{dataStatus}</span></header>
                    <div className="overview2-card-metrics">
                      <span><b>{app.avgPos ? `#${Math.round(app.avgPos)}` : '—'}</b><small>ср. позиция</small><em className={(app.weekDelta.avg ?? 0) > 0 ? 'overview2-delta-up' : (app.weekDelta.avg ?? 0) < 0 ? 'overview2-delta-down' : ''}>{formatDelta(app.weekDelta.avg)}</em></span>
                      <span><b>{app.top10}</b><small>в топ-10</small><em className={(app.weekDelta.top10 ?? 0) > 0 ? 'overview2-delta-up' : (app.weekDelta.top10 ?? 0) < 0 ? 'overview2-delta-down' : ''}>{formatDelta(app.weekDelta.top10)}</em></span>
                      <span><b>{app.top50}</b><small>в топ-50</small><em className={(app.weekDelta.top50 ?? 0) > 0 ? 'overview2-delta-up' : (app.weekDelta.top50 ?? 0) < 0 ? 'overview2-delta-down' : ''}>{formatDelta(app.weekDelta.top50)}</em></span>
                    </div>
                    <div className="overview2-locales" aria-label="Регионы">
                      {locales.slice(0, 6).map((entry) => <span key={entry.code} title={`${entry.code.toUpperCase()}: ${entry.avg == null ? 'нет в выдаче' : `средняя позиция ${Math.round(entry.avg)}`}`}>{localeFlag(entry.code)} {entry.avg == null ? '—' : `#${Math.round(entry.avg)}`}</span>)}
                      {locales.length > 6 ? <span>+{locales.length - 6}</span> : null}
                      {!locales.length ? <span>Регионы ещё не обновлялись</span> : null}
                    </div>
                    {movers.length ? <div className="overview2-movers">{movers.map((mover) => <span key={`${mover.kw}-${mover.delta}`}><b className={mover.delta > 0 ? 'overview2-delta-up' : 'overview2-delta-down'}>{formatDelta(mover.delta)}</b>{mover.kw}<small>#{mover.from} → #{mover.to}</small></span>)}</div> : null}
                  </button>
                  <button className="ds-icon-btn overview2-delete" type="button" title={`Удалить ${app.name}`} aria-label={`Удалить ${app.name}`} onClick={() => onDeleteApp(app)}><Icon name="close" /></button>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export default Overview;
