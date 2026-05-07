/**
 * PPO export helpers — per-strategy ZIP and global master-ZIP for all
 * strategies. ASC PPO accepts up to 3 treatments × N screenshots; one ZIP per
 * treatment is the fastest path: drag → drop → done.
 *
 * Files inside each strategy folder are named by their position in the
 * strategy's prompt-insertion order (1.png, 2.png, ...) so the order matches
 * what the user sees in the dashboard. Screens without a successful render are
 * skipped silently — Generate them first.
 */
import JSZip from 'jszip';
import { useStudio } from '../state/studio';
import type { PPOStrategy } from '../state/studio';

const API_BASE = import.meta.env.BASE_URL === '/' ? '/api' : '/studio-api';

const slug = (s: string): string =>
  s
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'untitled';

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Free the object URL after the browser has had a tick to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Always go through our server proxy — fal CDN may not return CORS headers,
 *  and we need the bytes in JS to put them inside a JSZip blob. The proxy is
 *  same-origin (vite dev) or same-host (prod) so no CORS issues.
 *
 *  Pass `exportSize=appstore-iphone | appstore-ipad` so the server upscales
 *  the gpt-image-2 output to ASC's required dimensions (1290×2796 for iPhone
 *  6.9", 2064×2752 for iPad 13"). Without it ASC rejects with "dimensions
 *  are wrong". */
async function fetchAsBlob(url: string, device: 'iphone' | 'ipad' = 'iphone'): Promise<Blob> {
  const exportSize = device === 'ipad' ? 'appstore-ipad' : 'appstore-iphone';
  const proxyUrl =
    `${API_BASE}/ppo/proxy-image?url=${encodeURIComponent(url)}&exportSize=${exportSize}`;
  const r = await fetch(proxyUrl);
  if (!r.ok) throw new Error(`proxy ${r.status}: ${url}`);
  return r.blob();
}

/** Collect (position, url) pairs for every screen in the strategy that has a
 *  successful render. Position follows the strategy's prompt insertion order
 *  (== the order the user sees in the dashboard). */
function collectRendered(strategy: PPOStrategy): Array<{ index: number; url: string }> {
  const ordered = Object.keys(strategy.prompts);
  const out: Array<{ index: number; url: string }> = [];
  let i = 1;
  for (const screenId of ordered) {
    const gen = strategy.generations[screenId];
    if (gen?.aiImageUrl && gen.generateState === 'done') {
      out.push({ index: i, url: gen.aiImageUrl });
      i += 1;
    }
  }
  return out;
}

export interface ExportProgress {
  /** What we're doing right now: fetching images, zipping, or done. */
  phase: 'fetching' | 'zipping' | 'done';
  done: number;
  total: number;
}

export type ExportProgressFn = (p: ExportProgress) => void;

/** Build a ZIP for one strategy and trigger a browser download.
 *  Filename: <appSlug>-<strategySlug>.zip with 1.png .. N.png inside. */
export async function exportStrategy(
  strategyId: string,
  onProgress?: ExportProgressFn,
): Promise<void> {
  const state = useStudio.getState();
  const ppo = state.ppo;
  if (!ppo) return;
  const strategy = ppo.strategies.find((s) => s.id === strategyId);
  if (!strategy) return;

  const items = collectRendered(strategy);
  if (items.length === 0) {
    alert('No rendered screens yet — generate at least one first.');
    return;
  }

  let fetched = 0;
  let failed = 0;
  const device = ppo.device ?? 'iphone';
  onProgress?.({ phase: 'fetching', done: 0, total: items.length });

  const zip = new JSZip();
  const fetchPromises = items.map(async ({ index, url }) => {
    try {
      const blob = await fetchAsBlob(url, device);
      zip.file(`${index}.png`, blob);
    } catch (e) {
      failed += 1;
      console.warn(`[ppo-export] skip ${index}.png:`, (e as Error).message);
    } finally {
      fetched += 1;
      onProgress?.({ phase: 'fetching', done: fetched, total: items.length });
    }
  });
  await Promise.all(fetchPromises);

  if (failed === items.length) {
    alert(`All ${items.length} image fetches failed — open Network tab to inspect.`);
    onProgress?.({ phase: 'done', done: 0, total: items.length });
    return;
  }

  onProgress?.({ phase: 'zipping', done: items.length, total: items.length });
  const appSlug = slug(state.appName || 'app');
  const stratSlug = slug(strategy.title || 'strategy');
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `${appSlug}-${stratSlug}.zip`);
  onProgress?.({ phase: 'done', done: items.length, total: items.length });
}

/** Build a master ZIP with a subfolder per strategy. Strategies with zero
 *  successful renders are omitted from the archive (and logged). */
export async function exportAllStrategies(onProgress?: ExportProgressFn): Promise<void> {
  const state = useStudio.getState();
  const ppo = state.ppo;
  if (!ppo || ppo.strategies.length === 0) return;

  type Job = { folderName: string; index: number; url: string };
  const jobs: Job[] = [];
  for (const strategy of ppo.strategies) {
    const items = collectRendered(strategy);
    if (items.length === 0) {
      console.log(`[ppo-export] skipping "${strategy.title}" — no renders`);
      continue;
    }
    const folderName = slug(strategy.title);
    for (const it of items) jobs.push({ folderName, ...it });
  }
  if (jobs.length === 0) {
    alert('No strategies have rendered screens yet.');
    return;
  }

  let fetched = 0;
  let failed = 0;
  const device = ppo.device ?? 'iphone';
  onProgress?.({ phase: 'fetching', done: 0, total: jobs.length });

  const zip = new JSZip();
  const fetchPromises = jobs.map(async (job) => {
    try {
      const blob = await fetchAsBlob(job.url, device);
      const folder = zip.folder(job.folderName);
      folder?.file(`${job.index}.png`, blob);
    } catch (e) {
      failed += 1;
      console.warn(`[ppo-export] ${job.folderName}/${job.index}.png skipped:`, (e as Error).message);
    } finally {
      fetched += 1;
      onProgress?.({ phase: 'fetching', done: fetched, total: jobs.length });
    }
  });
  await Promise.all(fetchPromises);

  if (failed === jobs.length) {
    alert(`All ${jobs.length} image fetches failed — check console / server log.`);
    onProgress?.({ phase: 'done', done: 0, total: jobs.length });
    return;
  }

  onProgress?.({ phase: 'zipping', done: jobs.length, total: jobs.length });
  const appSlug = slug(state.appName || 'app');
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `${appSlug}-ppo-treatments.zip`);
  onProgress?.({ phase: 'done', done: jobs.length - failed, total: jobs.length });
  console.log(`[ppo-export] master zip: ${jobs.length - failed} files (${failed} failed)`);
}
