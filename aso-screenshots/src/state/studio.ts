import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PRESETS } from '../lib/presets';

export type Devices = 'iphone' | 'ipad' | 'both';

export interface Headline {
  verb: string;
  descriptor: string;
  subhead: string;
}

export type EnhanceState = 'idle' | 'sending' | 'processing' | 'done' | 'error';

export interface ActionData {
  /** "1K+ Ratings" */
  primary: string;
  /** "4.9 Average" */
  secondary: string;
  showStars: boolean;
  /** Hide device, show only headline + decorations */
  hideDevice: boolean;
  /** Free-form theme hint passed to AI ("dream interpretation", "PDF signing", etc.) */
  themeHint: string;
  /** AI-generated full-canvas hero image (1290×2796 PNG) */
  aiImageUrl: string | null;
  /** Last prompt used to generate (for debug + regenerate) */
  lastPrompt: string | null;
  /** Generation state */
  generateState: 'idle' | 'generating' | 'done' | 'error';
  /** Last error message if state='error' */
  errorMessage?: string;
  /** Post-enhance transform — lets the user nudge / zoom the AI result inside the
   *  canvas without re-running generation. All in canvas-px (1290×2796). */
  aiOffsetX?: number;
  aiOffsetY?: number;
  aiScale?: number; // 1 = original size; >1 = zoomed in
  /** All AI-rendered URLs from successful Re-enhance attempts on this slot.
   *  The currently-displayed one is `aiImageUrl`; the user picks any from history
   *  to swap in. Lets us preserve "the good first attempt" while iterating further. */
  aiHistory?: string[];
  /** Hero composition ingredients — each toggle here turns into a sentence appended
   *  to the AI prompt. They're NOT rendered as HTML/SVG; the model bakes them into
   *  the polished image itself, which looks far better than anything we could draw. */
  ingredients?: HeroIngredients;
  /** Per-ingredient parameter values (text fields shown in Inspector when a toggle
   *  is on). Shape: `{ socialProof: { ratings: "1K+ Ratings", rating: "4.9 Average" }, ... }`.
   *  Values get interpolated into the ingredient's prompt template. */
  ingredientParams?: Partial<Record<keyof HeroIngredients, Record<string, string>>>;
  /** Toggle: when true (default if preset ships heroPrompt), the AI call sends
   *  `customPrompt` below instead of letting the server build a generic one. */
  useCustomPrompt?: boolean;
  /** Editable per-slot prompt. Pre-filled from preset.heroPrompt with placeholders
   *  resolved at seed time; the user can tune this freely in Inspector. */
  customPrompt?: string;
}

export interface HeroIngredients {
  socialProof?: boolean;
  ctaArrow?: boolean;
  appIcon?: boolean;
  editorsChoice?: boolean;
  pressQuotes?: boolean;
  testimonial?: boolean;
  handHolding?: boolean;
  floatingFeatures?: boolean;
  multiDevice?: boolean;
  beforeAfter?: boolean;
}

export interface Screenshot {
  id: string;
  filename: string;
  /** Which device family this slot belongs to. 'iphone' by default. */
  device?: 'iphone' | 'ipad';
  /** Source PNG URL from simulator (object URL or absolute path) */
  sourceUrl: string | null;
  /** Enhanced (textless template) PNG URL after AI polish */
  enhancedUrl: string | null;
  presetId: string;
  /** Override the preset's default background (solid color or gradient CSS). null = use preset. */
  backgroundOverride: string | null;
  headline: Headline;
  font: string;
  fontSize: number;
  tiltDeg: number;
  /** 3D forward/back tilt (rotateX). Negative = top tilts back. */
  tiltX: number;
  /** 3D left/right turn (rotateY). Positive = right side away. */
  tiltY: number;
  /** Horizontal device offset from canvas center, in canvas px. */
  deviceX: number;
  /** Vertical device offset, in canvas px. */
  deviceY: number;
  /** Device scale (1.0 = default size, 0.5 = half, 1.5 = 50% larger). */
  deviceScale: number;
  textX: number;
  textY: number;
  /** Per-screenshot headline layout copied from the preset's sample on creation. */
  textYFraction?: number;
  titlePx?: number;
  subPx?: number;
  /** Screenshots sharing the same groupId mirror the same sourceUrl (cross-slot pair). */
  groupId?: string;
  /** Per-regular-slot toggle for the designer-style "feature callout" — a
   *  zoomed-out magnified close-up of a key UI element with an arrow back
   *  to the source. Default off; when on, the polish prompt includes the
   *  callout block. Hero has its own ingredient toggles instead. */
  polishCallout?: boolean;
  /** Position of this slot in the template's sample list — seeded by pickPreset.
   *  Used by parametric backgrounds (e.g. dots) to derive a per-slot hue from
   *  the project accent so the 4 slots feel like one family. Hero (manually
   *  added) gets sampleIndex = 0 too — same accent base as feature slot 0. */
  sampleIndex?: number;
  /** Optional pill / badge text rendered above the headline (per-slot). */
  pill?: string;
  pillBg?: string;
  pillFg?: string;
  breakout: boolean;
  pulseScreen: number;
  enhanceState: EnhanceState;
  /** Hero / "selling" first-screenshot variant with decorations + social proof */
  kind: 'regular' | 'action';
  action?: ActionData;
}

export interface LocaleEntry {
  id: string;
  /** BCP-47 locale code, e.g. en-US, ru-RU, ja, ar */
  code: string;
  flag: string; // emoji
  name: string;
  rtl?: boolean;
  /** AI-generated translations per screenshot id */
  translations: Record<string, Headline>;
  /** Pill / badge translations keyed by screenshot id (separate from headline). */
  pillTranslations?: Record<string, string>;
  /** Per-slot text adjustments specific to this locale. Lets the user nudge
   *  position / resize the headline for languages where the translation runs
   *  longer (German) or shorter (CJK) than the source. Renderer adds these
   *  on top of the base screenshot's textX/textY/titlePx/subPx. */
  slotAdjustments?: Record<string, {
    textX?: number;
    textY?: number;
    titlePx?: number;
    subPx?: number;
  }>;
  /** Optional per-locale font override (script→font auto, can be manual) */
  fontOverride?: string;
  aiTranslated: boolean;
}

