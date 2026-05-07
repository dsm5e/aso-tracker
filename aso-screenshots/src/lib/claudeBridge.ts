/**
 * Browser-side bridge for Claude Code agents working on this app from outside.
 *
 * Workflow the user wants:
 *   user (to Claude in IDE): "вот скрины моего приложения Sign PDF, придумай тексты"
 *   Claude in IDE → opens Playwright → page.evaluate(window.asoStudio.getState())
 *     sees: presetId="sahara", 7 slots, app theme empty, accent default blue
 *   Claude → window.asoStudio.applyPlan({
 *     appName: 'Sign PDF', appColor: '#5B21B6',
 *     themeHint: 'PDF signature & document scanning app',
 *     slots: [
 *       { index: 0, verb: 'Sign in seconds', descriptor: 'Tap, draw, done', textYFraction: 0.78 },
 *       { index: 1, verb: 'Scan papers', descriptor: 'Camera → searchable PDF' },
 *       …
 *     ],
 *   })
 *
 * Exposed under window.asoStudio.* so any Playwright session can discover the API
 * with a single `await page.evaluate(() => window.asoStudio.getState())` call.
 */

import { useStudio, type Screenshot, type ActionData, type HeroIngredients } from '../state/studio';
import { PRESETS, getPreset } from './presets';
import { saveScreenshotBlob } from './screenshotStore';

export interface ClaudeSlotSnapshot {
  /** Stable id used by applyPlan / applyHeadlines. */
  id: string;
  /** 0-based position in the sidebar (matches what user sees left-to-right). */
  index: number;
  /** 'regular' = product shot · 'action' = first/hero slot with social proof + decorations. */
  kind: 'regular' | 'action';
  /** Current headline text (verb = title, descriptor = subtitle). */
  verb: string;
  descriptor: string;
  /** When set, this slot is part of a cross-paired phone shared with its siblings. */
  groupId?: string;
  /** True if the user has uploaded an inner screenshot here. */
  hasUpload: boolean;
  /** Approximate device bbox in canvas px (1290 × 2796). Use to avoid overlapping text on the phone. */
  deviceBox: { left: number; top: number; right: number; bottom: number };
  /** Approximate text bbox in canvas px (where the headline currently sits). */
  textBox: { left: number; top: number; right: number; bottom: number };
  /** Headline vertical placement, 0 = top, 1 = bottom of canvas. Pick 0.05 for "above device", 0.78 for "below device". */
  textYFraction: number;
  /** Title size in canvas px. */
  titlePx: number;
  /** Subtitle size in canvas px. */
  subPx: number;
  /** Action-slot only: theme hint that gets sent to gpt-image-2 for theme decorations. */
  themeHint?: string;
  /** Action-slot only: social proof primary line ("1K+ Ratings"). */
  socialPrimary?: string;
  socialSecondary?: string;
  /** Action-slot only: AI-rendered hero URL if generated. */
  aiImageUrl?: string;
}

export interface ClaudeStudioSnapshot {
  /** App-level fields. */
  appName: string;
  appColor: string;
  /** ID of the picked preset, or null if nothing selected. */
  presetId: string | null;
  /** Human-readable preset name (or null). */
  presetName: string | null;
  /** Number of slots in the picked preset's `samples`. */
  templateSlotCount: number;
  /** Current screenshots in the editor sidebar, in order. */
  slots: ClaudeSlotSnapshot[];
  /** Slots grouped by groupId — each entry is "one phone across N slots". */
  pairs: Array<{ groupId: string; slotIndices: number[] }>;
  /** Available presets the user could pick if no template is selected. */
  availablePresets: Array<{ id: string; name: string; description: string; slotCount: number }>;
}

const CANVAS_W = 1290;
const CANVAS_H = 2796;

