import {useState,type FormEvent} from 'react';
import {CalendarDays,MapPin,Users,ChevronDown} from 'lucide-react';
import type {Schema,Trip} from './lib/api';

type Props={trip?:Trip;busy:boolean;submit:(body:Schema['TripCreate'])=>Promise<void>;cancel?:()=>void};

/** Progressive optional inputs; empty dates remain null on the wire. */
export function TripForm({trip,busy,submit,cancel}:Props){
 const [where,setWhere]=useState(trip?.destination||''),[from,setFrom]=useState(trip?.startDate||''),[to,setTo]=useState(trip?.endDate||''),[who,setWho]=useState(trip?.companions||''),[problem,setProblem]=useState('');
 async function save(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setProblem('');
  if(from&&to&&from>to){setProblem('结束日期不能早于出发日期。');return;}
  const f=new FormData(e.currentTarget);
  await submit({title:String(f.get('title')||'').trim()||'新的旅行',destination:where.trim(),startDate:from||null,endDate:to||null,companions:who.trim(),timezone:String(f.get('timezone')||'Asia/Shanghai'),preferences:String(f.get('preferences')||'')});
 }
 return <form className="trip-form" onSubmit={e=>void save(e)}>
  <p className="modal-note">先记下想法。目的地、日期和同行人都可以稍后补充。</p>
  <label>旅行名称<input name="title" aria-label="旅行名称" maxLength={200} defaultValue={trip?.title||''} placeholder="给这趟旅行起个名字（可稍后修改）"/></label>
  <details className="progressive-field" open={undefined}><summary><MapPin size={17}/><b>Where · 去哪里</b><span>{where||'还没决定'}</span><ChevronDown size={15}/></summary><label>目的地<input aria-label="目的地" maxLength={200} value={where} onChange={e=>setWhere(e.target.value)} placeholder="例如：太原、杭州"/></label></details>
  <details className="progressive-field"><summary><CalendarDays size={17}/><b>When · 什么时候</b><span>{from||to?`${from||'未定'} → ${to||'未定'}`:'日期待定'}</span><ChevronDown size={15}/></summary><div className="form-row"><label>出发日期<input aria-label="出发日期" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>结束日期<input aria-label="结束日期" type="date" min={from||undefined} value={to} onChange={e=>setTo(e.target.value)}/></label></div><p className="modal-note">确定起止日期后即可安排日程。清空日期不会替你选择默认日期。</p></details>
  <details className="progressive-field"><summary><Users size={17}/><b>Who · 和谁一起</b><span>{who||'可以稍后补充'}</span><ChevronDown size={15}/></summary><div className="companion-options">{['独自旅行','两人同行','亲子家庭','朋友结伴','长者同行'].map(v=><button key={v} className={who===v?'selected':''} type="button" onClick={()=>setWho(v)}>{v}</button>)}</div><label>同行情况<input aria-label="同行人" value={who} onChange={e=>setWho(e.target.value)} maxLength={500} placeholder="例如：两位大人和一个六岁孩子"/></label></details>
  <label>偏好与想法<textarea name="preferences" aria-label="旅行偏好内容" defaultValue={trip?.preferences||''} rows={3} maxLength={4000} placeholder="期待什么？有哪些必须保留的安排、节奏或饮食偏好？"/></label>
  <details className="trip-timezone"><summary>旅行时区</summary><label>时区<input name="timezone" aria-label="旅行时区" required defaultValue={trip?.timezone||'Asia/Shanghai'}/></label></details>
  {problem&&<p role="alert" className="inline-error">{problem}</p>}
  <div className="modal-footer">{cancel&&<button type="button" className="secondary" onClick={cancel}>取消</button>}<button className="primary" disabled={busy}>{busy?'正在保存…':trip?'保存旅行设置':'创建旅行'}</button></div>
 </form>;
}