interface StudioState {
  // Project
  appName: string;
  appColor: string;
  /** Optional uploaded icon (object URL). Used when "App icon" hero ingredient is on —
   *  AI gets the actual icon image via image_urls so the result is brand-faithful. */
  appIconUrl: string | null;
  devices: Devices;
  outputFolder: string;

  // Catalog
  selectedPresetId: string | null;
  catalogFilter: 'all' | 'real' | 'abstract';

  // Editor
  screenshots: Screenshot[];
  activeScreenshotId: string | null;
  viewMode: 'scaffold' | 'enhanced';
  /** Which device frame to preview in Editor and Locales screens. Does not affect export unless explicitly passed. */
  previewDevice: 'iphone' | 'ipad';

  // Locales
  locales: LocaleEntry[];

  // Export
  destination: 'local' | 'asc' | 'claude';
  format: 'png' | 'jpg' | 'webp';
  /** ASC requires only the largest size per device family — it scales down for smaller devices. */
  sizes: { iphone: boolean; ipad: boolean };
  filenamePattern: string;
  folderStructure: 'per-locale' | 'per-size' | 'flat';

  /** Set of screenshot IDs the user has shift-clicked to pair / un-pair. */
  multiSelect: string[];

  /** Cumulative spend on AI renders (USD). Approximate — counts each successful
   *  gpt-image-2 polish at $0.05 (medium quality). Persisted across sessions. */
  aiSpent: number;
  /** Total successful AI renders (for "renders so far" line). */
  aiCallCount: number;

  /** When set, the current active state was loaded from an archived project.
   *  Export updates that entry instead of pushing a new one. Cleared by
   *  startNewProject / archiveCurrentProject. */
  loadedFromProjectId?: string;
  /** Set after ppoLoadSession; ppoSaveSession updates the matching entry
   *  rather than creating a new one. Cleared when the entry is deleted. */
  loadedFromPPOSessionId?: string;
  /** Past projects archived on Export. Browseable from /setup → Recent. */
  archivedProjects: ArchivedProject[];

  /** Saved PPO sessions — separate from archivedProjects since they have a
   *  different shape (no headlines / preset / locales, but multi-strategy). */
  archivedPPOExperiments: ArchivedPPOExperiment[];

  /** Product Page Optimization mode — multi-strategy A/B experiments.
   *  Source screens are shared across all strategies; each strategy has its
   *  own per-screen prompt + AI-generated result. See PPO_PLAN.md. */
  ppo?: PPOExperiment;

  // Mutations
  setProject: (patch: Partial<Pick<StudioState, 'appName' | 'appColor' | 'appIconUrl' | 'devices' | 'outputFolder'>>) => void;
  pickPreset: (id: string) => void;
  toggleMultiSelect: (id: string) => void;
  clearMultiSelect: () => void;
  /** Pair every currently-multi-selected screenshot into one cross-group with a single shared phone. */
  pairSelected: () => void;
  /** Break a group apart — slots return to independent positioning. */
  unpairGroup: (groupId: string) => void;
  /** Bump the AI-spend counter by N dollars (default $0.05 = one medium render). */
  bumpAiSpent: (cost?: number) => void;
  /** Zero the spend counter — for new project. */
  resetAiSpent: () => void;
  setCatalogFilter: (f: 'all' | 'real' | 'abstract') => void;
  addScreenshot: (s: Partial<Screenshot>, opts?: { atIndex?: number }) => Screenshot;
  updateScreenshot: (id: string, patch: Partial<Screenshot>) => void;
  removeScreenshot: (id: string) => void;
  reorderScreenshots: (orderedIds: string[]) => void;
  setActiveScreenshot: (id: string | null) => void;
  setViewMode: (m: 'scaffold' | 'enhanced') => void;
  setPreviewDevice: (d: 'iphone' | 'ipad') => void;
  addLocale: (loc: Omit<LocaleEntry, 'translations' | 'aiTranslated'>) => void;
  removeLocale: (id: string) => void;
  setLocaleTranslations: (id: string, translations: Record<string, Headline>) => void;
  setLocalePillTranslations: (id: string, pills: Record<string, string>) => void;
  updateLocaleSlotAdjustment: (
    localeId: string,
    slotId: string,
    patch: { textX?: number; textY?: number; titlePx?: number; subPx?: number },
  ) => void;
  setExport: (patch: Partial<Pick<StudioState, 'destination' | 'format' | 'sizes' | 'filenamePattern' | 'folderStructure'>>) => void;
  reset: () => void;
  // Project lifecycle
  /** Snapshot the current active state into archivedProjects (or update an
   *  existing entry if loadedFromProjectId is set), then reset active to
   *  initial values. Returns the archived project's id. */
  archiveCurrentProject: () => string;
  /** Reset active state without archiving — for "Start over" / discard. */
  startNewProject: () => void;
  /** Restore an archived project into active state and remember its id so a
   *  later Export updates the same entry. */
  loadProject: (id: string) => void;

