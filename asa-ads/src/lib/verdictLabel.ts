// The ROI engine names verdicts in English (SCALE / HOLD / …); the UI is Russian.
const RU: Record<string, string> = {
  SCALE: "Масштабировать",
  HOLD: "Держать",
  MONITOR: "Наблюдать",
  CUT: "Сократить",
  WAIT: "Мало данных",
};

export function verdictLabel(label: string): string {
  return RU[label] ?? label;
}
