import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const masterUrl = '/video/hair-app/model-master-v7-scan-identity.png';
const scanStartUrl = '/video/hair-app/scan-06-eyes-closed-mask-start.png';
const hookExtension = 0.55;
const voiceSyncShift = 0.42;
const timelineShift = hookExtension + voiceSyncShift;
const scanTailTrim = 0.96;
const baseCuts = [
  { start: 0.00, end: 0.90, label: 'Hook 01 · home ponytail', prompt: 'ordinary loose low at-home ponytail with slightly uneven crown volume, soft face-framing strands and a few controlled flyaways', performance: 'preserve the master expression exactly: calm neutral face, relaxed closed lips and direct eye contact; opening phase of a subtle blink', outputUrl: '/video/hair-app/hook-01-home-ponytail-v2.png' },
  { start: 0.90, end: 1.70, label: 'Hook 02 · wider bob', prompt: 'chin-length voluminous blonde bob with outward waves concentrated at cheek level', performance: 'subtle three-quarter view toward camera-left, head turned about 12 degrees, eyebrows naturally raised, eyes slightly widened and lips gently parted in a believable surprised doubtful reaction', accessories: 'ivory off-shoulder knit top and tiny pearl stud earrings', outputUrl: '/video/hair-app/hook-02-wider-fal.png' },
  { start: 1.70, end: 2.50, label: 'Hook 03 · asymmetric', prompt: 'asymmetric blonde style with a deep side part, large side-swept wave and the other side tucked behind the ear', performance: 'three-quarter view toward camera-right, head turned about 15 degrees and gaze slightly off-camera', accessories: 'black satin square-neck top and one small sculptural gold earring on the tucked side', outputUrl: '/video/hair-app/hook-03-unbalanced-fal.png' },
  { start: 2.50, end: 3.30, label: 'Hook 04 · centered layers', prompt: 'long symmetrical champagne-blonde face-framing layers with a precise center part and balanced volume', performance: 'almost frontal, head angled four degrees and chin slightly lifted with a calm confident expression', accessories: 'tailored cream blazer over a neutral top and tiny understated gold studs', outputUrl: '/video/hair-app/hook-04-centered-fal.png' },
  { start: 3.30, end: 3.67, label: 'Hook 05 · shorter fringe', prompt: 'collarbone-length textured blonde lob with full airy curtain bangs and volume around the temples and cheekbones', performance: 'three-quarter toward camera-left with a gentle ten-degree head turn and slight chin drop', accessories: 'muted dusty-rose boat-neck top and one delicate short gold chain necklace', outputUrl: '/video/hair-app/hook-05-shorter-fal-9x16.png' },
  { start: 3.67, end: 7.63, label: 'Scan base · eyes closed', prompt: 'sleek straight blonde hair with a precise center part, tucked behind the shoulders', performance: 'both eyes naturally and fully closed, calm still face; opening phase before she slowly opens her eyes', accessories: 'no jewelry; add only the first 5 percent of a thin luminous pink face-scanning contour as two short arcs at the upper forehead and temples with no more than three tracking points; leave the rest of the face clear, with no complete mask and no full mesh', outputUrl: scanStartUrl },
  { start: 7.63, end: 8.48, label: 'Result 01 · textured bob', prompt: 'layered textured blonde bob', performance: 'high-fashion editorial gaze: relaxed neutral eyebrows, slightly lowered eyelids, quiet direct eye contact, lips only barely parted on a soft controlled exhale and chin lowered a few millimeters; poised and magnetic, with no recognizable surprise or smile', accessories: 'black strapless top and no jewelry', outputUrl: '/video/hair-app/result-01-textured-bob-fashion.png' },
  { start: 8.48, end: 9.48, label: 'Result 02 · textured bob alt', prompt: 'layered textured blonde bob with fuller airy volume', performance: 'high-fashion three-quarter pose, head tilted eight degrees right, eyes looking through the lens with calm confidence, lips softly closed and one shoulder subtly leading; no smile or reaction face', accessories: 'ivory square-neck top and small pearl drop earrings', outputUrl: '/video/hair-app/result-02-full-bob-fashion.png' },
  { start: 9.48, end: 10.58, label: 'Result 03 · Hollywood waves', prompt: 'long polished blonde Hollywood waves', performance: 'editorial side glance with heavy relaxed eyelids and a controlled almost-smile, head angled fifteen degrees left, fingertips already resting on the lower hair; opening phase of slowly brushing the waves', accessories: 'deep burgundy satin top, delicate minimal gold necklace and tiny matching gold studs', outputUrl: '/video/hair-app/result-03-hollywood-waves-fashion.png' },
  { start: 10.58, end: 11.43, label: 'Result 04 · sleek straight', prompt: 'sleek straight blonde hair', performance: 'serene powerful runway expression, eyes steady and slightly narrowed, lips relaxed, chin lifted a few millimeters; opening phase of a slow head turn toward camera-right', accessories: 'structured white blazer and no jewelry', outputUrl: '/video/hair-app/result-04-sleek-fashion.png' },
  { start: 11.43, end: 12.23, label: 'Result 05 · curly French bob', prompt: 'short curly blonde French bob with soft fringe', performance: 'soft fashion-campaign gaze slightly past camera, relaxed eyelids, lips faintly parted on a quiet exhale, head tilted slightly right and fingertips touching one curl; opening phase of gently lifting the curl, no broad smile', accessories: 'dusty-blue boat-neck top, small thin polished gold hoops and no necklace', outputUrl: '/video/hair-app/result-05-curly-bob-fashion.png' },
  { start: 12.23, end: 12.43, label: 'Drum 01', prompt: 'short curly French bob' },
  { start: 12.43, end: 12.63, label: 'Drum 02', prompt: 'layered shoulder-length brunette hair' },
  { start: 12.63, end: 12.90, label: 'Drum 03', prompt: 'sleek high ponytail' },
  { start: 12.90, end: 13.10, label: 'Drum 04', prompt: 'straight bob with blunt bangs' },
  { start: 13.10, end: 13.30, label: 'Drum 05', prompt: 'long loose brunette curls' },
  { start: 13.30, end: 13.47, label: 'Drum 06', prompt: 'smooth elegant updo' },
  { start: 13.47, end: 13.67, label: 'Drum 07', prompt: 'short pixie cut' },
  { start: 13.67, end: 13.87, label: 'Drum 08', prompt: 'layered textured bob' },
  { start: 13.87, end: 14.07, label: 'Drum 09', prompt: 'long center-parted layers' },
  { start: 14.07, end: 14.27, label: 'Drum 10', prompt: 'curly French bob' },
  { start: 14.27, end: 14.47, label: 'Drum 11', prompt: 'sleek straight hair' },
  { start: 14.47, end: 14.67, label: 'Drum 12', prompt: 'soft Hollywood waves' },
  { start: 14.67, end: 14.83, label: 'Drum 13', prompt: 'messy high bun' },
  { start: 14.83, end: 15.03, label: 'Drum 14', prompt: 'long waves with curtain bangs' },
  { start: 15.03, end: 15.23, label: 'Drum 15', prompt: 'jaw-length rounded bob' },
  { start: 15.23, end: 15.43, label: 'Drum 16', prompt: 'high ponytail with face-framing strands' },
  { start: 15.43, end: 15.63, label: 'Drum 17', prompt: 'long glossy loose curls' },
  { start: 15.63, end: 15.80, label: 'Drum 18', prompt: 'straight lob with wispy bangs' },
  { start: 15.80, end: 16.03, label: 'Drum 19', prompt: 'sleek low bun' },
  { start: 16.03, end: 16.20, label: 'Drum 20', prompt: 'layered textured bob' },
];
const cuts = baseCuts.map((cut, index) => {
  if (index === 4) return { ...cut, end: cut.end + timelineShift };
  if (index === 5) return {
    ...cut,
    start: cut.start + timelineShift,
    end: cut.end + timelineShift - scanTailTrim,
  };
  if (index >= 6) return {
    ...cut,
    start: cut.start + timelineShift - scanTailTrim,
    end: cut.end + timelineShift - scanTailTrim,
  };
  return cut;
});
const motionPrompts = [
  'Natural fashion-film micro-motion: one soft blink, a quiet exhale and an almost imperceptible head settle. Keep identity, hair and wardrobe stable; real-time speed, locked camera.',
  'Editorial beauty motion: eyes return calmly to the lens, lips close softly after a breath, tiny shoulder settle. No surprise, no talking, no identity or hairstyle drift.',
  'Fashion three-quarter pose: gaze glides back toward camera while the side-swept hair moves only slightly from inertia. Controlled real-time movement, locked camera.',
  'Runway micro-performance: chin lifts a few millimeters, one slow blink and subtle breathing. Symmetrical layers remain stable, no morphing.',
  'Editorial close-up: a tiny head turn finishes and curtain fringe settles naturally. Quiet exhale, heavy relaxed gaze, no smile or face change.',
  'Both eyes begin closed, then open slowly and calmly while the thin pink scan contour grows progressively from forehead to the rest of the face. Locked head and camera, no identity drift.',
  'High-fashion beauty motion: quiet direct gaze, one soft blink and controlled exhale; textured bob moves minimally. No reaction face.',
  'Three-quarter fashion pose with a subtle shoulder lead and a slow eye movement through the lens. Fuller bob breathes slightly, no smile.',
  'Slow editorial side glance while fingertips brush the lower Hollywood waves once. Hair follows with realistic weight, real-time speed.',
  'Serene runway motion: slow small head turn toward camera-right, steady eyes and barely visible breathing. Sleek hair remains straight and stable.',
  'Soft campaign gaze past camera while fingertips gently lift and release one curl. Curly bob bounces once with realistic weight; no broad smile.',
];

