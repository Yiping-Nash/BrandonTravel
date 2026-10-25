import type { components } from './api';
export type Snapshot = components['schemas']['TripSnapshot'];
export type Activity = components['schemas']['Activity'];
export type Trip = components['schemas']['Trip'];
export type Idea = components['schemas']['Idea'];
export type Command = components['schemas']['Command'];
export type ChatResponse = components['schemas']['ChatResponse'];
export type Place = components['schemas']['Place'];
const stamp='2026-10-26T00:00:00Z';
export const demoSnapshot: Snapshot = {
  version:1,
  trip:{id:'demo-hangzhou',title:'杭州，慢一点',destination:'杭州',startDate:'2026-11-02',endDate:'2026-11-06',timezone:'Asia/Shanghai',preferences:'喜欢散步、茶与建筑。每天留一点自由时间。',createdAt:stamp,updatedAt:stamp},
  ideas:['找一家湖边咖啡馆','留半天逛小店','日落时拍照'].map((title,i)=>({id:`idea-${i}`,tripId:'demo-hangzhou',title,description:'手动演示候选，不是实时地点推荐',place:null,sourceKind:'manual',evidence:[],createdAt:stamp,updatedAt:stamp})),
  activities:['抵达杭州，安顿下来','湖边散步','晚餐与自由时间','喝一杯龙井茶','山间慢行','找一家小馆子','逛展与建筑漫步','午后留白','运河边骑行','给喜欢的地方多一点时间','买点伴手礼','慢慢返程'].map((title,i)=>{const day=Math.min(6,2+Math.floor(i/3));const date=`2026-11-0${day}`;return {id:`activity-${i}`,tripId:'demo-hangzhou',title,date,sortKey:i%3,startAt:i===1?`${date}T09:00`:i===4?`${date}T14:00`:null,endAt:i===1?`${date}T11:00`:i===4?`${date}T16:00`:null,notes:'演示数据，可自由编辑',place:null,ideaId:null,createdAt:stamp,updatedAt:stamp};}),
  suggestions:[],
};
/** Read-only fixture adapter for first paint; real mutations must use Workspace API. */
export const mockAdapter={getSnapshot:async()=>structuredClone(demoSnapshot),mode:'demo' as const};