function snapshot(): ClaudeStudioSnapshot {
  const st = useStudio.getState();
  const preset = st.selectedPresetId ? getPreset(st.selectedPresetId) : undefined;

  const slots: ClaudeSlotSnapshot[] = st.screenshots.map((s, i) => {
    const titlePx = s.titlePx ?? 220;
    const subPx = s.subPx ?? 100;
    const yFrac = s.textYFraction ?? 0.07;
    const textTop = Math.round(yFrac * CANVAS_H);
    const textBox = {
      left: 60,
      top: textTop,
      right: CANVAS_W - 60,
      bottom: textTop + titlePx + 24 + subPx,
    };
    const dW = 1064;
    const dH = 2200;
    const deviceLeft = (CANVAS_W - dW) / 2 + (s.deviceX ?? 0);
    const deviceTop = (CANVAS_H - dH) / 2 + (s.deviceY ?? 0);
    return {
      id: s.id,
      index: i,
      kind: s.kind,
      verb: s.headline.verb,
      descriptor: s.headline.descriptor,
      groupId: s.groupId,
      hasUpload: !!s.sourceUrl,
      deviceBox: {
        left: Math.round(deviceLeft),
        top: Math.round(deviceTop),
        right: Math.round(deviceLeft + dW),
        bottom: Math.round(deviceTop + dH),
      },
      textBox,
      textYFraction: yFrac,
      titlePx,
      subPx,
      themeHint: s.action?.themeHint,
      socialPrimary: s.action?.primary,
      socialSecondary: s.action?.secondary,
      aiImageUrl: s.action?.aiImageUrl ?? undefined,
    };
  });

  const pairsMap = new Map<string, number[]>();
  slots.forEach((s, i) => {
    if (s.groupId) {
      if (!pairsMap.has(s.groupId)) pairsMap.set(s.groupId, []);
      pairsMap.get(s.groupId)!.push(i);
    }
  });

  return {
    appName: st.appName,
    appColor: st.appColor,
    presetId: st.selectedPresetId,
    presetName: preset?.name ?? null,
    templateSlotCount: preset?.samples?.length ?? 0,
    slots,
    pairs: Array.from(pairsMap.entries()).map(([groupId, slotIndices]) => ({ groupId, slotIndices })),
    availablePresets: PRESETS.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      slotCount: p.samples?.length ?? 0,
    })),
  };
}

interface SlotPlan {
  /** Either screenshot id OR 0-based slot index (id wins if both given). */
  id?: string;
  index?: number;
  verb?: string;
  descriptor?: string;
  /** 0..1 vertical placement of headline. <0.5 → above device, >0.5 → below. */
  textYFraction?: number;
  titlePx?: number;
  subPx?: number;
  /** Promote / demote this slot. 'action' enables hero variant with social proof. */
  kind?: 'regular' | 'action';
  /** Action-slot only: theme hint sent to gpt-image-2 (e.g. "PDF signature & scanning"). */
  themeHint?: string;
  /** Action-slot only: social proof text. */
  socialPrimary?: string;
  socialSecondary?: string;
  /** Action-slot only: hide phone toggle (for text-only / decoration-only hero). */
  hideDevice?: boolean;
  /** Action-slot only: ingredient toggles (`{ socialProof: true, ctaArrow: true, ... }`). */
  ingredients?: Partial<HeroIngredients>;
  /** Action-slot only: per-ingredient text fields, e.g.
   *  `{ socialProof: { ratings: '500+ Ratings', rating: '4.8 Average' } }`. */
  ingredientParams?: Partial<Record<keyof HeroIngredients, Record<string, string>>>;
  /** Action-slot only: editable AI prompt + toggle. When omitted, current
   *  values are kept; pass `useCustomPrompt:false` to fall back to the builder. */
  useCustomPrompt?: boolean;
  customPrompt?: string;
}

interface Plan {
  /** App-level updates (sticky for whole project). */
  appName?: string;
  appColor?: string;
  /** Optional global theme hint applied to ALL action slots that don't already have one. */
  themeHint?: string;
  /** Per-slot updates. */
  slots?: SlotPlan[];
}

/** Apply many edits in one call. Returns counts of fields changed.
 *  Designed so a Claude agent can produce a single JSON plan and ship it. */
