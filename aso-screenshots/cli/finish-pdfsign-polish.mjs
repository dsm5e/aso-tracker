/** Finalize only when all paid jobs + 90 language renders have been verified. */
import fs from 'node:fs/promises';import path from 'node:path';import sharp from 'sharp';
const root=path.resolve('public/pdfsign-polish'),canonical='/Users/qwar49/Developer/screenshots/PDFSign/polish-v2';
const manifest=JSON.parse(await fs.readFile(`${root}/manifest.json`,'utf8'));
const beforeChecks=JSON.parse(await fs.readFile(`${root}/validation.json`,'utf8')),afterChecks=JSON.parse(await fs.readFile(`${root}/validation-polished.json`,'utf8'));
if(beforeChecks.length!==45||afterChecks.length!==45||[...beforeChecks,...afterChecks].some(x=>x.overflow||x.horizontalOverflow||!x.images))throw Error('Incomplete export checks');
const current=await fetch('http://localhost:5181/api/studio-state').then(r=>r.json());await fs.writeFile(`${canonical}/studio-before-polish-import.json`,JSON.stringify(current));
let archives=current.archivedProjects??[],chosen;const now=Date.now();
const previous=archives.find(a=>a.id===current.loadedFromProjectId);if(previous){previous.state={...previous.state,appName:current.appName,screenshots:current.screenshots,locales:current.locales};previous.archivedAt=now;}
for(const v of manifest){
 for(const i of [1,2,3]){const job=JSON.parse(await fs.readFile(`${root}/jobs/${v.id}-${i}.json`));if(job.status!=='done'||job.changedProtected!==0)throw Error(`Unverified job ${v.id}-${i}`);}
 const before=JSON.parse(await fs.readFile(`${root}/states/${v.id}.json`,'utf8'));
 const after=structuredClone(before);after.screenshots.forEach((s,i)=>{s.sourceUrl=`/studio/pdfsign-polish/polished/${v.id}-${i+1}.png`;s.action=undefined;});after.outputFolder+= '/polished';
 await fs.writeFile(`${root}/states/${v.id}-polished.json`,JSON.stringify(after,null,2));await fs.writeFile(`${canonical}/variants/${v.id}/state-polished.json`,JSON.stringify(after,null,2));
 for(const [mode,state] of [['before',before],['polished',after]]){
  const id=`pdfsign-v2-${mode}-${v.id}`,label=mode==='before'?'iPhone · без Polish':'iPhone · Sunburst High';archives=archives.filter(a=>a.id!==id);archives.push({id,createdAt:now,archivedAt:now,appName:'PDFSign',appColor:state.appColor,presetId:state.selectedPresetId,presetName:v.name+' · '+label,thumbUrl:`/studio/pdfsign-polish/exports/${v.id}-1-en${mode==='polished'?'-polished':''}.png`,slotCount:3,state});
  if(v.id==='signeasy'&&mode==='polished')chosen={...state,loadedFromProjectId:id};
 }
}
await fetch('http://localhost:5181/api/studio-state/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...current,...chosen,archivedProjects:archives,agentNav:null,ppo:null,iconLab:null,multiSelect:[]})}).then(r=>{if(!r.ok)throw Error('State push failed')});
const layers=[];
for(let r=0;r<manifest.length;r++){
 const v=manifest[r];layers.push({input:Buffer.from(`<svg width="1680" height="44"><rect width="1680" height="44" fill="#f3f3f6"/><text x="8" y="29" font-family="Arial" font-size="23" fill="#333">${v.name} — Before</text><text x="866" y="29" font-family="Arial" font-size="23" fill="#333">Sunburst High — Polish</text></svg>`),left:0,top:r*642});
 for(let mode=0;mode<2;mode++)for(let c=0;c<3;c++)layers.push({input:await sharp(`${root}/exports/${v.id}-${c+1}-en${mode?'-polished':''}.png`).resize(264,574).toBuffer(),left:mode*858+c*276,top:r*642+48});
}
await sharp({create:{width:1680,height:3210,channels:3,background:'#f3f3f6'}}).composite(layers).png().toFile(`${root}/comparison-en.png`);
await fs.copyFile(`${root}/comparison-en.png`,`${canonical}/comparison-en.png`);
await fs.writeFile(`${canonical}/verification.json`,JSON.stringify({date:new Date().toISOString(),model:'openai/gpt-image-2.5/sunburst/edit',quality:'high',generations:15,exportedPNGs:90,marketingLocales:['en','ru','de-DE'],protectedPixelDrift:0,beforeChecks,afterChecks},null,2));
console.log('Finalized 15 before/after pairs, 90 PNGs, 10 saved Studio projects.');
