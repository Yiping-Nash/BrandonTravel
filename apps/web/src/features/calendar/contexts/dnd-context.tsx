import { UTCDate } from "@/lib/wall-time";
import { parseWall as parseISO } from "@/lib/wall-time";
import {createContext,useContext,useState,type ReactNode} from 'react';
import { format, addMinutes, differenceInMinutes } from "date-fns";
import {useCalendar} from './calendar-context';
import type {IEvent} from '../interfaces';
type Dnd={draggedEvent:IEvent|null;isDragging:boolean;startDrag:(event:IEvent)=>void;endDrag:()=>void;handleEventDrop:(date:Date,hour?:number,minute?:number)=>void};
const Context=createContext<Dnd|null>(null);
/** Adapted upstream DnD: keep wall-clock time; commit once through Workspace. */
export function DndProvider({children}:{children:ReactNode}){const [event,setEvent]=useState<IEvent|null>(null);const {updateEvent}=useCalendar();return <Context.Provider value={{draggedEvent:event,isDragging:!!event,startDrag:setEvent,endDrag:()=>setEvent(null),handleEventDrop:(date,hour,minute)=>{if(!event)return;const start=parseISO(event.startDate),end=parseISO(event.endDate);const next=new UTCDate(date);next.setHours(hour??start.getHours(),minute??start.getMinutes(),0,0);setEvent(null);updateEvent({...event,startDate:format(next,"yyyy-MM-dd'T'HH:mm"),endDate:format(addMinutes(next,differenceInMinutes(end,start)),"yyyy-MM-dd'T'HH:mm")});}}}>{children}</Context.Provider>;}
export function useDragDrop(){const value=useContext(Context);if(!value)throw new Error('Missing DndProvider');return value;}
