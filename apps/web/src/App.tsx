import {useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {ArrowLeft,ArrowRight,Check,ChevronLeft,ChevronRight,Compass,Globe2,Heart,LayoutGrid,MapPin,MessageSquare,Plus,Search,Settings2,Sparkles,Trash2,X,CalendarDays,Leaf,ArrowUpRight} from 'lucide-react';
import {demoSnapshot} from '../../../packages/contracts/demo';
import {request,ApiError,activityInput,addDate,parseDate,tripDates,type Activity,type Command,type Idea,type Place,type Schema,type Snapshot,type Trip} from './lib/api';
import {Itinerary,type EditDraft} from './Itinerary';
import {Chat} from './Chat';
import {TripForm} from './TripForm';
import {PortfolioTools,type PortfolioAction} from './PortfolioTools';
import {DayWorkspace} from './DayWorkspace';
import type {Proposal} from './ProposalDiffPanel';

type Health={status:string;capabilities:{agent:boolean;poi:boolean;tracing:boolean};model:string};
type Tab='itinerary'|'ideas'|'explore'|'preferences';
const errorText=(e:unknown)=>e instanceof Error?e.message:'操作未完成，请重试。';
const tripDateLabel=(trip:Trip)=>trip.startDate&&trip.endDate?`${trip.startDate} — ${trip.endDate}`:'日期待定';
function Brand(){return <span className="brand"><span className="brand-mark"><Compass size={23}/></span>brandon<span className="brand-dot">.</span></span>;}
function Modal({title,children,close}:{title:string;children:ReactNode;close:()=>void}){const root=useRef<HTMLDivElement>(null);useEffect(()=>{const prior=document.activeElement as HTMLElement|null;root.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus();const fn=(e:KeyboardEvent)=>{if(e.key==='Escape')close();if(e.key==='Tab'&&root.current){const all=[...root.current.querySelectorAll<HTMLElement>('input,textarea,select,button,a[href]')].filter(el=>!el.hasAttribute('disabled'));const first=all[0],last=all[all.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};document.addEventListener('keydown',fn);return()=>{document.removeEventListener('keydown',fn);prior?.focus();};},[]);return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={root}><header><h2>{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={close}><X size={20}/></button></header>{children}</div></div>;}

export default function App(){
 const preview=new URLSearchParams(location.search).get('demo')==='1';
 const [trips,setTrips]=useState<Trip[]>([]),[snapshot,setSnapshot]=useState<Snapshot|null>(preview?demoSnapshot:null),[health,setHealth]=useState<Health|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[creating,setCreating]=useState(false);
 const [tab,setTab]=useState<Tab>('itinerary'),[view,setView]=useState<'board'|'day'|'week'>('board'),[date,setDate]=useState(preview?demoSnapshot.trip.startDate||'':''),[showChat,setShowChat]=useState(true),[edit,setEdit]=useState<EditDraft|null>(null),[newIdea,setNewIdea]=useState(false),[adopt,setAdopt]=useState<Idea|null>(null);
 const [portfolioAction,setPortfolioAction]=useState<PortfolioAction|null>(null),[actionSequence,setActionSequence]=useState(0),[selectedActivityId,setSelectedActivityId]=useState<string|null>(null),[showMap,setShowMap]=useState(true);
 function openPortfolio(action:PortfolioAction){setPortfolioAction(action);setActionSequence(n=>n+1);}
 const [incomingProposal,setIncomingProposal]=useState<Proposal|null>(null),[suggestionPreviewBusy,setSuggestionPreviewBusy]=useState(false);
 const current=useRef<Snapshot|null>(snapshot);
 const navigation=useRef(0);
 const selectedTrip=useRef<string|null>(snapshot?.trip.id||null);
 const busyOperation=useRef<symbol|null>(null);
 const renderedNavigation=navigation.current;
 function activeNavigation(generation:number,tripId:string|null){return navigation.current===generation&&selectedTrip.current===tripId;}
 function acceptSnapshot(value:Snapshot,generation:number,tripId:string){
  if(!activeNavigation(generation,tripId)||value.trip.id!==tripId)return false;
  const existing=current.current;
  if(existing?.trip.id===tripId&&existing.version>value.version)return false;
  current.current=value;setSnapshot(value);return true;
 }
 function beginNavigation(tripId:string|null){
  const generation=++navigation.current;selectedTrip.current=tripId;current.current=null;
  busyOperation.current=null;setBusy(false);setSnapshot(null);setNotice('');
  setEdit(null);setNewIdea(false);setAdopt(null);setSelectedActivityId(null);setPortfolioAction(null);setIncomingProposal(null);setSuggestionPreviewBusy(false);return generation;
 }
 function finishOperation(token:symbol){if(busyOperation.current===token){busyOperation.current=null;setBusy(false);}}
 useEffect(()=>{void request<Health>('/health').then(setHealth).catch(()=>{});if(preview)return;const generation=navigation.current;void request<Trip[]>('/trips').then(value=>{if(navigation.current===generation)setTrips(value);}).catch(e=>{if(navigation.current===generation)setError(errorText(e));});const id=new URLSearchParams(location.search).get('trip');if(id)void openTrip(id);},[]);
 useEffect(()=>{if(notice){const timer=setTimeout(()=>setNotice(''),3500);return()=>clearTimeout(timer);}},[notice]);
 async function openTrip(id:string){
  const generation=beginNavigation(id);setLoading(true);setError('');
  try{const value=await request<Snapshot>(`/trips/${id}`);if(!acceptSnapshot(value,generation,id))return;
   setDate(value.trip.startDate||'');setTab('itinerary');history.replaceState(null,'',`?trip=${encodeURIComponent(id)}`);
  }catch(e){if(activeNavigation(generation,id))setError(errorText(e));}
  finally{if(activeNavigation(generation,id))setLoading(false);}
 }
 useEffect(()=>{if(!snapshot)return;const t=snapshot.trip;if(!t.startDate||!t.endDate)setDate('');else setDate(d=>!d||d<t.startDate!||d>t.endDate!?t.startDate!:d);},[snapshot?.trip.startDate,snapshot?.trip.endDate]);
 async function refresh(){
  const tripId=snapshot?.trip.id;
  if(preview||!tripId||!activeNavigation(renderedNavigation,tripId))return;
  try{const value=await request<Snapshot>(`/trips/${tripId}`);acceptSnapshot(value,renderedNavigation,tripId);}
  catch(e){if(activeNavigation(renderedNavigation,tripId))throw e;}
 }
 async function previewSuggestion(suggestionId:string,target:'idea'|'activity',targetDate:string|null){
  const tripId=snapshot?.trip.id,generation=navigation.current;if(!tripId||suggestionPreviewBusy||preview)return;setSuggestionPreviewBusy(true);
  try{const proposal=await request<Proposal>(`/trips/${tripId}/suggestions/${encodeURIComponent(suggestionId)}/proposal`,{target,date:target==='activity'?targetDate:null});if(activeNavigation(generation,tripId))setIncomingProposal(proposal);}
  catch(e){if(activeNavigation(generation,tripId))setError(errorText(e));}
  finally{if(activeNavigation(generation,tripId))setSuggestionPreviewBusy(false);}
 }
 async function command(value:Command){
  if(preview){setError('当前为只读骨架预览。请返回首页创建可编辑的演示旅行。');return false;}
  const prior=current.current;
  if(!prior||busyOperation.current||!activeNavigation(renderedNavigation,prior.trip.id))return false;
  const generation=navigation.current,tripId=prior.trip.id,token=Symbol('command');
  busyOperation.current=token;setBusy(true);setError('');
  try{const next=await request<Snapshot>(`/trips/${tripId}/commands`,{expectedVersion:prior.version,command:value});
   if(!activeNavigation(generation,tripId))return false;
   acceptSnapshot(next,generation,tripId);setNotice('已保存到旅行');return true;
  }catch(e){
   if(!activeNavigation(generation,tripId))return false;
   if(e instanceof ApiError&&e.status===409){
    try{const latest=await request<Snapshot>(`/trips/${tripId}`);acceptSnapshot(latest,generation,tripId);}
    catch(readError){if(activeNavigation(generation,tripId))setError(errorText(readError));return false;}
    if(activeNavigation(generation,tripId))setError('旅行有更新，已载入最新状态。请检查后重新操作。');
   }else setError(errorText(e));
   // Domain edits are pessimistic; never roll a newer snapshot back to prior.
   return false;
  }finally{finishOperation(token);}
 }
 async function createTrip(body:Schema['TripCreate']){
  if(busyOperation.current)return;const generation=navigation.current,token=Symbol('create'),destinationTab=tab;
  busyOperation.current=token;setBusy(true);setError('');
  try{const value=await request<Snapshot>('/trips',body);if(!activeNavigation(generation,null))return;
   setTrips(x=>[...x,value.trip]);setCreating(false);await openTrip(value.trip.id);
   if(navigation.current===generation+1&&selectedTrip.current===value.trip.id&&current.current?.trip.id===value.trip.id&&destinationTab==='explore')setTab('explore');
  }catch(e){if(navigation.current===generation)setError(errorText(e));}finally{finishOperation(token);}
 }
 async function seedDemo(){
  if(busyOperation.current)return;const generation=navigation.current,token=Symbol('seed');busyOperation.current=token;setBusy(true);setError('');
  try{let value=await request<Snapshot>('/trips',{title:demoSnapshot.trip.title,destination:demoSnapshot.trip.destination,startDate:demoSnapshot.trip.startDate,endDate:demoSnapshot.trip.endDate,timezone:demoSnapshot.trip.timezone,preferences:demoSnapshot.trip.preferences});
   for(const idea of demoSnapshot.ideas||[])value=await request<Snapshot>(`/trips/${value.trip.id}/commands`,{expectedVersion:value.version,command:{type:'addIdea',idea:{title:idea.title,description:idea.description,sourceKind:'manual',evidence:[]}}});
   for(const activity of demoSnapshot.activities||[])value=await request<Snapshot>(`/trips/${value.trip.id}/commands`,{expectedVersion:value.version,command:{type:'addActivity',activity:activityInput(activity)}});
   if(!activeNavigation(generation,null))return;setTrips(x=>[...x,value.trip]);await openTrip(value.trip.id);
   if(navigation.current===generation+1&&selectedTrip.current===value.trip.id&&current.current?.trip.id===value.trip.id)setNotice('演示旅行已创建，所有安排均可编辑');
  }catch(e){if(navigation.current===generation)setError(errorText(e));}finally{finishOperation(token);}
 }
 function home(){
  if(preview){location.href='/';return;}const generation=beginNavigation(null);setLoading(false);setError('');history.replaceState(null,'','/');
  void request<Trip[]>('/trips').then(value=>{if(activeNavigation(generation,null))setTrips(value);}).catch(e=>{if(activeNavigation(generation,null))setError(errorText(e));});
 }
 const alert=error&&<div role="alert" className="error-banner"><span>{error}</span><button aria-label="关闭错误" onClick={()=>setError('')}><X size={16}/></button></div>;
 if(!snapshot)return <div className="home"><nav><Brand/><span className="home-note">为期待已久的出发，留一个地方。</span><span className="profile">Y</span></nav>{alert}<main className="home-main"><div className="hero"><div><span className="eyebrow">LESS RUSH. MORE JOURNEY.</span><h1>下一站，<br/>按你的节奏。</h1><p>收集想去的地方，安排每一天。<br/>让 Brandon 帮你研究，把决定留给自己。</p><button className="primary" onClick={()=>{setTab('itinerary');setCreating(true);}}><Plus size={18}/> 创建旅行</button><button className="secondary" onClick={()=>{setCreating(true);setTab('explore');}}><Search size={16}/> 探索地点</button></div><div className="hero-art" aria-hidden="true"><div className="sun"/><div className="hill hill-back"/><div className="hill hill-front"/><div className="lake"/><span className="art-line one"/><span className="art-line two"/><span className="art-label"><Compass size={18}/> Somewhere, at your pace.</span></div></div><section className="home-trips"><div className="section-title"><div><span className="eyebrow">YOUR JOURNEYS</span><h2>我的旅行</h2></div><button className="text-button" disabled={busy} onClick={()=>void seedDemo()}>打开演示旅行 <ArrowUpRight size={15}/></button></div>{loading?<div className="empty-state">正在载入旅行…</div>:trips.length?<div className="trip-grid">{trips.map((trip,i)=><button className="trip-card" data-testid={`trip-${trip.id}`} key={trip.id} onClick={()=>void openTrip(trip.id)}><div className={`trip-art art-${i%3}`}><span>{trip.destination.slice(0,2)||'待定'}</span><Compass/></div><div><h3>{trip.title}</h3><p><MapPin size={14}/>{trip.destination||'目的地待定'} <span>{tripDateLabel(trip)}</span></p></div><ArrowRight className="trip-arrow" size={19}/></button>)}</div>:<div className="empty-state"><Compass size={32}/><h3>一段旅行，从一个想法开始</h3><p>创建自己的旅行，或打开五天杭州演示，体验三种日程视图。</p><button className="secondary" disabled={busy} onClick={()=>void seedDemo()}>{busy?'正在创建…':'打开演示旅行'}</button></div>}</section><div className="home-footer"><Leaf size={15}/> 计划有据，旅行有余地。<span>Brandon Travel Workspace · V2</span></div></main>{creating&&<CreateTrip close={()=>setCreating(false)} submit={createTrip} busy={busy}/>}</div>;
 const trip=snapshot.trip,dates=tripDates(trip);const planningDate=dates.includes(date)?date:dates[0]||'';const timed=(snapshot.activities||[]).filter(a=>a.startAt).length;
 return <div className="app"><nav className="topbar"><button className="brand-button" onClick={home}><Brand/></button><span className="top-divider"/><button className="breadcrumb" onClick={home}>我的旅行</button><ChevronRight size={13}/><span className="breadcrumb-current">{trip.destination}</span><div className="top-actions"><span className="saved"><span/>{busy?'保存中…':'更改已保存'}</span><button className="icon-button" aria-label={showChat?'收起聊天':'展开聊天'} title={showChat?'收起聊天':'展开聊天'} onClick={()=>setShowChat(x=>!x)}><MessageSquare size={18}/></button><span className="profile">Y</span></div></nav>{alert}{notice&&<div role="status" className="toast"><Check size={16}/>{notice}</div>}{preview&&<div className="preview-banner">UI 骨架预览 · 演示数据 · 返回首页可创建可编辑的演示旅行</div>}
 <div className="workspace-layout"><Chat key={trip.id} snapshot={snapshot} refresh={refresh} command={command} error={setError} preview={preview} hidden={!showChat} selectedDate={date} onPortfolioAction={openPortfolio} onSuggestionPreview={previewSuggestion} suggestionPreviewBusy={suggestionPreviewBusy}/>
 <main className="workspace"><header className="trip-header"><div><span className="eyebrow">YOUR NEXT CHAPTER</span><h1>{trip.title}</h1><div className="trip-info"><span><MapPin size={14}/>{trip.destination||'目的地待定'}</span><span><CalendarDays size={14}/>{tripDateLabel(trip)}</span><span>{dates.length?`${dates.length} 天`:'天数待定'}</span><span>{trip.companions||'同行人待定'}</span><span>{trip.timezone}</span></div></div><button className="settings-button" aria-label="旅行偏好" onClick={()=>setTab('preferences')}><Settings2 size={17}/><span>旅行设置</span></button></header>
 <div className="workspace-tabs">{([{id:'itinerary',label:'Itinerary',sub:'日程',icon:CalendarDays},{id:'ideas',label:'Ideas',sub:'候选',icon:Heart},{id:'explore',label:'Explore',sub:'探索',icon:Compass}] as const).map(t=><button key={t.id} data-testid={`tab-${t.id}`} className={tab===t.id?'active':''} onClick={()=>setTab(t.id)}><t.icon size={16}/>{t.label}<span>{t.sub}</span>{t.id==='ideas'&&<small>{snapshot.ideas?.length||0}</small>}</button>)}<div className="workspace-summary">{snapshot.activities?.length||0} 项安排 <span>·</span> {timed} 项已定时间</div></div>
 <PortfolioTools key={trip.id} snapshot={snapshot} date={date} preview={preview} busy={busy} command={command} error={setError} action={portfolioAction} actionSequence={actionSequence} incomingProposal={incomingProposal} onAction={openPortfolio} onSettings={()=>setTab('preferences')}/>
 {tab==='itinerary'&&(!dates.length?<section className="empty-state undated-trip"><CalendarDays size={34}/><h2>旅行还不必有日期。</h2><p>先把想法放进 Ideas，确定出发时间后，再安排每一天。</p><div><button className="primary" onClick={()=>setTab('preferences')}>补充出行日期</button><button className="secondary" onClick={()=>setTab('ideas')}>先收集 Ideas</button></div></section>:<><div className="itinerary-toolbar"><div className="view-switch">{(['board','day','week'] as const).map(v=><button data-testid={`view-${v}`} key={v} className={view===v?'active':''} onClick={()=>{setView(v);if(v==='week')setShowChat(false);}}>{v==='board'&&<LayoutGrid size={14}/>}{{board:'Board',day:'Day',week:'Week'}[v]}</button>)}</div>{view==='day'&&<button className="secondary small map-toggle" onClick={()=>setShowMap(x=>!x)}><MapPin size={14}/>{showMap?'收起地图':'展开地图'}</button>}<div className="date-navigation"><button aria-label="上一段日期" className="icon-button" onClick={()=>setDate(addDate(date,view==='day'?-1:-7))}><ChevronLeft size={17}/></button><input aria-label="选中日期" type="date" value={date} onChange={e=>e.target.value&&setDate(e.target.value)}/><button aria-label="下一段日期" className="icon-button" onClick={()=>setDate(addDate(date,view==='day'?1:7))}><ChevronRight size={17}/></button></div><button className="primary small" disabled={busy} onClick={()=>setEdit({date:planningDate})}><Plus size={15}/> 添加活动</button></div><div className="itinerary-caption"><span>{view==='board'?'每天一点期待，留一点自由。':view==='day'?'今天的节奏，一眼看清。':'把一周展开，找到舒服的节奏。'}</span><small>{view==='board'?'拖动卡片调整日期与顺序':'时间按旅行当地时间显示'}</small></div><div className={view==='day'&&showMap?'daily-workspace':'itinerary-only'}><div className="timeline-pane"><Itinerary snapshot={snapshot} date={date} view={view} setDate={setDate} edit={draft=>{setSelectedActivityId(draft.id||null);setEdit(draft);}} command={command} busy={busy}/></div>{view==='day'&&showMap&&<DayWorkspace snapshot={snapshot} date={date} selectedActivityId={selectedActivityId} onSelectActivity={id=>{setSelectedActivityId(id);const activity=snapshot.activities?.find(a=>a.id===id);if(activity)setEdit(activity);}} preview={preview}/>}</div><div className="ideas-shelf"><div><Heart size={15}/><b>还没安排的灵感</b><span>候选保存后仍然保留</span></div><div>{snapshot.ideas?.slice(0,4).map(idea=><button key={idea.id} onClick={()=>dates.length?setAdopt(idea):(setTab('preferences'),setNotice('先补充日期，Idea 会继续保留。'))}>{idea.title}<Plus size={13}/></button>)}<button className="text-button" onClick={()=>setNewIdea(true)}><Plus size={13}/> 新建 Idea</button></div></div></>)}
 {tab==='ideas'&&<section className="tab-content"><div className="section-title"><div><h2>先收藏，再决定什么时候出发。</h2><p>想去的地方、想做的小事，都可以成为一个 Idea。</p></div><button className="primary small" onClick={()=>setNewIdea(true)}><Plus size={15}/> 添加 Idea</button></div><div className="idea-grid">{snapshot.ideas?.map((idea,i)=><article className="idea-card" data-testid={`idea-${idea.id}`} key={idea.id}><div className={`idea-art art-${i%3}`}><span>{idea.place?<MapPin size={36}/>:<Leaf size={36}/>}</span><small>{idea.sourceKind==='poi'?'高德地点':idea.sourceKind==='agent'?'Brandon 建议':'我的灵感'}</small></div><div className="idea-body"><h3>{idea.title}</h3><p>{idea.description||'给这趟旅行保留一个可能。'}</p>{idea.place&&<small><MapPin size={12}/>{idea.place.address||idea.place.name}</small>}<footer><button data-testid={`adopt-idea-${idea.id}`} className="secondary small" onClick={()=>dates.length?setAdopt(idea):(setTab('preferences'),setNotice('先补充日期，Idea 会继续保留。'))}><Plus size={14}/> 加入日程</button><button className="icon-button" title="删除候选" aria-label={`删除候选 ${idea.title}`} onClick={()=>void command({type:'deleteIdea',ideaId:idea.id})}><Trash2 size={15}/></button></footer></div></article>)}</div>{!snapshot.ideas?.length&&<div className="empty-state"><Heart size={30}/><h3>把想去的地方先放在这里</h3><button className="secondary" onClick={()=>setNewIdea(true)}>添加 Idea</button></div>}</section>}
 {tab==='explore'&&<Explore trip={trip} command={command} error={setError} poiReady={health?.capabilities.poi??null}/>}
 {tab==='preferences'&&<section className="tab-content preferences"><span className="eyebrow">MAKE IT YOURS</span><h2>这趟旅行，慢慢想清楚。</h2><p>目的地、日期、同行人与偏好随时可改。已有活动不会因修改日期被悄悄删除。</p><TripForm key={`${trip.id}-${snapshot.version}`} trip={trip} busy={busy} submit={async body=>{await command({type:'updateTrip',trip:body});}}/></section>}
 </main></div>
 {edit&&<ActivityEditor draft={edit} snapshot={snapshot} busy={busy} close={()=>setEdit(null)} command={command}/>}
 {newIdea&&<Modal title="记下一个 Idea" close={()=>setNewIdea(false)}><form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(await command({type:'addIdea',idea:{title:String(f.get('title')).trim(),description:String(f.get('description')||''),sourceKind:'manual',evidence:[]}}))setNewIdea(false);}}><label>想做什么？<input name="title" aria-label="Idea 标题" required maxLength={200} placeholder="例如：留半天逛小店"/></label><label>补充一点想法<textarea name="description" rows={3} maxLength={4000}/></label><div className="modal-footer"><button type="button" className="secondary" onClick={()=>setNewIdea(false)}>取消</button><button className="primary" disabled={busy}>保存 Idea</button></div></form></Modal>}
 {adopt&&<Modal title={`安排「${adopt.title}」`} close={()=>setAdopt(null)}><form onSubmit={async e=>{e.preventDefault();if(await command({type:'adoptIdea',ideaId:adopt.id,date:String(new FormData(e.currentTarget).get('date'))}))setAdopt(null);}}><p className="modal-note">加入日程后，原 Idea 会保留。时间可以稍后决定。</p><label>安排在哪天？<select name="date" aria-label="采纳日期" defaultValue={planningDate}>{dates.map((d,i)=><option key={d} value={d}>第 {i+1} 天 · {d}</option>)}</select></label><div className="modal-footer"><button type="button" className="secondary" onClick={()=>setAdopt(null)}>取消</button><button className="primary" disabled={busy}>确认加入日程</button></div></form></Modal>}
 </div>;
}

function CreateTrip({close,submit,busy}:{close:()=>void;submit:(body:Schema['TripCreate'])=>Promise<void>;busy:boolean}){return <Modal title="开启一段新的旅行" close={close}><TripForm busy={busy} submit={submit} cancel={close}/></Modal>;}

function ActivityEditor({draft,snapshot,busy,close,command}:{draft:EditDraft;snapshot:Snapshot;busy:boolean;close:()=>void;command:(c:Command)=>Promise<boolean>}){
 const [timed,setTimed]=useState(!!draft.startAt),[date,setDate]=useState(draft.date);const dates=tripDates(snapshot.trip),a=draft as Activity;
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);const name=String(f.get('placeName')||'').trim();const place=name?{...(draft.place||{provider:'manual'}),name}:null;const activity:Schema['ActivityInput']={title:String(f.get('title')).trim(),date,startAt:timed?`${date}T${f.get('start')}`:null,endAt:timed?`${date}T${f.get('end')}`:null,notes:String(f.get('notes')||''),ideaId:draft.ideaId||null,place};if(await command(draft.id?{type:'updateActivity',activityId:draft.id,activity}:{type:'addActivity',activity}))close();}
 return <Modal title={draft.id?'活动详情':'添加活动'} close={close}><form onSubmit={submit}><label>活动名称<input name="title" aria-label="活动名称" defaultValue={draft.title||''} required maxLength={200} placeholder="也可以只是吃饭、散步、自由活动"/></label><label>日期<select aria-label="活动日期" value={date} onChange={e=>setDate(e.target.value)}>{dates.map((d,i)=><option key={d} value={d}>第 {i+1} 天 · {d}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" checked={timed} onChange={e=>setTimed(e.target.checked)}/> 设定具体时间</label>{timed?<div className="form-row"><label>开始时间<input type="time" name="start" aria-label="开始时间" defaultValue={draft.startAt?.slice(11)||'09:00'} required/></label><label>结束时间<input type="time" name="end" aria-label="结束时间" defaultValue={draft.endAt?.slice(11)||'10:00'} required/></label></div>:<p className="modal-note">时间未定 · 会显示在当天的未定安排区。</p>}<label>地点（可选）<input name="placeName" aria-label="活动地点" defaultValue={draft.place?.name||''} placeholder="不填也可以创建活动"/></label><label>备注<textarea name="notes" aria-label="活动备注" defaultValue={draft.notes||''} rows={3} maxLength={4000}/></label>{draft.ideaId&&<small className="muted">来自已保存的 Idea</small>}{draft.id&&<div className="order-controls"><span>当天顺序</span><button type="button" disabled={busy||a.sortKey===0} onClick={async()=>{if(await command({type:'moveActivity',activityId:a.id,date:a.date,index:Math.max(0,a.sortKey-1)}))close();}}>向前移</button><button type="button" disabled={busy} onClick={async()=>{if(await command({type:'moveActivity',activityId:a.id,date:a.date,index:a.sortKey+1}))close();}}>向后移</button></div>}<div className="modal-footer">{draft.id&&<button type="button" className="danger-button" disabled={busy} onClick={async()=>{if(await command({type:'removeActivity',activityId:draft.id!}))close();}}><Trash2 size={15}/> 删除活动</button>}<button className="secondary" type="button" onClick={close}>取消</button><button className="primary" disabled={busy}>保存</button></div></form></Modal>;
}

function Explore({trip,command,error,poiReady}:{trip:Trip;command:(c:Command)=>Promise<boolean>;error:(s:string)=>void;poiReady:boolean|null}){
 const [query,setQuery]=useState(''),[places,setPlaces]=useState<Place[]>([]),[searching,setSearching]=useState(false),[searched,setSearched]=useState(false),[selected,setSelected]=useState<Place|null>(null);
 async function search(e:FormEvent){e.preventDefault();setSearching(true);setSearched(true);try{const result=await request<{places:Place[]}>(`/places?query=${encodeURIComponent(query)}&city=${encodeURIComponent(trip.destination)}`);setPlaces(result.places);setSelected(result.places[0]||null);}catch(e){setPlaces([]);error(errorText(e));}finally{setSearching(false);}}
 return <section className="tab-content explore"><div className="section-title"><div><span className="eyebrow">A LITTLE DISCOVERY</span><h2>发现{trip.destination}，从一个好奇开始。</h2><p>真实地点来自高德。先收进 Ideas，再慢慢安排。</p></div><span className="provider-badge"><MapPin size={13}/> 高德 POI</span></div><form className="search-bar" onSubmit={search}><Search size={20}/><input aria-label="搜索地点" placeholder={`搜索${trip.destination}的景点、茶馆、餐厅…`} value={query} onChange={e=>setQuery(e.target.value)} required/><button className="primary small" disabled={searching}>{searching?'搜索中…':'搜索'}</button></form>{poiReady===false&&<div className="configuration-note">地点服务尚未配置：请在本地 .env 填写高德 Web 服务 Key 并重启 API。这里不会展示模拟搜索结果。</div>}<div className="explore-layout"><div>{places.map((p,i)=><button className={`place-result ${selected===p?'selected':''}`} key={p.providerId||i} onClick={()=>setSelected(p)}><span className="place-number">{String(i+1).padStart(2,'0')}</span><div><strong>{p.name}</strong><p>{p.address||'暂无详细地址'}</p><small>高德地图 · {p.providerId}</small></div><ChevronRight size={17}/></button>)}{!places.length&&<div className="empty-state"><Globe2 size={40}/><h3>{searched&&!searching?'还没有找到匹配的地点':'让好奇心带路'}</h3><p>{searched?'试着换一个关键词。':'输入关键词，查看真实地点与地址。'}</p></div>}</div><div className="place-detail">{selected?<><div className="place-detail-art"><MapPin size={48}/><span>{selected.name}</span></div><span className="eyebrow">PLACE DETAILS</span><h2>{selected.name}</h2><p>{selected.address||'高德未提供详细地址'}</p><dl><dt>数据来源</dt><dd>高德地图</dd><dt>经纬度</dt><dd>{selected.longitude??'—'}, {selected.latitude??'—'}</dd></dl><button className="primary" onClick={()=>void command({type:'addIdea',idea:{title:selected.name,description:selected.address||'',place:selected,sourceKind:'poi',evidence:[`amap:${selected.providerId}`]}})}><Heart size={16}/> 保存到 Ideas</button>{selected.latitude!=null&&selected.longitude!=null&&<a className="secondary" href={`https://uri.amap.com/marker?position=${selected.longitude},${selected.latitude}&name=${encodeURIComponent(selected.name)}&coordinate=gaode&callnative=0`} target="_blank" rel="noreferrer"><MapPin size={16}/> 在高德地图查看</a>}<small className="place-disclaimer">地点信息来自实时搜索；营业时间、预约和路况尚未核实。</small></>:<div className="map-empty"><Compass size={58}/><h3>给每个灵感一个位置</h3><p>选择搜索结果，查看地点详情，<br/>或在高德地图中定位。</p></div>}</div></div></section>;
}
