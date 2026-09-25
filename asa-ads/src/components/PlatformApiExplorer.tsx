import { useEffect, useMemo, useState } from "react";
import { api, type PlatformApiMethod, type PlatformApiMethodsPayload } from "../api.ts";
import InfoTooltip from "./InfoTooltip.tsx";
import { useApp } from "../lib/AppContext.tsx";

const STATUS_LABEL: Record<PlatformApiMethod["status"], string> = {
  "live-read": "Подключён: только чтение",
  "catalog-only": "В каталоге: не вызывается",
  "not-integrated-read-only": "Не подключён",
};

/** An intentionally read-only catalogue. It is a transparency surface, never a
 * generic API console: the dashboard must not offer Apple Ads mutations without
 * an approved action in the queue. */
export default function PlatformApiExplorer() {
  const { selected } = useApp();
  const [data, setData] = useState<PlatformApiMethodsPayload | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [showCatalog, setShowCatalog] = useState(false);
  const [sourceStatus, setSourceStatus] = useState<Record<string, { status: string; error?: string }>>({});
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api.platformMethods().then(setData).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить каталог API");
    });
  }, []);

  const live = useMemo(() => (data?.methods ?? []).filter((item) => item.integrated && item.kind === "read"), [data]);
  const catalog = useMemo(() => (data?.methods ?? []).filter((item) => item.kind === "read" && !item.integrated)
    .filter((item) => !query || `${item.name} ${item.path} ${item.group}`.toLowerCase().includes(query.toLowerCase())), [data, query]);

  if (error) return <div className="data-state error">Каталог Apple Ads API недоступен: {error}</div>;
  if (!data) return <div className="data-state loading">Загружаем подключённые возможности Apple Ads API…</div>;

  async function checkLiveSources(): Promise<void> {
    if (selected === "all") return;
    setChecking(true);
    try {
      const [inventory, reports, suggestions] = await Promise.all([
        api.platformInventory(selected),
        api.platformReports(selected),
        api.platformSuggestions(selected),
      ]);
      const merge = (sources?: Record<string, { status: string; error?: string }>) => sources ?? {};
      setSourceStatus({ ...merge(inventory.sources), ...merge(reports.sources), ...merge(suggestions.sources) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось проверить источники Apple Ads API");
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="api-explorer" aria-labelledby="platform-api-title">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Прозрачность интеграции</div>
          <h3 id="platform-api-title">Apple Ads Platform API</h3>
        </div>
        <span className="status-chip neutral">Только чтение</span>
      </div>
      <p className="section-description">
        В кабинете активны только безопасные запросы. Изменения ставок, бюджетов и ключей появляются исключительно через очередь с подтверждением.
        <InfoTooltip title="Что означает «подключён»">«Подключён» — метод реально вызывается сервером и его результат попадает в экран аналитики. Каталог ниже — официальный справочник, а не обещание данных или доступ на запись.</InfoTooltip>
      </p>
      <div className="api-summary" aria-label="Сводка API">
        <div><strong>{live.length}</strong><span>подключено</span></div>
        <div><strong>{data.totals.reads}</strong><span>методов только для чтения</span></div>
        <div><strong>{data.totals.mutations}</strong><span>методы записи исключены</span></div>
        <div><strong>{data.generatedFromOfficialDocs}</strong><span>срез документации</span></div>
      </div>

      <div className="api-live-list">
        {live.map((item) => <ApiMethodRow key={item.id} item={item} />)}
      </div>

      <div className="api-check-row">
        <div>
          <strong>Статус живых источников</strong>
          <span>Проверяет инвентарь, отчёты и рекомендации без записи в Apple Ads.</span>
        </div>
        <button type="button" onClick={() => void checkLiveSources()} disabled={checking || selected === "all"}>
          {checking ? "Проверяем…" : "Проверить источники"}
        </button>
      </div>
      {selected === "all" ? <div className="api-status-note">Для точной проверки выберите одно приложение. Каталог методов доступен всегда.</div> : Object.keys(sourceStatus).length > 0 && (
        <div className="source-status-grid" aria-live="polite">
          {Object.entries(sourceStatus).map(([name, source]) => <div key={name} className={`source-status ${source.status}`}><strong>{sourceLabel(name)}</strong><span>{sourceStatusLabel(source.status)}{source.error ? ` · ${source.error}` : ""}</span></div>)}
        </div>
      )}

      <details className="api-catalog" onToggle={(event) => setShowCatalog((event.target as HTMLDetailsElement).open)}>
        <summary>Открыть справочник доступных read-only методов ({data.totals.reads - live.length})</summary>
        {showCatalog && (
          <>
            <input aria-label="Поиск по справочнику API" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти метод или путь" />
            <div className="api-catalog-list">
              {catalog.map((item) => <ApiMethodRow key={item.id} item={item} compact />)}
              {catalog.length === 0 && <div className="data-state">Нет методов по этому фильтру.</div>}
            </div>
          </>
        )}
      </details>
    </section>
  );
}

function sourceLabel(source: string): string {
  return ({
    account: "Аккаунт", appDetails: "Приложение", eligibility: "Допуск", supportedLanguages: "Языки", localeDetails: "Локали",
    campaigns: "Кампании", adGroups: "Группы объявлений", keywords: "Ключи", negativeKeywords: "Минус-слова", ads: "Объявления",
    creatives: "Креативы", productPages: "Страницы продукта", assets: "Материалы", reports: "Отчёты", suggestions: "Подсказки",
  } as Record<string, string>)[source] ?? source;
}

function sourceStatusLabel(status: string): string {
  return ({
    live: "получено напрямую", fresh: "свежий кэш", "stale-if-error": "предыдущие данные при ошибке", unavailable: "недоступно", error: "ошибка источника",
  } as Record<string, string>)[status] ?? status;
}

function ApiMethodRow({ item, compact = false }: { item: PlatformApiMethod; compact?: boolean }) {
  return (
    <div className={`api-method ${compact ? "compact" : ""}`}>
      <div className="api-method-main">
        <span className="http-method">{item.method}</span>
        <div><strong>{item.name}</strong><code>{item.path}</code></div>
      </div>
      <div className="api-method-meta">
        <span className={`status-chip ${item.integrated ? "positive" : "neutral"}`}>{STATUS_LABEL[item.status]}</span>
        <a href={item.docsUrl} target="_blank" rel="noreferrer">Документация</a>
      </div>
    </div>
  );
}
