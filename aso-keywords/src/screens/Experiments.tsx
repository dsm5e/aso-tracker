import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type AsoExperiment, type AsoExperimentStatus, type MetadataHistoryPayload, type MetadataSnapshot } from '../api';
import './Experiments.css';

export interface ExperimentsProps {
  app: { id: string; name: string };
  locales: string[];
  activeLocale: string;
}

type LoadState = 'loading' | 'ready' | 'error';

const statusLabel: Record<AsoExperimentStatus, string> = {
  draft: 'Черновик',
  scheduled: 'Запланирован',
  running: 'Идёт',
  completed: 'Завершён',
};

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function sourceLabel(source: MetadataSnapshot['source']) {
  return source === 'manual_asc_export' ? 'ручной экспорт App Store Connect' : 'публичная карточка App Store';
}

function snapshotText(snapshot: MetadataSnapshot, field: 'title' | 'subtitle' | 'keywords') {
  const value = snapshot[field];
  return value?.trim() || '—';
}

export default function Experiments({ app, locales, activeLocale }: ExperimentsProps) {
  const [scope, setScope] = useState<'all' | string>('all');
  const [snapshots, setSnapshots] = useState<MetadataSnapshot[]>([]);
  const [metadataCapability, setMetadataCapability] = useState<MetadataHistoryPayload['capability'] | null>(null);
  const [experiments, setExperiments] = useState<AsoExperiment[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showExperimentForm, setShowExperimentForm] = useState(false);
  const [showSnapshotForm, setShowSnapshotForm] = useState(false);
  const [experimentName, setExperimentName] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [experimentLocale, setExperimentLocale] = useState(activeLocale || locales[0] || 'us');
  const [metadataLocale, setMetadataLocale] = useState(activeLocale || locales[0] || 'us');
  const [metadataTitle, setMetadataTitle] = useState('');
  const [metadataSubtitle, setMetadataSubtitle] = useState('');
  const [metadataKeywords, setMetadataKeywords] = useState('');

  const availableLocales = useMemo(() => [...new Set(locales.map((locale) => locale.toLowerCase()))].sort(), [locales]);

  const effectiveScope = scope !== 'all' && availableLocales.includes(scope) ? scope : 'all';

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const locale = effectiveScope === 'all' ? undefined : effectiveScope;
      const [history, rawExperiments] = await Promise.all([
        api.metadataHistory(app.id, locale),
        api.asoExperiments(app.id),
      ]);
      setSnapshots(history.history);
      setMetadataCapability(history.capability);
      setExperiments((rawExperiments.experiments ?? []).filter((experiment) => (
        effectiveScope === 'all' || experiment.locales.some((item) => item.toLowerCase() === effectiveScope)
      )));
      setState('ready');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить журнал ASO.');
      setState('error');
    }
  }, [app.id, effectiveScope]);

  useEffect(() => {
    // Schedule the asynchronous source sync after paint. This keeps the
    // current view stable while a new market/app scope is being requested.
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const addExperiment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!experimentName.trim() || !experimentLocale) return;
    setSaving(true);
    try {
      await api.createAsoExperiment(app.id, {
        name: experimentName.trim(),
        hypothesis: hypothesis.trim() || null,
        status: 'draft',
        locales: [experimentLocale],
        metadataChanges: [],
        notes: null,
        beforeStart: null,
        beforeEnd: null,
        afterStart: null,
        afterEnd: null,
      });
      setExperimentName('');
      setHypothesis('');
      setShowExperimentForm(false);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось создать эксперимент.');
    } finally { setSaving(false); }
  };

  const addSnapshot = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!metadataLocale || !metadataTitle.trim()) return;
    setSaving(true);
    try {
      await api.addMetadataSnapshot(app.id, {
        locale: metadataLocale,
        observedAt: new Date().toISOString(),
        title: metadataTitle.trim(),
        subtitle: metadataSubtitle.trim() || null,
        keywords: metadataKeywords.trim() || null,
        source: 'manual_asc_export',
      });
      setMetadataTitle('');
      setMetadataSubtitle('');
      setMetadataKeywords('');
      setShowSnapshotForm(false);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить снимок метаданных.');
    } finally { setSaving(false); }
  };

  const changeStatus = async (experiment: AsoExperiment, status: AsoExperimentStatus) => {
    setSaving(true);
    try {
      await api.updateAsoExperiment(app.id, experiment.id, { status });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось изменить статус эксперимента.');
    } finally { setSaving(false); }
  };

  const archive = async (experiment: AsoExperiment) => {
    setSaving(true);
    try {
      await api.archiveAsoExperiment(app.id, experiment.id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось отправить эксперимент в архив.');
    } finally { setSaving(false); }
  };

  const capturePublicMetadata = async () => {
    if (!metadataLocale) return;
    setSaving(true);
    try {
      const result = await api.captureMetadataSnapshot(app.id, metadataLocale, true);
      if (result.error) throw new Error(result.error);
      setShowSnapshotForm(false);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось получить публичные метаданные.');
    } finally { setSaving(false); }
  };

  const latestByLocale = useMemo(() => {
    const latest = new Map<string, MetadataSnapshot>();
    [...snapshots]
      .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))
      .forEach((snapshot) => { if (!latest.has(snapshot.locale)) latest.set(snapshot.locale, snapshot); });
    return [...latest.values()];
  }, [snapshots]);

  return (
    <main className="experiments-workspace">
      <header className="experiments-header">
        <div>
          <span className="experiments-eyebrow">ASO · журнал изменений</span>
          <h1>Метаданные и эксперименты</h1>
          <p>{app.name} · фиксируйте изменения до публикации и сравнивайте одинаковые окна до/после.</p>
        </div>
        <div className="experiments-actions">
          <label><span className="experiments-sr-only">Витрина</span><select value={effectiveScope} onChange={(event) => setScope(event.target.value)}><option value="all">Все витрины</option>{availableLocales.map((locale) => <option key={locale} value={locale}>{locale.toUpperCase()}</option>)}</select></label>
          <button type="button" onClick={() => setShowSnapshotForm((open) => !open)}>Зафиксировать ASC экспорт</button>
          <button type="button" className="experiments-primary" onClick={() => setShowExperimentForm((open) => !open)}>Новый эксперимент</button>
        </div>
      </header>

      <div className="experiments-body">
        <section className="experiments-note">
          <strong>Как читать журнал</strong>
          <span>Снимок — неизменяемая запись title, subtitle и keyword field. Эксперимент не доказывает причинность сам по себе: решение принимается по одинаковым окнам позиций, показов, установок и когортной экономики.</span>
        </section>

        {showExperimentForm ? <form className="experiments-form" onSubmit={addExperiment}>
          <header><h2>Новый ASO-эксперимент</h2><button type="button" onClick={() => setShowExperimentForm(false)} aria-label="Закрыть форму">×</button></header>
          <label>Название<input value={experimentName} onChange={(event) => setExperimentName(event.target.value)} placeholder="Например: DICOM в subtitle" required /></label>
          <label>Витрина<select value={experimentLocale} onChange={(event) => setExperimentLocale(event.target.value)}>{availableLocales.map((locale) => <option key={locale} value={locale}>{locale.toUpperCase()}</option>)}</select></label>
          <label>Гипотеза<textarea value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} placeholder="Какое изменение и какой сигнал должны улучшиться" /></label>
          <footer><button type="button" onClick={() => setShowExperimentForm(false)}>Отмена</button><button className="experiments-primary" disabled={saving}>Создать</button></footer>
        </form> : null}

        {showSnapshotForm ? <form className="experiments-form" onSubmit={addSnapshot}>
          <header><h2>Снимок метаданных</h2><button type="button" onClick={() => setShowSnapshotForm(false)} aria-label="Закрыть форму">×</button></header>
          <label>Витрина<select value={metadataLocale} onChange={(event) => setMetadataLocale(event.target.value)}>{availableLocales.map((locale) => <option key={locale} value={locale}>{locale.toUpperCase()}</option>)}</select></label>
          <label>Title<input value={metadataTitle} onChange={(event) => setMetadataTitle(event.target.value)} required /></label>
          <label>Subtitle<input value={metadataSubtitle} onChange={(event) => setMetadataSubtitle(event.target.value)} /></label>
          <label>Keyword field<textarea value={metadataKeywords} onChange={(event) => setMetadataKeywords(event.target.value)} /></label>
          <footer><button type="button" onClick={() => void capturePublicMetadata()} disabled={saving}>Получить публичную карточку</button><button type="button" onClick={() => setShowSnapshotForm(false)}>Отмена</button><button className="experiments-primary" disabled={saving}>Сохранить ASC экспорт</button></footer>
        </form> : null}

        {state === 'loading' ? <div className="experiments-state" aria-live="polite"><i /><strong>Загружаем журнал ASO…</strong></div> : null}
        {state === 'error' ? <div className="experiments-state experiments-state-error" role="alert"><strong>Журнал временно недоступен</strong><span>{error}</span><button type="button" onClick={() => void load()}>Повторить</button></div> : null}
        {error && state === 'ready' ? <div className="experiments-inline-error" role="status">Последнее действие не выполнено: {error}</div> : null}

        {state === 'ready' ? <>
          <section className="experiments-panel">
            <header className="experiments-section-heading"><div><h2>Эксперименты</h2><p>Никакие изменения в App Store Connect отсюда не публикуются.</p></div><span>{experiments.filter((item) => !item.archivedAt).length}</span></header>
            {experiments.length ? <div className="experiments-list">{experiments.map((experiment) => <article key={experiment.id} className="experiments-item">
              <div className="experiments-item-main"><div><span className={`experiments-status ${experiment.archivedAt ? 'experiments-status-archived' : `experiments-status-${experiment.status}`}`}>{experiment.archivedAt ? 'В архиве' : statusLabel[experiment.status]}</span><span className="experiments-locale">{experiment.locales.length ? experiment.locales.map((item) => item.toUpperCase()).join(', ') : '—'}</span></div><strong>{experiment.name}</strong>{experiment.hypothesis ? <p>{experiment.hypothesis}</p> : <small>Гипотеза не указана</small>}</div>
              <div className="experiments-window"><span>До: {formatDate(experiment.beforeStart)} — {formatDate(experiment.beforeEnd)}</span><span>После: {formatDate(experiment.afterStart)} — {formatDate(experiment.afterEnd)}</span></div>
              <div className="experiments-item-actions"><select value={experiment.status} onChange={(event) => void changeStatus(experiment, event.target.value as AsoExperimentStatus)} disabled={saving || Boolean(experiment.archivedAt)} aria-label={`Статус эксперимента ${experiment.name}`}>{(Object.keys(statusLabel) as AsoExperimentStatus[]).map((status) => <option key={status} value={status}>{statusLabel[status]}</option>)}</select>{!experiment.archivedAt ? <button type="button" onClick={() => void archive(experiment)} disabled={saving}>В архив</button> : null}</div>
            </article>)}</div> : <div className="experiments-empty"><strong>Экспериментов пока нет</strong><span>Зафиксируйте гипотезу до изменения metadata, paywall или CPP.</span></div>}
          </section>

          <section className="experiments-panel">
            <header className="experiments-section-heading"><div><h2>Последние метаданные по витринам</h2><p>Последний неизменяемый снимок для каждой витрины в выбранном срезе.</p></div><span>{latestByLocale.length}</span></header>
            {metadataCapability ? <p className="experiments-capability"><strong>Публично доступны:</strong> {metadataCapability.publicFields.join(', ') || '—'}. <strong>Закрыты:</strong> {metadataCapability.unavailablePublicFields.join(', ') || '—'}.</p> : null}
            {latestByLocale.length ? <div className="experiments-table-wrap"><table className="experiments-table"><thead><tr><th>Витрина</th><th>Зафиксировано</th><th>Title</th><th>Subtitle</th><th>Keyword field</th><th>Источник</th></tr></thead><tbody>{latestByLocale.map((snapshot) => <tr key={snapshot.id}><td><strong>{snapshot.locale.toUpperCase()}</strong></td><td>{formatDate(snapshot.observedAt)}</td><td title={snapshotText(snapshot, 'title')}>{snapshotText(snapshot, 'title')}</td><td title={snapshotText(snapshot, 'subtitle')}>{snapshotText(snapshot, 'subtitle')}</td><td title={snapshotText(snapshot, 'keywords')}>{snapshotText(snapshot, 'keywords')}</td><td title={snapshot.sourceUrl ?? sourceLabel(snapshot.source)}>{sourceLabel(snapshot.source)}</td></tr>)}</tbody></table></div> : <div className="experiments-empty"><strong>Снимков метаданных пока нет</strong><span>Импортируйте публичную карточку или зафиксируйте экспорт из App Store Connect.</span></div>}
          </section>
        </> : null}
      </div>
    </main>
  );
}
