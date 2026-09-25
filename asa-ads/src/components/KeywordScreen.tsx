import type { ReactNode } from "react";
import ConnectGate from "./ConnectGate.tsx";
import { useKeywordsBridge, type KeywordsBridge } from "../lib/useKeywordsBridge.ts";
import { useCountry } from "../lib/CountryContext.tsx";
import { countryFlag, countryNameRu } from "../lib/countries.ts";

// Shell for the keyword-level screens that read the Keywords product's data:
// «Подключить» gate (Apple Ads keys), app context, and the .kw-scope wrapper
// that supplies the keyword components' token names. The storefront comes
// from the global «Страна» filter in the sidebar.

export default function KeywordScreen({ title, children }: { title: string; children: (bridge: KeywordsBridge & { app: NonNullable<KeywordsBridge["app"]> }) => ReactNode }) {
  const bridge = useKeywordsBridge();
  const { app, candidates, locale, countryTracked } = bridge;
  const { isWorld, label } = useCountry();
  const organicCode = locale.split("-")[0].toUpperCase();
  const organicLabel = locale ? `${countryFlag(organicCode)} ${countryNameRu(organicCode)}` : "—";

  let body: ReactNode;
  if (bridge.status === "loading") body = <div className="kw-screen-note">Загружаем приложения из Keywords…</div>;
  else if (bridge.status === "error") body = <div className="kw-screen-note kw-screen-error">Сервер Keywords недоступен ({bridge.error}). Экран берёт позиции и ключи из Keywords — запустите студию целиком.</div>;
  else if (!app) body = <div className="kw-screen-note">Это приложение не отслеживается в Keywords. Добавьте его в Keywords или выберите другое: {candidates.map((c) => c.name).join(", ") || "—"}.</div>;
  else if (!locale) body = <div className="kw-screen-note">Загружаем витрины…</div>;
  else body = children({ ...bridge, app });

  return (
    <ConnectGate requires={["asa"]} title={title}>
      <div className="kw-scope kw-screen">
        {candidates.length > 0 && (
          <div className="kw-screen-context">
            <label>
              <span>Приложение</span>
              <select className="ds-select" value={app?.id ?? ""} onChange={(e) => bridge.selectApp(e.target.value)}>
                {!app && <option value="">—</option>}
                {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            {app && locale && (
              <span
                className="kw-screen-hint kw-screen-organic"
                title={isWorld
                  ? "Метрики — все страны; органика и топ‑5 — витрина по умолчанию из Keywords"
                  : countryTracked
                    ? "Органика и топ‑5 — выбранная страна (отслеживается в Keywords)"
                    : `${label} не отслеживается в Keywords: органика и топ‑5 — витрина по умолчанию`}
              >
                Органика и топ‑5: {organicLabel}{!isWorld && !countryTracked ? ` · ${label} не отслеживается в Keywords` : ""}
              </span>
            )}
          </div>
        )}
        {body}
      </div>
    </ConnectGate>
  );
}
