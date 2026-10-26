import type {ReactNode} from 'react';
import {useCalendar} from '../contexts/calendar-context';
export function AddEditEventDialog({startDate,startTime,children}:{startDate:Date;startTime:{hour:number;minute:number};children:ReactNode}){const {createEvent}=useCalendar();return <div className="contents" onDoubleClick={()=>createEvent(startDate,startTime.hour,startTime.minute)}>{children}</div>;}
