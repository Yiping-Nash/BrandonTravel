import json
from pathlib import Path
from fastapi import FastAPI
from packages.contracts import *

app = FastAPI(title='BrandonTravel2 Contract',version='1.0.0')
@app.get('/api/trips',response_model=list[Trip])
def trips(): pass
@app.post('/api/trips',response_model=TripSnapshot,status_code=201)
def create(body:TripCreate): pass
@app.get('/api/trips/{trip_id}',response_model=TripSnapshot)
def snapshot(trip_id:str): pass
@app.post('/api/trips/{trip_id}/commands',response_model=TripSnapshot)
def command(trip_id:str,body:Command): pass
@app.post('/api/trips/{trip_id}/chat',response_model=ChatResponse)
def chat(trip_id:str,body:ChatRequest): pass
@app.get('/api/trips/{trip_id}/sessions',response_model=list[ChatSession])
def sessions(trip_id:str): pass

Path('packages/contracts/openapi.json').write_text(json.dumps(app.openapi(),indent=2),encoding='utf-8')
print('OpenAPI exported')