  // MARK: PPO actions
  /** Initialize an empty PPO experiment if not present. Idempotent. */
  ppoInit: () => void;
  /** Replace the entire PPO experiment (used by /api/studio-state/push). */
  ppoSetExperiment: (exp: PPOExperiment | undefined) => void;
  /** Append source screens. previewUrl is required; rest derived. */
  ppoAddSourceScreens: (screens: Array<{ previewUrl: string; serverPath?: string; byteSize?: number; filename?: string }>) => void;
  ppoRemoveSourceScreen: (id: string) => void;
  ppoReorderSourceScreens: (orderedIds: string[]) => void;
  /** Add a strategy with given title (or auto-numbered "Strategy N"). Returns id. */
  ppoAddStrategy: (title?: string) => string;
  ppoRemoveStrategy: (id: string) => void;
  ppoUpdateStrategy: (id: string, patch: Partial<Pick<PPOStrategy, 'title' | 'audience'>>) => void;
  /** Set prompt for one screen within one strategy. */
  ppoSetPrompt: (strategyId: string, screenId: string, prompt: string) => void;
  /** Update one cell's generation result (called from server response handler). */
  ppoSetGeneration: (strategyId: string, screenId: string, gen: Partial<PPOGeneration>) => void;
  /** Active strategy in UI focus. */
  ppoSetActiveStrategy: (id: string | undefined) => void;
  /** Drop a source screen from a strategy (removes both prompt + generation). */
  ppoRemoveScreenFromStrategy: (strategyId: string, screenId: string) => void;
  /** Fold/unfold a single strategy card. Empty list = all open by default. */
  ppoToggleStrategyCollapsed: (strategyId: string) => void;
  /** Switch the experiment between iPhone and iPad targets. Affects
   *  generation input size, tile aspect ratio, and export upscale dims. */
  ppoSetDevice: (device: 'iphone' | 'ipad') => void;
  /** Snapshot the current PPO experiment into archivedPPOExperiments. If a
   *  session is loaded (loadedFromPPOSessionId set) — update in place;
   *  otherwise create a new entry. Returns the session id. */
  ppoSaveSession: (title?: string) => string;
  /** Restore a saved PPO session into ppo state. */
  ppoLoadSession: (id: string) => void;
  /** Drop a saved PPO session. */
  ppoDeleteSession: (id: string) => void;
  /** Remove an archived project from the list. */
  deleteProject: (id: string) => void;
  /** Duplicate all iPhone slots as iPad slots, switching devices to 'both'. */
  addIpadVariant: () => void;
}

/** Frozen snapshot of a PPO experiment — shows up in /setup → Recent PPO. */
export interface ArchivedPPOExperiment {
  id: string;
  createdAt: number;
  savedAt: number;
  /** User-editable label for the Recent grid; defaults to "PPO 2026-05-07". */
  title: string;
  /** Cached so the grid renders without hydrating full state. */
  appName: string;
  strategyCount: number;
  /** Total successful renders across all strategies. */
  renderedCount: number;
  /** First done aiImageUrl for thumbnail; null if nothing rendered yet. */
  thumbUrl: string | null;
  state: {
    sourceScreens: PPOSourceScreen[];
    strategies: PPOStrategy[];
    activeStrategyId?: string;
    collapsedStrategyIds?: string[];
  };
}

/** Frozen snapshot of a project — what shows up in /setup → Recent. */
export interface ArchivedProject {
  id: string;
  /** Local timestamps for sorting + UI display. */
  createdAt: number;
  archivedAt: number;
  /** Cached preview metadata so the Recent grid renders without rehydrating. */
  appName: string;
  appColor: string;
  presetId: string | null;
  presetName: string;
  /** First hero AI render — used as thumbnail. Falls back to first slot's
   *  sourceUrl when no hero was generated. */
  thumbUrl: string | null;
  slotCount: number;
  /** Full state needed to re-open the project in Editor. */
  state: {
    appName: string;
    appColor: string;
    appIconUrl: string | null;
    devices: Devices;
    outputFolder: string;
    selectedPresetId: string | null;
    screenshots: Screenshot[];
    locales: LocaleEntry[];
  };
}

const initial = {
  appName: '',
  appColor: '#3B82F6',
  appIconUrl: null as string | null,
  devices: 'iphone' as Devices,
  outputFolder: '',
  selectedPresetId: null,
  catalogFilter: 'all' as const,
  screenshots: [] as Screenshot[],
  activeScreenshotId: null,
  viewMode: 'scaffold' as const,
  previewDevice: 'iphone' as const,
  locales: [] as LocaleEntry[],
  destination: 'local' as const,
  format: 'png' as const,
  sizes: { iphone: true, ipad: false },
  filenamePattern: '{app}_{locale}_{n}_{size}.{ext}',
  folderStructure: 'per-locale' as const,
  multiSelect: [] as string[],
  aiSpent: 0,
  aiCallCount: 0,
  loadedFromProjectId: undefined as string | undefined,
  loadedFromPPOSessionId: undefined as string | undefined,
  archivedProjects: [] as ArchivedProject[],
  archivedPPOExperiments: [] as ArchivedPPOExperiment[],
};

/** Subset of `initial` reset on "new project" — preserves archive + ai-spend. */
const projectInitial = {
  appName: '',
  appColor: '#3B82F6',
  appIconUrl: null as string | null,
  devices: 'iphone' as Devices,
  outputFolder: '',
  selectedPresetId: null as string | null,
  catalogFilter: 'all' as const,
  screenshots: [] as Screenshot[],
  activeScreenshotId: null as string | null,
  viewMode: 'scaffold' as const,
  previewDevice: 'iphone' as const,
  locales: [] as LocaleEntry[],
  multiSelect: [] as string[],
  loadedFromProjectId: undefined as string | undefined,
  ppo: undefined as PPOExperiment | undefined,
};

// MARK: - PPO (Product Page Optimization) types

export interface PPOSourceScreen {
  /** Stable id — uuid-ish. */
  id: string;
  /** Filename used for export (e.g. "1.png"). Auto-assigned in upload order. */
  filename: string;
  /** Local preview URL (data:/blob:) — for thumbnails in UI. */
  previewUrl: string;
  /** Disk path served by /api or local file ref — used as inputImage in hero gen. */
  serverPath?: string;
  /** Original raw bytes size (bytes), for sanity / size warnings. */
  byteSize?: number;
  uploadedAt: number;
}

export interface PPOGeneration {
  generateState: 'idle' | 'generating' | 'done' | 'error';
  aiImageUrl?: string;
  lastPrompt?: string;
  errorMessage?: string;
  /** Last 8 successful renders for re-pick after iteration. */
  aiHistory?: string[];
  /** fal.ai queue request id — set while in flight, cleared on done/error. Lets
   *  the server resume polling after a restart instead of orphaning the tile. */
  requestId?: string;
  /** fal endpoint the requestId belongs to (e.g. 'openai/gpt-image-2/edit'). */
  requestEndpoint?: string;
  /** ISO timestamp when the request was submitted to fal — used to detect
   *  abandoned/stale requests (e.g. >5min still pending → mark as error). */
  requestStartedAt?: string;
}

