import type { ReactNode } from "react";
import ConnectGate from "./ConnectGate.tsx";
import { useKeywordsBridge, type KeywordsBridge } from "../lib/useKeywordsBridge.ts";
import { APP_STORE_LOCALES } from "../lib/appStoreLocales.ts";

// Shell for the keyword-level screens that read the Keywords product's data:
// «Подключить» gate (Apple Ads keys), app + storefront context, and the
// .kw-scope wrapper that supplies the keyword components' token names.

const LOCALE_NAMES = new Map(APP_STORE_LOCALES.map((l) => [l.code, l.name]));

function flag(code: string): string {
  const country = code.split("-")[0].toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return "🌐";
  return String.fromCodePoint(...[...country].map((c) => c.charCodeAt(0) + 127397));
}

export default function KeywordScreen({ title, children }: { title: string; children: (bridge: KeywordsBridge & { app: NonNullable<KeywordsBridge["app"]> }) => ReactNode }) {
  const bridge = useKeywordsBridge();
  const { app, candidates, locales, locale } = bridge;

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
            {app && locales.length > 0 && (
              <label>
                <span>Витрина</span>
                <select className="ds-select" value={locale} onChange={(e) => bridge.setLocale(e.target.value)}>
                  {locales.map((code) => <option key={code} value={code}>{flag(code)} {code.toUpperCase()} · {LOCALE_NAMES.get(code) ?? code}</option>)}
                </select>
              </label>
            )}
            <span className="kw-screen-hint">Позиции и ключи — из Keywords</span>
          </div>
        )}
        {body}
      </div>
    </ConnectGate>
  );
}
