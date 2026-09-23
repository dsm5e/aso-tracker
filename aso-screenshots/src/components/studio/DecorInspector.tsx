import { Card, Slider } from '../shared';
import type { DecorItem, Screenshot } from '../../state/studio';

/**
 * Inspector section for `Screenshot.decor` — cut-out images, speech bubbles
 * and doodles. Keeps the editing surface small: position / size / rotation
 * sliders, layer, flip, and the bubble copy (localised by index on Locales).
 */
const SHAPES: NonNullable<DecorItem['shape']>[] = ['arrow', 'arrow-curly', 'star', 'heart', 'sparkle', 'swirl', 'scribble', 'burst', 'wave'];

const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line-2)',
  background: 'var(--bg-2)', color: 'var(--fg-1)', fontSize: 12,
};

export function DecorInspector({ ss, set }: { ss: Screenshot; set: (patch: Partial<Screenshot>) => void }) {
  const list = ss.decor ?? [];
  const update = (i: number, patch: Partial<DecorItem>) =>
    set({ decor: list.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const remove = (i: number) => set({ decor: list.filter((_, j) => j !== i) });
  const add = (item: DecorItem) => set({ decor: [...list, item] });

  const slider = (label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, fmt = (v: number) => v.toFixed(2)) => (
    <div className="field" style={{ marginTop: 6 }}>
      <label className="field-label">{label} <span className="tabular muted">{fmt(value)}</span></label>
      <Slider value={value} min={min} max={max} step={step} onChange={onChange} />
    </div>
  );

  return (
    <Card.Section title="Декор (дети, маскот, пузыри, дудлы)">
      {list.map((d, i) => (
        <div key={i} style={{ border: '1px solid var(--line-2)', borderRadius: 10, padding: 10, marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <strong style={{ flex: 1 }}>
              {i + 1}. {d.kind === 'image' ? (d.src?.split('/').pop() ?? 'image') : d.kind === 'bubble' ? 'пузырь' : d.shape}
            </strong>
            <select className="select" value={d.layer ?? 'front'} onChange={(e) => update(i, { layer: e.target.value as DecorItem['layer'] })}
              style={{ width: 'auto', height: 26, fontSize: 11 }}>
              <option value="back">под устройством</option>
              <option value="front">над устройством</option>
              <option value="top">над всем</option>
            </select>
            <label style={{ fontSize: 11 }}>
              <input type="checkbox" checked={Boolean(d.flipX)} onChange={(e) => update(i, { flipX: e.target.checked })} /> ⇋
            </label>
            <button type="button" onClick={() => remove(i)}
              style={{ border: 0, background: 'transparent', color: 'var(--neg)', cursor: 'pointer', fontSize: 11 }}>
              удалить
            </button>
          </div>
          {d.kind === 'bubble' && (
            <textarea value={d.text ?? ''} rows={2} onChange={(e) => update(i, { text: e.target.value })}
              style={{ ...inputStyle, width: '100%', marginTop: 8, resize: 'vertical' }} />
          )}
          {d.kind === 'doodle' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <select className="select" value={d.shape} onChange={(e) => update(i, { shape: e.target.value as DecorItem['shape'] })}
                style={{ flex: 1, height: 26, fontSize: 11 }}>
                {SHAPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(d.stroke ?? '') ? d.stroke : '#ffffff'}
                onChange={(e) => update(i, { stroke: e.target.value })} />
            </div>
          )}
          {d.kind === 'image' && (
            <input type="text" value={d.src ?? ''} placeholder="URL прозрачного PNG" onChange={(e) => update(i, { src: e.target.value })}
              style={{ ...inputStyle, width: '100%', marginTop: 8 }} />
          )}
          {slider('X', d.xFrac, -0.2, 1.2, 0.005, (v) => update(i, { xFrac: v }))}
          {slider('Y', d.yFrac, -0.2, 1.2, 0.005, (v) => update(i, { yFrac: v }))}
          {slider('Ширина', d.widthFrac, 0.02, 1.5, 0.005, (v) => update(i, { widthFrac: v }))}
          {slider('Поворот', d.rotate ?? 0, -180, 180, 1, (v) => update(i, { rotate: v }), (v) => `${v}°`)}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ghost" onClick={() => add({ kind: 'bubble', text: 'Привет!', xFrac: 0.3, yFrac: 0.4, widthFrac: 0.45, layer: 'top', tail: 'bottom-left' })}>+ пузырь</button>
        <button type="button" className="btn btn-ghost" onClick={() => add({ kind: 'doodle', shape: 'star', xFrac: 0.15, yFrac: 0.5, widthFrac: 0.08, stroke: '#FFE27A', layer: 'top' })}>+ дудл</button>
        <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
          + картинка
          <input type="file" accept="image/png,image/webp" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) add({ kind: 'image', src: URL.createObjectURL(f), xFrac: 0.25, yFrac: 0.8, widthFrac: 0.45 });
            e.currentTarget.value = '';
          }} />
        </label>
      </div>
      <div style={{ marginTop: 10, fontSize: 11 }}>
        <label>
          <input type="checkbox" checked={ss.deviceAnchor !== 'free'}
            onChange={(e) => set({ deviceAnchor: e.target.checked ? undefined : 'free' })} />{' '}
          Устройство сразу под заголовком (если пресет это умеет)
        </label>
      </div>
    </Card.Section>
  );
}
