// Opt-in real UI model calls on an existing demo Trip. No fixture responses.
import {chromium,expect} from '../apps/web/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';
const [kind,id]=process.argv.slice(2);if(!['day','research'].includes(kind)||!id)throw Error('Usage: node scripts/portfolio-followup.mjs day|research <Trip ID>');
const base=process.env.PORTFOLIO_URL||'http://127.0.0.1:5174',out=`data/portfolio/browser/${kind}-${Date.now()}`;
await fs.mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1512,height:982},recordVideo:{dir:out,size:{width:1512,height:982}}}),page=await context.newPage();
page.setDefaultTimeout(15000);const result={kind,tripId:id,status:'Running',checks:[],errors:[],traceUrls:[]};page.on('pageerror',e=>result.errors.push(e.message));
const path=`${base}/api/trips/${id}`,snapshot=async()=>await(await page.request.get(path)).json(),save=async name=>await page.screenshot({path:`${out}/${name}.png`,fullPage:true,animations:'disabled'});
const check=(name,pass)=>{if(!pass)throw Error(name);result.checks.push(name);console.log('PASS '+name);};
try{
 await page.goto(`${base}/?trip=${id}`);await expect(page.getByTestId('view-board')).toBeVisible();
 const before=await snapshot();
 if(kind==='day'){
  await page.getByTestId('view-day').click();await page.getByRole('button',{name:'讨论这一天',exact:true}).click();
  await page.getByLabel('规划要求').fill(`请把 ${before.trip.startDate} 已定时间的第一项活动开始和结束各延后30分钟。其他活动保持不变，不搜索新地点。用单日规则检查说明变化，开放预约尚未核实。`);
  const pending=page.waitForResponse(r=>r.url().endsWith('/proposals/generate')&&r.request().method()==='POST',{timeout:200000});await page.getByRole('button',{name:'生成变更预览',exact:true}).click();const res=await pending;if(!res.ok())throw Error(`Day HTTP ${res.status()}: ${await res.text()}`);
  result.proposal=await res.json();result.traceUrls=[result.proposal.traceUrl].filter(Boolean);
  check('Day proposal updates actual current activity',result.proposal.actions.some(a=>a.type==='updateActivity'&&before.activities.some(b=>b.id===a.activityId)));
  check('Day preview leaves canonical activities unchanged',JSON.stringify((await snapshot()).activities)===JSON.stringify(before.activities));
  await save('01-day-diff');await page.getByTestId('confirm-proposal').click();await expect(page.getByTestId('proposal-diff')).toContainText('已确认并保存');
  await page.getByLabel('收起 AI 面板').click();await expect(page.locator('.amap-static>img')).toBeVisible();await expect.poll(()=>page.locator('.amap-static>img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);await save('02-day-adjusted');
  const after=await snapshot();check('Day confirmation preserves activity count and changes time',after.activities.length===before.activities.length&&after.activities.some(a=>before.activities.find(b=>b.id===a.id)?.startAt!==a.startAt));
  await page.reload();check('Confirmed day change survives reload',JSON.stringify((await snapshot()).activities)===JSON.stringify(after.activities));
 }else{
  await page.getByRole('button',{name:'深入研究',exact:true}).first().click();
  await page.getByLabel('研究问题').fill(process.env.RESEARCH_QUESTION||'结合我们对古建筑和彩塑的偏好，研究晋中平遥双林寺是否值得加入这趟旅行。只需一个候选，查高德实际地点及官方或权威公开资料，用证据解释文化看点、与已有安排的区别；未来开放和预约未核实就明确未知。先作为 Ideas，不压满日程。');
  let run;
  if(process.env.RESEARCH_RUN_ID){run={id:process.env.RESEARCH_RUN_ID};result.resume=true;}
  else{const started=page.waitForResponse(r=>r.url().endsWith('/research-runs')&&r.request().method()==='POST');await page.getByRole('button',{name:'开始研究',exact:true}).click();const res=await started;if(!res.ok())throw Error(await res.text());run=await res.json();}
  result.runId=run.id;
  await save('01-research-running');
  let completed;await expect.poll(async()=>{const list=await(await page.request.get(path+'/research-runs')).json();completed=list.find(r=>r.id===run.id);return !['queued','running'].includes(completed.status);},{timeout:200000,intervals:[1500,2500,4000]}).toBe(true);
  result.run=completed;result.traceUrls=[completed.traceUrl].filter(Boolean);
  if(!['completed','partial'].includes(completed.status))throw Error(`Research ${completed.status}: ${completed.error}`);
  check('Real research returns a nonempty evidence-backed candidate',completed.result.candidates.length>0&&completed.evidence.some(e=>e.sourceType==='web'&&e.excerpt?.trim()));
  check('Research does not write itinerary or Ideas',JSON.stringify((await snapshot()).activities)===JSON.stringify(before.activities)&&(await snapshot()).ideas.length===before.ideas.length);
  await expect(page.locator('.research-candidate').first()).toBeVisible();await page.locator('.research-candidate').first().locator('summary').first().click();await save('02-research-evidence');
  await page.locator('.research-candidate').first().getByRole('button',{name:'预览保存到 Ideas',exact:true}).click();await expect(page.getByTestId('proposal-diff')).toBeVisible();
  check('Candidate preview is still read only',(await snapshot()).ideas.length===before.ideas.length);await save('03-adoption-preview');
  await page.getByTestId('confirm-proposal').click();await expect(page.getByTestId('proposal-diff')).toContainText('已确认并保存');await page.getByLabel('收起 AI 面板').click();
  const after=await snapshot();check('User confirmation persists one researched Idea',after.ideas.length===before.ideas.length+1&&after.activities.length===before.activities.length);
  const idea=after.ideas.find(i=>!before.ideas.some(b=>b.id===i.id));await page.getByTestId('tab-ideas').click();await save('04-idea-saved');
  await page.getByTestId(`adopt-idea-${idea.id}`).click();await page.getByLabel('采纳日期').selectOption(before.trip.endDate);await page.getByRole('button',{name:'确认加入日程'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();check('Researched Idea can be scheduled and survives refresh',(await snapshot()).activities.some(a=>a.ideaId===idea.id));
  await page.getByLabel('选中日期').fill(before.trip.endDate);await page.getByTestId('view-day').click();await expect(page.locator('.amap-static>img')).toBeVisible();await expect.poll(()=>page.locator('.amap-static>img').evaluate(i=>i.complete&&i.naturalWidth>0),{timeout:20000}).toBe(true);await save('05-research-in-workspace');
 }
 check('No browser runtime exceptions',result.errors.length===0);result.status='Pass';result.finalSnapshot=await snapshot();
}catch(e){result.status='Fail';result.failure=e.message;console.error(e.message);process.exitCode=1;await save('failure').catch(()=>{});}
finally{await fs.writeFile(`${out}/results.json`,JSON.stringify(result,null,2));await context.close();await browser.close();console.log(JSON.stringify({out,status:result.status}));}
