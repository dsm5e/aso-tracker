import { useCallback, useEffect, useState, type ReactNode } from 'react';
import './ConnectGate.css';

// «Подключить» gate: a screen that needs keys renders only when the studio server says
// every required integration is connected. Otherwise the screen is locked with a
// «Подключить» button: paste the keys right here, or copy a ready prompt for an agent.
// Status and saving go through /asa-api (the Apple Ads server keeps all studio keys).
// Preview a locked screen with ?gate=<id>[,<id>] even when keys are present.

export type IntegrationId = 'asa' | 'asc' | 'adapty';
interface Field { key: string; label: string; secret?: boolean; multiline?: boolean; hint: string; present: boolean; preview: string }
interface Integration { id: IntegrationId; name: string; purpose: string; where: string; connected: boolean; source: string; missing: string[]; fields: Field[]; agentPrompt: string }

let cache: Promise<Integration[]> | null = null;
const load = (force = false) => {
  if (!cache || force) cache = fetch('/asa-api/integrations').then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
  return cache;
};
const forced = () => new Set((new URLSearchParams(location.search).get('gate') ?? '').split(',').filter(Boolean));

export default function ConnectGate({ requires, title, children }: { requires: IntegrationId[]; title: string; children: ReactNode }) {
  const [list, setList] = useState<Integration[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const refresh = useCallback((force = false) => { load(force).then(setList).catch((e: Error) => setError(e.message)); }, []);
  useEffect(() => { refresh(); }, [refresh]);

  if (error) return <>{children}</>; // the server is down: let the screen show its own error
  if (!list) return <div className="gate-loading">Проверяем подключения…</div>;
  const f = forced();
  const need = list.filter((i) => requires.includes(i.id) && (!i.connected || f.has(i.id)));
  if (!need.length) return <>{children}</>;

  return (
    <section className="gate">
      <div className="gate-card">
        <div className="gate-lock" aria-hidden>🔒</div>
        <h2>{title} ждёт подключения</h2>
        <p>Нужно подключить: {need.map((i) => i.name).join(', ')}. Без этих ключей экран покажет пустые или неверные данные.</p>
        <ul className="gate-why">{need.map((i) => <li key={i.id}><b>{i.name}</b> — {i.purpose}</li>)}</ul>
        {!open && <button className="gate-primary" onClick={() => setOpen(true)}>Подключить</button>}
        {open && need.map((i) => <Connect key={i.id} item={i} onSaved={() => refresh(true)} />)}
      </div>
    </section>
  );
}

function Connect({ item, onSaved }: { item: Integration; onSaved: () => void }) {
  const [tab, setTab] = useState<'form' | 'agent'>('form');
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [copied, setCopied] = useState(false);
  const save = async () => {
    setState('saving');
    const body = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
    const r = await fetch(`/asa-api/credentials/${item.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    setState(r.ok ? 'saved' : 'error');
    if (r.ok) { setValues({}); onSaved(); }
  };
  return (
    <div className="gate-connect">
      <div className="gate-connect-head">
        <b>{item.name}</b>
        <div className="gate-tabs">
          <button className={tab === 'form' ? 'on' : ''} onClick={() => setTab('form')}>Вставить ключи</button>
          <button className={tab === 'agent' ? 'on' : ''} onClick={() => setTab('agent')}>Инструкция для агента</button>
        </div>
      </div>
      <p className="gate-where">Где взять: {item.where}</p>
      {tab === 'form' ? (
        <div className="gate-form">
          {item.fields.map((f) => (
            <label key={f.key}>
              <span>{f.label}{f.present && <em>сохранён · {f.preview}</em>}</span>
              {f.multiline
                ? <textarea rows={4} placeholder={f.hint} value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                : <input type={f.secret ? 'password' : 'text'} placeholder={f.hint} autoComplete="off" value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />}
            </label>
          ))}
          <div className="gate-actions">
            <button className="gate-primary" disabled={state === 'saving' || !Object.values(values).some((v) => v.trim())} onClick={save}>
              {state === 'saving' ? 'Сохраняем…' : 'Сохранить'}
            </button>
            {state === 'saved' && <span className="gate-ok">Сохранено. Если экран не открылся — перезапустите студию.</span>}
            {state === 'error' && <span className="gate-err">Сервер не принял ключи.</span>}
          </div>
          <p className="gate-note">Ключи хранятся только в локальной базе студии и не показываются целиком.</p>
        </div>
      ) : (
        <div className="gate-agent">
          <pre>{item.agentPrompt}</pre>
          <button onClick={() => { void navigator.clipboard.writeText(item.agentPrompt); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? 'Скопировано' : 'Скопировать для агента'}
          </button>
        </div>
      )}
    </div>
  );
}
