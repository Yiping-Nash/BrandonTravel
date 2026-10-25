import {test,expect} from '../../apps/web/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';

test('today question replies visibly, survives collapse and reload with selected session',async({page})=>{
  test.setTimeout(150000);
  const trip=await(await page.request.post('/api/trips',{data:{title:'回复可见性验收',destination:'杭州',startDate:'2026-11-02',endDate:'2026-11-06'}})).json();
  await page.goto(`/?trip=${trip.trip.id}`);
  await page.getByLabel('给 Brandon 的消息').fill('今天日程是不是太满？');
  const responsePromise=page.waitForResponse(r=>r.url().endsWith('/chat')&&r.request().method()==='POST',{timeout:120000});
  await page.getByLabel('发送消息').click();
  await expect(page.locator('.chat-panel')).toContainText('今天日程是不是太满？');
  await expect(page.locator('.thinking')).toBeVisible();
  await page.getByLabel('收起聊天').click();
  const response=await responsePromise;expect(response.status()).toBe(200);
  const result=await response.json();expect(result.reply.length).toBeGreaterThan(30);expect(result.toolCalls).toContain('get_trip_snapshot');
  await page.getByLabel('展开聊天').click();
  await expect(page.locator('.message.assistant').last()).toContainText(result.reply.slice(0,40));
  await page.reload();
  await expect(page.getByLabel('聊天会话')).toHaveValue(result.sessionId);
  await expect(page.locator('.message.assistant').last()).toContainText(result.reply.slice(0,40));
  await page.locator('.message.assistant').last().scrollIntoViewIfNeeded();
  await page.screenshot({path:'docs/screenshots/chat-recovery.png',fullPage:true,animations:'disabled'});
  await fs.writeFile('evaluation/chat-recovery-result.json',JSON.stringify({passed:true,tripId:trip.trip.id,sessionId:result.sessionId,reply:result.reply,traceUrl:result.traceUrl,toolCalls:result.toolCalls},null,2));
});
