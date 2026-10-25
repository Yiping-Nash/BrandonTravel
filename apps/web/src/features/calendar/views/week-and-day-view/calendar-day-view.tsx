import { CalendarWeekView } from "./calendar-week-view";
import type { IEvent } from "../../interfaces";
/** Day shares the adapted upstream week time-grid and DnD behavior. */
export function CalendarDayView(props:{singleDayEvents:IEvent[];multiDayEvents:IEvent[]}){return <CalendarWeekView {...props} dayOnly/>;}