const nodes = [
  {
    id: 'hair-model-master',
    type: 'image-gen',
    position: { x: 40, y: 40 },
    data: {
      label: 'MASTER IDENTITY — generate first',
      model: 'gpt-image-2',
      quality: 'medium',
      aspectRatio: '9:16',
      usage: 'character',
      identityLock: true,
      prompt: 'Vertical 9:16 ultra-photorealistic premium beauty identity master based on the approved scan-scene woman. Preserve her recognizable soft-heart/oval face, subtle natural asymmetry, pale green-hazel eyes, faint beauty marks, restrained irregular skin texture, taupe professional makeup and calm neutral expression. Straight champagne-beige blonde baseline hair with a clean center part resting naturally behind the shoulders, neither glamorous nor messy. Large soft key 35 degrees camera-left and above, weak fill, negative fill camera-right with soft cheek/nose/jaw shadows, delicate hair rim and separately lit darker pearl-grey background. Real full-frame 85mm cosmetics photography with restrained retouching. No scan graphics, mathematically perfect symmetry, plastic skin, ring light, jewelry, text, logo, UI or watermark.',
      outputUrl: masterUrl,
      status: 'done',
      cost: 0
    },
  },
  ...cuts.map((cut, index) => ({
    id: `hair-frame-${String(index + 1).padStart(2, '0')}`,
    type: 'image-edit',
    position: { x: 440 + Math.floor(index / 8) * 360, y: 40 + (index % 8) * 480 },
    data: {
      label: cut.label,
      usage: 'asset',
      sourceIdentityNode: 'hair-model-master',
      model: 'nano-banana-2-edit',
      prompt: `Create the exact starting still for this short video shot. Change the hairstyle to ${cut.prompt}. Set the performance to: ${cut.performance ?? 'calm attractive expression, natural head angle, prepared for a tiny real-time motion'}. Accessories and shot-specific additions: ${cut.accessories ?? 'no jewelry or additional objects'}. Preserve the exact same adult blonde woman's identity, subtle natural facial asymmetry, realistic skin texture, body, wardrobe, camera angle, crop, dimensional camera-left beauty key, weak fill, camera-right negative fill, hair rim and darker pearl-grey background. Keep wardrobe and identity perfectly consistent. The pose and any scan graphic must already be the natural first phase of the requested motion so the animation model can continue without snapping from an empty or neutral frame. No text, logos, interface or watermark.`,
      outputUrl: cut.outputUrl ?? masterUrl,
      status: cut.outputUrl ? 'done' : 'idle',
      transitionIn: index === 5
        ? { type: 'slide-bounce-up', duration: 0.52 }
        : index >= 7 && index <= 10
          ? { type: 'mask-wipe', duration: 0.22 }
          : undefined,
      timeline: {
        start: cut.start,
        duration: Number((cut.end - cut.start).toFixed(3)),
        track: 0,
        role: 'video',
        label: cut.label,
        layout: { x: 0, y: 0, width: 100, height: 100, opacity: 1 },
      },
    },
  })),
  ...cuts.slice(0, 11).map((cut, index) => ({
    id: `hair-motion-${String(index + 1).padStart(2, '0')}`,
    type: 'video-gen',
    position: { x: 1960 + Math.floor(index / 6) * 380, y: 40 + (index % 6) * 480 },
    data: {
      label: `ANIMATE · ${cut.label}`,
      model: index === 5 ? 'kling' : 'happy-horse',
      mode: 'image',
      resolution: index === 5 ? 'auto' : '720p',
      prompt: index === 5
        ? 'Animate this exact source portrait with strict identity and frame preservation. Locked camera, absolutely no zoom, pan, tilt, reframing, crop change, background change, hairstyle change, wardrobe change, facial reshaping, beauty retouching, morphing or added cinematic effects. She begins with both eyes closed and slowly opens them with only subtle natural breathing. Continue the existing tiny pink scan arcs: a thin luminous pink facial-tracking web grows smoothly across the forehead, temples, cheeks, nose and jaw until it wraps the entire face as a precise delicate connected mesh. The web is the only graphic animation. Keep the original face visible beneath it. Real-time speed, no cuts, no flashes, no particles, no text.'
        : motionPrompts[index],
      duration: 3,
      audio: false,
      disabled: index !== 5,
      requiresApproval: true,
      approvedImageUrl: index === 5 ? scanStartUrl : null,
      sourceImageUrl: index === 5 ? scanStartUrl : null,
      outputUrl: index === 5 ? '/output/videos/kling-image-1785252125638.mp4' : undefined,
      cost: index === 5 ? 0.336 : undefined,
      status: index === 5 ? 'done' : 'idle',
    },
  })),
  {
    id: 'hair-face-scan-ui',
    type: 'reference-image',
    position: { x: 1880, y: 40 },
    data: {
      label: 'MOTION · cyan scan + 3D mask',
      usage: 'asset',
      motionDesign: { kind: 'face-scan', sourceUrl: '/output/videos/kling-image-1785252125638.mp4' },
      timeline: {
        start: 3.67 + timelineShift, duration: 3, track: 2, role: 'overlay',
        label: 'Cyan face scan motion',
        layout: { x: 4, y: 5, width: 92, height: 72, opacity: 1 },
      },
    },
  },
  {
    id: 'hair-selector-ui',
    type: 'reference-image',
    position: { x: 1880, y: 300 },
    data: {
      label: 'MOTION · thumbnail selector ribbon',
      usage: 'asset',
      motionDesign: { kind: 'selector-ribbon', sourceUrl: masterUrl },
      timeline: {
        start: 12.23 + timelineShift - scanTailTrim, duration: 3.97, track: 2, role: 'overlay',
        label: 'Scrolling hairstyle ribbon',
        layout: { x: 7, y: 62, width: 86, height: 17, opacity: 1 },
      },
    },
  },
  {
    id: 'hair-hairstyle-ui',
    type: 'reference-image',
    position: { x: 1880, y: 430 },
    data: {
      label: 'MOTION · hairstyle title + result UI',
      usage: 'asset',
      motionDesign: { kind: 'hairstyle-ui' },
      timeline: {
        start: 7.63 + timelineShift - scanTailTrim, duration: 4.60, track: 2, role: 'overlay',
        label: 'Hairstyle names + Soft Heart UI',
        layout: { x: 0, y: 0, width: 100, height: 100, opacity: 1 },
      },
    },
  },
  {
    id: 'hair-hook-captions',
    type: 'captions',
    position: { x: 1880, y: 560 },
    data: {
      label: 'TEXT · hook captions',
      motionDesign: { kind: 'hook-captions' },
      preset: 'capcut-classic', fontSize: 118, marginV: 410, status: 'idle',
      timeline: {
        start: 0, duration: 3.67 + timelineShift, track: 3, role: 'overlay',
        label: 'Word-by-word hook captions',
        layout: { x: 12, y: 39, width: 76, height: 18, opacity: 1 },
      },
    },
  },
  {
    id: 'hair-voiceover',
    type: 'tts-voice',
    position: { x: 1880, y: 820 },
    data: {
      label: 'AUDIO · TTS voiceover',
      text: "[confidently] Ugly? [softly] You just haven’t found the right hairstyle for your face shape yet. [warmly] With Hair App, simply scan your face to discover your face shape... then instantly try on hairstyles recommended just for you. [playfully] In seconds, you’ll find the hairstyle that suits you best.",
      voice: 'fal-elevenlabs/Aria',
      status: 'done',
      outputUrl: '/output/audio/hair-app-eleven-aria-v1.mp3',
      cost: 0.0303,
      timeline: { start: 0, duration: 16.16, track: 4, role: 'audio', label: 'TTS voiceover · ElevenLabs Aria' },
    },
  },
  {
    id: 'hair-drum-sfx',
    type: 'reference-video',
    position: { x: 1880, y: 1080 },
    data: {
      label: 'AUDIO · spinning drum SFX',
      usage: 'asset',
      url: '/output/audio/hair-drum-ratchet.wav',
      timeline: { start: 12.23 + timelineShift - scanTailTrim, duration: 3.97, track: 4, role: 'audio', label: 'Spinning drum / ratchet' },
    },
  },
  {
    id: 'hair-fashion-bgm',
    type: 'reference-video',
    position: { x: 1880, y: 950 },
    data: {
      label: 'BGM · Techno Fest Vibes — A. M.',
      usage: 'asset',
      url: '/output/audio/hair-techno-fest-bgm.mp3',
      volume: 0.27,
      source: 'Mixkit Stock Music Free License',
      timeline: {
        start: 0,
        duration: 18.2 + timelineShift - scanTailTrim,
        track: 4,
        role: 'audio',
        label: 'BGM · Techno Fest Vibes (instrumental EDM)',
      },
    },
  },
  {
    id: 'hair-cut-clicks',
    type: 'reference-video',
    position: { x: 1880, y: 1210 },
    data: {
      label: 'AUDIO · hairstyle cut clicks',
      usage: 'asset',
      url: '/output/audio/hair-cut-clicks.wav',
      timeline: { start: 7.63 + timelineShift - scanTailTrim, duration: 4.60, track: 4, role: 'audio', label: 'Click SFX on hard cuts' },
    },
  },
  {
    id: 'hair-end-card',
    type: 'end-card',
    position: { x: 2240, y: 40 },
    data: {
      label: 'END CARD · Hair App',
      duration: 2, cta: 'Download now', subtitle: 'Find the hairstyle made for you', brand: 'Hair App', status: 'idle',
      motionDesign: { kind: 'store-end-card', sourceUrl: masterUrl },
      timeline: {
        start: 16.2 + timelineShift - scanTailTrim, duration: 2, track: 1, role: 'video', label: 'Store end card',
        layout: { x: 0, y: 0, width: 100, height: 100, opacity: 1 },
      },
    },
  },
  { id: 'hair-output', type: 'output', position: { x: 2600, y: 40 }, data: { label: `FINAL · Hair App ${18.2 + timelineShift - scanTailTrim}s` } },
];

