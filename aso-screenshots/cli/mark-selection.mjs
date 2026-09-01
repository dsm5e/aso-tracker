#!/usr/bin/env node
/**
 * Дорисовать выделение объекта на фотографии через nano-banana.
 *
 * Рисовать выделение кодом получалось только «вокруг кляксы»: контур шёл по
 * мазкам, которыми задавалась маска, а не по силуэту предмета. Модель видит
 * сам предмет и обводит его по границе.
 *
 * Usage: node cli/mark-selection.mjs <вход.png> <выход.png> "<что выделить>"
 */
import { fal } from '@fal-ai/client';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const [input, output, subject] = process.argv.slice(2);
if (!input || !output || !subject) {
  console.error('usage: mark-selection.mjs <in.png> <out.png> "<subject>"');
  process.exit(2);
}

const keys = JSON.parse(await readFile(path.join(homedir(), '.aso-studio/keys.json'), 'utf8'));
fal.config({ credentials: keys.FAL_API_KEY });

const prompt = [
  `Edit this photograph to show ${subject} selected in a photo-editing app.`,
  `Overlay a translucent red tint over ${subject} only, following its exact silhouette,`,
  'so the object stays clearly visible through the tint.',
  `Trace the outline of ${subject} with a crisp white dashed line, like a chalk outline`,
  'or a marching-ants selection border, following the real contour of the object',
  'including its headboard, sides and foot.',
  'Everything else in the photograph must stay pixel-identical: same room, same walls,',
  'same lighting, same furniture, same camera angle, same colours.',
  'Do not add, remove or move any object. Do not add text, icons, cursors or UI chrome.',
  'The red tint and the white dashed outline are the only additions.',
].join(' ');

console.log('загружаю исходник…');
const buf = await readFile(input);
const url = await fal.storage.upload(new File([buf], path.basename(input), { type: 'image/png' }));

console.log('nano-banana…');
const result = await fal.subscribe('fal-ai/nano-banana/edit', {
  input: { prompt, image_urls: [url], num_images: 1, output_format: 'png' },
  logs: true,
  onQueueUpdate: (u) => console.log('  ', u.status),
});

const image = result?.data?.images?.[0];
if (!image?.url) {
  console.error('модель не вернула картинку:', JSON.stringify(result?.data ?? {}).slice(0, 400));
  process.exit(1);
}
const png = Buffer.from(await (await fetch(image.url)).arrayBuffer());
await writeFile(output, png);
console.log(`готово → ${output} (${(png.length / 1024).toFixed(0)} КБ)`);
