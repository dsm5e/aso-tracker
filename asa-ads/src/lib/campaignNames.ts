const SCOPES: Record<string, string> = {
  US: "США", GB: "Великобритания", DE: "Германия", BR: "Бразилия", MX: "Мексика",
  "T1-WEST": "Западные рынки · тир 1",
  "T2-GROWTH": "Растущие рынки · тир 2",
  "T3-EAST": "Восточная Азия · тир 3",
  "T4-EMERGING": "Развивающиеся рынки · тир 4",
  "T5-TAIL": "Остальные рынки · тир 5",
  ALL: "Все доступные страны",
  "L10N-EN": "Английские запросы",
  "L10N-PT-BR": "Португальские запросы · Бразилия",
  "L10N-PT": "Португальские запросы",
  "L10N-ES": "Испанские запросы",
  "L10N-DE": "Немецкие запросы",
  "L10N-FR": "Французские запросы",
  "L10N-IT": "Итальянские запросы",
  "L10N-JA": "Японские запросы",
  "L10N-KO": "Корейские запросы",
  "L10N-ZH-HANT": "Китайские запросы · традиционные",
  "L10N-TR": "Турецкие запросы",
  "L10N-AR": "Арабские запросы",
  "L10N-HE": "Иврит-запросы",
  "L10N-NL": "Нидерландские запросы",
  KG: "Кыргызстан · локальные запросы",
  MO: "Макао · локальные запросы",
};

const PORTFOLIOS: Record<string, string> = {
  "CORE-EXACT": "Основные ключи · exact",
  "DISC-BROAD": "Поиск новых запросов · broad",
  "DISC-SM": "Автоподбор Apple · Search Match",
  "COMP-EXACT": "Ключи конкурентов · exact",
  "LOCAL-EXACT": "Локальные ключи · exact",
  "BRAND-EXACT": "Защита бренда · exact",
};

export function campaignDisplayName(raw: string): string {
  const match = raw.match(/^M26 - (.+) - (CORE-EXACT|DISC-BROAD|DISC-SM|COMP-EXACT|LOCAL-EXACT|BRAND-EXACT)$/);
  if (!match) return raw;
  const [, scope, portfolio] = match;
  return `${SCOPES[scope] ?? scope} — ${PORTFOLIOS[portfolio] ?? portfolio}`;
}

export function campaignTechnicalName(raw: string): string | null {
  return raw.startsWith("M26 - ") ? raw : null;
}
