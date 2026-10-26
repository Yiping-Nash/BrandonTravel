import {useEffect,useState} from 'react';
import {Check,X,ArrowRight,FileDiff} from 'lucide-react';
import type {Schema,Snapshot,Activity,Command} from './lib/api';

export type Proposal=Schema['Proposal'];
const activityDescription=(a:Partial<Activity>)=>`${a.date||'日期未定'} · ${a.startAt?`${a.startAt.slice(11)}—${a.endAt?.slice(11)}`:'时间未定'}${a.place?` · ${a.place.name}`:''}`;

export function ProposalDiffPanel({proposal,snapshot,busy,command,onChanged,onResolved,close}:{proposal:Proposal;snapshot:Snapshot;busy:boolean;command:(c:Command)=>Promise<boolean>;onChanged:()=>Promise<void>;onResolved:(status:Proposal['status'])=>void;close:()=>void}){
 const [refreshNotice,setRefreshNotice]=useState('');
 useEffect(()=>setRefreshNotice(''),[proposal.id]);
 async function decide(type:'confirmProposal'|'dismissProposal'){if(!await command({type,proposalId:proposal.id}))return;onResolved(type==='confirmProposal'?'accepted':'dismissed');try{await onChanged();}catch{setRefreshNotice(type==='confirmProposal'?'已保存，记录刷新失败。正式行程已更新，可稍后刷新查看。':'已忽略，记录刷新失败。可稍后刷新查看。');}}
 return <section className="proposal-diff" aria-label="方案变更预览" data-testid="proposal-diff">
  <header><div><span className="eyebrow"><FileDiff size={13}/> 变更预览 · {proposal.status==='accepted'?'已确认并保存':proposal.status==='dismissed'?'已忽略，日程未变':'尚未改写日程'}</span><h3>{proposal.title}</h3></div><button className="icon-button" aria-label="关闭方案预览" onClick={close}><X size={18}/></button></header>
  <p>{proposal.summary}</p>
  <div className="proposal-actions-list">{proposal.actions.map((action,index)=>{
   const before=('activityId' in action)?snapshot.activities?.find(a=>a.id===action.activityId):undefined;
   return <article className={`proposal-change ${action.type}`} key={index}>
    <span className="change-kind">{{addIdea:'保存候选',addActivity:'新增安排',updateActivity:'调整安排',removeActivity:'删除安排'}[action.type]}</span>
    {action.type==='addIdea'?<div><strong>{action.idea.title}</strong><p>{action.idea.description||'保存到 Ideas，不占用日程时间'}</p></div>:
     action.type==='removeActivity'?<div><strong>{before?.title||'原活动已变更'}</strong><p>{before?activityDescription(before):'确认时将重新检查最新状态'}</p></div>:
     <div className="activity-diff">{action.type==='updateActivity'&&<div className="before"><small>当前</small><strong>{before?.title||'原活动已变更'}</strong><p>{before?activityDescription(before):'需要重新核对'}</p></div>}{action.type==='updateActivity'&&<ArrowRight size={16}/>}<div className="after"><small>{action.type==='updateActivity'?'建议改为':'待加入'}</small><strong>{action.activity.title}</strong><p>{activityDescription(action.activity)}</p>{action.activity.notes&&<p>{action.activity.notes}</p>}</div></div>}
   </article>;
  })}</div>
  {(proposal.assumptions||[]).length>0&&<div className="proposal-assumptions"><b>需要你确认的假设</b><ul>{proposal.assumptions?.map((s,i)=><li key={i}>{s}</li>)}</ul></div>}
  {(proposal.evidenceRefs||[]).length>0&&<details><summary>方案引用 · {(proposal.evidenceRefs||[]).length} 条</summary><p className="evidence-ids">{proposal.evidenceRefs?.join(' · ')}</p></details>}
  {proposal.traceUrl&&<a href={proposal.traceUrl} target="_blank" rel="noreferrer">查看执行 Trace</a>}
  {refreshNotice&&<p className="configuration-note" role="status">{refreshNotice}</p>}
  {proposal.status==='proposed'?<footer><p>只有点击确认才会应用以上 {proposal.actions.length} 项变更。若旅行已被编辑，服务器会拒绝过期方案，请重新生成。</p><div><button className="secondary" disabled={busy} onClick={()=>void decide('dismissProposal')}>不采纳</button><button className="primary" data-testid="confirm-proposal" disabled={busy} onClick={()=>void decide('confirmProposal')}><Check size={15}/> 确认应用变更</button></div></footer>:<p className="status-chip"><Check size={14}/>{proposal.status==='accepted'?'已确认并保存':'已忽略，日程未变'}</p>}
 </section>;
}
