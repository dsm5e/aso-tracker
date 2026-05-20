import type { Response } from "express";

const clients = new Set<Response>();

export function attach(res: Response): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
  res.write(`event: hello\ndata: {"ts":${Date.now()}}\n\n`);
  clients.add(res);
  const ping = setInterval(() => {
    try {
      res.write(`:ping\n\n`);
    } catch {
      /* ignore */
    }
  }, 15_000);
  res.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

export function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    try {
      c.write(payload);
    } catch {
      clients.delete(c);
    }
  }
}
