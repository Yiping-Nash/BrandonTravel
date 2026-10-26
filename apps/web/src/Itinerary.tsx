import {useEffect,useRef,useState} from 'react';
import {Clock,GripVertical,MapPin,Plus} from 'lucide-react';
import {KanbanProvider,KanbanBoard,KanbanHeader,KanbanCards,KanbanCard} from './components/kibo-ui/kanban';
import {CalendarProvider} from './features/calendar/contexts/calendar-context';
import {DndProvider} from './features/calendar/contexts/dnd-context';
import {CalendarDayView} from './features/calendar/views/week-and-day-view/calendar-day-view';
import {CalendarWeekView} from './features/calendar/views/week-and-day-view/calendar-week-view';
import type {IEvent} from './features/calendar/interfaces';
import {activityInput,localDate,parseDate,tripDates,type Activity,type Command,type Snapshot} from './lib/api';

export type EditDraft=Partial<Activity>&{date:string};
type Props={snapshot:Snapshot;date:string;view:'board'|'day'|'week';setDate:(value:string)=>void;edit:(activity:EditDraft)=>void;command:(value:Command)=>Promise<boolean>;busy:boolean};
export function Itinerary({snapshot,date,view,setDate,edit,command,busy}:Props){
 const activities=snapshot.activities||[];const dates=tripDates(snapshot.trip);
 const sorted=[...activities].sort((a,b)=>a.date.localeCompare(b.date)||a.sortKey-b.sortKey);
 type Item={id:string;name:string;column:string;activity:Activity};
 const items=()=>sorted.map(a=>({id:a.id,name:a.title,column:a.date,activity:a}));
 const [draft,setDraft]=useState<Item[]>(items);const draftRef=useRef(draft);const activeRef=useRef<string|null>(null);
 useEffect(()=>{const next=items();setDraft(next);draftRef.current=next;},[snapshot]);
 useEffect(()=>{if(view!=='board'){const viewport=document.querySelector('.calendar-scroll [data-radix-scroll-area-viewport]');if(viewport)viewport.scrollTop=7*96;}},[view,date]);
 const changeDraft=(value:Item[])=>{draftRef.current=value;setDraft(value);};
 const commitDrag=()=>{setTimeout(()=>{const id=activeRef.current;activeRef.current=null;if(!id)return;const next=draftRef.current.find(a=>a.id===id);if(!next)return;const index=draftRef.current.filter(a=>a.column===next.column).findIndex(a=>a.id===id);void command({type:'moveActivity',activityId:id,date:next.column,index}).then(ok=>{if(!ok){const reset=items();setDraft(reset);draftRef.current=reset;}});},0);};
 const events:IEvent[]=activities.filter(a=>a.startAt&&a.endAt).map(a=>({id:a.id,title:a.title,startDate:a.startAt!,endDate:a.endAt!,description:a.notes||'',color:'green',user:{id:'traveler',name:'旅行者',picturePath:null}}));
 const updateEvent=(event:IEvent)=>{const a=activities.find(x=>x.id===event.id);if(a)void command({type:'updateActivity',activityId:a.id,activity:{...activityInput(a),date:event.startDate.slice(0,10),startAt:event.startDate,endAt:event.endDate}});};
 const weekStart=parseDate(date);weekStart.setDate(weekStart.getDate()-((weekStart.getDay()+6)%7));
 const visibleUntimed=sorted.filter(a=>!a.startAt&&(view==='day'?a.date===date:parseDate(a.date)>=weekStart&&parseDate(a.date).getTime()<weekStart.getTime()+7*86400000));
 if(view==='board')return <div className="board-scroll" aria-busy={busy}><KanbanProvider columns={dates.map(d=>({id:d,name:d}))} data={draft} onDataChange={changeDraft} onDragStart={e=>{activeRef.current=String(e.active.id);}} onDragEnd={commitDrag} onDragCancel={()=>{activeRef.current=null;changeDraft(items());}} className="travel-board">
  {column=><KanbanBoard id={column.id} key={column.id} className="day-column"><KanbanHeader className="day-heading"><button onClick={()=>setDate(column.id)} className={date===column.id?'day-number selected':'day-number'}>{dates.indexOf(column.id)+1}</button><div><b>{parseDate(column.id).toLocaleDateString('zh-CN',{month:'long',day:'numeric'})}</b><small>{parseDate(column.id).toLocaleDateString('zh-CN',{weekday:'long'})} · {draft.filter(a=>a.column===column.id).length} 项安排</small></div><button className="icon-button" aria-label={`${column.id} 添加活动`} onClick={()=>edit({date:column.id})}><Plus size={16}/></button></KanbanHeader><KanbanCards<Item> id={column.id} className="day-cards">{item=><KanbanCard key={item.id} id={item.id} name={item.name} column={item.column} className="activity-card"><button data-testid={`activity-${item.id}`} className="activity-content" onClick={()=>edit(item.activity)}><span className={item.activity.startAt?'time-tag time-fixed':'time-tag'}><Clock size={12}/>{item.activity.startAt?`${item.activity.startAt.slice(11)} – ${item.activity.endAt?.slice(11)}`:'时间未定'}</span><strong>{item.name}</strong><span className="activity-meta"><MapPin size={12}/>{item.activity.place?.name||'自定义活动'}</span>{item.activity.notes&&<p>{item.activity.notes}</p>}<span className="card-bottom"><span>{String(draft.filter(a=>a.column===column.id).findIndex(a=>a.id===item.id)+1).padStart(2,'0')}</span><GripVertical size={14}/></span></button></KanbanCard>}</KanbanCards><button className="add-in-column" onClick={()=>edit({date:column.id})}><Plus size={15}/> 添加活动</button></KanbanBoard>}
 </KanbanProvider></div>;
 return <div className={`calendar-adapter ${view}`} aria-busy={busy}>
  <div className="untimed-strip"><div><Clock size={15}/><b>未定时间</b><span>保留弹性，不占用时间格</span></div><div className="untimed-items">{visibleUntimed.length?visibleUntimed.map(a=><button key={a.id} data-testid={`untimed-${a.id}`} onClick={()=>edit(a)}>{view==='week'&&<small>{a.date.slice(5)} · </small>}{a.title}</button>):<span className="muted">这段时间暂无未定安排</span>}</div></div>
  <CalendarProvider selectedDate={parseDate(date)} setSelectedDate={d=>setDate(localDate(d))} view={view} use24HourFormat badgeVariant="colored" updateEvent={updateEvent} editEvent={id=>{const a=activities.find(x=>x.id===id);if(a)edit(a);}} createEvent={(d,h,m)=>{const ds=localDate(d);edit({date:ds,startAt:`${ds}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`,endAt:`${ds}T${String(Math.min(h+1,23)).padStart(2,'0')}:${h===23?'59':String(m).padStart(2,'0')}`});}}><DndProvider>{view==='day'?<CalendarDayView singleDayEvents={events} multiDayEvents={[]}/>:<CalendarWeekView singleDayEvents={events} multiDayEvents={[]}/>}</DndProvider></CalendarProvider>
  <p className="calendar-help">拖动活动调整时间 · 拖动下边缘调整时长 · 双击空白时间格新增 · {snapshot.trip.timezone}</p>
 </div>;
}
