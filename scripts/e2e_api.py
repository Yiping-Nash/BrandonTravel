"""Real provider integrated acceptance. Writes only the new synthetic test Trip."""
import json
from datetime import datetime, timezone
from pathlib import Path
import httpx

client=httpx.Client(base_url='http://127.0.0.1:8000/api',timeout=120,trust_env=False)
steps=[]
def checked(response):
    response.raise_for_status()
    return response.json()
s=checked(client.post('/trips',json={'title':'验收 · 杭州五日','destination':'杭州','startDate':'2026-11-02','endDate':'2026-11-06','preferences':'喜欢散步和茶，每天留出自由时间。'}))
trip_id=s['trip']['id']
path=f'/trips/{trip_id}'
def command(body):
    global s
    s=checked(client.post(path+'/commands',json={'expectedVersion':s['version'],'command':body}))
    assert checked(client.get(path))==s
    return s
assert checked(client.get(path))==s
steps.append('create trip and read back')
for title in ['湖边散步','午餐与自由活动','安顿行李']:
    command({'type':'addActivity','activity':{'title':title,'date':'2026-11-02'}})
command({'type':'addIdea','idea':{'title':'找一家安静茶馆'}})
manual_idea=s['ideas'][-1]['id']
steps.append('manual idea and custom untimed activities persist')
places=checked(client.get('/places',params={'query':'西湖','city':'杭州'}))['places']
assert places and places[0]['provider']=='amap'
command({'type':'addIdea','idea':{'title':places[0]['name'],'place':places[0],'sourceKind':'poi','evidence':[f"amap:{places[0]['providerId']}"]}})
steps.append('real AMap POI saved as idea')
command({'type':'adoptIdea','ideaId':manual_idea,'date':'2026-11-03'})
assert any(i['id']==manual_idea for i in s['ideas'])
activity=s['activities'][0]
command({'type':'moveActivity','activityId':activity['id'],'date':'2026-11-04','index':0})
activity=next(a for a in s['activities'] if a['id']==activity['id'])
body={k:activity[k] for k in ['title','date','startAt','endAt','place','ideaId','notes']}
body.update(startAt='2026-11-04T09:00',endAt='2026-11-04T11:00')
command({'type':'updateActivity','activityId':activity['id'],'activity':body})
command({'type':'moveActivity','activityId':activity['id'],'date':'2026-11-02','index':1})
moved=next(a for a in s['activities'] if a['id']==activity['id'])
assert moved['startAt']=='2026-11-02T09:00' and moved['sortKey']==1
steps.append('adopt idea, reorder/move, set time, move back with local time preserved')
before=s
result=checked(client.post(path+'/chat',json={'mode':'real','message':'第一天是不是太满？请先读最新行程，再实际搜索杭州龙井茶馆，提出一个可保存到 Ideas 的真实地点建议。明确哪些判断未验证。'}))
s=checked(client.get(path))
assert s['activities']==before['activities'] and s['ideas']==before['ideas']
assert 'get_trip_snapshot' in result['toolCalls'] and 'search_places' in result['toolCalls']
assert result['mode']=='real' and result['suggestions'] and result['traceUrl']
assert result['snapshotVersion']==before['version']
steps.append('real Qwen reads latest snapshot and calls POI; proposed suggestions do not mutate ideas/activities')
proposal=result['suggestions'][0]
command({'type':'adoptSuggestion','suggestionId':proposal['id'],'target':'idea'})
assert len(s['ideas'])==len(before['ideas'])+1
retry=client.post(path+'/commands',json={'expectedVersion':s['version'],'command':{'type':'adoptSuggestion','suggestionId':proposal['id'],'target':'idea'}})
assert retry.status_code==409
assert checked(client.get(path))==s
steps.append('explicit adoption persists once; duplicate adoption rejected')
sessions=checked(client.get(path+'/sessions'))
assert len(sessions)==1 and len(sessions[0]['messages'])==2
report={'passed':True,'time':datetime.now(timezone.utc).isoformat(),'tripId':trip_id,'tripUrl':f'http://127.0.0.1:5173/?trip={trip_id}','steps':steps,'snapshotVersion':s['version'],'traceUrl':result['traceUrl'],'toolCalls':result['toolCalls'],'response':result}
Path('evaluation/integrated-e2e-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='response'},ensure_ascii=False,indent=2))
