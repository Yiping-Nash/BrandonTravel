// Capture existing actual UI state. Optional --chat performs one real Chat request.
import {chromium,expect} from '../apps/web/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';
const id=process.argv[2];if(!id)throw Error('Trip ID required');const base=process.env.PORTFOLIO_URL||'http://127.0.0.1:5174';
await fs.mkdir('docs/screenshots/portfolio',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1512,height:982}});
try{
 await page.goto(`${base}/?trip=${id}`);await expect(page.getByTestId('view-board')).toBeVisible();
 const snapshot=await(await page.request.get(`${base}/api/trips/${id}`)).json();
 await page.getByLabel('选中日期').fill(snapshot.trip.endDate);await page.getByTestId('view-day').click();
 if(process.argv.includes('--chat')){
  await page.getByLabel('给 Brandon 的消息').fill(`请读取当前行程，简短评估 ${snapshot.trip.endDate} 的安排是否需要留出更多交通与休息时间。哪些是已知，哪些还未核实？不需要新地点建议。`);
  const pending=page.waitForResponse(r=>r.url().endsWith('/chat')&&r.request().method()==='POST',{timeout:130000});await page.getByLabel('发送消息').click();const response=await pending;if(!response.ok())throw Error(`Chat ${response.status()}`);
  const result=await response.json();await fs.writeFile('data/portfolio/live-chat.json',JSON.stringify({tripId:id,...result},null,2));await expect(page.locator('.message.assistant').last()).toBeVisible();
 }
 await expect.poll(()=>page.locator('.amap-static>img').evaluate(i=>i.complete&&i.naturalWidth>0),{timeout:20000}).toBe(true);
 await expect(page.getByText('正在检查时间与地点关系…')).toHaveCount(0,{timeout:120000});
 await page.screenshot({path:'docs/screenshots/portfolio/hero.png',fullPage:false,animations:'disabled'});
 await page.screenshot({path:'docs/screenshots/portfolio/day.png',fullPage:true,animations:'disabled'});
 await page.getByTestId('view-board').click();await page.screenshot({path:'docs/screenshots/portfolio/board.png',fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'深入研究',exact:true}).first().click();await expect(page.locator('.research-candidate').first()).toBeVisible();
 await page.locator('.research-candidate').first().scrollIntoViewIfNeeded();await page.screenshot({path:'docs/screenshots/portfolio/research.png',fullPage:false,animations:'disabled'});
 await page.locator('.research-candidate').first().locator('summary').first().click();await page.screenshot({path:'docs/screenshots/portfolio/evidence.png',fullPage:true,animations:'disabled'});
 console.log('Captured actual Board / Day / Research / Evidence UI');
}finally{await browser.close();}
