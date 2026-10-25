import {test,expect} from '../../apps/web/node_modules/@playwright/test/index.mjs';

async function create(request,title,start='2026-11-02',end='2026-11-06'){
  return (await request.post('/api/trips',{data:{title,destination:'杭州',startDate:start,endDate:end,timezone:'Asia/Shanghai'}})).json();
}

test('delayed chat refresh cannot regress a newer human edit',async({page})=>{
  const s=await create(page.request,'并发回归');
  await page.goto(`/?trip=${s.trip.id}`);await expect(page.getByTestId('view-board')).toBeVisible();
  let release;const gate=new Promise(r=>release=r);let captured=false;
  // A deterministic no-suggestion chat fixture isolates network ordering; no provider claim.
  await page.route(`**/api/trips/${s.trip.id}/chat`,r=>r.fulfill({json:{sessionId:'test-ordering',reply:'并发测试回复',suggestions:[],uncertainty:[],mode:'demo',snapshotVersion:1,traceUrl:null,toolCalls:[]}}));
  await page.route(`**/api/trips/${s.trip.id}`,async r=>{const response=await r.fetch();captured=true;await gate;await r.fulfill({response});});
  await page.getByLabel('给 Brandon 的消息').fill('并发测试');await page.getByLabel('发送消息').click();
  await expect.poll(()=>captured).toBe(true);
  await page.getByRole('button',{name:'添加活动',exact:true}).first().click();
  await page.getByLabel('活动名称').fill('较新的编辑');await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  release();await expect(page.getByText('较新的编辑',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'添加活动',exact:true}).first().click();
  await page.getByLabel('活动名称').fill('再次编辑无冲突');await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('较新的编辑',{exact:true})).toBeVisible();
});

test('late command response cannot reopen the trip user left',async({page})=>{
  const a=await create(page.request,'旧旅行回归'),b=await create(page.request,'新旅行回归');
  await page.goto(`/?trip=${a.trip.id}`);await expect(page.getByTestId('view-board')).toBeVisible();
  let release;const gate=new Promise(r=>release=r);let captured=false;
  await page.route(`**/api/trips/${a.trip.id}/commands`,async r=>{const response=await r.fetch();captured=true;await gate;await r.fulfill({response});});
  await page.getByRole('button',{name:'添加活动',exact:true}).first().click();await page.getByLabel('活动名称').fill('后台完成的旧旅行编辑');
  await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>captured).toBe(true);
  await page.getByLabel('关闭弹窗').click();await page.getByRole('button',{name:'我的旅行',exact:true}).click();
  await page.getByTestId(`trip-${b.trip.id}`).click();await expect(page.getByRole('heading',{name:'新旅行回归'})).toBeVisible();
  release();await page.waitForResponse(r=>r.url().endsWith(`/trips/${a.trip.id}/commands`));
  await expect(page.getByRole('heading',{name:'新旅行回归'})).toBeVisible();expect(new URL(page.url()).searchParams.get('trip')).toBe(b.trip.id);
});

test('Shanghai civil times ignore browser New York DST',async({browser,request})=>{
  const s=await create(request,'时区回归','2026-03-08','2026-03-12');
  const out=await(await request.post(`/api/trips/${s.trip.id}/commands`,{data:{expectedVersion:s.version,command:{type:'addActivity',activity:{title:'三小时活动',date:'2026-03-08',startAt:'2026-03-08T01:00',endAt:'2026-03-08T04:00'}}}})).json();
  const id=out.activities[0].id;
  const context=await browser.newContext({timezoneId:'America/New_York',viewport:{width:1512,height:982}});const page=await context.newPage();
  await page.goto(`http://127.0.0.1:5173/?trip=${s.trip.id}`);await page.getByTestId('view-day').click();
  const event=page.getByTestId(`calendar-event-${id}`);
  expect((await event.boundingBox()).height).toBe(280); // 180 civil minutes, not 120 elapsed NY minutes.
  await page.locator('.calendar-scroll [data-radix-scroll-area-viewport]').evaluate(el=>el.scrollTop=0);
  await event.dragTo(page.getByRole('gridcell').nth(8)); // 04:00 local Trip time.
  await expect.poll(async()=> (await(await request.get(`/api/trips/${s.trip.id}`)).json()).activities[0].endAt).toBe('2026-03-08T07:00');
  await expect(event).toContainText('04:00 - 07:00');
  await context.close();
});