function applyPlan(plan: Plan): {
  appUpdated: boolean;
  slotsUpdated: number;
  unmatchedIndices: number[];
} {
  const st = useStudio.getState();

  let appUpdated = false;
  if (plan.appName !== undefined || plan.appColor !== undefined) {
    st.setProject({
      ...(plan.appName !== undefined ? { appName: plan.appName } : {}),
      ...(plan.appColor !== undefined ? { appColor: plan.appColor } : {}),
    });
    appUpdated = true;
  }

  let slotsUpdated = 0;
  const unmatched: number[] = [];

  for (const u of plan.slots ?? []) {
    const target =
      u.id != null
        ? st.screenshots.find((s) => s.id === u.id)
        : u.index != null
          ? st.screenshots[u.index]
          : null;
    if (!target) {
      if (u.index != null) unmatched.push(u.index);
      continue;
    }

    const patch: Partial<Screenshot> = {};

    // Headline content
    if (u.verb !== undefined || u.descriptor !== undefined) {
      patch.headline = {
        ...target.headline,
        ...(u.verb !== undefined ? { verb: u.verb } : {}),
        ...(u.descriptor !== undefined ? { descriptor: u.descriptor } : {}),
      };
    }
    // Text layout
    if (u.textYFraction !== undefined) patch.textYFraction = u.textYFraction;
    if (u.titlePx !== undefined) patch.titlePx = u.titlePx;
    if (u.subPx !== undefined) patch.subPx = u.subPx;
    if (u.kind !== undefined) patch.kind = u.kind;

    // Action data (theme hint, social proof, ingredients) — preserve existing fields
    const actionPatchNeeded =
      u.themeHint !== undefined ||
      u.socialPrimary !== undefined ||
      u.socialSecondary !== undefined ||
      u.hideDevice !== undefined ||
      u.ingredients !== undefined ||
      u.ingredientParams !== undefined ||
      u.useCustomPrompt !== undefined ||
      u.customPrompt !== undefined;
    if (actionPatchNeeded || (plan.themeHint && (u.kind === 'action' || target.kind === 'action'))) {
      const cur: ActionData = target.action ?? {
        primary: '1K+ Ratings',
        secondary: '4.9 Average',
        showStars: true,
        hideDevice: false,
        themeHint: '',
        aiImageUrl: null,
        lastPrompt: null,
        generateState: 'idle',
      };
      const mergedIngredients: HeroIngredients | undefined = u.ingredients
        ? { ...(cur.ingredients ?? {}), ...u.ingredients }
        : cur.ingredients;
      const mergedParams: ActionData['ingredientParams'] | undefined = u.ingredientParams
        ? Object.entries(u.ingredientParams).reduce(
            (acc, [k, v]) => ({
              ...acc,
              [k]: { ...((cur.ingredientParams ?? {})[k as keyof HeroIngredients] ?? {}), ...(v ?? {}) },
            }),
            { ...(cur.ingredientParams ?? {}) },
          )
        : cur.ingredientParams;
      const next: ActionData = {
        ...cur,
        ...(u.themeHint !== undefined
          ? { themeHint: u.themeHint }
          : plan.themeHint && !cur.themeHint
            ? { themeHint: plan.themeHint }
            : {}),
        ...(u.socialPrimary !== undefined ? { primary: u.socialPrimary } : {}),
        ...(u.socialSecondary !== undefined ? { secondary: u.socialSecondary } : {}),
        ...(u.hideDevice !== undefined ? { hideDevice: u.hideDevice } : {}),
        ...(u.useCustomPrompt !== undefined ? { useCustomPrompt: u.useCustomPrompt } : {}),
        ...(u.customPrompt !== undefined ? { customPrompt: u.customPrompt } : {}),
        ...(mergedIngredients !== undefined ? { ingredients: mergedIngredients } : {}),
        ...(mergedParams !== undefined ? { ingredientParams: mergedParams } : {}),
      };
      patch.action = next;
    }

    if (Object.keys(patch).length) {
      st.updateScreenshot(target.id, patch);
      slotsUpdated++;
    }
  }

  return { appUpdated, slotsUpdated, unmatchedIndices: unmatched };
}

/** Convert a data URI / blob URL / http URL into a Blob the browser can store. */
async function fetchToBlob(src: string): Promise<Blob> {
  const r = await fetch(src);
  return await r.blob();
}

