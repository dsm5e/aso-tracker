import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {chromium} from 'playwright';
const root=path.resolve('public/pdfsign-polish');
const manifest=JSON.parse(await fs.readFile(`${root}/manifest.json`,'utf8'));
const staging='/tmp/pdfsign-real-render-output';await fs.mkdir(staging,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const selected=process.argv.slice(2);
const checks=selected.length?JSON.parse(await fs.readFile(`${root}/validation.json`,'utf8')).filter(c=>!selected.some(n=>c.slot.startsWith(`pdfsign-real-${n}-`))):[];
for(const variant of manifest.filter(v=>!selected.length||selected.includes(v.id))){
 const state=JSON.parse(await fs.readFile(`${root}/states/${variant.id}.json`,'utf8'));delete state.ppo;
 const ctx=await browser.newContext({viewport:{width:1320,height:2868},deviceScaleFactor:1});
 await ctx.route('**/studio-api/studio-state**',route=>route.fulfill({status:200,contentType:route.request().url().endsWith('/stream')?'text/event-stream':'application/json',body:route.request().url().endsWith('/stream')?`data: ${JSON.stringify(state)}\n\n`:JSON.stringify(state)}));
 const page=await ctx.newPage();page.on('pageerror',e=>console.error('PAGE ERROR',variant.id,e.message));
 for(const locale of ['en','ru','de-DE'])for(const slot of state.screenshots){
  await page.goto(`${process.env.ASO_RENDER_ORIGIN ?? 'http://localhost:5180'}/studio/render?slot=${slot.id}${locale==='en'?'':`&locale=${locale}`}`);
  await page.waitForFunction(()=>document.documentElement.dataset.renderReady==='1');
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})))});
  await page.waitForTimeout(350);
  const validation=await page.evaluate(()=>{
   const box=document.querySelector('[data-headline-box]'),title=document.querySelector('[data-headline-title]');const desc=document.querySelector('[data-headline-descriptor]');const br=box.getBoundingClientRect(),tr=title.getBoundingClientRect(),dr=desc?.getBoundingClientRect();
   return {titlePx:getComputedStyle(title).fontSize,overflow:(dr?.bottom??tr.bottom)>br.bottom+2,horizontalOverflow:title.scrollWidth>title.clientWidth+2,images:[...document.images].every(i=>i.complete&&i.naturalWidth>0)};
  });checks.push({slot:slot.id,locale,...validation});
  if(validation.overflow||validation.horizontalOverflow||!validation.images)throw Error(`Invalid composition ${slot.id} ${locale}: ${JSON.stringify(validation)}`);
  const dest=`${staging}/${variant.id}-${slot.sampleIndex+1}-${locale}.png`;
  await page.locator('[data-render-root]').screenshot({path:dest});
  const out=`/Users/qwar49/Developer/screenshots/PDFSign/polish-v2/variants/${variant.id}/${locale}`;await fs.mkdir(out,{recursive:true});await fs.copyFile(dest,`${out}/${slot.sampleIndex+1}.png`);
 }
 await ctx.close();console.log('Rendered',variant.id,'EN/RU/DE');
}
await browser.close();for(const f of await fs.readdir(staging))await fs.copyFile(`${staging}/${f}`,`${root}/exports/${f}`);await fs.writeFile(`${root}/validation.json`,JSON.stringify(checks,null,2));
let layers=[];
for(let r=0;r<manifest.length;r++)for(let c=0;c<3;c++){const img=await sharp(`${root}/exports/${manifest[r].id}-${c+1}-en.png`).resize(264,574).toBuffer();layers.push({input:img,left:c*276,top:r*598});}
await sharp({create:{width:816,height:2990,channels:3,background:'#e9e9ed'}}).composite(layers).png().toFile(`${root}/overview.png`);
console.log('Validated and exported',checks.length,'screenshots.');
