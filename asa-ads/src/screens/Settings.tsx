import { useEffect, useState, type ReactNode } from "react";
import InfoTooltip from "../components/InfoTooltip.tsx";
import CredentialsCard from "../components/CredentialsCard.tsx";
import PlatformApiExplorer from "../components/PlatformApiExplorer.tsx";
import { useApp } from "../lib/AppContext.tsx";
import { apiUrl, sseUrl } from "../lib/apiBase.ts";

interface Settings {
  target_cpi_tier1: number;
  target_cpi_tier2: number;
  ltv_per_paid: number;
  trial_to_paid_rate: number;
  min_spend_for_signal: number;
  min_installs_for_signal: number;
  min_days_for_signal: number;
  alert_cpi_threshold: number;
  alert_spend_no_install: number;
  alert_interval_min: number;
}

interface Suggestion { value: number; basis: string }
type Suggestions = Partial<Record<keyof Settings, Suggestion>>;

interface LabelDef {
  key: keyof Settings;
  label: string;
  hint: string;
  group: string;
  autoSuggestable: boolean;
  details: ReactNode;
}

const LABELS: LabelDef[] = [
  {
    key: "ltv_per_paid",
    label: "LTV на платящего пользователя ($)",
    hint: "Сколько денег приносит один платный подписчик",
    group: "Экономика и прогноз",
    autoSuggestable: true,
    details: (
      <>
        <p><strong>LTV = Lifetime Value.</strong> Сколько денег принесёт один платящий юзер за всё время, пока не отпишется.</p>
        <p>Используется в формуле: <code>projected_paid × LTV = projected_revenue</code></p>
        <p className="note">Реальная выручка per-keyword тянется из AdServices-атрибуции × Adapty revenue (поле «ROAS so far»). LTV здесь — множитель forward-проекции будущих renewals; realized ROAS детерминистичен, без Adapty paid integration.</p>
      </>
    ),
  },
  {
    key: "trial_to_paid_rate",
    label: "Конверсия триал → оплата (0–1)",
    hint: "Доля триалов которая стала платными",
    group: "Экономика и прогноз",
    autoSuggestable: true,
    details: (
      <>
        <p><strong>Trial → Paid Conversion Rate.</strong> Какой процент людей оплачивает после бесплатного триала.</p>
        <p>✅ <strong>Автосчитается</strong> из ASC events: <code>Subscribe ÷ Start Introductory Offer</code> за последние 90 дней (минус ~50% Cancel как refunds).</p>
      </>
    ),
  },
  {
    key: "target_cpi_tier1",
    label: "Целевой CPI, Tier-1 ($)",
    hint: "Бюджет на установку в богатых странах",
    group: "Экономика и прогноз",
    autoSuggestable: true,
    details: (
      <>
        <p>🇺🇸 🇬🇧 🇩🇪 🇫🇷 🇨🇦 🇦🇺 🇯🇵 🇨🇭 🇳🇱 🇸🇪 🇳🇴 🇩🇰 🇫🇮 🇮🇪</p>
        <p>Используется в bid recommendations: CPI ниже target × 0.7 → <span className="roi scale">SCALE</span>; выше × 1.5 → <span className="roi cut">CUT</span>.</p>
        <p>✅ <strong>Автосчитается</strong> как <code>LTV × trial→paid × 0.25</code> (safe ROI 200%+, с поправкой на install→trial rate).</p>
      </>
    ),
  },
  {
    key: "target_cpi_tier2",
    label: "Целевой CPI, Tier-2/3 ($)",
    hint: "То же для развивающихся рынков",
    group: "Экономика и прогноз",
    autoSuggestable: true,
    details: (
      <>
        <p>🇧🇷 🇹🇷 🇲🇽 🇸🇦 🇰🇷 🇮🇩 🇮🇳 🇹🇼 🇮🇱 и др.</p>
        <p>✅ <strong>Автосчитается</strong> как <code>tier-1 × 0.6</code> (ниже LTV из-за меньшей покупательной способности).</p>
      </>
    ),
  },
  {
    key: "min_spend_for_signal",
    label: "Минимальные траты для сигнала ($)",
    hint: "Меньше — данные ненадёжны",
    group: "Достоверность данных",
    autoSuggestable: false,
    details: (
      <>
        <p>Если spend меньше этого числа → ROI engine ставит <span className="badge warn">insufficient</span>.</p>
        <p className="note">Это твой <strong>осознанный выбор</strong> уровня риска. Низкий = решаем быстро (рискованно), высокий = ждём (безопасно).</p>
      </>
    ),
  },
  {
    key: "min_installs_for_signal",
    label: "Минимум установок для сигнала",
    hint: "Минимум installs",
    group: "Достоверность данных",
    autoSuggestable: false,
    details: <p>1 install = случайность. 5 = тренд. 15+ = надёжная статистика. Default 5 → medium confidence.</p>,
  },
  {
    key: "min_days_for_signal",
    label: "Минимум дней для сигнала",
    hint: "Минимум дней работы",
    group: "Достоверность данных",
    autoSuggestable: false,
    details: <p>Apple ASA имеет learning period 24-72ч. Меньше — данные нестабильные.</p>,
  },
  {
    key: "alert_cpi_threshold",
    label: "Порог оповещения по CPI ($)",
    hint: "Выше — Telegram alert",
    group: "Оповещения",
    autoSuggestable: true,
    details: (
      <>
        <p>7-дневный CPI выше → <span className="badge bad">💸 High CPI</span> alert в TG.</p>
        <p>✅ <strong>Автосчитается</strong> как <code>target CPI tier-1 × 2</code>.</p>
      </>
    ),
  },
  {
    key: "alert_spend_no_install",
    label: "Порог слива бюджета ($)",
    hint: "Spend без installs",
    group: "Оповещения",
    autoSuggestable: true,
    details: (
      <>
        <p>Spend за день больше этого + 0 installs → <span className="badge bad">🔥 Burn</span> alert.</p>
        <p>✅ <strong>Автосчитается</strong> как <code>target CPI tier-1 × 5</code>.</p>
      </>
    ),
  },
  {
    key: "alert_interval_min",
    label: "Интервал проверки оповещений (мин)",
    hint: "Как часто проверять",
    group: "Оповещения",
    autoSuggestable: false,
    details: <p>Default 30 мин — баланс между скоростью реакции и нагрузкой.</p>,
  },
];

