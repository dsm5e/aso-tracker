/** API path helper — handles direct vs proxied serving. */
export function apiUrl(path: string): string {
  const base = import.meta.env.BASE_URL;
  if (base === "/") return path; // direct on :5193 → /api/* via vite proxy to :5194
  // served under /asa/ via keywords proxy → rewrite /api/* to /asa-api/*
  return path.startsWith("/api/") ? `/asa-api${path.slice(4)}` : path;
}

export function sseUrl(): string {
  return import.meta.env.BASE_URL === "/" ? "/sse" : "/asa-sse";
}
