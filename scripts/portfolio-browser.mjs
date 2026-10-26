// Real Chrome + real local API. This opt-in script makes bounded paid model calls.
// Run: node scripts/portfolio-browser.mjs shanxi|hangzhou|shanghai
import {chromium,expect} from '../apps/web/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';
const scenario=process.argv[2]||'shanxi';
const scenarios={
 shanxi:{title:'山西 · 与古建相遇',destination:'山西',who:'朋友结伴',preferences:'两位古建筑与雕塑爱好者，太原和晋中为主，节奏舒缓。交通未预订；不把同一景区的子地点当成不同游览重复安排。',start:'2026-11-02',end:'2026-11-04'},
 hangzhou:{title:'杭州 · 亲子慢周末',destination:'杭州',who:'亲子家庭',preferences:'两位大人和一个六岁孩子，喜欢自然和动手体验；午后需要休息，不安排登山和夜间活动。',start:'2026-11-07',end:'2026-11-09'},
 shanghai:{title:'上海 · 长者的建筑漫步',destination:'上海',who:'长者同行',preferences:'带两位长者轻松旅行，喜欢城市建筑和博物馆；步行不宜连续超过30分钟，尽量避免跨城，午间休息。',start:'2026-11-12',end:'2026-11-14'},
};
if(!scenarios[scenario])throw new Error('Unknown scenario');
const spec=scenarios[scenario],base=process.env.PORTFOLIO_URL||'http://127.0.0.1:5174';
const out=`data/portfolio/browser/${scenario}-${Date.now()}`;
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1512,height:982},recordVideo:{dir:out,size:{width:1512,height:982}}});
const page=await context.newPage();page.setDefaultTimeout(15000);
const evidence={scenario,kind:'Real Chrome / live model / actual AMap',startedAt:new Date().toISOString(),checks:[],errors:[],tripId:null,traceUrls:[]};
page.on('pageerror',e=>evidence.errors.push(e.message));
const save=async name=>{await page.screenshot({path:`${out}/${name}.png`,fullPage:true,animations:'disabled'});};
const check=(name,pass)=>{if(!pass)throw new Error(name);evidence.checks.push(name);console.log(`PASS ${name}`);};
try{
 const resume=process.env.PORTFOLIO_TRIP_ID;
 if(resume){
  await page.goto(`${base}/?trip=${resume}`);await expect(page.getByTestId('view-board')).toBeVisible();evidence.tripId=resume;evidence.resume=true;
 }else{
 await page.goto(base);
 await page.getByRole('button',{name:'创建旅行',exact:true}).first().click();
 await page.getByLabel('旅行名称',{exact:true}).fill(spec.title);
 // Genuine optional start: creation happens before destination/dates/companions.
 await page.getByRole('dialog').getByRole('button',{name:'创建旅行',exact:true}).click();
 await page.waitForURL(/\?trip=/);
 await expect(page.getByRole('heading',{name:spec.title,exact:true})).toBeVisible();
 evidence.tripId=new URL(page.url()).searchParams.get('trip');
 const api=`${base}/api/trips/${evidence.tripId}`;
 const snapshot=async()=>await(await page.request.get(api)).json();
 let state=await snapshot();check('Blank Trip has no invented destination/dates',state.trip.destination===''&&state.trip.startDate===null&&state.trip.endDate===null);
 await save('01-blank-trip');
 await page.getByRole('button',{name:'旅行偏好',exact:true}).click();
 const dialog=page.locator('.trip-form');
 await dialog.locator('summary').filter({hasText:'Where'}).click();await dialog.getByLabel('目的地',{exact:true}).fill(spec.destination);
 await dialog.locator('summary').filter({hasText:'When'}).click();await dialog.getByLabel('出发日期').fill(spec.start);await dialog.getByLabel('结束日期').fill(spec.end);
 await dialog.locator('summary').filter({hasText:'Who'}).click();await dialog.getByRole('button',{name:spec.who,exact:true}).click();
 await dialog.getByLabel('旅行偏好内容').fill(spec.preferences);await save('02-where-when-who');
 await dialog.getByRole('button',{name:'保存旅行设置'}).click();await expect.poll(async()=>(await snapshot()).trip.startDate).toBe(spec.start);
 await page.getByTestId('tab-itinerary').click();
 }
 const api=`${base}/api/trips/${evidence.tripId}`;
 const snapshot=async()=>await(await page.request.get(api)).json();
 let state;
 await page.getByRole('button',{name:'AI 旅行蓝图',exact:true}).click();
 const button=page.getByRole('button',{name:'生成变更预览',exact:true});
 const generated=page.waitForResponse(r=>r.url().endsWith('/proposals/generate')&&r.request().method()==='POST',{timeout:200000});
 await button.click();
 const response=await generated;if(!response.ok())throw new Error(`Blueprint HTTP ${response.status()}: ${await response.text()}`);
 await expect(page.getByTestId('proposal-diff')).toBeVisible({timeout:200000});
 state=await snapshot();check('AI preview does not write itinerary or Ideas',state.activities.length===0&&state.ideas.length===0);
 const proposals=await(await page.request.get(api+'/proposals')).json();const proposal=proposals[0];
 evidence.proposal=proposal;if(proposal.traceUrl)evidence.traceUrls.push(proposal.traceUrl);
 check('Blueprint contains all three dates',new Set(proposal.actions.filter(a=>a.type==='addActivity').map(a=>a.activity.date)).size===3);
 await save('03-ai-blueprint-preview');
 await page.getByTestId('confirm-proposal').click();await expect(page.getByTestId('proposal-diff')).toContainText('已确认并保存');
 await page.getByLabel('收起 AI 面板').click();
 state=await snapshot();check('Confirmation writes once to canonical Trip',state.activities.length===proposal.actions.filter(a=>a.type==='addActivity').length);
 await save('04-workspace-hero');
 await page.getByTestId('view-day').click();
 const located=state.activities.find(a=>a.date===spec.start&&a.place?.latitude!=null);
 if(located){await expect(page.locator('.amap-static>img')).toBeVisible();await expect.poll(()=>page.locator('.amap-static>img').evaluate(i=>i.complete&&i.naturalWidth>0),{timeout:25000}).toBe(true);check('Actual AMap image loaded for Day',true);}
 await save('05-day-timeline-map-chat');
 // Editing an activity is a genuine UI interaction, not direct DB fixture loading.
 const first=state.activities.find(a=>a.date===spec.start);
 await page.getByTestId('view-board').click();await page.getByTestId(`activity-${first.id}`).click();
 await page.getByLabel('活动名称').fill(first.title+' · 留有余地');await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.reload();state=await snapshot();check('Manual edit survives refresh after AI confirmation',state.activities.some(a=>a.id===first.id&&a.title.endsWith('留有余地')));
 await page.getByTestId('view-week').click();await save('06-week-after-edit');
 check('No browser runtime exceptions',evidence.errors.length===0);
 evidence.status='Pass';evidence.finalSnapshot=state;
}catch(e){evidence.status='Fail';evidence.failure=e.message;await save('failure').catch(()=>{});console.error(e.message);process.exitCode=1;}
finally{evidence.finishedAt=new Date().toISOString();await fs.writeFile(`${out}/results.json`,JSON.stringify(evidence,null,2));await context.close();await browser.close();console.log(JSON.stringify({out,status:evidence.status,tripId:evidence.tripId}));}
