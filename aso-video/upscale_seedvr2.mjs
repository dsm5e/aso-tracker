import { fal } from '@fal-ai/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { homedir } from 'node:os';

const keys = JSON.parse(
  readFileSync(`${homedir()}/.aso-studio/keys.json`, 'utf8'),
);
const apiKey = keys.FAL_API_KEY?.trim();
if (!apiKey) throw new Error('FAL_API_KEY is missing');

const [inputPath, outputPath, targetResolution = '2160p'] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error(
    'Usage: node upscale_seedvr2.mjs <input> <output> [720p|1080p|1440p|2160p]',
  );
}

const allowedResolutions = new Set(['720p', '1080p', '1440p', '2160p']);
if (!allowedResolutions.has(targetResolution)) {
  throw new Error('Unsupported target resolution');
}

fal.config({ credentials: apiKey });
const extension = extname(inputPath).toLowerCase();
const mimeType = extension === '.jpg' || extension === '.jpeg'
  ? 'image/jpeg'
  : extension === '.webp'
    ? 'image/webp'
    : 'image/png';

const imageUrl = await fal.storage.upload(
  new File([readFileSync(inputPath)], basename(inputPath), { type: mimeType }),
);

const result = await fal.subscribe('fal-ai/seedvr/upscale/image', {
  input: {
    image_url: imageUrl,
    upscale_mode: 'target',
    target_resolution: targetResolution,
    noise_scale: 0.05,
    output_format: 'png',
  },
  logs: true,
});

const outputUrl = result.data?.image?.url ?? result.image?.url;
if (!outputUrl) throw new Error('SeedVR2 response did not contain an image URL');

const response = await fetch(outputUrl);
if (!response.ok) {
  throw new Error(`Failed to download upscale: HTTP ${response.status}`);
}

writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
console.log(`saved ${outputPath}`);
