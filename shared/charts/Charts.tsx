// Studio chart kit — the look of the Roomvi admin analytics dashboard (plain SVG,
// 2px lines, rounded data-ends, recessive grid, hover tooltips with every series).
// Colors come from shared/ds.css: pass 'var(--ds-c1)'…'var(--ds-c4)' or semantic tokens.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './charts.css';

export const SERIES = ['var(--ds-c1)', 'var(--ds-c2)', 'var(--ds-c3)', 'var(--ds-c4)'];
export type TipRow = [color: string | null, label: string, value: string];
const num = (v: number) => Math.round(v).toLocaleString('ru-RU');

// ---------- tooltip ----------
type TipState = { x: number; y: number; head: string; rows: TipRow[] } | null;
let setGlobalTip: ((t: TipState) => void) | null = null;
function TipHost() {
  const [tip, setTip] = useState<TipState>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setGlobalTip = setTip; return () => { setGlobalTip = null; }; }, []);
  useLayoutEffect(() => {
    const el = ref.current; if (!el || !tip) return;
    el.style.left = Math.min(tip.x + 14, innerWidth - el.offsetWidth - 8) + 'px';
    el.style.top = Math.min(tip.y + 14, innerHeight - el.offsetHeight - 8) + 'px';
  });
  if (!tip) return null;
  return createPortal(
    <div className="dsc-tip" ref={ref}>
      <div className="th">{tip.head}</div>
      {tip.rows.map(([c, l, v], i) => (
        <div className="tr" key={i}>{c && <span className="k" style={{ background: c }} />}<span>{l}</span><b>{v}</b></div>
      ))}
    </div>, document.body);
}
let hostMounted = false;
function useTipHost() {
  const [mine, setMine] = useState(false);
  useEffect(() => { if (!hostMounted) { hostMounted = true; setMine(true); return () => { hostMounted = false; }; } }, []);
  return mine ? <TipHost /> : null;
}
export const showTip = (e: { clientX: number; clientY: number }, head: string, rows: TipRow[]) => setGlobalTip?.({ x: e.clientX, y: e.clientY, head, rows });
export const hideTip = () => setGlobalTip?.(null);
/** Props for any SVG/HTML element that should show a tooltip on hover. */
export const tipProps = (head: string, rows: TipRow[]) => ({
  onPointerMove: (e: React.PointerEvent) => showTip(e, head, rows),
  onPointerLeave: hideTip,
});

// ---------- helpers ----------
function useWidth<T extends HTMLElement>(fallback = 600): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || fallback));
    ro.observe(el); setW(el.clientWidth || fallback);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w];
}
export function nice(max: number): [number, number[]] {
  if (!(max > 0)) return [1, [0, 1]];
  const raw = max / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step; const t: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) t.push(+v.toFixed(6));
  return [top, t];
}
const colPath = (x: number, y: number, w: number, h: number, r = 4) => {
  if (h <= 0) return ''; r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};
const hbarPath = (x: number, y: number, w: number, h: number, r = 4) => {
  if (w <= 0) return ''; r = Math.min(r, w, h / 2);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
};

// ---------- legend ----------
export function Legend({ items, line = false }: { items: [color: string, label: string][]; line?: boolean }) {
  return <div className="dsc-legend">{items.map(([c, l]) => <span key={l}><i className={line ? 'ln' : ''} style={{ background: c }} />{l}</span>)}</div>;
}

