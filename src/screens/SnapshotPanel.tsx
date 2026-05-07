import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Flag, RankPill } from '../design/primitives.jsx';
import { SPEED_PRESETS, type SnapshotEvent, type SnapshotSpeed } from '../api';

function shortError(msg?: string): string {
  if (!msg) return 'error';
  const m = msg.toLowerCase();
  const http = msg.match(/http (\d{3})/i);
  if (http) {
    const code = http[1];
    if (code === '403' || code === '429') return `throttled ${code}`;
    if (code === '502' || code === '503' || code === '504') return `server ${code}`;
    return `http ${code}`;
  }
  if (m.includes('timeout')) return 'timeout';
  if (m.includes('rate') || m.includes('throttl')) return 'rate limit';
  if (m.includes('network') || m.includes('fetch')) return 'network';
  return msg.length > 24 ? msg.slice(0, 24) + '…' : msg;
}

interface Props {
  events: SnapshotEvent[];
  running: boolean;
  /** When true: not started / stopped by user — show Run button instead of Stop */
  paused: boolean;
  /** Context the panel is set up to run (target app scope label) */
  scopeLabel?: string;
  onClose: () => void;
  onStart: () => void;
  onResume: () => void;
  onAbort: () => void;
  speed: SnapshotSpeed;
  onSpeedChange: (s: SnapshotSpeed) => void;
}