const workflow = {
  version: 1,
  nodes,
  edges: [
    ...cuts.map((_, index) => ({
      id: `hair-master-to-frame-${String(index + 1).padStart(2, '0')}`,
      source: 'hair-model-master',
      sourceHandle: 'image',
      target: `hair-frame-${String(index + 1).padStart(2, '0')}`,
      targetHandle: 'image',
    })),
    ...cuts.slice(0, 11).map((_, index) => ({
      id: `hair-frame-to-motion-${String(index + 1).padStart(2, '0')}`,
      source: `hair-frame-${String(index + 1).padStart(2, '0')}`,
      sourceHandle: 'image',
      target: `hair-motion-${String(index + 1).padStart(2, '0')}`,
      targetHandle: 'image_url',
    })),
    { id: 'hair-output-edge', source: 'hair-end-card', sourceHandle: 'video', target: 'hair-output', targetHandle: 'video' },
  ],
  meta: {
    updatedAt: 0,
    totalCost: 0,
    timeline: { duration: 18.2 + timelineShift - scanTailTrim, fps: 30, width: 1080, height: 1920 },
    strategy: 'image-first; hard cuts; motion overlays; animate only after picture lock',
  },
};

const output = resolve('workflows/hair-app-image-first-v2.json');
writeFileSync(output, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(output);
