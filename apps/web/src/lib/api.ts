import type { components } from '../../../../packages/contracts/api';
import { parseWall } from './wall-time';
export type Schema=components['schemas'];
export type Snapshot=Schema['TripSnapshot'];
export type Activity=Schema['Activity'];
export type Idea=Schema['Idea'];
export type Place=Schema['Place'];
export type Command=Schema['Command']['command'];
export type Trip=Schema['Trip'];
export type ChatResponse=Schema['ChatResponse'];
export type Session=Schema['ChatSession'];
export class ApiError extends Error{constructor(public status:number,message:string){super(message);}}
export async function request<T>(path:string,body?:unknown):Promise<T>{
 const result=await fetch(`/api${path}`,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 let data;try{data=await result.json();}catch{throw new ApiError(result.status,'服务暂时不可用，请确认 API 已启动。');}
 if(!result.ok)throw new ApiError(result.status,data.error?.message||data.detail?.[0]?.msg||'请求失败，请重试。');
 return data as T;
}
export function localDate(date:Date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export function parseDate(date:string){return parseWall(date);}
export function addDate(date:string,n:number){const d=parseDate(date);d.setDate(d.getDate()+n);return localDate(d);}
export function tripDates(trip:Trip){const days:string[]=[];for(let d=trip.startDate;d<=trip.endDate;d=addDate(d,1))days.push(d);return days;}
export function activityInput(a:Activity):Schema['ActivityInput']{return {title:a.title,date:a.date,startAt:a.startAt,endAt:a.endAt,place:a.place,ideaId:a.ideaId,notes:a.notes};}
