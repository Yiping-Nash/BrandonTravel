"""Tests exercise actual routing, validation and persistent domain boundary."""
import pytest
from fastapi.testclient import TestClient

@pytest.fixture
def client(tmp_path):
    from apps.api.main import create_app
    with TestClient(create_app(str(tmp_path/'workspace.db'))) as client:
        yield client

def create(client):
    r=client.post('/api/trips',json={'title':'杭州测试','destination':'杭州','startDate':'2026-11-02','endDate':'2026-11-06'})
    assert r.status_code==201, r.text
    return r.json()

def command(client,s,body):
    return client.post(f"/api/trips/{s['trip']['id']}/commands",json={'expectedVersion':s['version'],'command':body})

def test_crud_contract_and_readback(client):
    s=create(client)
    r=command(client,s,{'type':'addActivity','activity':{'title':'无地点自由活动','date':'2026-11-02'}})
    assert r.status_code==200,r.text
    newer=r.json()
    assert newer['activities'][0]['place'] is None
    assert newer['activities'][0]['startAt'] is None
    assert command(client,s,{'type':'setPreferences','preferences':'stale'}).status_code==409
    assert client.get(f"/api/trips/{s['trip']['id']}").json()==newer

def test_validation_and_origin(client):
    assert client.post('/api/trips',json={}).status_code==422
    invalid=client.post('/api/trips',json={}).json()
    assert invalid['error']['code']=='VALIDATION_ERROR'
    r=client.post('/api/trips',json={},headers={'origin':'https://evil.example'})
    assert r.status_code==403
    health=client.get('/api/health').json()
    assert all(isinstance(v,bool) for v in health['capabilities'].values())
    assert 'KEY' not in str(health)

def test_demo_chat_proposes_without_activity_write(client):
    s=create(client)
    path=f"/api/trips/{s['trip']['id']}"
    r=client.post(path+'/chat',json={'message':'第一天是不是太满？推荐一个休息安排','mode':'demo'})
    assert r.status_code==200,r.text
    response=r.json()
    assert response['mode']=='demo'
    assert response['traceUrl'] is None
    after=client.get(path).json()
    assert after['activities']==[] and after['ideas']==[]
    assert all(x['status']=='proposed' for x in after['suggestions'])
    assert len(client.get(path+'/sessions').json())==1

def test_missing_real_keys_is_explicit(client, monkeypatch):
    monkeypatch.delenv('DASHSCOPE_API_KEY',raising=False)
    monkeypatch.delenv('AMAP_WEB_SERVICE_KEY',raising=False)
    s=create(client)
    r=client.post(f"/api/trips/{s['trip']['id']}/chat",json={'message':'hello','mode':'real'})
    assert r.status_code==503,r.text
    assert 'error' in r.json()
    places=client.get('/api/places',params={'query':'公园','city':'杭州'})
    assert places.status_code==503,places.text

def test_chat_whitespace_normalization_and_atomic_transcript(client):
    s=create(client)
    path=f"/api/trips/{s['trip']['id']}"
    r=client.post(path+'/chat',json={'message':' '*60+'hello','mode':'demo'})
    assert r.status_code==200,r.text
    sessions=client.get(path+'/sessions').json()
    assert sessions[0]['title']=='hello'
    assert sessions[0]['messages'][-1]['response']['suggestions']==r.json()['suggestions']
    before=client.get(path).json()
    assert client.post(path+'/chat',json={'message':' '*100,'mode':'demo'}).status_code==422
    assert client.get(path).json()==before