// ---------- line chart ----------
export interface LineSeries { label: string; color: string; values: (number | null)[]; end?: boolean; width?: number; dashed?: boolean }
export function LineChart({ labels, series, height = 220, yFmt = num, yMax, invert = false }: {
  labels: string[]; series: LineSeries[]; height?: number; yFmt?: (v: number) => string; yMax?: number;
  /** ranks: smaller is better, so the axis grows downward (1 at the top) */
  invert?: boolean;
}) {
  const host = useTipHost();
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = height, L = 44, B = 24, T = 10, R = 50;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const [top, ticks] = nice(yMax ?? Math.max(...all, invert ? 1 : 0.1));
  const n = labels.length;
  const X = (i: number) => L + (w - L - R) * (n > 1 ? i / (n - 1) : 0.5);
  const Y = (v: number) => invert ? T + (H - T - B) * (v / top) : T + (H - T - B) * (1 - v / top);
  const every = Math.ceil(n / 10);
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const bb = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = (e.clientX - bb.left) * w / bb.width;
    const i = Math.max(0, Math.min(n - 1, Math.round((px - L) / ((w - L - R) / Math.max(n - 1, 1)))));
    setHover(i);
    showTip(e, labels[i], series.map((s) => [s.color, s.label, s.values[i] == null ? '—' : yFmt(s.values[i] as number)]));
  };
  return (
    <div className="dsc" ref={ref}>
      {host}
      <svg viewBox={`0 0 ${w} ${H}`} height={H}>
        {ticks.map((t) => <g key={t}><line x1={L} x2={w - R} y1={Y(t)} y2={Y(t)} stroke={t ? 'var(--ds-grid)' : 'var(--ds-axis)'} /><text x={L - 6} y={Y(t) + 4} textAnchor="end">{yFmt(t)}</text></g>)}
        {labels.map((l, i) => (n <= 10 || i % every === 0 || i === n - 1) && <text key={i} x={X(i)} y={H - 6} textAnchor="middle">{l}</text>)}
        {series.map((s) => {
          let d = '', pen = false;
          s.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i) + ',' + Y(v); pen = true; });
          const li = s.values.map((v, i) => v == null ? -1 : i).filter((i) => i >= 0).pop();
          return <g key={s.label}>
            <path d={d} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '4 4' : undefined} />
            {s.end && li != null && <><circle cx={X(li)} cy={Y(s.values[li] as number)} r={4} fill={s.color} stroke="var(--ds-panel)" strokeWidth={2} />
              <text className="lab-strong" x={X(li) + 8} y={Y(s.values[li] as number) + 4}>{yFmt(s.values[li] as number)}</text></>}
          </g>;
        })}
        {hover != null && <line x1={X(hover)} x2={X(hover)} y1={T} y2={H - B} stroke="var(--ds-muted)" opacity={0.5} />}
        {hover != null && series.map((s) => s.values[hover] != null && <circle key={s.label} cx={X(hover)} cy={Y(s.values[hover] as number)} r={4} fill={s.color} stroke="var(--ds-panel)" strokeWidth={2} />)}
        <rect x={L} y={T} width={Math.max(0, w - L - R)} height={H - T - B} fill="transparent" onPointerMove={onMove} onPointerLeave={() => { setHover(null); hideTip(); }} />
      </svg>
    </div>
  );
}

// ---------- bar chart (single or stacked) ----------
export interface BarSeries { label: string; color: string; values: number[] }
export function BarChart({ labels, series, height = 220, yFmt = num, tipHead }: {
  labels: string[]; series: BarSeries[]; height?: number; yFmt?: (v: number) => string; tipHead?: (i: number) => string;
}) {
  const host = useTipHost();
  const [ref, w] = useWidth<HTMLDivElement>();
  const H = height, L = 44, B = 24, T = 14;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
  const [top, ticks] = nice(Math.max(...totals, 1));
  const Y = (v: number) => T + (H - T - B) * (1 - v / top);
  const step = (w - L - 8) / Math.max(labels.length, 1), bw = Math.min(28, Math.max(3, step - 3));
  const every = Math.ceil(labels.length / 12);
  return (
    <div className="dsc" ref={ref}>
      {host}
      <svg viewBox={`0 0 ${w} ${H}`} height={H}>
        {ticks.map((t) => <g key={t}><line x1={L} x2={w} y1={Y(t)} y2={Y(t)} stroke={t ? 'var(--ds-grid)' : 'var(--ds-axis)'} /><text x={L - 6} y={Y(t) + 4} textAnchor="end">{yFmt(t)}</text></g>)}
        {labels.map((l, i) => {
          const x = L + 4 + i * step + (step - bw) / 2; let acc = 0;
          const present = series.filter((s) => s.values[i]);
          return <g key={i}>
            {present.map((s, si) => {
              const v = s.values[i]; const y0 = Y(acc), y1 = Y(acc + v); const hh = y0 - y1 - (acc ? 2 : 0); acc += v;
              return si === present.length - 1
                ? <path key={s.label} d={colPath(x, y1, bw, hh)} fill={s.color} fillOpacity={0.9} />
                : <rect key={s.label} x={x} y={y1} width={bw} height={Math.max(hh, 0)} fill={s.color} fillOpacity={0.9} />;
            })}
            <rect className="dsc-hit" x={L + 4 + i * step} y={T} width={step} height={H - T - B} fill="transparent"
              {...tipProps(tipHead ? tipHead(i) : l, [...series.map((s): TipRow => [s.color, s.label, yFmt(s.values[i] || 0)]), ...(series.length > 1 ? [[null, 'Всего', yFmt(totals[i])] as TipRow] : [])])} />
            {(labels.length <= 16 || i % every === 0) && <text x={x + bw / 2} y={H - 8} textAnchor="middle">{l}</text>}
          </g>;
        })}
      </svg>
    </div>
  );
}

