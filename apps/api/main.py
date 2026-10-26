"""Local single-user HTTP boundary; authoritative state lives in Repository."""
import asyncio
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / '.env')

from apps.api.db.repository import Repository
from apps.api.domain.errors import DomainError
from apps.api.routes.workspace import create_router
from apps.api.routes.portfolio import create_router as create_portfolio_router
from apps.api.routes.maps import create_router as create_map_router
from apps.api.agent.service import AgentError, run_chat
from apps.api.agent.places import search_places
from packages.contracts import ChatMessage, ChatRequest, ChatResponse, ChatSession, SuggestionDraft

logger = logging.getLogger('brandontravel')

def configured(name: str) -> bool:
    value = os.getenv(name, '').strip()
    return bool(value) and value.lower() not in {'your-api-key', 'changeme', 'replace-me'}

def create_app(database_path: str | None = None) -> FastAPI:
    path = database_path or os.getenv('DATABASE_PATH', 'data/brandontravel.sqlite3')
    if not Path(path).is_absolute(): path = str(ROOT / path)
    repo = Repository(path)
    app = FastAPI(title='BrandonTravel2 Workspace', version='1.0.0')
    app.state.repo = repo
    # A bounded pool avoids unbounded lock allocation from user-supplied session IDs.
    chat_locks = [asyncio.Lock() for _ in range(64)]
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1','localhost','testserver'])

    @app.middleware('http')
    async def local_origin_only(request: Request, call_next):
        origin = request.headers.get('origin')
        if origin:
            parsed = urlparse(origin)
            if parsed.scheme not in {'http','https'} or parsed.hostname not in {'localhost','127.0.0.1'}:
                return JSONResponse(status_code=403, content={'error':{'code':'ORIGIN_FORBIDDEN','message':'Local workspace accepts only local browser origins'}})
        return await call_next(request)

    @app.exception_handler(DomainError)
    async def domain_error(_request, exc):
        return JSONResponse(status_code=exc.status, content={'error':{'code':exc.code,'message':exc.message}})

    @app.exception_handler(AgentError)
    async def agent_error(_request, exc):
        logger.warning('Agent request failed: %s (HTTP %s)', exc.code, exc.status)
        return JSONResponse(status_code=exc.status, content={'error':{'code':exc.code,'message':exc.message}})

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request, exc):
        # Do not return request bodies/inputs, which may contain personal data.
        details = [{'loc':list(e['loc']),'message':e['msg'],'type':e['type']} for e in exc.errors()]
        return JSONResponse(status_code=422, content={'error':{'code':'VALIDATION_ERROR','message':'输入不符合数据契约','details':details}})

    @app.exception_handler(Exception)
    async def unexpected_error(_request, exc):
        logger.error('Unhandled API error (%s)', type(exc).__name__)
        return JSONResponse(status_code=500, content={'error':{'code':'INTERNAL_ERROR','message':'服务暂时无法完成请求，请重试'}})

    @app.get('/api/health')
    def health():
        return {'status':'ok','capabilities':{'agent':configured('DASHSCOPE_API_KEY'),'poi':configured('AMAP_WEB_SERVICE_KEY'),'tracing':configured('LANGSMITH_API_KEY') and os.getenv('LANGSMITH_TRACING','false').lower()=='true'},'model':os.getenv('AGENT_MODEL','qwen3.8-flash')}

    app.include_router(create_router(repo))
    app.include_router(create_portfolio_router(repo))
    app.include_router(create_map_router(repo))

    @app.get('/api/places')
    async def places(query: str = Query(min_length=1,max_length=200), city: str = Query(min_length=1,max_length=200)):
        return {'places':await search_places(query,city),'provider':'amap'}

    @app.post('/api/trips/{trip_id}/chat', response_model=ChatResponse)
    async def chat(trip_id: str, body: ChatRequest):
        # Serialize a trip's conversations; human itinerary writes remain independent.
        async with chat_locks[hash(trip_id) % len(chat_locks)]:
            repo.get_snapshot(trip_id)
            session = repo.get_session(trip_id,body.sessionId) if body.sessionId else None
            history = session.messages if session else []
            result = await asyncio.wait_for(run_chat(trip_id,body,repo.get_snapshot,search_places,history),timeout=120)
            drafts = [SuggestionDraft.model_validate(s.model_dump(exclude={'id','tripId','status'})) for s in result.suggestions]
            now = datetime.now(timezone.utc).isoformat()
            if session is None:
                session = ChatSession(id=result.sessionId,tripId=trip_id,title=body.message.strip()[:60])
            session.messages.extend([ChatMessage(role='user',content=body.message,createdAt=now),ChatMessage(role='assistant',content=result.reply,createdAt=now,response=result)])
            return repo.finalize_chat(trip_id,drafts,session,result)

    @app.exception_handler(TimeoutError)
    async def chat_timeout(_request, _exc):
        return JSONResponse(status_code=504,content={'error':{'code':'AGENT_TIMEOUT','message':'模型响应超时，请稍后重试。未改写行程。'}})

    return app

app = create_app()
