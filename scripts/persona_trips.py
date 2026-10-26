"""Create synthetic personas through the real API and evaluate real Qwen reading."""
import argparse
import json
from datetime import date, timedelta
from pathlib import Path
import httpx

PERSONAS=[
    {'name':'亲子慢游','destination':'杭州','days':5,'preferences':'两位成人与一名六岁孩子，喜欢公园和轻松体验。午休不可少，每天最多两个主要活动。','dayspec':[
        [('湖畔短程散步','09:30','10:30'),('午休','12:30','14:30'),('找一处草地玩耍',None,None)],
        [('自然博物馆探索','10:00','11:30'),('午休','13:00','15:00')],
        [('亲子手工体验',None,None),('自由晚餐',None,None)],
        [('公园野餐','11:00','12:00')],[('慢慢收拾与返程',None,None)]]},
    {'name':'密集打卡','destination':'上海','days':5,'preferences':'朋友两人，喜欢城市地标、拍照和夜景。希望尽量多看，但不要隐瞒时间冲突。','dayspec':[
        [('早餐集合','07:30','08:00'),('老城步行','08:15','10:30'),('建筑展览','10:00','12:00'),('午餐','12:00','13:00'),('滨江拍照','13:00','15:00'),('街区探索','15:00','18:00'),('夜景漫步','18:30','21:00')],
        [('城市博物馆','09:00','12:00'),('商业街与摄影','13:00','18:00')],
        [('咖啡与建筑路线',None,None),('夜间小吃',None,None)],
        [('主题展览','10:00','13:00')],[('返程',None,None)]]},
    {'name':'朋友美食','destination':'成都','days':5,'preferences':'三位朋友，不早起，重视当地美食和聊天。餐厅尚未选定，不把候选当预约。','dayspec':[
        [('睡到自然醒',None,None),('找一家面馆',None,None),('喝茶聊天',None,None),('火锅候选研究',None,None)],
        [('早午餐','11:00','12:30'),('街区慢逛',None,None)],
        [('美食市场散步',None,None),('朋友聚餐','18:00','20:00')],
        [('自由探索',None,None)],[('伴手礼与返程',None,None)]]},
    {'name':'跨周文化独旅','destination':'西安','days':9,'preferences':'独自出行，偏好历史、建筑与安静观察。九天跨周，重视灵活调整。','dayspec':[
        [('抵达与休息',None,None),('读一段城市历史','19:00','20:00')],
        [('博物馆主题研究','10:00','12:00')],
        [('古建筑漫步','09:00','11:00')],
        [('写旅行笔记',None,None)],[('自由留白',None,None)],
        [('城市文化展览','13:00','15:00')],[('旧街区观察',None,None)],
        [('跨周：再访喜欢的展馆','10:00','12:00')],[('跨周：整理笔记与返程',None,None)]]},
]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--evaluate',action='store_true');parser.add_argument('--resume',action='store_true');args=parser.parse_args()
    client=httpx.Client(base_url='http://127.0.0.1:8000/api',timeout=130,trust_env=False)
    records=json.loads(Path('evaluation/persona-results.json').read_text(encoding='utf-8')) if args.resume else []
    def checked(r): r.raise_for_status();return r.json()
    for persona in PERSONAS:
        if any(r['persona']==persona['name'] and r.get('agentReadLatest') for r in records): continue
        start=date(2026,11,2);end=start+timedelta(days=persona['days']-1)
        s=checked(client.post('/trips',json={'title':'演示 · '+persona['name'],'destination':persona['destination'],'startDate':str(start),'endDate':str(end),'timezone':'Asia/Shanghai','preferences':persona['preferences']}))
        path=f"/trips/{s['trip']['id']}"
        for index,activities in enumerate(persona['dayspec']):
            day=str(start+timedelta(days=index))
            for title,t0,t1 in activities:
                s=checked(client.post(path+'/commands',json={'expectedVersion':s['version'],'command':{'type':'addActivity','activity':{'title':title,'date':day,'startAt':f'{day}T{t0}' if t0 else None,'endAt':f'{day}T{t1}' if t1 else None,'notes':'人工构造的风格测试安排；没有真实预订或营业时间验证。'}}}))
        for title in ['遇到喜欢的地方多停一会','备用的雨天安排','有空再决定的小体验']:
            s=checked(client.post(path+'/commands',json={'expectedVersion':s['version'],'command':{'type':'addIdea','idea':{'title':title,'sourceKind':'manual','description':'测试候选，尚未安排日期'}}}))
        assert checked(client.get(path))==s
        entry={'persona':persona['name'],'tripId':s['trip']['id'],'url':f"http://127.0.0.1:5173/?trip={s['trip']['id']}",'activities':len(s['activities']),'untimed':sum(x['startAt'] is None for x in s['activities']),'days':persona['days'],'persistencePassed':True}
        if args.evaluate:
            response=client.post(path+'/chat',json={'mode':'real','message':'请读取最新行程与偏好，评价第一天是不是太满。具体列出已确认的时间重叠或未定时间，并结合我的旅行风格提出建议。不要替我改行程，不需要查询地点。'})
            entry['chatStatus']=response.status_code
            if response.status_code != 200:
                entry['error']=response.json().get('error',{})
                records.append(entry)
                Path('evaluation/persona-results.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
                print(json.dumps(entry,ensure_ascii=True),flush=True)
                continue
            result=checked(response)
            after=checked(client.get(path))
            assert after['activities']==s['activities'] and after['ideas']==s['ideas']
            assert 'get_trip_snapshot' in result['toolCalls'] and result['snapshotVersion']==s['version']
            entry.update(agentReadLatest=True,noUnconfirmedWrites=True,reply=result['reply'],uncertainty=result['uncertainty'],traceUrl=result['traceUrl'],sessionId=result['sessionId'])
        records.append(entry)
        Path('evaluation/persona-results.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({k:v for k,v in entry.items() if k not in {'reply','uncertainty'}},ensure_ascii=True),flush=True)

if __name__=='__main__':main()
