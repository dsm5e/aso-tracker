import { fal } from '@fal-ai/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
const KEY = JSON.parse(readFileSync(homedir()+'/.aso-studio/keys.json','utf8')).FAL_API_KEY.trim();
fal.config({ credentials: KEY });
const OUT = process.argv[2];
const prompt = process.argv[3];
const ar = process.argv[4]||'16:9';
const neg = "realistic, 3D render, photorealistic, live action, people, text, words, letters, watermark, logo, harsh shadows, cluttered, jitter";
const cands = [
 ['fal-ai/wan/v2.2-a14b/text-to-video', {prompt, negative_prompt:neg, aspect_ratio:ar, resolution:'720p'}],
 ['fal-ai/pixverse/v4.5/text-to-video', {prompt, negative_prompt:neg, aspect_ratio:ar, style:'3d_animation', resolution:'720p', duration:5}],
 ['fal-ai/kling-video/v2.5-turbo/pro/text-to-video', {prompt, negative_prompt:neg, aspect_ratio:ar, duration:'5'}],
];
for (const [model, input] of cands){
  try{
    const r = await fal.subscribe(model,{input,logs:false});
    const v=(r.data?.video?.url)||(r.video?.url);
    if(v){const vid=await fetch(v); writeFileSync(OUT,Buffer.from(await vid.arrayBuffer())); console.log('SUCCESS',model); process.exit(0);}
    console.log('no url',model);
  }catch(e){ console.log('skip',model,String(e.message||e).slice(0,90)); }
}
console.log('ALL FAILED'); process.exit(2);
