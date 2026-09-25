/** Rebuild the 5 reference-derived concepts. No marketing text is rasterized. */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const root=path.resolve('public/pdfsign-polish');
const inputRoot='/Users/qwar49/Developer/screenshots/PDFSign';
const canonical=inputRoot+'/polish-v2';
const names=['acrobat','docusign','pdf-expert','signeasy','signnow'];
const W=1320,H=2868,base='/studio/pdfsign-polish';
for(const d of ['artwork','source','states','references','exports','masks','polished','jobs'])await fs.mkdir(`${root}/${d}`,{recursive:true});
const source={};
for(const [key,num] of Object.entries({home:1,document:2,export:3,editor:4,library:5,draw:6})){
 const bytes=await fs.readFile(`${inputRoot}/source/iphone/${num}.png`);await fs.writeFile(`${root}/source/${key}.png`,bytes);
 source[key]=`data:image/png;base64,${bytes.toString('base64')}`;
}
// Crops below are close-ups of the unmodified real simulator captures, not invented UI.
async function crop(key,rect){return `data:image/png;base64,${(await sharp(Buffer.from(source[key].split(',')[1],'base64')).extract(rect).png().toBuffer()).toString('base64')}`;}
const docCrop=await crop('document',{left:0,top:390,width:1206,height:1660});
const sigCrop=await crop('document',{left:70,top:1590,width:970,height:310});
const libraryCrop=await crop('library',{left:48,top:725,width:1110,height:500});
let uid=0;
const frameUri='data:image/png;base64,'+(await fs.readFile('public/uploads/device-frames/iphone-pro-titanium-frame-fitted-v1.png')).toString('base64');
const protectedFragments=[];
function phone(src,x,y,w,rot=0,_rim,_outline){
 const h=w*2622/1206,p=13,k=(w-2*p)/754,clip=`clip${uid++}`;
 const transform=`translate(${x} ${y}) rotate(${rot} ${w/2} ${h/2})`;
 const screen=`<rect x="${p}" y="${p}" width="${w-p*2}" height="${h-p*2}" rx="${96*k}"/>`;
 const output=`<g transform="${transform}"><defs><clipPath id="${clip}">${screen}</clipPath></defs><image href="${src}" x="${p}" y="${p}" width="${w-p*2}" height="${h-p*2}" preserveAspectRatio="none" clip-path="url(#${clip})"/><image href="${frameUri}" x="${p-33*k}" y="${p-24*k}" width="${821*k}" height="${1689*k}" filter="url(#shadow)"/><rect x="${w*.375}" y="${p+16}" width="${w*.25}" height="${w*.069}" rx="${w*.0345}" fill="#060609"/></g>`;
 protectedFragments.push([output,`<g transform="${transform}" fill="white">${screen}</g>`]);return output;
}
function card(src,x,y,w,h,rot=0){const clip=`clip${uid++}`,transform=`translate(${x} ${y}) rotate(${rot} ${w/2} ${h/2})`;
 const output=`<g transform="${transform}"><rect width="${w}" height="${h}" rx="35" fill="white" filter="url(#shadow)"/><defs><clipPath id="${clip}"><rect x="10" y="10" width="${w-20}" height="${h-20}" rx="27"/></clipPath></defs><image href="${src}" x="10" y="10" width="${w-20}" height="${h-20}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/></g>`;
 protectedFragments.push([output,`<g transform="${transform}"><rect width="${w}" height="${h}" rx="35" fill="white"/></g>`]);return output;
}
function svg(body){return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><filter id="shadow" x="-40%" y="-40%" width="180%" height="190%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-opacity=".19"/></filter><linearGradient id="docline" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#df7d88"/><stop offset="1" stop-color="#8252ed"/></linearGradient><linearGradient id="fade"><stop stop-color="#ef1710"/><stop offset=".4" stop-color="white"/></linearGradient><linearGradient id="pastel" x1="0" y1="0" x2="0" y2="1"><stop stop-color="var(--top)"/><stop offset="1" stop-color="var(--bottom)"/></linearGradient></defs>${body}</svg>`;}
const rect=(fill)=>`<rect width="${W}" height="${H}" fill="${fill}"/>`;
const ribbon=(color,x,y)=>`<defs><linearGradient id="rib${color.slice(1)}"><stop stop-color="${color}"/><stop offset=".28" stop-color="${color === '#f22475' ? '#ff93c2' : '#55dfff'}"/><stop offset=".48" stop-color="${color === '#f22475' ? '#ffced9' : '#0c74ff'}"/><stop offset=".74" stop-color="${color === '#f22475' ? '#b31850' : '#000ac4'}"/><stop offset="1" stop-color="${color}"/></linearGradient></defs><g transform="translate(${x} ${y}) rotate(18)">${Array.from({length:24},(_,i)=>`<rect x="${i*65}" y="-300" width="65" height="2000" fill="url(#rib${color.slice(1)})"/>`).join('')}</g>`;
const sparkle=(x,y)=>`<path d="M ${x} ${y-25} Q ${x+6} ${y-5} ${x+25} ${y} Q ${x+6} ${y+5} ${x} ${y+25} Q ${x-6} ${y+5} ${x-25} ${y} Q ${x-6} ${y-5} ${x} ${y-25}" fill="#ffdf77"/>`;
const blueBg=rect('#087ac7')+`<circle cx="40" cy="1600" r="200" fill="#3199d8"/><circle cx="1310" cy="2400" r="330" fill="#135bab"/><circle cx="1150" cy="710" r="105" fill="#228cdb"/>`+sparkle(110,730)+sparkle(1200,920)+sparkle(1170,2570);
const person=`<g transform="translate(910 1830)"><path d="M75 540 L330 530 L340 1080 L180 1080 L158 725 L114 1080 L-20 1080Z" fill="#15122f"/><path d="M118 229 C48 239 16 305 11 390 L-15 622 Q125 682 343 598 L324 347 Q299 265 211 241Z" fill="#9ebaf5"/><path d="M125 180 L119 267 Q177 300 213 256 L207 160Z" fill="#bd7950"/><path d="M100 57 C122 8 220 22 238 81 L223 175 Q205 232 163 214 L124 185 L105 135Z" fill="#c88d60"/><path d="M90 117 C50 68 82 0 117 9 C135 -28 189 -13 199 10 C254 -16 286 36 257 74 L225 124 L207 92 Q155 120 139 77 L133 140Z" fill="#13152e"/><path d="M132 314 Q100 386 15 423 L-101 354" fill="none" stroke="#9ebaf5" stroke-width="73" stroke-linecap="round"/><path d="M-101 354 L-182 298 L-215 252" fill="none" stroke="#c88d60" stroke-width="35" stroke-linecap="round"/><path d="M-209 268 L-254 253 M-211 271 L-242 239 M-207 273 L-222 235" fill="none" stroke="#c88d60" stroke-width="13" stroke-linecap="round"/><path d="M286 325 Q357 474 265 548 L183 571" fill="none" stroke="#aac5fc" stroke-width="69" stroke-linecap="round"/><path d="M184 571 L128 572" stroke="#c88d60" stroke-width="33" stroke-linecap="round"/><path d="M219 125 L235 144 L218 149 M194 171 Q205 184 216 172" fill="none" stroke="#825032" stroke-width="4"/><circle cx="212" cy="118" r="4" fill="#302334"/></g>`;
const layouts={
 acrobat:[
  rect('#eb1000')+card(docCrop,-90,1270,780,1320,-13)+card(source.home,645,1040,780,1695,11)+card(libraryCrop,70,835,1110,420,-2),
  rect('#eb1000')+phone(source.home,145,670,1020,0,'#fff')+card(libraryCrop,280,1900,990,360),
  rect('url(#fade)')+phone(source.editor,155,660,1010,0,'#fff')+card(sigCrop,235,1770,1070,375)
 ],
 docusign:[
  rect('#f9f6f3')+phone(source.document,145,940,1030,0,'#fff','url(#docline)'),
  rect('#f9f6f3')+`<path d="M1320 565 H740 C330 565 12 895 12 1250 C12 1630 340 1860 705 1860 C1060 1860 1300 1595 1300 1300 C1300 1020 980 930 715 1070 C260 1280 12 1510 12 1870 V2360 H600 C1030 2360 1300 2020 1300 1620 V565" fill="none" stroke="url(#docline)" stroke-width="8"/>`,
  rect('#f9f6f3')+phone(source.home,145,940,1030,0,'#fff','url(#docline)')
 ],
 'pdf-expert':[
  rect('#fafafa')+`<defs><clipPath id="wedge"><path d="M0 1860 L1320 1500 L1320 2868 L0 2868 Z"/></clipPath></defs><g clip-path="url(#wedge)">${ribbon('#123afa',-150,1750)}</g>`+phone(source.document,575,1440,825,14,'#090909'),
  rect('#fafafa')+ribbon('#f22475',540,1950)+phone(source.editor,165,675,1150,12,'#090909'),
  rect('#fafafa')+ribbon('#f22475',-150,2280)+phone(source.library,140,755,1040,0,'#090909')
 ],
 signeasy:[
  `<defs><linearGradient id="se" x2="0" y2="1"><stop stop-color="#409fdd"/><stop offset="1" stop-color="#bde3fc"/></linearGradient></defs>`+rect('url(#se)')+`<path d="M-100 400 Q 50 1700 300 2070 T 1430 2710" fill="none" stroke="white" stroke-opacity=".27" stroke-width="17"/>`+phone(source.home,155,580,1010,0,'#432815'),
  `<defs><linearGradient id="se" x2="0" y2="1"><stop stop-color="#3cbda7"/><stop offset="1" stop-color="#c8f1e8"/></linearGradient></defs>`+rect('url(#se)')+`<path d="M140 -80 Q-40 990 620 790 T1400 820" fill="none" stroke="white" stroke-opacity=".27" stroke-width="17"/>`+phone(source.document,155,580,1010,0,'#432815'),
  `<defs><linearGradient id="se" x2="0" y2="1"><stop stop-color="#a586e6"/><stop offset="1" stop-color="#e4d6ff"/></linearGradient></defs>`+rect('url(#se)')+`<path d="M1230 -80 Q1350 990 590 890 T-100 820" fill="none" stroke="white" stroke-opacity=".27" stroke-width="17"/>`+phone(source.export,155,580,1010,0,'#432815')
 ],
 signnow:[
  blueBg+phone(source.editor,130,995,950,-17,'#fafafa')+person+`<path d="M380 765 L350 700 L405 718 L425 650 L450 720 L500 702 L485 775" fill="none" stroke="#eae192" stroke-width="9"/>`,
  blueBg+phone(source.home,175,880,970,0,'#fafafa')+card(libraryCrop,40,2080,1150,375,-4),
  blueBg+phone(source.document,185,-300,950,0,'#fafafa')+`<path d="M1000 2320 l65 -35 -15 55 100 -30 -15 50 90 -20" fill="none" stroke="#f6d97e" stroke-width="8"/>`
 ]
};
const config={
 acrobat:{name:'01 · Acrobat — Red Cards',color:'#fff',font:'Inter',weight:850,align:'left',bg:'#eb1000',title:151,y:.055,safe:.25,heads:[['All your PDFs.\nReady to sign.',''],['Your documents.\nOne place.',''],['Add your\nsignature.','']],desc:'Красный фон, крупные карточки и увеличенные фрагменты интерфейса.'},
 docusign:{name:'02 · Docusign — Quiet Outline',color:'#3e3549',font:'Inter',weight:450,align:'center',bg:'#f9f6f3',title:143,y:.09,safe:.29,heads:[['Open, sign,\nsend & done.',''],['One signature.\nReady to reuse.',''],['Keep your signed\ndocuments close.','']],desc:'Тёплый белый фон, тонкий цветной контур и спокойная типографика.'},
 'pdf-expert':{name:'03 · PDF Expert — Diagonal',color:'#303033',font:'Inter',weight:750,align:'left',bg:'#fafafa',title:181,y:.15,safe:.48,heads:[['Your go-to\nPDF signer','Sign documents\non your iPhone.'],['Make it\nyour signature',''],['Save & reuse','Your signature,\nready when you need it.']],desc:'Редакционный заголовок, контрастная диагональная лента и крупный телефон.'},
 signeasy:{name:'04 · Signeasy — Pastel',color:'#fff',font:'Inter',weight:700,align:'center',bg:'#409fdd',title:118,y:.055,safe:.185,heads:[['A simpler way to\nmanage your PDFs',''],['Sign documents',''],['Share signed PDFs','']],desc:'Голубой, мятный и сиреневый градиенты, крупный ровный телефон.'},
 signnow:{name:'05 · SignNow — Blue Motion',color:'#fff',font:'Inter',weight:850,align:'center',bg:'#087ac7',title:153,y:.065,safe:.265,heads:[['Your signature.\nReady anywhere.',''],['Open your\ndocuments',''],['Sign, save\nand send PDFs','']],desc:'Яркий синий фон, наклонный телефон, геометрия и увеличенные карточки.'}
};
const ru={acrobat:['Все PDF.\nГотовы к подписи.','Документы\nв одном месте.','Добавьте\nсвою подпись.'],docusign:['Откройте, подпишите\nи отправьте.','Одна подпись.\nСнова и снова.','Подписанные\nдокументы рядом.'],'pdf-expert':['Ваш помощник\nдля подписи PDF','Ваша подпись.\nВаш документ.','Сохраните\nи используйте снова'],signeasy:['Удобная работа\nс вашими PDF','Подписывайте\nдокументы','Отправляйте\nподписанные PDF'],signnow:['Ваша подпись.\nВсегда под рукой.','Открывайте\nсвои документы','Подписывайте\nи отправляйте PDF']};
const de={acrobat:['Alle Ihre PDFs.\nBereit zum Signieren.','Ihre Dokumente.\nAn einem Ort.','Fügen Sie Ihre\nUnterschrift hinzu.'],docusign:['Öffnen, unterschreiben\nund versenden.','Eine Unterschrift.\nImmer wieder bereit.','Unterschriebene\nDokumente griffbereit.'],'pdf-expert':['Ihr Helfer zum\nPDF-Signieren','Ihre eigene\nUnterschrift','Speichern und\nwiederverwenden'],signeasy:['Ihre PDFs\neinfach verwalten','Dokumente\nunterschreiben','Signierte PDFs\nversenden'],signnow:['Ihre Unterschrift.\nÜberall bereit.','Dokumente\nöffnen','PDFs signieren\nund versenden']};
const manifest=[];
for(const n of names){
 const cfg=config[n],meta=JSON.parse(await fs.readFile(`${inputRoot}/references/${n}/metadata.json`,'utf8'));
 const samples=[],slots=[];
 for(let i=0;i<3;i++){
  const art=svg(layouts[n][i]);await fs.writeFile(`${root}/artwork/${n}-${i+1}.svg`,art);await sharp(Buffer.from(art)).png().toFile(`${root}/artwork/${n}-${i+1}.png`);
  await fs.copyFile(`${inputRoot}/references/${n}/${i+1}.jpg`,`${root}/references/${n}-${i+1}.jpg`);
  const color=n==='acrobat'&&i===2?'#171717':cfg.color;
  const y=n==='docusign'&&i===1?.48:n==='signnow'&&i===2?.825:n==='pdf-expert'&&i>0?.06:cfg.y;
  const safe=n==='docusign'&&i===1?.66:n==='signnow'&&i===2?.98:n==='pdf-expert'&&i>0?.245:cfg.safe;
  const protect=protectedFragments.filter(([fragment])=>layouts[n][i].includes(fragment)).map(([,mask])=>mask).join('');
  const zone=y>.7 ? `<rect y="${Math.floor(y*H)-40}" width="${W}" height="${H}" fill="white"/>` : y>.4 ? `<rect y="${Math.floor(y*H)-40}" width="${W}" height="${Math.ceil((safe-y)*H)+80}" fill="white"/>` : `<rect width="${W}" height="${Math.ceil(safe*H)}" fill="white"/>`;
  await sharp(Buffer.from(svg(protect+zone))).png().toFile(`${root}/masks/${n}-${i+1}.png`);
  const title=n==='pdf-expert'&&i>0?144:cfg.title;
  const sub=n==='pdf-expert'?86:70;
  const sample={verb:cfg.heads[i][0],descriptor:cfg.heads[i][1],sourceLayout:'full-bleed',screenSrc:`${base}/artwork/${n}-${i+1}.png`,text:{yFraction:y,titlePx:title,subPx:sub,color,safeBottomFraction:safe}};
  samples.push(sample);
  slots.push({id:`pdfsign-real-${n}-${i+1}`,filename:`${n}-${i+1}.png`,device:'iphone',sourceUrl:sample.screenSrc,sourcePixelWidth:W,sourcePixelHeight:H,sourceLayout:'full-bleed',sourceScale:1,sourceOffsetX:0,sourceOffsetY:0,enhancedUrl:null,presetId:`pdfsign-real-${n}`,backgroundOverride:null,headline:{verb:sample.verb,descriptor:sample.descriptor,subhead:''},font:cfg.font,fontSize:48,titlePx:title,subPx:sub,textYFraction:y,headlineSafeBottomFraction:safe,textColorOverride:color,tiltDeg:0,tiltX:0,tiltY:0,deviceX:0,deviceY:0,deviceScale:1,textX:0,textY:0,breakout:false,pulseScreen:0,enhanceState:'idle',kind:'regular',sampleIndex:i});
 }
 const preset={id:`pdfsign-real-${n}`,name:cfg.name+' · Real iPhone',kind:'real',description:cfg.desc,recommendedFor:'PDFSign / PDF signing',background:{type:'solid',css:cfg.bg},text:{font:cfg.font,weight:cfg.weight,color:cfg.color,align:cfg.align,uppercase:false},tiltDeg:0,breakout:'none',isGradient:false,decorationsHint:'Reference-derived layout. Keep headline zones empty in artwork; all marketing copy is a live localized layer.',samples};
 await fs.writeFile(`src/lib/presets/imported/pdfsign-real-${n}.json`,JSON.stringify(preset,null,2));
 const locales=[['ru','🇷🇺','Русский',ru],['de-DE','🇩🇪','Deutsch',de]].map(([code,flag,name,tr])=>({id:code,code,flag,name,translations:Object.fromEntries(slots.map((s,i)=>[s.id,{verb:tr[n][i],descriptor:n==='pdf-expert'?(code==='ru'?(i===0?'Подписывайте документы\nна iPhone.':i===2?'Ваша подпись готова\nк новым документам.':''):(i===0?'Dokumente auf Ihrem\niPhone unterschreiben.':i===2?'Ihre Unterschrift.\nJederzeit griffbereit.':'')):'',subhead:''}])),aiTranslated:true}));
 const state={appName:'PDFSign',appColor:'#6258eb',appIconUrl:null,devices:'iphone',iphoneModel:'iphone-17-pro-max',outputFolder:`${canonical}/variants/${n}`,agentNav:null,agentPolishCommand:null,selectedPresetId:preset.id,catalogFilter:'all',screenshots:slots,activeScreenshotId:slots[0].id,viewMode:'scaffold',previewDevice:'iphone',locales,activeLocaleId:'ru'};
 await fs.writeFile(`${root}/states/${n}.json`,JSON.stringify(state,null,2));
 await fs.mkdir(`${canonical}/variants/${n}`,{recursive:true});await fs.writeFile(`${canonical}/variants/${n}/state.json`,JSON.stringify(state,null,2));
 manifest.push({id:n,name:cfg.name,description:cfg.desc,ratings:meta.userRatingCount,rating:meta.averageUserRating,source:meta.trackViewUrl,captured:'2026-09-19',screenshots:3,preset:preset.id});
}
await fs.writeFile(`${root}/manifest.json`,JSON.stringify(manifest,null,2));
console.log('Created real-device baselines, protected masks and editable states.');