const STEP: Record<keyof Settings, number> = {
  target_cpi_tier1: 0.1, target_cpi_tier2: 0.1, ltv_per_paid: 1, trial_to_paid_rate: 0.05,
  min_spend_for_signal: 0.5, min_installs_for_signal: 1, min_days_for_signal: 1,
  alert_cpi_threshold: 0.1, alert_spend_no_install: 0.5, alert_interval_min: 5,
};

export default function SettingsPage() {
  const { selected, apps } = useApp();
  const [s, setS] = useState<Settings | null>(null);
  const [sug, setSug] = useState<Suggestions>({});
  const [pending, setPending] = useState<Partial<Settings>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string>("");
  const [suggestedAt, setSuggestedAt] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);

  const appQuery = selected === "all" ? "" : `?app_id=${selected}`;
  const currentAppName = selected === "all" ? "Все приложения" : apps.find((a) => a.app_id === selected)?.app_name?.split(":")[0] || `Приложение ${selected}`;

  async function loadAll(): Promise<void> {
    const [a, b] = await Promise.all([
      fetch(apiUrl(`/api/settings${appQuery}`)).then((r) => r.json()),
      fetch(apiUrl(`/api/settings/suggest${appQuery}`)).then((r) => r.json()),
    ]);
    setS(a);
    setSug(b);
    setSuggestedAt(new Date());
  }

  async function recomputeSuggestions(): Promise<void> {
    setRefreshing(true);
    try {
      const b = await fetch(apiUrl(`/api/settings/suggest${appQuery}`)).then((r) => r.json());
      setSug(b);
      setSuggestedAt(new Date());
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => { void loadAll(); }, [selected]);

  // Listen for sync done to refresh suggestions automatically
  useEffect(() => {
    const es = new EventSource(sseUrl());
    const onSync = (): void => { void recomputeSuggestions(); };
    es.addEventListener("sync:done", onSync);
    return () => {
      es.removeEventListener("sync:done", onSync);
      es.close();
    };
  }, []);

  if (!s) return <div className="data-state loading">Загружаем настройки…</div>;

  const groups = [...new Set(LABELS.map((l) => l.group))];

  async function save(): Promise<void> {
    if (Object.keys(pending).length === 0) return;
    setSaving(true);
    try {
      const res = await fetch(apiUrl(`/api/settings${appQuery}`), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pending),
      });
      const next = await res.json();
      setS(next);
      setPending({});
      setSavedAt(new Date().toLocaleTimeString());
      void loadAll();
    } finally {
      setSaving(false);
    }
  }

  function applyAllSuggestions(): void {
    const next: Partial<Settings> = {};
    for (const l of LABELS) {
      if (!l.autoSuggestable) continue;
      const su = sug[l.key];
      if (su && su.value !== s![l.key]) next[l.key] = su.value as Settings[typeof l.key];
    }
    setPending((p) => ({ ...p, ...next }));
  }

  const dirty = Object.keys(pending).length > 0;

  function val(k: keyof Settings): number {
    return pending[k] !== undefined ? Number(pending[k]) : s![k];
  }

  const autoCount = LABELS.filter((l) => l.autoSuggestable && sug[l.key] && sug[l.key]!.value !== s[l.key]).length;

  return (
    <>
      <div className="topbar">
        <div>
          <h1 className="ds-page-title">Настройки · <span className="accent-text">{currentAppName}</span></h1>
          <p className="ds-page-sub">
            {selected === "all"
              ? "Общие значения применяются, когда для конкретного приложения нет переопределения. Пороги достоверности общие."
              : "Переопределение для приложения. Если значение не задано, используется общее; переключите приложение слева для редактирования другого профиля."}
          </p>
        </div>
        <div className="controls">
          <button onClick={recomputeSuggestions} disabled={refreshing} title="Recompute suggestions from latest data">
            {refreshing ? "Считаем…" : "↺ Пересчитать"}
          </button>
          {autoCount > 0 ? (
            <button onClick={applyAllSuggestions} title="Apply all auto-suggested values">
              Принять {autoCount} рекомендац{autoCount === 1 ? "ию" : "ии"}
            </button>
          ) : (
            <span className="meta good">✓ значения синхронизированы</span>
          )}
          {savedAt && !dirty && <span className="meta">сохранено · {savedAt}</span>}
          {dirty && <span className="meta warn">изменений: {Object.keys(pending).length}</span>}
          <button className="primary" onClick={save} disabled={!dirty || saving}>
            {saving ? "Сохраняем…" : "Сохранить изменения"}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="hint settings-legend">
          <div>
            ✅ <strong>автосчитается</strong> из реальных данных · ⚙ <strong>твой бизнес-выбор</strong> · <span className="info-tooltip-glyph">?</span> детали
          </div>
          <div className="note">
            рекомендации: {suggestedAt.toLocaleTimeString()} · обновляются после синхронизации
          </div>
        </div>
      </div>

      {autoCount === 0 && (
        <div className="callout callout-block">
          <div>
            <strong>Кнопка apply скрыта потому что все auto-параметры совпадают с твоими.</strong> Появится когда:
            <ul className="callout-list">
              <li>придут новые данные после <code>npm run sync</code> или Sync now (хук на SSE — обновится автоматом)</li>
              <li>изменится trial→paid CR (новые ASC события)</li>
              <li>сменишь LTV вручную → пересчитаются target CPI / alert thresholds</li>
              <li>нажмёшь ↺ recompute сверху</li>
            </ul>
          </div>
        </div>
      )}

      <h2 className="ds-h2">Учётные данные API</h2>
      <CredentialsCard
        provider="asa"
        title="Apple Ads"
        description="OAuth-учётные данные и ES256-ключ для Apple Ads API"
        helpUrl="https://developer.apple.com/documentation/apple_search_ads/implementing_oauth_for_the_apple_search_ads_api"
      />
      <CredentialsCard
        provider="asc"
        title="App Store Connect"
        description="Ключ API для отчётов подписок; нужен для сверки триалов и оплат"
        helpUrl="https://developer.apple.com/documentation/appstoreconnectapi/creating_api_keys_for_app_store_connect_api"
      />

      {groups.map((g) => (
        <div key={g}>
          <h2 className="ds-h2">{g}</h2>
          <div className="table-wrap section-block">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Параметр</th>
                <th className="num">Текущее</th>
                <th className="num">Рекомендация</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {LABELS.filter((l) => l.group === g).map((l) => {
                const su = sug[l.key];
                const different = su && Math.abs(su.value - s[l.key]) > 0.001;
                return (
                  <tr key={l.key}>
                    <td>
                      <div className="row settings-param">
                        <span className={l.autoSuggestable ? "" : "muted"}>
                          {l.autoSuggestable ? "✅ " : "⚙ "}{l.label}
                        </span>
                        <InfoTooltip title={l.label}>{l.details}</InfoTooltip>
                      </div>
                      <div className="note">{l.hint}</div>
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        step={STEP[l.key]}
                        value={val(l.key)}
                        onChange={(e) => setPending((p) => ({ ...p, [l.key]: Number(e.target.value) }))}
                        className="settings-input"
                      />
                    </td>
                    <td className="num">
                      {su ? (
                        <div className="col settings-suggest">
                          <span className={different ? "good" : "muted"}>{su.value}</span>
                          <span className="note" title={su.basis}>
                            {su.basis.length > 38 ? su.basis.slice(0, 38) + "…" : su.basis}
                          </span>
                        </div>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td>
                      {su && different && (
                        <button
                          className="compact"
                          onClick={() => setPending((p) => ({ ...p, [l.key]: su.value }))}
                          title={`Apply suggested ${su.value}`}
                        >↺ Принять</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      ))}

      <div className="hint">
        <strong>Auto-suggested values</strong> пересчитываются на каждое открытие страницы из <code>asc_events_daily</code> + текущего LTV. Не применяются автоматически — ты решаешь.
      </div>

      <h2 className="ds-h2">Подключённые возможности API</h2>
      <PlatformApiExplorer />
    </>
  );
}
