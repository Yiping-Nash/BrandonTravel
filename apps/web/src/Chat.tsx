import {useEffect,useRef,useState} from 'react';
import {ArrowUp,ChevronDown,Plus,Sparkles,Check,ExternalLink} from 'lucide-react';
import {request,type Snapshot,type Session,type ChatResponse,type Command} from './lib/api';
type Props={snapshot:Snapshot;refresh:()=>Promise<void>;command:(c:Command)=>Promise<boolean>;error:(s:string)=>void;preview:boolean;hidden?:boolean};
export function Chat({snapshot,refresh,command,error,preview,hidden=false}:Props){
 const [sessions,setSessions]=useState<Session[]>([]),[sessionId,setSessionId]=useState<string|null>(null),[message,setMessage]=useState(''),[mode,setMode]=useState<'real'|'demo'>('real'),[loading,setLoading]=useState(false);
 const [pendingMessage,setPendingMessage]=useState<string|null>(null);
 const bottom=useRef<HTMLDivElement>(null),lifecycle=useRef(0),selection=useRef(0),loads=useRef(0),activeSend=useRef<symbol|null>(null);
 const session=sessions.find(x=>x.id===sessionId);
 const storageKey=`brandon.chat.session.${snapshot.trip.id}`;
 function rememberSession(id:string|null){try{sessionStorage.setItem(storageKey,id||'__new__');}catch{/* Storage may be disabled; in-memory selection remains usable. */}}
 async function load(epoch=lifecycle.current,restore=false){
  if(preview)return;const sequence=++loads.current;
  const initialSelection=selection.current;
  const value=await request<Session[]>(`/trips/${snapshot.trip.id}/sessions`);
  if(lifecycle.current!==epoch||loads.current!==sequence)return;
  setSessions(value);
  if(restore&&selection.current===initialSelection){
   let saved:string|null=null;try{saved=sessionStorage.getItem(storageKey);}catch{}
   const recent=[...value].sort((a,b)=>(b.messages?.at(-1)?.createdAt||'').localeCompare(a.messages?.at(-1)?.createdAt||''))[0];
   const id=saved==='__new__'?null:value.some(item=>item.id===saved)?saved:recent?.id||null;
   setSessionId(id);rememberSession(id);
  }
 }
 function selectSession(id:string|null){selection.current++;activeSend.current=null;rememberSession(id);setSessionId(id);setMessage('');setPendingMessage(null);setLoading(false);}
 useEffect(()=>{
  const epoch=++lifecycle.current;selection.current++;activeSend.current=null;setSessionId(null);setMessage('');setPendingMessage(null);setLoading(false);setSessions([]);
  void load(epoch,true).catch(e=>{if(lifecycle.current===epoch)error(e.message);});
  return()=>{lifecycle.current++;selection.current++;activeSend.current=null;};
 },[snapshot.trip.id]);
 useEffect(()=>{if(!hidden)bottom.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[sessions,loading,hidden]);
 async function send(value:string){
  if(!value.trim()||activeSend.current)return;
  if(preview){error('当前为只读骨架预览。请返回首页创建演示旅行。');return;}
  const epoch=lifecycle.current,selected=selection.current,token=Symbol('chat'),requestedSession=sessionId;
  const stillSelected=()=>lifecycle.current===epoch&&selection.current===selected&&activeSend.current===token;
  activeSend.current=token;setLoading(true);setPendingMessage(value);setMessage('');
  try{
   const response=await request<ChatResponse>(`/trips/${snapshot.trip.id}/chat`,{message:value,sessionId:requestedSession,mode});
   if(lifecycle.current!==epoch)return;
   // Show the acknowledged reply immediately; a slow history read cannot hide it.
   const stamp=new Date().toISOString();
   setSessions(previous=>{
    const existing=previous.find(item=>item.id===response.sessionId);
    const updated:Session={id:response.sessionId,tripId:snapshot.trip.id,title:existing?.title||value.slice(0,40),messages:[...(existing?.messages||[]),{role:'user',content:value,createdAt:stamp},{role:'assistant',content:response.reply,createdAt:stamp,response}]};
    return [...previous.filter(item=>item.id!==response.sessionId),updated];
   });
   if(stillSelected()){setSessionId(response.sessionId);rememberSession(response.sessionId);setPendingMessage(null);}
   await Promise.all([load(epoch),refresh()]).catch(e=>{if(stillSelected())error(`回答已完成，但状态刷新失败：${(e as Error).message}`);});
  }catch(e){if(stillSelected()){error((e as Error).message);setMessage(value);setPendingMessage(null);}}
  finally{if(stillSelected()){activeSend.current=null;setLoading(false);}}
 }
 const suggestionStatus=(id:string)=>snapshot.suggestions?.find(s=>s.id===id)?.status||'proposed';
 return <aside className="chat-panel" hidden={hidden}><header><div className="brandon-avatar"><Sparkles size={19}/></div><div><b>Brandon</b><small>和你一起，把旅行想清楚</small></div><button className="icon-button" title="新建对话" aria-label="新建对话" onClick={()=>selectSession(null)}><Plus size={18}/></button></header>
 <div className="chat-controls"><select aria-label="对话模式" value={mode} onChange={e=>setMode(e.target.value as 'real'|'demo')}><option value="real">真实 Agent · Qwen</option><option value="demo">演示模式 · 模拟回复</option></select><select aria-label="聊天会话" value={sessionId||''} onChange={e=>selectSession(e.target.value||null)}><option value="">新对话</option>{sessions.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></div>
 <div className="chat-messages">{!session?.messages?.length&&<div className="chat-welcome"><span className="eyebrow">YOUR TRAVEL COMPANION</span><h2>好旅行，<br/>也需要一点留白。</h2><p>我可以帮你读懂当前安排、查找地点，再把值得去的地方变成候选。</p><div className="context-card"><span className="context-dot"/><div><strong>已连接这趟旅行</strong><small>{snapshot.trip.destination} · {snapshot.activities?.length||0} 项安排 · 最新版本 {snapshot.version}</small></div></div><p className="chat-hint">试着问我</p>{['第一天是不是太满？','帮我找杭州的茶馆，给出建议'].map(q=><button className="prompt-chip" key={q} onClick={()=>void send(q)}>{q}<ArrowUp size={13}/></button>)}<div className="human-note"><Check size={15}/><span>你决定安排。建议只有在你确认后才会保存。</span></div></div>}
 {session?.messages?.map((m,i)=><div className={`message ${m.role}`} key={i}><small>{m.role==='user'?'你':'Brandon'}{m.response?.mode==='demo'?' · 模拟演示':''}</small><p>{m.content}</p>{m.response?.uncertainty?.map((u,j)=><p className="uncertainty" key={j}>{u}</p>)}{m.response?.suggestions?.map(s=><div key={s.id} className="suggestion-card"><span className="eyebrow">待你确认的建议</span><strong>{s.title}</strong><p>{s.rationale}</p>{s.evidenceRefs?.length?<small>依据：{s.evidenceRefs.join(' · ')}</small>:null}{suggestionStatus(s.id)==='proposed'?<div className="suggestion-actions"><button onClick={()=>void command({type:'adoptSuggestion',suggestionId:s.id,target:'idea'})}>保存到 Ideas</button><button onClick={()=>void command({type:'adoptSuggestion',suggestionId:s.id,target:'activity',date:s.proposedDate||snapshot.trip.startDate})}>加入 {s.proposedDate?.slice(5)||'第一天'}</button><button className="text-button" onClick={()=>void command({type:'dismissSuggestion',suggestionId:s.id})}>忽略</button></div>:<span className="status-chip"><Check size={12}/>{suggestionStatus(s.id)==='accepted'?'已采纳':'已忽略'}</span>}</div>)}{m.response&&<small className="trace-meta">读取版本 {m.response.snapshotVersion} · {m.response.toolCalls?.join(' → ')}</small>}{m.response?.traceUrl&&<a href={m.response.traceUrl} target="_blank" rel="noreferrer">查看 LangSmith Trace <ExternalLink size={12}/></a>}</div>)}{pendingMessage&&<div className="message user"><small>你 · 发送中</small><p>{pendingMessage}</p></div>}{loading&&<div className="thinking"><span/>正在读取旅行、研究与整理建议…</div>}<div ref={bottom}/></div>
 <form className="chat-composer" onSubmit={e=>{e.preventDefault();void send(message);}}><textarea aria-label="给 Brandon 的消息" placeholder="聊聊这趟旅行…" value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send(message);}}}/><div><small>{mode==='demo'?'演示回复，不调用真实模型':'Qwen3.8-Flash · Deep Agents'}</small><button aria-label="发送消息" className="send-button" disabled={loading||!message.trim()}><ArrowUp size={18}/></button></div></form><footer>建议仅供规划，营业与预约信息请另行核实。</footer>
 </aside>;
}
