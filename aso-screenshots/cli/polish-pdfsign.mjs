/** Paid generation is explicit: run only for a user-authorized Polish batch. */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const root=path.resolve('public/pdfsign-polish');
const manifest=JSON.parse(await fs.readFile(`${root}/manifest.json`,'utf8'));
const recompose=process.argv.includes('--recompose');
const filter=process.argv.slice(2).filter(x=>x!=='--recompose');
const jobs=manifest.flatMap(v=>[1,2,3].map(n=>({variant:v.id,n,id:`${v.id}-${n}`}))).filter(j=>!filter.length||filter.includes(j.id));
const prefix='data:image/png;base64,';
async function protect(j,slot,before,mask,raw){
 const W=1320,H=2868,f=220;const top=Math.max(0,Math.floor(slot.textYFraction*H)-40),bottom=Math.ceil(slot.headlineSafeBottomFraction*H);
 const down=`<rect y="${bottom}" width="${W}" height="${f}" fill="url(#down)"/>`;
 const up=`<rect y="${Math.max(0,top-f)}" width="${W}" height="${f}" fill="url(#up)"/>`;
 const extra=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="down" x2="0" y2="1"><stop stop-color="white" stop-opacity="1"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient><linearGradient id="up" x2="0" y2="1"><stop stop-color="white" stop-opacity="0"/><stop offset="1" stop-color="white" stop-opacity="1"/></linearGradient></defs>${slot.textYFraction>.7?up:slot.textYFraction>.4?up+down:down}</svg>`;
 const postMask=await sharp(mask).composite([{input:Buffer.from(extra),blend:'over'}]).png().toBuffer();
 // Enforce exact app pixels and headline safe zones independently of AI compliance.
  const protectedPixels=await sharp(before).ensureAlpha().composite([{input:postMask,blend:'dest-in'}]).png().toBuffer();
  const normalized=await sharp(raw).resize(1320,2868,{fit:'fill'}).png().toBuffer();
  await sharp(normalized).composite([{input:protectedPixels,blend:'over'}]).png().toFile(`${root}/polished/${j.id}.png`);
  const [a,b,m]=await Promise.all([sharp(before).removeAlpha().raw().toBuffer(),sharp(`${root}/polished/${j.id}.png`).removeAlpha().raw().toBuffer(),sharp(mask).ensureAlpha().raw().toBuffer()]);
  let protectedCount=0,changedProtected=0;for(let i=0;i<a.length/3;i++)if(m[i*4+3]===255){protectedCount++;if(a[i*3]!==b[i*3]||a[i*3+1]!==b[i*3+1]||a[i*3+2]!==b[i*3+2])changedProtected++;}
  if(changedProtected)throw Error(`Protected pixel drift: ${changedProtected}`);
 return {protectedCount,changedProtected};
}
async function run(j){
 const jobFile=`${root}/jobs/${j.id}.json`;
 const old=await fs.readFile(jobFile,'utf8').then(JSON.parse).catch(()=>null);
 if(old?.status==='done'&&!recompose){console.log('CACHED',j.id);return;}
 if(old?.status==='requesting')throw Error(`${j.id}: unresolved prior submission; inspect instead of submitting twice`);
 const state=JSON.parse(await fs.readFile(`${root}/states/${j.variant}.json`,'utf8'));
 const slot=state.screenshots[j.n-1];
 const preset=JSON.parse(await fs.readFile(`src/lib/presets/imported/${slot.presetId}.json`,'utf8'));
 const before=await fs.readFile(`${root}/artwork/${j.id}.png`),mask=await fs.readFile(`${root}/masks/${j.id}.png`);
 const zone=slot.textYFraction>.7?'bottom':slot.textYFraction>.4?'middle':'top';
 if(old?.status==='done'&&recompose){const result=await protect(j,slot,before,mask,await fs.readFile(`${root}/polished/${j.id}-raw.png`));console.log('RECOMPOSED',j.id,result);return;}
 const prompt=`Polish this App Store screenshot template for PDFSign into a premium, photorealistic product presentation. This is a tightly scoped FINISHING PASS, not a redesign. Preserve the exact composition, positions, device angles, scale, palette and hierarchy of the input.\n\nWhere an iPhone is present, refine it as a real photographed modern iPhone Pro: precise polished metal edges, convincing glass highlights and very subtle studio reflections, realistic contact shadows. No chunky plastic or clay mockup. Keep the inner screen aperture fixed at exactly the same coordinates. Where the composition has only paper cards or line art, preserve that concept; do not invent a phone. Polish existing cards and shadows gently. Match backgrounds seamlessly across all protected-region boundaries; never brighten a rectangular section. Existing illustration remains a restrained flat illustration. No new objects, hands, logos, badges, buttons, stars or claims.\n\nCRITICAL: The source app screenshots, all UI text, document text, signatures and controls are immutable. They are opaque protected regions in the supplied mask. Do not redraw, replace, crop, reposition or stylize them. All added highlights must stay on the hardware edges, never on the display.\n\nLOCALIZATION: There are deliberately NO marketing headlines in this input. Keep the ${zone} headline area empty and unchanged, spanning vertical fractions ${Math.max(0,slot.textYFraction-.02).toFixed(3)} through ${slot.headlineSafeBottomFraction.toFixed(3)} of the canvas. Never generate marketing text, letters, watermarks or typographic shapes anywhere outside the existing app UI. Preserve background colors in that zone exactly so editable translated text can be overlaid later.\n\nArt direction: ${preset.description} Maintain this identity. Output one portrait composition with the same aspect ratio.`;
 const request={appName:'PDFSign',appColor:state.appColor,themeHint:'Sign PDF documents on iPhone',effectiveBackground:preset.background.css,preset,scaffoldDataUri:prefix+before.toString('base64'),maskDataUri:prefix+mask.toString('base64'),headlineZone:zone,headlinePct:Math.round(slot.headlineSafeBottomFraction*100),kind:'polish',device:'iphone',model:'gpt-image-2.5-sunburst',quality:'high',customPrompt:prompt};
 let receipt={id:j.id,status:'requesting',started:new Date().toISOString(),model:request.model,quality:request.quality,prompt};
 await fs.writeFile(jobFile,JSON.stringify(receipt,null,2));console.log('START',j.id,request.model,'high');
 try{
  const r=await fetch('http://localhost:5181/api/screenshots/generate-hero',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
  const result=await r.json();if(!r.ok||!result.url)throw Error(JSON.stringify(result));
  const rawResponse=await fetch(result.url);if(!rawResponse.ok)throw Error(`Image download ${rawResponse.status}`);
  const raw=Buffer.from(await rawResponse.arrayBuffer());await fs.writeFile(`${root}/polished/${j.id}-raw.png`,raw);
  const {protectedCount,changedProtected}=await protect(j,slot,before,mask,raw);
  receipt={...receipt,status:'done',finished:new Date().toISOString(),endpoint:result.endpoint,url:result.url,rawDimensions:await sharp(raw).metadata().then(({width,height})=>({width,height})),protectedCount,changedProtected};await fs.writeFile(jobFile,JSON.stringify(receipt,null,2));console.log('DONE',j.id,'protected pixels',protectedCount,'drift',changedProtected);
 }catch(error){await fs.writeFile(jobFile,JSON.stringify({...receipt,status:'error',error:String(error)},null,2));throw error;}
}
let index=0,stop=false;const failures=[];await Promise.allSettled(Array.from({length:Math.min(2,jobs.length)},async()=>{while(!stop&&index<jobs.length){const j=jobs[index++];try{await run(j)}catch(e){failures.push({id:j.id,error:String(e)});console.error('FAILED',j.id,String(e));if(/Exhausted balance|User is locked/.test(String(e)))stop=true;}}}));
if(failures.length){console.error(JSON.stringify(failures,null,2));process.exitCode=1;}
