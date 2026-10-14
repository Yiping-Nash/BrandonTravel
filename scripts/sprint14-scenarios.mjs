import assert from 'node:assert/strict';import {randomUUID}from 'node:crypto';import {writeFileSync}from 'node:fs';
export async function verifySprint14({api,checks}){
 await import('../apps/api/node_modules/tsx/dist/loader.mjs');const {applyOperations}=await import('../apps/api/src/travel/domain.ts');
 let trip=await api('/trips','POST',{title:'Sprint14隔离验收',startDate:'2026-10-13',endDate:'2026-10-17'},201);const ids=[randomUUID(),randomUUID()];
 const command=operations=>({operations,expectedRevision:trip.revision,requestId:randomUUID()});const path='/trips/'+trip.id;
 trip=await api(path+'/operations','POST',command(ids.map((id,i)=>({type:'add',activity:{id,title:'活动'+i,date:i?'2026-10-15':'2026-10-13',start:600,duration:60,notes:'保留',place:'待确认',locked:false,position:i}}))));
 const input=command([{type:'set_trip_range',startDate:'2026-10-13',endDate:'2026-10-14'}]),expected=applyOperations(trip,input.operations,'user');trip=await api(path+'/operations','POST',input);assert.deepEqual(trip,expected);assert.deepEqual(await api(path+'/operations','POST',input),trip);assert.deepEqual(await api(path),trip);assert.equal(trip.activities[1].backlogOriginDate,'2026-10-15');
 await api(path+'/operations','POST',{...input,requestId:randomUUID()},409);checks.push('日期缩短、来源分组持久化、身份不变、领域／REST／薄消费者一致、幂等与并发');
 trip=await api(path+'/operations','POST',command([{type:'edit',id:ids[0],patch:{locked:true}}]));const before=trip;await api(path+'/operations','POST',command([{type:'return_to_pending',ids}]),422);assert.deepEqual(await api(path),before);checks.push('固定项导致整批失败，无部分写入');
 trip=await api(path+'/operations','POST',command([{type:'edit',id:ids[0],patch:{locked:false}}]));
 const proposal=await api(path+'/proposals','POST',{...command([{type:'set_trip_range',startDate:'2026-10-16',endDate:'2026-10-17'}]),reason:'测试未来Agent共用日期能力'},201);assert.deepEqual(await api(path),trip);trip=await api('/proposals/'+proposal.id+'/confirm','POST',{});if(trip.result)trip=trip.result;const latest=await api(path);assert.equal(latest.startDate,'2026-10-16');checks.push('新领域能力可提出提案，确认前不变，确认后同一规则写入');
 writeFileSync('verification/sprint14-api.json',JSON.stringify({checks:checks.slice(-3),realProviderRequests:0,modelRequests:0},null,2));
}
