import './DataQuality.css';

export type DataQualityStatus = 'ok' | 'stale' | 'missing' | 'error';
export type DataQualityKind = 'fact' | 'model';

export interface DataQualitySource {
  /** Название набора или внешнего источника. */
  name: string;
  /** Состояние доступности и свежести данных. */
  status: DataQualityStatus;
  /** Время последнего успешного обновления (ISO-строка, timestamp или Date). */
  updatedAt?: string | number | Date | null;
  /** Период, к которому относятся данные, например «1–31 августа». */
  window?: string | null;
  /** Покрытие: строка для произвольного текста либо доля в процентах. */
  coverage?: string | number | null;
  /** Факт из источника либо расчётная модель. */
  kind?: DataQualityKind;
  /** Короткое пояснение причины статуса или ограничения. */
  message?: string | null;
}

export interface DataQualityProps {
  sources: DataQualitySource[];
  title?: string;
  className?: string;
}

const statusCopy: Record<DataQualityStatus, string> = {
  ok: 'Актуально',
  stale: 'Требует обновления',
  missing: 'Нет данных',
  error: 'Ошибка получения',
};

const kindCopy: Record<DataQualityKind, string> = {
  fact: 'Факт',
  model: 'Модель',
};

function formatUpdatedAt(value: DataQualitySource['updatedAt']): string | null {
  if (value === null || value === undefined || value === '') return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatCoverage(value: DataQualitySource['coverage']): string | null {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'number' ? `${Math.round(value)}%` : value;
}

/** Компактный, не завязанный на API индикатор происхождения и свежести данных. */
export function DataQuality({ sources, title = 'Качество данных', className }: DataQualityProps) {
  const rootClassName = ['data-quality', className].filter(Boolean).join(' ');

  return (
    <section className={rootClassName} aria-label={title}>
      <header className="data-quality-header">
        <div>
          <h2 className="data-quality-title">{title}</h2>
          <p className="data-quality-caption">Статус источников и ограничения расчётов</p>
        </div>
        <span className="data-quality-count" aria-label={`Источников: ${sources.length}`}>{sources.length}</span>
      </header>

      {sources.length === 0 ? (
        <p className="data-quality-empty">Источники данных пока не подключены.</p>
      ) : (
        <ul className="data-quality-list">
          {sources.map((source, index) => {
            const updatedAt = formatUpdatedAt(source.updatedAt);
            const coverage = formatCoverage(source.coverage);
            const kind = source.kind ?? 'fact';

            return (
              <li className="data-quality-item" key={`${source.name}-${index}`}>
                <span className={`data-quality-status data-quality-status-${source.status}`} aria-label={statusCopy[source.status]} />
                <div className="data-quality-source">
                  <strong>{source.name}</strong>
                  {source.message ? <small>{source.message}</small> : null}
                </div>
                <div className="data-quality-meta">
                  <span className={`data-quality-kind data-quality-kind-${kind}`}>{kindCopy[kind]}</span>
                  {updatedAt ? <span title="Последнее обновление">{updatedAt}</span> : null}
                  {source.window ? <span title="Период данных">{source.window}</span> : null}
                  {coverage ? <span title="Покрытие">Покрытие: {coverage}</span> : null}
                </div>
                <span className={`data-quality-badge data-quality-badge-${source.status}`}>{statusCopy[source.status]}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default DataQuality;