/** Upload an image to a specific slot. Accepts data URI (data:image/...), blob: URL,
 *  or any http(s) URL the browser can fetch. Returns blob URL on success. */
async function uploadScreenshot(
  slotIdOrIndex: string | number,
  src: string,
  filename = 'upload.png',
): Promise<{ ok: boolean; error?: string; sourceUrl?: string }> {
  const st = useStudio.getState();
  const target =
    typeof slotIdOrIndex === 'string'
      ? st.screenshots.find((s) => s.id === slotIdOrIndex)
      : st.screenshots[slotIdOrIndex];
  if (!target) return { ok: false, error: 'slot not found' };
  try {
    const blob = await fetchToBlob(src);
    const url = URL.createObjectURL(blob);
    st.updateScreenshot(target.id, { sourceUrl: url, filename });
    // Persist so blob survives reload (zustand only stores metadata).
    await saveScreenshotBlob(target.id, blob, filename);
    return { ok: true, sourceUrl: url };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Set the project-level app icon (used by the "App icon" hero ingredient). */
async function setAppIcon(src: string | null): Promise<{ ok: boolean; error?: string }> {
  const st = useStudio.getState();
  if (!src) {
    st.setProject({ appIconUrl: null });
    return { ok: true };
  }
  try {
    const blob = await fetchToBlob(src);
    const url = URL.createObjectURL(blob);
    st.setProject({ appIconUrl: url });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function pickPreset(id: string): { ok: boolean; error?: string } {
  if (!PRESETS.some((p) => p.id === id)) {
    return { ok: false, error: `Unknown preset id "${id}"` };
  }
  useStudio.getState().pickPreset(id);
  return { ok: true };
}

/** Convenience getters for individual flows that don't need the full snapshot. */
function getSelectedPresetId(): string | null {
  return useStudio.getState().selectedPresetId;
}

/** Full raw Zustand store state (sans methods) — JSON-serialisable snapshot of
 *  EVERYTHING the editor knows. Use this when the curated `getState()` snapshot
 *  doesn't expose the field you need to inspect. */
function dump() {
  const s = useStudio.getState();
  // Strip function values; everything left is plain data.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (typeof v !== 'function') out[k] = v;
  }
  return out;
}

/** Surgical writer: patch one screenshot by id with any fields you like. Bypasses
 *  applyPlan's curated mapping — go here when you need to set, say, ingredients
 *  params or device fields directly. */
function patchSlot(id: string, patch: Partial<Screenshot>): { ok: boolean; error?: string } {
  const st = useStudio.getState();
  if (!st.screenshots.some((s) => s.id === id)) return { ok: false, error: 'slot not found' };
  st.updateScreenshot(id, patch);
  return { ok: true };
}

/** Project-level setter (appName, appColor, devices, outputFolder, etc.). */
function patchProject(patch: Parameters<typeof useStudio.getState>[0] extends never
  ? Record<string, unknown>
  : Parameters<ReturnType<typeof useStudio.getState>['setProject']>[0]) {
  useStudio.getState().setProject(patch);
  return { ok: true } as const;
}

export const claudeStudioApi = {
  /** READ — full snapshot for planning. */
  getState: snapshot,
  /** READ — only the picked preset id (or null). */
  getSelectedPresetId,
  /** WRITE — single bulk call. Most agents only need this. */
  applyPlan,
  /** WRITE — pick a preset (use this when getState().presetId is null). */
  pickPreset,
  /** WRITE — set the project-level app icon (data URI or any URL the browser can fetch). */
  setAppIcon,
  /** WRITE — upload a screenshot into a specific slot (data URI / blob URL / http URL). */
  uploadScreenshot,
  /** READ — full Zustand state as plain JSON (no methods). Heavier than getState(). */
  dump,
  /** WRITE — surgical patch on one screenshot by id. */
  patchSlot,
  /** WRITE — project-level patch (appName, appColor, devices, outputFolder, …). */
  patchProject,
};

if (typeof window !== 'undefined') {
  // @ts-expect-error — augmenting global for agent access
  window.asoStudio = claudeStudioApi;
}