export interface PPOStrategy {
  id: string;
  title: string;
  /** Optional notes from discussion (audience, tone, etc.). */
  audience?: string;
  /** screenId → prompt the user wrote for THIS strategy on THAT screen. */
  prompts: Record<string, string>;
  /** screenId → generation result for THIS strategy on THAT screen. */
  generations: Record<string, PPOGeneration>;
}

export interface PPOExperiment {
  /** Source screens uploaded once, replicated across strategies. */
  sourceScreens: PPOSourceScreen[];
  strategies: PPOStrategy[];
  activeStrategyId?: string;
  /** Strategies that are folded in the UI — empty/missing = all expanded.
   *  Default behaviour is "all open" so users see every strategy at a glance;
   *  individual cards can be collapsed via the chevron. */
  collapsedStrategyIds?: string[];
  /** Device target for the whole experiment. Affects: gpt-image-2 input size
   *  (768×1664 iPhone vs 768×1024 iPad), preview tile aspect ratio, and
   *  export upscale target (1290×2796 vs 2064×2752 for ASC). Defaults to
   *  iphone when missing — older saved sessions don't have this field. */
  device?: 'iphone' | 'ipad';
}

const CANVAS_W_FOR_PAIR = 1290;

const newId = () => Math.random().toString(36).slice(2, 10);

