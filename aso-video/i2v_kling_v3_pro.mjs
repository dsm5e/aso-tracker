import { fal } from '@fal-ai/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { homedir } from 'node:os';

const keys = JSON.parse(
  readFileSync(`${homedir()}/.aso-studio/keys.json`, 'utf8'),
);
const apiKey = keys.FAL_API_KEY?.trim();

if (!apiKey) {
  throw new Error('FAL_API_KEY is missing from ~/.aso-studio/keys.json');
}

const [inputPath, outputPath, prompt, duration = '5', cfgScale = '0.5'] =
  process.argv.slice(2);

if (!inputPath || !outputPath || !prompt) {
  throw new Error(
    'Usage: node i2v_kling_v3_pro.mjs <input> <output> <prompt> [duration 3...15] [cfg 0...1]',
  );
}

const allowedDurations = new Set(
  Array.from({ length: 13 }, (_, index) => String(index + 3)),
);
if (!allowedDurations.has(String(duration))) {
  throw new Error('Duration must be an integer string from 3 through 15');
}

const cfg = Number(cfgScale);
if (!Number.isFinite(cfg) || cfg < 0 || cfg > 1) {
  throw new Error('CFG scale must be between 0 and 1');
}

fal.config({ credentials: apiKey });

const extension = extname(inputPath).toLowerCase();
const mimeType = extension === '.jpg' || extension === '.jpeg'
  ? 'image/jpeg'
  : extension === '.webp'
    ? 'image/webp'
    : 'image/png';

const startImageUrl = await fal.storage.upload(
  new File([readFileSync(inputPath)], basename(inputPath), { type: mimeType }),
);

const result = await fal.subscribe(
  'fal-ai/kling-video/v3/pro/image-to-video',
  {
    input: {
      start_image_url: startImageUrl,
      prompt,
      duration: String(duration),
      generate_audio: false,
      negative_prompt: [
        'blur',
        'distort',
        'low quality',
        'warped anatomy',
        'duplicated limbs',
        'floating feet',
        'foot sliding',
        'identity drift',
        'text',
        'logo',
        'watermark',
        'UI',
      ].join(', '),
      cfg_scale: cfg,
    },
    logs: true,
    onQueueUpdate(update) {
      if (update.status === 'IN_PROGRESS') {
        for (const log of update.logs ?? []) {
          console.log(log.message);
        }
      }
    },
  },
);

const videoUrl = result.data?.video?.url ?? result.video?.url;
if (!videoUrl) {
  throw new Error('Kling response did not contain a video URL');
}

const response = await fetch(videoUrl);
if (!response.ok) {
  throw new Error(`Failed to download output: HTTP ${response.status}`);
}

writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
console.log(`saved ${outputPath}`);
