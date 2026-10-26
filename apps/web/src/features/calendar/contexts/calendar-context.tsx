import { createContext,useContext,type ReactNode } from 'react';
import type { IEvent } from '../interfaces';
type Context={selectedDate:Date;setSelectedDate:(date:Date)=>void;view:'day'|'week'|'month'|'agenda'|'year';use24HourFormat:boolean;badgeVariant:'colored'|'dot';updateEvent:(event:IEvent)=>void;editEvent:(id:string)=>void;createEvent:(date:Date,hour:number,minute:number)=>void};
const CalendarContext=createContext<Context|null>(null);
/** Controlled adapter: Workspace owns events; this context owns no domain data. */
export function CalendarProvider({children,...value}:Context&{children:ReactNode}){return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;}
export function useCalendar(){const value=useContext(CalendarContext);if(!value)throw new Error('Missing CalendarProvider');return value;}