// ---------- sparkline ----------
export function Sparkline({ values, labels, color = 'var(--ds-c1)', height = 40, fmt = num, invert = false }: {
  values: (number | null)[]; labels?: string[]; color?: string; height?: number; fmt?: (v: number) => string; invert?: boolean;
}) {
  const host = useTipHost();
  const [ref, w] = useWidth<HTMLDivElement>(120);
  const [hover, setHover] = useState<number | null>(null);
  const [gid] = useState(() => 'dsg' + Math.random().toString(36).slice(2));
  const vs = values.map((v) => v ?? null); const nums = vs.filter((v): v is number => v != null);
  if (nums.length < 2) return <div className="dsc-spark-empty" ref={ref}>—</div>;
  const mx = Math.max(...nums), mn = Math.min(...nums), n = vs.length, h = height;
  const X = (i: number) => 2 + i * (w - 4) / (n - 1);
  const Y = (v: number) => { const t = mx === mn ? 0.5 : (v - mn) / (mx - mn); return 3 + (invert ? t : 1 - t) * (h - 8); };
  let line = '', pen = false;
  vs.forEach((v, i) => { if (v == null) { pen = false; return; } line += (pen ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); pen = true; });
  const first = vs.findIndex((v) => v != null), last = n - 1 - [...vs].reverse().findIndex((v) => v != null);
  return (
    <div className="dsc dsc-spark" ref={ref}>
      {host}
      <svg viewBox={`0 0 ${w} ${h}`} height={h} preserveAspectRatio="none"
        onPointerMove={(e) => { const bb = e.currentTarget.getBoundingClientRect(); const i = Math.max(0, Math.min(n - 1, Math.round((e.clientX - bb.left) / bb.width * (n - 1)))); setHover(i);
          showTip(e, labels?.[i] ?? String(i + 1), [[color, 'Значение', vs[i] == null ? '—' : fmt(vs[i] as number)]]); }}
        onPointerLeave={() => { setHover(null); hideTip(); }}>
        <defs><linearGradient id={gid} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.28} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
        <path d={`${line}L${X(last)},${h}L${X(first)},${h}Z`} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {hover != null && <line x1={X(hover)} x2={X(hover)} y1={0} y2={h} stroke="var(--ds-muted)" strokeWidth={1} opacity={0.6} vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}

// ---------- horizontal bars (ranked list) ----------
export function HBars({ rows, fmt = num, max }: {
  rows: { label: ReactNode; value: number; color?: string; tip?: TipRow[]; tipHead?: string; note?: string }[]; fmt?: (v: number) => string; max?: number;
}) {
  const host = useTipHost();
  const [ref, w] = useWidth<HTMLDivElement>();
  const L = Math.min(180, w * 0.34), RR = 70, rowH = 26, H = rows.length * rowH;
  const mx = max ?? Math.max(...rows.map((r) => r.value), 1e-9);
  return (
    <div className="dsc dsc-hbars" ref={ref}>
      {host}
      <div className="dsc-hbar-labels" style={{ width: L }}>{rows.map((r, i) => <div key={i} style={{ height: rowH }}>{r.label}</div>)}</div>
      <svg viewBox={`0 0 ${w - L} ${H}`} height={H} style={{ width: `calc(100% - ${L}px)` }}>
        {rows.map((r, i) => {
          const bw = Math.max(2, (w - L - RR) * r.value / mx), y = i * rowH + 6;
          return <g key={i} {...tipProps(r.tipHead ?? String(r.label), r.tip ?? [[r.color ?? 'var(--ds-c1)', 'Значение', fmt(r.value)]])}>
            <path d={hbarPath(0, y, bw, 14)} fill={r.color ?? 'var(--ds-c1)'} />
            <text className="lab" x={bw + 6} y={y + 11}>{fmt(r.value)}{r.note ? ` · ${r.note}` : ''}</text>
          </g>;
        })}
      </svg>
    </div>
  );
}