export const useStudio = create<StudioState>()(
  persist(
    (set) => ({
      ...initial,
      setProject: (patch) => set(patch),
      pickPreset: (id) =>
        set((state) => {
          const preset = PRESETS.find((p) => p.id === id);
          // Without samples, fall back to old behaviour: just update presetId.
          if (!preset?.samples?.length) {
            // Switching to a sample-less preset — clear pill + bg seeds from the
            // previous template so they don't bleed into the new look.
            return {
              selectedPresetId: id,
              screenshots: state.screenshots.map((s) => ({
                ...s,
                presetId: id,
                pill: undefined,
                pillBg: undefined,
                pillFg: undefined,
                backgroundOverride: null,
              })),
            };
          }
          // Action (hero) slots adapt fully to the new template — visual layout +
          // default headline + heroPrompt all swap to the new style. App-specific
          // data (themeHint, ingredients, ingredientParams, hideDevice) survives
          // because it describes the app, not the style. The previous AI render
          // and history are dropped — that PNG was baked in the old style and
          // would no longer match.
          const heroSample = preset.samples[0];
          // Hero gets its OWN device pose — feature-slot poses (sample.device.*)
          // are tuned for a clipped-at-bottom drama look, but a hero needs the
          // full phone visible inside the canvas, slightly tilted, centred in
          // the lower 75% so AI doesn't mimic the empty bottom margin.
          const heroSeed = heroSample
            ? {
                backgroundOverride: heroSample.bgColor ?? null,
                pill: heroSample.pill,
                pillBg: heroSample.pillBg,
                pillFg: heroSample.pillFg,
                font: preset.text.font,
                titlePx: heroSample.text?.titlePx,
                subPx: heroSample.text?.subPx,
                textYFraction: heroSample.text?.yFraction,
                deviceX: 0,
                deviceY: -650,
                deviceScale: 0.85,
                tiltDeg: 5,
                headline: { verb: heroSample.verb, descriptor: heroSample.descriptor, subhead: '' },
              }
            : {};
          const heroes = state.screenshots
            .filter((s) => s.kind === 'action')
            .map((s) => {
              const oldAction = s.action;
              const newAction: ActionData = {
                primary: oldAction?.primary ?? '1K+ Ratings',
                secondary: oldAction?.secondary ?? '4.9 Average',
                showStars: oldAction?.showStars ?? true,
                hideDevice: oldAction?.hideDevice ?? false,
                themeHint: oldAction?.themeHint ?? '',
                ingredients: oldAction?.ingredients,
                ingredientParams: oldAction?.ingredientParams,
                useCustomPrompt: !!preset.heroPrompt,
                customPrompt: preset.heroPrompt,
                aiImageUrl: null,
                aiHistory: [],
                aiOffsetX: 0,
                aiOffsetY: 0,
                aiScale: 1,
                lastPrompt: null,
                generateState: 'idle',
              };
              return { ...s, ...heroSeed, presetId: id, action: newAction };
            });
          // Regular slots map 1:1 onto preset.samples by index — uploaded sourceUrls
          // are preserved per slot.
          const existingRegulars = state.screenshots.filter((s) => s.kind === 'regular');
          const merged: Screenshot[] = preset.samples.map((sample, i) => {
            const old = existingRegulars[i];
            return {
              id: old?.id ?? newId(),
              filename: old?.filename ?? `screenshot-${i + 1}.png`,
              sourceUrl: old?.sourceUrl ?? null,
              enhancedUrl: old?.enhancedUrl ?? null,
              presetId: id,
              // pickPreset = clean apply: take the new sample's bgColor as the slot
              // background, ignoring whatever the previous preset / user override was.
              // Reset Template reuses this code path — same semantics.
              backgroundOverride: sample.bgColor ?? null,
              headline: { verb: sample.verb, descriptor: sample.descriptor, subhead: '' },
              pill: sample.pill,
              pillBg: sample.pillBg,
              pillFg: sample.pillFg,
              font: preset.text.font,
              fontSize: 48,
              // Sample's per-screen device transform — copy ALL fields so cross-pair
              // tilt (rotateZ) survives into the editor, not just translation/scale.
              tiltDeg: sample.device?.rotateZ ?? 0,
              tiltX: 0,
              tiltY: 0,
              deviceX: sample.device?.offsetX ?? 0,
              deviceY: sample.device?.offsetY ?? 0,
              deviceScale: sample.device?.scale ?? 1,
              textX: 0,
              textY: 0,
              textYFraction: sample.text?.yFraction,
              titlePx: sample.text?.titlePx,
              subPx: sample.text?.subPx,
              sampleIndex: i,
              groupId: sample.groupId,
              breakout: false,
              pulseScreen: 0,
              enhanceState: 'idle',
              // Template-derived slots are always 'regular' — hero/action lives in a
              // separate user-added slot above. This prevents accidental promotion if
              // a previous session marked a template slot as action.
              kind: 'regular',
              action: undefined,
              // iPhone is the canonical device for template-seeded slots; iPad dupes
              // are created below with device: 'ipad'. Must be explicit so the field
              // survives JSON round-trips through the server state mirror.
              device: 'iphone' as const,
            };
          });
          // Hero(es) on top, then template feature slots in sample order.
          const screenshots = [...heroes, ...merged];
          // If project targets both devices, also seed iPad slots immediately so
          // the user doesn't have to click "+ Add iPad" after every preset switch.
          // Remap groupIds: each iPhone pair gets a fresh iPad-specific groupId so
          // iPhone and iPad cross-pairs don't merge into a 4-slot group.
          // deviceX offsets are in canvas-px and were tuned for the iPhone canvas
          // (1290px). Scale them up to iPad canvas (2048px) so the seamless split
          // still lands at the canvas edge instead of floating in the middle.
          const IPAD_CANVAS_W = 2048;
          const IPHONE_CANVAS_W = 1290;
          const iPadXScale = IPAD_CANVAS_W / IPHONE_CANVAS_W;
          const ipadGroupIdMap = new Map<string, string>();
          const ipadDupes: Screenshot[] =
            state.devices === 'both'
              ? screenshots.map((s) => {
                  let mappedGroupId: string | undefined = undefined;
                  if (s.groupId) {
                    if (!ipadGroupIdMap.has(s.groupId)) {
                      ipadGroupIdMap.set(s.groupId, `pair-${Date.now()}-${newId()}`);
                    }
                    mappedGroupId = ipadGroupIdMap.get(s.groupId);
                  }
                  return {
                    ...s,
                    id: newId(),
                    device: 'ipad' as const,
                    groupId: mappedGroupId,
                    // Rescale deviceX for the wider iPad canvas so paired slots still
                    // split the device at the canvas edge.
                    deviceX: mappedGroupId ? Math.round(s.deviceX * iPadXScale) : s.deviceX,
                    enhancedUrl: null,
                    enhanceState: 'idle' as const,
                    action: s.action
                      ? {
                          ...s.action,
                          aiImageUrl: null,
                          aiHistory: [],
                          lastPrompt: null,
                          generateState: 'idle' as const,
                        }
                      : s.action,
                  };
                })
              : [];
          const finalScreenshots = [...screenshots, ...ipadDupes];
          return {
            selectedPresetId: id,
            screenshots: finalScreenshots,
            sizes: state.devices === 'both' ? { iphone: true, ipad: true } : state.sizes,
            activeScreenshotId: finalScreenshots[0]?.id ?? state.activeScreenshotId,
          };
        }),
      setCatalogFilter: (f) => set({ catalogFilter: f }),
      addScreenshot: (s, opts) => {
        const presetForSeed = s.presetId ? PRESETS.find((p) => p.id === s.presetId) : undefined;
        // Hero slot — seed customPrompt + visual layout from preset.samples[0]
        // so a freshly added hero matches the chosen template (bg, pill, device
        // baselines, font sizes). User fills the headline themselves.
        const seedAction = s.kind === 'action' && presetForSeed?.heroPrompt
          ? { useCustomPrompt: true, customPrompt: presetForSeed.heroPrompt }
          : {};
        const heroSample = s.kind === 'action' ? presetForSeed?.samples?.[0] : undefined;
        const heroVisual = heroSample
          ? {
              backgroundOverride: heroSample.bgColor ?? null,
              pill: heroSample.pill,
              pillBg: heroSample.pillBg,
              pillFg: heroSample.pillFg,
              font: presetForSeed?.text.font ?? 'Inter',
              titlePx: heroSample.text?.titlePx,
              subPx: heroSample.text?.subPx,
              textYFraction: heroSample.text?.yFraction,
              // Hero pose — full phone visible, slightly tilted, centered in
              // the lower 75% of the canvas. Different from feature-slot poses.
              deviceX: 0,
              deviceY: -650,
              deviceScale: 0.85,
              tiltDeg: 5,
            }
          : {};
        const ss: Screenshot = {
          id: newId(),
          filename: `screenshot-${Date.now()}.png`,
          sourceUrl: null,
          enhancedUrl: null,
          presetId: '',
          backgroundOverride: null,
          headline: { verb: '', descriptor: '', subhead: '' },
          font: 'Inter',
          fontSize: 48,
          tiltDeg: 0,
          tiltX: 0,
          tiltY: 0,
          deviceX: 0,
          deviceY: 0,
          deviceScale: 1,
          textX: 0,
          textY: 0,
          breakout: true,
          pulseScreen: 0,
          enhanceState: 'idle',
          kind: 'regular',
          action: {
            primary: '1K+ Ratings',
            secondary: '4.9 Average',
            showStars: true,
            hideDevice: false,
            themeHint: '',
            aiImageUrl: null,
            lastPrompt: null,
            generateState: 'idle',
            ...seedAction,
          },
          ...heroVisual,
          ...s,
        };
        set((state) => {
          const list = [...state.screenshots];
          if (opts?.atIndex !== undefined) list.splice(opts.atIndex, 0, ss);
          else list.push(ss);
          return { screenshots: list, activeScreenshotId: ss.id };
        });
        return ss;
      },
      updateScreenshot: (id, patch) =>
        set((state) => {
          const target = state.screenshots.find((s) => s.id === id);
          if (!target) return {};
          const inGroup = !!target.groupId;
          // Fields that describe the device itself — when one slot in a group changes
          // them, they're THE SAME device, so all slots must mirror.
          const SHARED_DEVICE_FIELDS = [
            'deviceY', 'tiltDeg', 'deviceScale', 'tiltX', 'tiltY',
          ] as const;
          // sourceUrl is also shared — single upload covers the whole group.
          const propagateSrc = Object.prototype.hasOwnProperty.call(patch, 'sourceUrl');
          const xDelta = Object.prototype.hasOwnProperty.call(patch, 'deviceX')
            ? (patch.deviceX as number) - target.deviceX
            : 0;

          return {
            screenshots: state.screenshots.map((s) => {
              if (s.id === id) return { ...s, ...patch };
              if (!inGroup || s.groupId !== target.groupId) return s;
              // Group sibling — copy shared device fields verbatim, shift its own
              // deviceX by the same delta so the slot keeps its cross-offset.
              const next: Partial<Screenshot> = {};
              for (const f of SHARED_DEVICE_FIELDS) {
                if (Object.prototype.hasOwnProperty.call(patch, f)) {
                  (next as Record<string, unknown>)[f] = (patch as Record<string, unknown>)[f];
                }
              }
              if (propagateSrc) {
                next.sourceUrl = patch.sourceUrl ?? null;
                next.filename = patch.filename ?? s.filename;
              }
              if (xDelta !== 0) next.deviceX = s.deviceX + xDelta;
              return Object.keys(next).length ? { ...s, ...next } : s;
            }),
          };
        }),
      removeScreenshot: (id) =>
        set((state) => ({
          screenshots: state.screenshots.filter((s) => s.id !== id),
          activeScreenshotId: state.activeScreenshotId === id ? null : state.activeScreenshotId,
        })),
      reorderScreenshots: (orderedIds) =>
        set((state) => {
          const map = new Map(state.screenshots.map((s) => [s.id, s]));
          return { screenshots: orderedIds.map((id) => map.get(id)!).filter(Boolean) };
        }),
      setActiveScreenshot: (id) => set({ activeScreenshotId: id }),
      setViewMode: (m) => set({ viewMode: m }),
      setPreviewDevice: (d) => set({ previewDevice: d }),
      addLocale: (loc) =>
        set((state) => ({
          locales: [...state.locales, { ...loc, translations: {}, aiTranslated: false }],
        })),
      removeLocale: (id) => set((state) => ({ locales: state.locales.filter((l) => l.id !== id) })),
      setLocaleTranslations: (id, translations) =>
        set((state) => ({
          locales: state.locales.map((l) =>
            l.id === id ? { ...l, translations: { ...l.translations, ...translations }, aiTranslated: true } : l,
          ),
        })),
      setLocalePillTranslations: (id, pills) =>
        set((state) => ({
          locales: state.locales.map((l) =>
            l.id === id ? { ...l, pillTranslations: { ...(l.pillTranslations ?? {}), ...pills } } : l,
          ),
        })),
      updateLocaleSlotAdjustment: (localeId, slotId, patch) =>
        set((state) => ({
          locales: state.locales.map((l) => {
            if (l.id !== localeId) return l;
            const adj = l.slotAdjustments ?? {};
            const slot = adj[slotId] ?? {};
            return {
              ...l,
              slotAdjustments: { ...adj, [slotId]: { ...slot, ...patch } },
            };
          }),
        })),
      setExport: (patch) => set(patch),

      toggleMultiSelect: (id) =>
        set((state) => ({
          multiSelect: state.multiSelect.includes(id)
            ? state.multiSelect.filter((x) => x !== id)
            : [...state.multiSelect, id],
        })),
      clearMultiSelect: () => set({ multiSelect: [] }),

      pairSelected: () =>
        set((state) => {
          const ids = state.multiSelect;
          if (ids.length < 2) return {};
          // Order pair members by their on-screen order, not by click order.
          const ordered = state.screenshots.filter((s) => ids.includes(s.id)).map((s) => s.id);
          const N = ordered.length;
          const groupId = `pair-${Date.now()}`;
          const canonical = state.screenshots.find((s) => s.id === ordered[0])!;
          // Use canvas width matching the device family so the split lands at the edge.
          const canvasW = canonical.device === 'ipad' ? 2048 : CANVAS_W_FOR_PAIR;
          // Apply pair fields, then reorder so paired slots are consecutive (they
          // form one continuous phone — they MUST be adjacent in the App Store strip).
          const insertAt = state.screenshots.findIndex((s) => s.id === ordered[0]);
          const transformed = state.screenshots.map((s) => {
            const idx = ordered.indexOf(s.id);
            if (idx < 0) return s;
            const newDeviceX = ((N - 1) / 2 - idx) * canvasW;
            return {
              ...s,
              groupId,
              sourceUrl: canonical.sourceUrl,
              filename: canonical.filename,
              deviceX: newDeviceX,
              deviceY: canonical.deviceY,
              tiltDeg: canonical.tiltDeg,
              deviceScale: canonical.deviceScale,
              tiltX: canonical.tiltX,
              tiltY: canonical.tiltY,
            };
          });
          const groupItems = ordered
            .map((id) => transformed.find((s) => s.id === id)!)
            .filter(Boolean);
          const others = transformed.filter((s) => !ordered.includes(s.id));
          // Re-insert grouped members consecutively at the slot of the first selection.
          const reordered = [
            ...others.slice(0, insertAt),
            ...groupItems,
            ...others.slice(insertAt),
          ];
          return { multiSelect: [], screenshots: reordered };
        }),

      unpairGroup: (groupId) =>
        set((state) => ({
          screenshots: state.screenshots.map((s) =>
            s.groupId === groupId ? { ...s, groupId: undefined, deviceX: 0 } : s,
          ),
        })),

      bumpAiSpent: (cost = 0.05) =>
        set((state) => ({
          aiSpent: +(state.aiSpent + cost).toFixed(4),
          aiCallCount: state.aiCallCount + 1,
        })),
      resetAiSpent: () => set({ aiSpent: 0, aiCallCount: 0 }),

      // MARK: PPO actions
      ppoInit: () =>
        set((state) => {
          if (state.ppo) return state;
          return { ppo: { sourceScreens: [], strategies: [], activeStrategyId: undefined } };
        }),
      ppoSetExperiment: (exp) => set({ ppo: exp }),
      ppoAddSourceScreens: (screens) =>
        set((state) => {
          const existing = state.ppo ?? { sourceScreens: [], strategies: [] };
          const startIndex = existing.sourceScreens.length;
          const newScreens: PPOSourceScreen[] = screens.map((s, i) => ({
            id: newId(),
            filename: s.filename ?? `${startIndex + i + 1}.png`,
            previewUrl: s.previewUrl,
            serverPath: s.serverPath,
            byteSize: s.byteSize,
            uploadedAt: Date.now(),
          }));
          return {
            ppo: {
              ...existing,
              sourceScreens: [...existing.sourceScreens, ...newScreens],
            },
          };
        }),
      ppoRemoveSourceScreen: (id) =>
        set((state) => {
          if (!state.ppo) return state;
          const sourceScreens = state.ppo.sourceScreens.filter((s) => s.id !== id);
          // Drop any prompts/generations referring to the removed screen.
          const strategies = state.ppo.strategies.map((str) => {
            const { [id]: _droppedPrompt, ...prompts } = str.prompts;
            const { [id]: _droppedGen, ...generations } = str.generations;
            void _droppedPrompt;
            void _droppedGen;
            return { ...str, prompts, generations };
          });
          return { ppo: { ...state.ppo, sourceScreens, strategies } };
        }),
      ppoReorderSourceScreens: (orderedIds) =>
        set((state) => {
          if (!state.ppo) return state;
          const byId = new Map(state.ppo.sourceScreens.map((s) => [s.id, s]));
          const reordered = orderedIds
            .map((id) => byId.get(id))
            .filter((s): s is PPOSourceScreen => Boolean(s));
          // Re-number filenames so export order matches visual order.
          const renumbered = reordered.map((s, i) => ({ ...s, filename: `${i + 1}.png` }));
          return { ppo: { ...state.ppo, sourceScreens: renumbered } };
        }),
      ppoAddStrategy: (title) => {
        const id = newId();
        set((state) => {
          const existing = state.ppo ?? { sourceScreens: [], strategies: [] };
          const fallbackTitle = `Strategy ${existing.strategies.length + 1}`;
          const newStrategy: PPOStrategy = {
            id,
            title: title?.trim() || fallbackTitle,
            prompts: {},
            generations: {},
          };
          return {
            ppo: {
              ...existing,
              strategies: [...existing.strategies, newStrategy],
              activeStrategyId: existing.activeStrategyId ?? id,
            },
          };
        });
        return id;
      },
      ppoRemoveStrategy: (id) =>
        set((state) => {
          if (!state.ppo) return state;
          const strategies = state.ppo.strategies.filter((s) => s.id !== id);
          const activeStrategyId =
            state.ppo.activeStrategyId === id ? strategies[0]?.id : state.ppo.activeStrategyId;
          return { ppo: { ...state.ppo, strategies, activeStrategyId } };
        }),
      ppoUpdateStrategy: (id, patch) =>
        set((state) => {
          if (!state.ppo) return state;
          const strategies = state.ppo.strategies.map((s) =>
            s.id === id ? { ...s, ...patch } : s,
          );
          return { ppo: { ...state.ppo, strategies } };
        }),
      ppoSetPrompt: (strategyId, screenId, prompt) =>
        set((state) => {
          if (!state.ppo) return state;
          const strategies = state.ppo.strategies.map((s) =>
            s.id === strategyId
              ? { ...s, prompts: { ...s.prompts, [screenId]: prompt } }
              : s,
          );
          return { ppo: { ...state.ppo, strategies } };
        }),
      ppoSetGeneration: (strategyId, screenId, gen) =>
        set((state) => {
          if (!state.ppo) return state;
          const strategies = state.ppo.strategies.map((s) => {
            if (s.id !== strategyId) return s;
            const prev = s.generations[screenId] ?? { generateState: 'idle' as const };
            return {
              ...s,
              generations: { ...s.generations, [screenId]: { ...prev, ...gen } },
            };
          });
          return { ppo: { ...state.ppo, strategies } };
        }),
      ppoSetActiveStrategy: (id) =>
        set((state) => {
          if (!state.ppo) return state;
          return { ppo: { ...state.ppo, activeStrategyId: id } };
        }),
      ppoRemoveScreenFromStrategy: (strategyId, screenId) =>
        set((state) => {
          if (!state.ppo) return state;
          const strategies = state.ppo.strategies.map((s) => {
            if (s.id !== strategyId) return s;
            const { [screenId]: _droppedPrompt, ...prompts } = s.prompts;
            const { [screenId]: _droppedGen, ...generations } = s.generations;
            void _droppedPrompt;
            void _droppedGen;
            return { ...s, prompts, generations };
          });
          return { ppo: { ...state.ppo, strategies } };
        }),
      ppoToggleStrategyCollapsed: (strategyId) =>
        set((state) => {
          if (!state.ppo) return state;
          const current = state.ppo.collapsedStrategyIds ?? [];
          const next = current.includes(strategyId)
            ? current.filter((id) => id !== strategyId)
            : [...current, strategyId];
          return { ppo: { ...state.ppo, collapsedStrategyIds: next } };
        }),
      ppoSetDevice: (device) =>
        set((state) => (state.ppo ? { ppo: { ...state.ppo, device } } : state)),

      ppoSaveSession: (title) => {
        const state = useStudio.getState();
        const ppo = state.ppo;
        if (!ppo) return '';
        const now = Date.now();
        // Pick the first done aiImageUrl across all strategies as the thumb.
        let thumbUrl: string | null = null;
        let renderedCount = 0;
        for (const s of ppo.strategies) {
          for (const g of Object.values(s.generations)) {
            if (g.generateState === 'done' && g.aiImageUrl) {
              renderedCount += 1;
              if (!thumbUrl) thumbUrl = g.aiImageUrl;
            }
          }
        }
        const existingId = state.loadedFromPPOSessionId;
        const id = existingId ?? newId();
        const previous = existingId
          ? state.archivedPPOExperiments.find((p) => p.id === existingId)
          : undefined;
        const defaultTitle = `${state.appName || 'PPO'} · ${new Date(now).toISOString().slice(0, 10)}`;
        const session: ArchivedPPOExperiment = {
          id,
          createdAt: previous?.createdAt ?? now,
          savedAt: now,
          title: title ?? previous?.title ?? defaultTitle,
          appName: state.appName || 'Untitled',
          strategyCount: ppo.strategies.length,
          renderedCount,
          thumbUrl,
          state: {
            sourceScreens: ppo.sourceScreens,
            strategies: ppo.strategies,
            activeStrategyId: ppo.activeStrategyId,
            collapsedStrategyIds: ppo.collapsedStrategyIds,
          },
        };
        const others = state.archivedPPOExperiments.filter((p) => p.id !== id);
        set({
          archivedPPOExperiments: [session, ...others],
          loadedFromPPOSessionId: id,
        });
        return id;
      },

      ppoLoadSession: (id) => {
        const state = useStudio.getState();
        const session = state.archivedPPOExperiments.find((p) => p.id === id);
        if (!session) return;
        set({
          ppo: {
            sourceScreens: session.state.sourceScreens,
            strategies: session.state.strategies,
            activeStrategyId: session.state.activeStrategyId,
            collapsedStrategyIds: session.state.collapsedStrategyIds ?? [],
          },
          loadedFromPPOSessionId: session.id,
        });
      },

      ppoDeleteSession: (id) =>
        set((state) => ({
          archivedPPOExperiments: state.archivedPPOExperiments.filter((p) => p.id !== id),
          loadedFromPPOSessionId:
            state.loadedFromPPOSessionId === id ? undefined : state.loadedFromPPOSessionId,
        })),

      reset: () => set(initial),

      archiveCurrentProject: () => {
        const state = useStudio.getState();
        const presetName = state.selectedPresetId
          ? PRESETS.find((p) => p.id === state.selectedPresetId)?.name ?? state.selectedPresetId
          : '—';
        const hero = state.screenshots.find((s) => s.kind === 'action');
        const thumbUrl =
          hero?.action?.aiImageUrl ?? state.screenshots[0]?.sourceUrl ?? null;
        const existingId = state.loadedFromProjectId;
        const id = existingId ?? newId();
        const now = Date.now();
        const previous = existingId
          ? state.archivedProjects.find((p) => p.id === existingId)
          : undefined;
        const project: ArchivedProject = {
          id,
          createdAt: previous?.createdAt ?? now,
          archivedAt: now,
          appName: state.appName || 'Untitled',
          appColor: state.appColor,
          presetId: state.selectedPresetId,
          presetName,
          thumbUrl,
          slotCount: state.screenshots.length,
          state: {
            appName: state.appName,
            appColor: state.appColor,
            appIconUrl: state.appIconUrl,
            devices: state.devices,
            outputFolder: state.outputFolder,
            selectedPresetId: state.selectedPresetId,
            screenshots: state.screenshots,
            locales: state.locales,
          },
        };
        const otherProjects = state.archivedProjects.filter((p) => p.id !== id);
        // Newest first.
        const archivedProjects = [project, ...otherProjects];
        set({ ...projectInitial, archivedProjects });
        return id;
      },

      startNewProject: () => set({ ...projectInitial }),

      loadProject: (id) => {
        const state = useStudio.getState();
        const project = state.archivedProjects.find((p) => p.id === id);
        if (!project) return;
        set({
          ...projectInitial,
          ...project.state,
          activeScreenshotId: project.state.screenshots[0]?.id ?? null,
          loadedFromProjectId: project.id,
        });
      },

      deleteProject: (id) =>
        set((state) => ({
          archivedProjects: state.archivedProjects.filter((p) => p.id !== id),
          // If the active project came from this entry, decouple — Export
          // will create a new archive entry instead of trying to update a
          // deleted one.
          loadedFromProjectId:
            state.loadedFromProjectId === id ? undefined : state.loadedFromProjectId,
        })),

      addIpadVariant: () =>
        set((state) => {
          const iphoneSlots = state.screenshots.filter(
            (s) => !s.device || s.device === 'iphone',
          );
          // Remap groupIds so iPad pairs are independent from iPhone pairs.
          // Also rescale deviceX offsets from iPhone canvas (1290px) to iPad (2048px).
          const IPAD_CW = 2048;
          const IPHONE_CW = 1290;
          const xScale = IPAD_CW / IPHONE_CW;
          const ipadGroupIdMap = new Map<string, string>();
          const ipadSlots: Screenshot[] = iphoneSlots.map((s) => {
            let mappedGroupId: string | undefined = undefined;
            if (s.groupId) {
              if (!ipadGroupIdMap.has(s.groupId)) {
                ipadGroupIdMap.set(s.groupId, `pair-${Date.now()}-${newId()}`);
              }
              mappedGroupId = ipadGroupIdMap.get(s.groupId);
            }
            return {
              ...s,
              id: newId(),
              device: 'ipad' as 'ipad',
              groupId: mappedGroupId,
              deviceX: mappedGroupId ? Math.round(s.deviceX * xScale) : s.deviceX,
              // Clear AI-generated renders — iPad canvas is different dimensions
              // and the existing iPhone renders won't fit without regeneration.
              enhancedUrl: null,
              enhanceState: 'idle' as const,
              action: s.action
                ? {
                    ...s.action,
                    aiImageUrl: null,
                    aiHistory: [],
                    lastPrompt: null,
                    generateState: 'idle' as const,
                  }
                : s.action,
            };
          });
          return {
            devices: 'both',
            previewDevice: 'ipad',
            sizes: { iphone: true, ipad: true },
            screenshots: [...state.screenshots, ...ipadSlots],
            activeScreenshotId: ipadSlots[0]?.id ?? state.activeScreenshotId,
          };
        }),
    }),
    { name: 'aso-studio' },
  ),
);
