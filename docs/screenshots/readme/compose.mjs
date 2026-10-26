// Deterministic README presentation assets. Uses existing screenshots only.
// Run from the repository root: node docs/screenshots/readme/compose.mjs
import { chromium } from '../../../apps/web/node_modules/playwright-core/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const out='docs/screenshots/readme';
const scratch='data/readme-visual';
await mkdir(out,{recursive:true});await mkdir(scratch,{recursive:true});
const source=name=>pathToFileURL(resolve(`docs/screenshots/portfolio/${name}.png`)).href;
const crop=(name,x,y,w,h,displayW)=>`<div class="crop" style="width:${displayW}px;height:${h*displayW/w}px"><img alt="Original ${name} screenshot crop" src="${source(name)}" style="width:${1512*displayW/w}px;left:${-x*displayW/w}px;top:${-y*displayW/w}px"></div>`;
const css=`*{box-sizing:border-box}html,body{margin:0}body{font-family:Arial,sans-serif;color:#202720}main{position:relative;overflow:hidden;background:#f5f7f2}img{display:block}.crop{position:relative;overflow:hidden;background:#fff}.crop img{max-width:none;position:absolute;height:auto}.window{overflow:hidden;background:white;border:1px solid #dce3d8;border-radius:18px;box-shadow:0 16px 40px #21351d0c}.overview{padding:40px;display:grid;grid-template-columns:repeat(3,1fr);gap:24px;height:100%}.module{border:1px solid #dce3d8;border-radius:22px;overflow:hidden;background:#fff}.label{height:112px;padding:28px 28px 20px;display:flex;align-items:center;justify-content:space-between}.number{font-size:22px;color:#84977b;letter-spacing:2px}.name{font-size:42px;font-weight:600;letter-spacing:-1px}.module .crop{margin:0 20px;border-radius:12px 12px 0 0;border:1px solid #e3e7df}.frame{padding:48px;height:100%;display:flex;align-items:center;justify-content:center}.frame .window{width:100%}.hero{width:1504px;height:auto;border-radius:12px;border:1px solid #dce3d8;box-shadow:0 16px 48px #233a1f12}.subtle{position:absolute;height:8px;background:#c8d6bd;top:0;left:0;right:0}`;
const compositions=[
 {file:'workspace-hero.png',w:1600,h:1074,body:`<div class="frame"><img class="hero" alt="Unchanged original workspace screenshot" src="${source('hero')}"></div>`},
 {file:'product-overview.png',w:1800,h:664,body:`<div class="overview">${[
  {name:'Board',n:'01',crop:crop('board',350,370,1140,900,490)},
  {name:'Day',n:'02',crop:crop('day',350,370,1140,1020,490)},
  {name:'Research',n:'03',crop:crop('research',394,0,1040,850,490)},
 ].map(p=>`<section class="module"><div class="label"><span class="name">${p.name}</span><span class="number">${p.n}</span></div>${p.crop}</section>`).join('')}</div>`},
 {file:'board-detail.png',w:1600,h:1000,body:`<div class="frame"><div class="window">${crop('board',350,365,1140,688,1504)}</div></div>`},
 {file:'research-detail.png',w:1600,h:1000,body:`<div class="frame"><div class="window">${crop('research',397,125,1040,610,1504)}</div></div>`},
];
const browser=await chromium.launch({channel:'chrome',headless:true});
for(const c of compositions){
 const html=`<!doctype html><meta charset="utf-8"><style>${css}</style><main style="width:${c.w}px;height:${c.h}px">${c.body}</main>`;
 const path=resolve(scratch,'composition.html');await writeFile(path,html);
 const page=await browser.newPage({viewport:{width:c.w,height:c.h}});await page.goto(pathToFileURL(path).href);
 await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
 await page.locator('main').screenshot({path:`${out}/${c.file}`});await page.close();console.log(c.file);
}
await browser.close();
