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

@app.get('/api/trips/{trip_id}/proposals',response_model=list[Proposal])
def proposals(trip_id:str): pass
@app.post('/api/trips/{trip_id}/proposals/generate',response_model=Proposal)
def generate(trip_id:str,body:PlanRequest): pass
@app.get('/api/trips/{trip_id}/research-runs',response_model=list[ResearchRun])
def runs(trip_id:str): pass
@app.post('/api/trips/{trip_id}/research-runs',response_model=ResearchRun,status_code=202)
def research_start(trip_id:str,body:ResearchStart): pass
@app.post('/api/trips/{trip_id}/research-runs/{run_id}/cancel',response_model=ResearchRun)
def research_cancel(trip_id:str,run_id:str): pass
@app.post('/api/trips/{trip_id}/research-runs/{run_id}/proposal',response_model=Proposal)
def research_proposal(trip_id:str,run_id:str,body:ResearchAdopt): pass
@app.post('/api/trips/{trip_id}/suggestions/{suggestion_id}/proposal',response_model=Proposal)
def suggestion_proposal(trip_id:str,suggestion_id:str,body:SuggestionPreview): pass
@app.get('/api/trips/{trip_id}/day-context',response_model=DayContext)
def day_context(trip_id:str,date:str): pass

Path('packages/contracts/openapi.json').write_text(json.dumps(app.openapi(),indent=2),encoding='utf-8')
print('OpenAPI exported')
