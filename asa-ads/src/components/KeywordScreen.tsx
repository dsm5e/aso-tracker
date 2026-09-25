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
        {/* The app is picked once, in the sidebar; this line only says where organic
            and top-5 come from when that differs from the metrics' scope. */}
        {app && locale && (isWorld || !countryTracked) && (
          <div className="kw-screen-context">
            <span className="kw-screen-hint kw-screen-organic">
              Органика и топ‑5: {organicLabel} · {isWorld ? "метрики — весь мир" : `${label} не отслеживается в Keywords`}
            </span>
          </div>
        )}
        {body}
      </div>
    </ConnectGate>
  );
}
