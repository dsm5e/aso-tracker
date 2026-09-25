import { useEffect, useState } from "react";
import { apiUrl } from "../lib/apiBase.ts";

interface FieldDef {
  key: string;
  label: string;
  hint: string;
  multiline?: boolean;
  placeholder?: string;
}

const ASA_FIELDS: FieldDef[] = [
  { key: "client_id", label: "Client ID", hint: "SEARCHADS.xxxx… из ads.apple.com → Settings → API", placeholder: "SEARCHADS.00000000-0000-…" },
  { key: "team_id", label: "Team ID", hint: "Часто совпадает с Client ID", placeholder: "SEARCHADS.00000000-0000-…" },
  { key: "key_id", label: "Key ID", hint: "UUID из сертификата API" },
  { key: "org_id", label: "Org ID", hint: "Числовой идентификатор организации (org_acls)" },
  { key: "private_key", label: "Закрытый ключ (.p8)", hint: "Вставьте весь PEM, включая -----BEGIN…", multiline: true, placeholder: "-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----" },
];

const ASC_FIELDS: FieldDef[] = [
  { key: "key_id", label: "Key ID", hint: "10 символов из appstoreconnect.apple.com → Users → Keys" },
  { key: "issuer_id", label: "Issuer ID", hint: "UUID с той же страницы (Issuer ID вверху)" },
  { key: "vendor_number", label: "Номер поставщика", hint: "Раздел Sales and Trends → Reports" },
  { key: "private_key", label: "Закрытый ключ (.p8)", hint: "Содержимое AuthKey_XXXXXXXXXX.p8", multiline: true, placeholder: "-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----" },
];

interface Props {
  provider: "asa" | "asc";
  title: string;
  helpUrl: string;
  description: string;
}

interface MaskedCred {
  present: boolean;
  preview: string;
  source: "db" | "env" | "none";
  updated_at?: string;
}

export default function CredentialsCard({ provider, title, helpUrl, description }: Props) {
  const fields = provider === "asa" ? ASA_FIELDS : ASC_FIELDS;
  const [current, setCurrent] = useState<Record<string, MaskedCred>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string>("");
  const [open, setOpen] = useState(false);

  async function load(): Promise<void> {
    const r = await fetch(apiUrl(`/api/credentials/${provider}`)).then((res) => res.json());
    setCurrent(r);
  }

  useEffect(() => { void load(); }, []);

  const dirty = Object.keys(edits).length > 0;
  const allConfigured = fields.every((f) => current[f.key]?.present);

  async function save(): Promise<void> {
    if (!dirty) return;
    setSaving(true);
    try {
      await fetch(apiUrl(`/api/credentials/${provider}`), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(edits),
      });
      setEdits({});
      setSavedAt(new Date().toLocaleTimeString());
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div>
          <h3 style={{ margin: 0 }}>
            {title} {allConfigured ? <span className="badge ok">настроено</span> : <span className="badge warn">не настроено</span>}
          </h3>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{description} · <a href={helpUrl} target="_blank" rel="noreferrer">документация ↗</a></div>
        </div>
        <button onClick={() => setOpen((v) => !v)}>{open ? "− Свернуть" : "+ Редактировать"}</button>
      </div>

      {!open && (
        <table style={{ marginTop: 8 }}>
          <tbody>
            {fields.map((f) => {
              const c = current[f.key];
              return (
                <tr key={f.key}>
                  <td style={{ width: "28%" }}><span className="muted">{f.label}</span></td>
                  <td style={{ width: 60 }}>
                    {c?.source === "db" && <span className="badge ok">db</span>}
                    {c?.source === "env" && <span className="badge cyan">.env</span>}
                    {c?.source === "none" && <span className="badge bad">нет</span>}
                  </td>
                  <td>
                    {c?.present ? (
                      <span style={{ color: "var(--bone)", fontSize: 11 }}>{c.preview}</span>
                    ) : (
                      <span className="bad">— не задано —</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {open && (
        <>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
            {fields.map((f) => (
              <div key={f.key}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                  <label style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--bone-dim)" }}>
                    {f.label}
                  </label>
                  {current[f.key]?.present && (
                    <span className="muted" style={{ fontSize: 10 }}>текущее: {current[f.key]!.preview}</span>
                  )}
                </div>
                {f.multiline ? (
                  <textarea
                    placeholder={f.placeholder ?? "вставьте значение…"}
                    value={edits[f.key] ?? ""}
                    onChange={(e) => setEdits((p) => ({ ...p, [f.key]: e.target.value }))}
                    style={{
                      width: "100%",
                      minHeight: 100,
                      background: "var(--void)",
                      border: "1px solid var(--line)",
                      color: "var(--bone)",
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      padding: "8px 10px",
                      resize: "vertical",
                    }}
                  />
                ) : (
                  <input
                    type="text"
                    placeholder={f.placeholder ?? ""}
                    value={edits[f.key] ?? ""}
                    onChange={(e) => setEdits((p) => ({ ...p, [f.key]: e.target.value }))}
                    style={{ width: "100%" }}
                  />
                )}
                <div className="muted" style={{ fontSize: 10, marginTop: 3 }}>{f.hint}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="hint" style={{ fontSize: 11 }}>
              {dirty
                ? <><strong className="warn">изменений: {Object.keys(edits).length}</strong> · после сохранения перезапустите API, чтобы клиенты подхватили значения</>
                : savedAt
                  ? <><span className="good">сохранено · {savedAt}</span> · перезапустите API для применения</>
                  : <>Заполненные поля хранятся в зашифрованном виде в <code style={{ color: "var(--cyan)" }}>data/asa-ads.db</code>. Пустые поля игнорируются, существующие значения сохраняются.</>
              }
            </div>
            <div className="btn-group">
              <button onClick={() => { setEdits({}); setOpen(false); }}>Отменить</button>
              <button className="primary" disabled={!dirty || saving} onClick={save}>{saving ? "Сохраняем…" : "Сохранить"}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
