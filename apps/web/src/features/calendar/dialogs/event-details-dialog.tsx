import type {ReactNode} from 'react';
import type {IEvent} from '../interfaces';
import {useCalendar} from '../contexts/calendar-context';
export function EventDetailsDialog({event,children}:{event:IEvent;children:ReactNode}){const {editEvent}=useCalendar();return <div className="contents" onClick={()=>editEvent(event.id)}>{children}</div>;}
