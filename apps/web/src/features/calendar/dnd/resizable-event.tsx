import { parseWall as parseISO } from "@/lib/wall-time";
import {useState,type ReactNode} from 'react';
import {Resizable} from 're-resizable';
import { addMinutes, differenceInMinutes, format } from "date-fns";
import type {IEvent} from '../interfaces';
import {useCalendar} from '../contexts/calendar-context';
/** Adapted upstream resize: preview locally; commit only at resize end. */
export function ResizableEvent({event,children}:{event:IEvent;children:ReactNode}){const {updateEvent}=useCalendar();const [resize,setResize]=useState(false);const duration=differenceInMinutes(parseISO(event.endDate),parseISO(event.startDate));return <Resizable size={{width:'100%',height:duration/60*96-8}} minHeight={16} enable={{top:false,bottom:true,right:false,left:false,topRight:false,bottomRight:false,bottomLeft:false,topLeft:false}} onResizeStart={()=>setResize(true)} onResizeStop={(_e,_dir,_ref,delta)=>{setResize(false);const minutes=Math.max(15,Math.round((duration+delta.height/96*60)/15)*15);updateEvent({...event,endDate:format(addMinutes(parseISO(event.startDate),minutes),"yyyy-MM-dd'T'HH:mm")});}} style={{zIndex:resize?50:undefined}}>{children}</Resizable>;}
