interface Props {
  /** Solid pastel base under the dots. */
  bgColor: string;
  /** Dot color. Pass slightly darker than bg for a soft polka feel. */
  dotColor: string;
  /** Logical canvas width. */
  width?: number;
  /** Logical canvas height. */
  height?: number;
  /** Distance between dot centers, canvas px. */
  spacing?: number;
  /** Dot radius, canvas px. */
  dotRadius?: number;
  /** 0..1 dot opacity. */
  dotOpacity?: number;
}

const VIEW_W = 1290;
const VIEW_H = 2796;

export function DotsBackground({
  bgColor,
  dotColor,
  width = VIEW_W,
  height = VIEW_H,
  spacing = 70,
  dotRadius = 6,
  dotOpacity = 0.4,
}: Props) {
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      style={{ display: 'block', position: 'absolute', inset: 0 }}
    >
      <defs>
        <pattern
          id="dots-pattern"
          x="0"
          y="0"
          width={spacing}
          height={spacing}
          patternUnits="userSpaceOnUse"
        >
          <circle cx={spacing / 2} cy={spacing / 2} r={dotRadius} fill={dotColor} fillOpacity={dotOpacity} />
        </pattern>
      </defs>
      <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill={bgColor} />
      <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#dots-pattern)" />
    </svg>
  );
}
