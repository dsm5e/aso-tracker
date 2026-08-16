import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const key = process.env.FAL_KEY;
if (!key) throw new Error('FAL_KEY is required');

const sourcePath = resolve('public/hair-app/model-master-v7-scan-identity.png');
const sourceBytes = await readFile(sourcePath);
const mime = extname(sourcePath).toLowerCase() === '.jpg' ? 'image/jpeg' : 'image/png';
const sourceUrl = `data:${mime};base64,${sourceBytes.toString('base64')}`;

const shared = `
Use the supplied approved master as a strict identity reference. Preserve the exact same recognizable woman, green-hazel eyes, facial geometry, subtle human asymmetry, skin tone and natural details, taupe makeup, dimensional camera-left beauty key, camera-right negative fill, rim light, grey studio background and premium 85mm photographic finish.
This frame belongs to one continuous ad, but it must not look cloned from the neighboring frames. Change hairstyle, wardrobe, head angle and gaze exactly as requested while keeping identity and lighting consistent.
No text, logo, watermark, app UI, hands, extra person, plastic skin or mathematically perfect symmetry.
`;

const jobs = [
  {
    file: 'hook-02-wider-fal.png',
    prompt: `${shared}
Hook 02, visual meaning: "makes my face look WIDER".
Create a chin-length voluminous blonde bob with soft outward waves concentrated at cheek level so the hairstyle visually broadens the face. Camera is a subtle three-quarter view toward camera-left, head turned about 12 degrees, eyes returning to the lens. Wardrobe: clean ivory off-shoulder knit top. Accessories: tiny pearl stud earrings. Expression: composed and mildly evaluating, lips closed. Keep the full hairstyle readable in a vertical 9:16 beauty crop.`,
  },
  {
    file: 'hook-03-unbalanced-fal.png',
    prompt: `${shared}
Hook 03, visual meaning: "makes my face look UNBALANCED".
Create an intentionally asymmetric blonde hairstyle with a deep side part: large side-swept wave and most volume on one side, the other side tucked sleekly behind the ear. Camera is a subtle three-quarter view toward camera-right, head turned about 15 degrees, gaze slightly off-camera as the starting phase of looking back. Wardrobe: minimalist black satin square-neck top. Accessories: one small sculptural gold earring visible on the tucked side. Expression neutral and thoughtful, no smile.`,
  },
  {
    file: 'hook-04-centered-fal.png',
    prompt: `${shared}
Hook 04, visual meaning: "makes my face look CENTERED".
Create long symmetrical champagne-blonde face-framing layers with a precise center part and balanced volume on both sides. Camera is almost frontal but not perfectly passport-straight: head angled 4 degrees and chin slightly lifted. Wardrobe: tailored cream blazer over a neutral top. No necklace; tiny understated gold studs. Expression calm and confident with the faintest warmth in closed lips. The centered hairstyle must visually balance the face.`,
  },
  {
    file: 'hook-05-shorter-fal.png',
    prompt: `${shared}
Hook 05, visual meaning: "makes my face look SHORTER".
Create a collarbone-length textured blonde lob with full airy curtain bangs and controlled volume around the temples and cheekbones, visually reducing apparent face length. Camera is three-quarter toward camera-left with a gentle 10-degree head turn and a slight chin drop. Wardrobe: muted dusty-rose boat-neck top. Accessories: one delicate short gold chain necklace, no earrings. Expression softly pleased but natural, lips closed. This final hook frame must hold well for 1.25 seconds before the scan transition.`,
  },
];

async function generate(job) {
  const response = await fetch('https://fal.run/fal-ai/nano-banana-2/edit', {
    method: 'POST',
    headers: {
      Authorization: `Key ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: job.prompt,
      image_urls: [sourceUrl],
      aspect_ratio: '9:16',
    }),
  });
  if (!response.ok) {
    throw new Error(`${job.file}: fal ${response.status} ${(await response.text()).slice(0, 500)}`);
  }
  const data = await response.json();
  const imageUrl = data.images?.[0]?.url;
  if (!imageUrl) throw new Error(`${job.file}: fal returned no image`);
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) throw new Error(`${job.file}: download ${imageResponse.status}`);
  const output = resolve('public/hair-app', job.file);
  await writeFile(output, Buffer.from(await imageResponse.arrayBuffer()));
  return output;
}

const requested = new Set(process.argv.slice(2));
const selectedJobs = requested.size > 0
  ? jobs.filter((job) => requested.has(job.file))
  : jobs;
if (selectedJobs.length === 0) throw new Error('No matching hook jobs selected');
const results = await Promise.all(selectedJobs.map(generate));
for (const result of results) console.log(result);
