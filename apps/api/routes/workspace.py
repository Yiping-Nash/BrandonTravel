from fastapi import APIRouter
from packages.contracts import ChatSession, Command, Trip, TripCreate, TripSnapshot
from apps.api.db.repository import Repository


def create_router(repo: Repository) -> APIRouter:
    router = APIRouter(prefix="/api", tags=["Workspace"])

    @router.get("/trips", response_model=list[Trip])
    def list_trips():
        return repo.list_trips()

    @router.post("/trips", response_model=TripSnapshot, status_code=201)
    def create_trip(body: TripCreate):
        return repo.create_trip(body)

    @router.get("/trips/{trip_id}", response_model=TripSnapshot)
    def get_trip(trip_id: str):
        return repo.get_snapshot(trip_id)

    @router.post("/trips/{trip_id}/commands", response_model=TripSnapshot)
    def execute(trip_id: str, body: Command):
        return repo.execute(trip_id, body)

    @router.get("/trips/{trip_id}/sessions", response_model=list[ChatSession])
    def list_sessions(trip_id: str):
        return repo.list_sessions(trip_id)

    return router
