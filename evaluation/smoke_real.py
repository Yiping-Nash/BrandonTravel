"""Opt-in real provider smoke: uv run python -m evaluation.smoke_real.

Uses synthetic travel data, writes only nonsecret evidence. Does not mutate Workspace.
"""
import asyncio
import json
from pathlib import Path
from dotenv import load_dotenv
from packages.contracts import TripSnapshot, Trip, Activity, ChatRequest
from apps.api.agent.service import run_chat, AgentError
from apps.api.agent.places import search_places


async def main():
    load_dotenv()
    stamp="2026-10-26T00:00:00Z"
    trip=Trip(id="smoke-trip",title="杭州真实 Agent 验证",destination="杭州",startDate="2026-11-02",endDate="2026-11-06",createdAt=stamp,updatedAt=stamp)
    snapshot=TripSnapshot(version=3,trip=trip,activities=[Activity(id="a1",tripId=trip.id,title="湖边散步",date="2026-11-02",sortKey=0,createdAt=stamp,updatedAt=stamp)])
    try:
        response=await run_chat(trip.id,ChatRequest(message="请读取最新行程，检查第一天是不是太满；必须调用高德 search_places 搜索杭州的西湖，选一个真实返回地点给一个 Idea 建议。不要编造 POI 字段。",mode="real"),lambda _:snapshot,search_places,[])
        evidence=response.model_dump(mode="json")
        evidence["verification"]={"structured":True,"snapshotUnchanged":snapshot.version==3 and len(snapshot.activities)==1,
                                  "poiToolCalled":"search_places" in response.toolCalls,"traceVerified":bool(response.traceUrl)}
    except AgentError as exc:
        evidence={"status":"failed","code":exc.code,"message":exc.message}
    target=Path("evaluation/real-smoke-result.json")
    target.write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(evidence,ensure_ascii=False,indent=2))


if __name__=="__main__": asyncio.run(main())
