import { chromium, expect } from '../apps/web/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const personas=JSON.parse(await fs.readFile('evaluation/persona-results.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
for(const [index,persona] of personas.entries()){
 const page=await browser.newPage({viewport:{width:1512,height:982}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const snapshot=async()=>await(await page.request.get(`http://127.0.0.1:8000/api/trips/${persona.tripId}`)).json();
 const before=await snapshot();
 await page.goto(persona.url);await expect(page.getByTestId('view-board')).toBeVisible();
 await expect(page.locator('.day-column')).toHaveCount(persona.days);
 await expect(page.locator('[data-testid^="activity-"]')).toHaveCount(persona.activities);
 await page.screenshot({path:`docs/screenshots/persona-${index+1}-board.png`,fullPage:true,animations:'disabled'});
 await page.getByTestId('view-day').click();
 const first=before.activities.filter(a=>a.date===before.trip.startDate);
 await expect(page.locator('[data-testid^="untimed-"]')).toHaveCount(first.filter(a=>!a.startAt).length);
 await expect(page.locator('[data-testid^="calendar-event-"]')).toHaveCount(first.filter(a=>a.startAt).length);
 await page.screenshot({path:`docs/screenshots/persona-${index+1}-day.png`,fullPage:true,animations:'disabled'});
 await page.getByTestId('view-week').click();
 await page.screenshot({path:`docs/screenshots/persona-${index+1}-week.png`,fullPage:true,animations:'disabled'});
 if(persona.days>7){
   await page.getByLabel('下一段日期').click();
   const next=before.activities.find(a=>a.title.startsWith('跨周：再访'));
   await expect(page.getByTestId(`calendar-event-${next.id}`)).toBeVisible();
   await page.screenshot({path:`docs/screenshots/persona-${index+1}-week-next.png`,fullPage:true,animations:'disabled'});
 }
 await page.reload();await expect(page.locator('[data-testid^="activity-"]')).toHaveCount(persona.activities);
 assert.deepEqual(await snapshot(),before);assert.deepEqual(errors,[]);
 results.push({persona:persona.persona,tripId:persona.tripId,passed:true,views:['Board','Day','Week'],crossWeekPassed:persona.days>7?true:null,pageErrors:errors});
 await page.close();
}
await browser.close();await fs.writeFile('evaluation/persona-browser-results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