export default function SnapshotPanel({
  events,
  running,
  paused,
  scopeLabel,
  onClose,
  onStart,
  onResume,
  onAbort,
  speed,
  onSpeedChange,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const summary = useMemo(() => {
    let total = 0;
    let completed = 0;
    let currentLocale: string | undefined;
    let aborted = false;
    let reason: string | undefined;
    let done = false;
    let lastThrottleAt: number | null = null;
    let lastThrottleEvent: SnapshotEvent | null = null;
    let keywordsSinceThrottle = 0;
    let lastSpeedEvent: SnapshotEvent | null = null;
    let lastSpeedAt: number | null = null;
    const keywordEvents: SnapshotEvent[] = [];
    for (const e of events) {
      if (e.type === 'start' && e.total != null) {
        total = completed + e.total;
        aborted = false;
        reason = undefined;
        done = false;
      } else if (e.type === 'locale' && e.locale) currentLocale = e.locale;
      else if (e.type === 'keyword') {
        completed += 1;
        keywordEvents.push(e);
        if (lastThrottleEvent) keywordsSinceThrottle += 1;
      } else if (e.type === 'abort') {
        aborted = true;
        reason = e.reason;
      } else if (e.type === 'done') {
        done = true;
      } else if (e.type === 'throttle') {
        lastThrottleAt = Date.now();
        lastThrottleEvent = e;
        keywordsSinceThrottle = 0;
      } else if (e.type === 'speed') {
        lastSpeedEvent = e;
        lastSpeedAt = Date.now();
      }
    }
    if (total < completed) total = completed;
    return {
      total,
      completed,
      currentLocale,
      aborted,
      reason,
      done,
      keywordEvents,
      lastThrottleAt,
      lastThrottleEvent,
      keywordsSinceThrottle,
      lastSpeedEvent,
      lastSpeedAt,
    };
  }, [events]);

  // Show a transient confirmation banner under the speed picker for ~3s after
  // the server acknowledges a manual speed change. Re-renders on tick so the
  // banner fades out without us hooking into a separate state machine.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!summary.lastSpeedAt) return;
    const t = setTimeout(() => forceTick((n) => n + 1), 3100);
    return () => clearTimeout(t);
  }, [summary.lastSpeedAt]);
  const speedAck = summary.lastSpeedEvent && summary.lastSpeedAt && Date.now() - summary.lastSpeedAt < 3000
    ? summary.lastSpeedEvent
    : null;

  const isRateLimitAbort = summary.aborted && /(403|429|502|503|504|rate|throttl)/i.test(summary.reason || '');
  const isUserCancelled = summary.aborted && (summary.reason || '').toLowerCase().includes('cancelled');

  // Soft banner: auto-throttle is active when we just received a throttle event and either
  // no keyword has come through since (still in cooldown) OR fewer than 5 keywords have
  // (still in slow recovery). Cleared once we're clearly back to normal.
  const isAutoThrottling =
    !!summary.lastThrottleEvent &&
    summary.lastThrottleEvent.source === 'auto' &&
    summary.keywordsSinceThrottle < 5 &&
    running;

  const groupedByLocale = useMemo(() => {
    const groups: Record<string, SnapshotEvent[]> = {};
    for (const e of summary.keywordEvents) {
      const loc = e.locale || '??';
      if (!groups[loc]) groups[loc] = [];
      groups[loc].push(e);
    }
    return groups;
  }, [summary.keywordEvents]);

  // Auto-follow the bottom only while the user already is near the bottom.
  // Prevents "snap-to-bottom" when the user manually scrolled up to inspect an error.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 80) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const pct = summary.total ? Math.round((summary.completed / summary.total) * 100) : 0;
  const hasProgress = summary.keywordEvents.length > 0;
  const stateTitle = running
    ? 'Running snapshot'
    : summary.aborted
      ? isUserCancelled ? 'Snapshot paused' : 'Snapshot aborted'
      : summary.done
        ? 'Snapshot complete'
        : hasProgress
          ? 'Snapshot paused'
          : 'Ready to run';

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(10,10,10,0.22)', backdropFilter: 'blur(2px)', zIndex: 40 }}
      />
      <aside
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 460,
          background: 'var(--bg-raised)',
          boxShadow: 'inset 1px 0 0 var(--border), -20px 0 40px -20px rgba(0,0,0,0.18)',
          display: 'flex', flexDirection: 'column', zIndex: 50,
        }}
      >
        {/* Rate-limit banner */}
        {isRateLimitAbort && (
          <div style={{ background: '#FFE8E2', color: '#B8270A', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, borderBottom: '1px solid rgba(184,39,10,0.15)' }}>
            <Icon name="alert" size={14} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>iTunes rate-limited your IP</div>
              <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
                Try Slow preset below, wait 2-3 min, then Resume.
              </div>
            </div>
          </div>
        )}

        {/* Auto-throttle soft banner — snapshot keeps running, just slowed itself down */}
        {isAutoThrottling && summary.lastThrottleEvent && (
          <div style={{ background: 'var(--bg-sunken)', color: 'var(--text)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, borderBottom: '1px solid var(--border-subtle)' }}>
            <span className="dot" style={{ width: 7, height: 7, background: '#E59B3C', borderRadius: 999 }} />
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600 }}>Auto-throttled</span>{' '}
              <span style={{ color: 'var(--text-muted)' }}>
                → {summary.lastThrottleEvent.workers}w · {summary.lastThrottleEvent.sleepMs}ms
                {summary.lastThrottleEvent.cooldownSec ? ` · cooldown ${summary.lastThrottleEvent.cooldownSec}s` : ''}
              </span>
            </div>
          </div>
        )}

        {/* Header */}
        <header style={{ padding: 16, borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {running && !summary.aborted ? (
              <span className="dot" style={{ width: 8, height: 8, background: 'var(--accent)', animation: 'pulse 1.4s infinite', borderRadius: 999 }} />
            ) : summary.aborted && !isUserCancelled ? (
              <span className="dot" style={{ width: 8, height: 8, background: 'var(--neg)', borderRadius: 999 }} />
            ) : summary.done ? (
              <span className="dot dot-pos" style={{ width: 8, height: 8 }} />
            ) : (
              <span className="dot" style={{ width: 8, height: 8, background: 'var(--text-faint)', borderRadius: 999 }} />
            )}
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{stateTitle}</h2>
            {scopeLabel && <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>· {scopeLabel}</span>}
            <div style={{ flex: 1 }} />
            <button className="btn btn-ghost btn-sm" onClick={onClose} title="Close"><Icon name="x" size={13} /></button>
          </div>

          {/* Speed picker — always visible */}
          <div style={{ position: 'relative' }}>
            {speedAck && (
              <div
                style={{
                  position: 'absolute',
                  top: -2,
                  right: 0,
                  fontSize: 11.5,
                  color: 'var(--accent)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontWeight: 500,
                  animation: 'fadeIn 200ms ease',
                }}
              >
                <span className="dot" style={{ width: 6, height: 6, background: 'var(--accent)', borderRadius: 999 }} />
                Applied · {speedAck.workers}w · {speedAck.sleepMs}ms
                {speedAck.source === 'auto' && <span style={{ color: 'var(--text-muted)' }}> (auto)</span>}
              </div>
            )}
            <div className="label" style={{ marginBottom: 6 }}>Speed · {SPEED_PRESETS[speed].note}</div>
            <div style={{ display: 'flex', gap: 6, padding: 3, background: 'var(--bg-sunken)', borderRadius: 10, boxShadow: 'inset 0 0 0 1px var(--border-subtle)' }}>
              {(['medium','slow'] as SnapshotSpeed[]).map((key) => {
                const active = speed === key;
                const p = SPEED_PRESETS[key];
                return (
                  <button
                    key={key}
                    onClick={() => onSpeedChange(key)}
                    style={{
                      flex: 1,
                      padding: '8px 10px', borderRadius: 7,
                      background: active ? 'var(--bg-raised)' : 'transparent',
                      color: active ? 'var(--text)' : 'var(--text-muted)',
                      fontSize: 13, fontWeight: active ? 600 : 500,
                      boxShadow: active ? '0 0 0 1px var(--border), 0 1px 2px rgba(0,0,0,0.04)' : 'none',
                      border: 0,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ fontWeight: active ? 600 : 500 }}>
                      {p.label}{key === 'slow' && <span style={{ color: 'var(--pos)', marginLeft: 6, fontSize: 11.5, fontWeight: 600 }}>SAFE</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                      {p.workers}w · {p.sleepMs}ms
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Run/Stop/Resume button */}
          {running ? (
            <button className="btn btn-sm" onClick={onAbort} style={{ background: 'var(--neg-tint)', color: 'var(--neg)', fontWeight: 600, height: 40 }}>
              <Icon name="pause" size={12} /> Stop
            </button>
          ) : summary.aborted ? (
            <button className="btn btn-primary" onClick={onResume} style={{ height: 40 }}>
              <Icon name="play" size={12} /> Resume
              <span style={{ fontSize: 11.5, color: 'var(--accent-tint)', marginLeft: 8, fontWeight: 500 }}>
                — skip {summary.completed} already done
              </span>
            </button>
          ) : summary.done ? (
            <button className="btn btn-sm" onClick={onClose} style={{ height: 40 }}>
              <Icon name="check" size={12} /> Close
            </button>
          ) : hasProgress ? (
            <button className="btn btn-primary" onClick={onResume} style={{ height: 40 }}>
              <Icon name="play" size={12} /> Resume
            </button>
          ) : (
            <button className="btn btn-primary" onClick={onStart} style={{ height: 40 }}>
              <Icon name="play" size={12} /> Start snapshot
            </button>
          )}

          {/* Progress row */}
          {hasProgress && (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span className="hero-num" style={{ fontSize: 22, color: summary.aborted && !isUserCancelled ? 'var(--neg)' : 'var(--text)' }}>
                  {pct}%
                </span>
                <span className="num" style={{ fontSize: 13, color: 'var(--text-muted)' }}>{summary.completed} / {summary.total}</span>
                {summary.currentLocale && running && (
                  <>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Flag code={summary.currentLocale.toUpperCase()} size={12} />
                      {summary.currentLocale.toUpperCase()}
                    </span>
                  </>
                )}
              </div>

              <div style={{ height: 4, borderRadius: 2, background: 'var(--bg-sunken)', overflow: 'hidden' }}>
                <div style={{
                  width: `${pct}%`, height: '100%',
                  background: summary.aborted && !isUserCancelled ? 'var(--neg)' : 'var(--accent)',
                  transition: 'width 200ms ease-out',
                }} />
              </div>
            </>
          )}
        </header>

        {/* Feed */}
        <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
          {Object.entries(groupedByLocale).map(([loc, items]) => (
            <div key={loc}>
              <div style={{ position: 'sticky', top: 0, background: 'var(--bg-sunken)', padding: '6px 16px', fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border-subtle)' }}>
                <Flag code={loc.toUpperCase()} size={12} />
                <span>{loc.toUpperCase()}</span>
                <div style={{ flex: 1 }} />
                <span style={{ color: 'var(--text-faint)', letterSpacing: 0, textTransform: 'none', fontWeight: 500 }}>{items.length}</span>
              </div>
              {items.map((it, i) => {
                const isErr = !!it.error;
                const rank = it.position;
                const tone = rank == null ? 'muted' : rank <= 10 ? 'pos' : rank <= 50 ? 'neg' : 'muted';
                return (
                  <div key={i} style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, borderBottom: '1px solid var(--border-subtle)' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, color: 'var(--text-muted)' }}>{it.keyword}</span>
                    {isErr ? <span style={{ fontSize: 12, color: 'var(--neg)' }} title={it.error}>{shortError(it.error)}</span>
                      : rank != null && rank > 0 ? <RankPill rank={rank} />
                      : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>— not ranked</span>}
                    <span className="dot" style={{ width: 7, height: 7, background: isErr ? 'var(--neg)' : tone === 'pos' ? 'var(--pos)' : tone === 'neg' ? 'var(--neg)' : 'var(--text-faint)' }} />
                  </div>
                );
              })}
            </div>
          ))}
          {!hasProgress && !running && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              Configure speed above and click <b>Start snapshot</b>.
            </div>
          )}
          {!hasProgress && running && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Waiting for first result…</div>
          )}
        </div>

        {summary.aborted && summary.reason && (
          <div style={{ padding: 12, borderTop: '1px solid var(--border-subtle)', fontSize: 12, color: 'var(--neg)' }}>
            {summary.reason}
          </div>
        )}
      </aside>
    </>
  );
}
