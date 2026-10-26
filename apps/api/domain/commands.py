from datetime import date, datetime, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

from packages.contracts import Activity, ActivityInput, CommandBody, Idea, IdeaInput, Trip, TripSnapshot
from apps.api.domain.errors import DomainError


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def identifier() -> str:
    return str(uuid4())


def require_text(value: str, name: str = "标题") -> None:
    if not value.strip():
        raise DomainError(422, "INVALID_TEXT", f"{name}不能为空。")


def require_date(snapshot: TripSnapshot, day: date) -> None:
    if snapshot.trip.startDate is None or snapshot.trip.endDate is None:
        raise DomainError(422, "TRIP_DATES_REQUIRED", "请先补全旅行起止日期，再安排活动。")
    if not snapshot.trip.startDate <= day <= snapshot.trip.endDate:
        raise DomainError(422, "DATE_OUTSIDE_TRIP", "活动日期必须在旅行起止日期之内。")


def find(items: list, item_id: str, kind: str):
    item = next((item for item in items if item.id == item_id), None)
    if item is None:
        raise DomainError(404, "ENTITY_NOT_FOUND", f"此旅行中找不到{kind}。")
    return item


def validate_activity(snapshot: TripSnapshot, activity: ActivityInput) -> None:
    require_text(activity.title)
    require_date(snapshot, activity.date)
    if activity.ideaId is not None:
        find(snapshot.ideas, activity.ideaId, "候选")
    zone = ZoneInfo(snapshot.trip.timezone)
    for value in (activity.startAt, activity.endAt):
        if value is None:
            continue
        wall = datetime.fromisoformat(value)
        candidates = [wall.replace(tzinfo=zone, fold=fold) for fold in (0, 1)]
        valid = [candidate for candidate in candidates
                 if candidate.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) == wall]
        if not valid:
            raise DomainError(422, "NONEXISTENT_LOCAL_TIME", "该时间在旅行时区的夏令时切换中不存在，请选择其他时间。")
        if len({candidate.utcoffset() for candidate in valid}) > 1:
            raise DomainError(422, "AMBIGUOUS_LOCAL_TIME", "该时间在旅行时区的夏令时切换中重复，请选择无歧义的时间。")


def normalize(snapshot: TripSnapshot) -> None:
    """Keep stable list order for equal sort keys; canonical keys are per date."""
    snapshot.activities.sort(key=lambda activity: (activity.date, activity.sortKey))
    counts: dict[date, int] = {}
    for activity in snapshot.activities:
        position = counts.get(activity.date, 0)
        activity.sortKey = position
        counts[activity.date] = position + 1


def append_activity(snapshot: TripSnapshot, value: ActivityInput, stamp: str) -> Activity:
    validate_activity(snapshot, value)
    activity = Activity(**value.model_dump(), id=identifier(), tripId=snapshot.trip.id,
                        sortKey=sum(a.date == value.date for a in snapshot.activities),
                        createdAt=stamp, updatedAt=stamp)
    snapshot.activities.append(activity)
    return activity


def append_idea(snapshot: TripSnapshot, value: IdeaInput, stamp: str) -> Idea:
    require_text(value.title)
    idea = Idea(**value.model_dump(), id=identifier(), tripId=snapshot.trip.id,
                createdAt=stamp, updatedAt=stamp)
    snapshot.ideas.append(idea)
    return idea


def apply_command(snapshot: TripSnapshot, command: CommandBody) -> None:
    """Mutate a transaction-private snapshot; repository commits only on success."""
    stamp = now()
    match command.type:
        case "addIdea":
            append_idea(snapshot, command.idea, stamp)
        case "deleteIdea":
            idea = find(snapshot.ideas, command.ideaId, "候选")
            snapshot.ideas.remove(idea)
            for activity in snapshot.activities:
                if activity.ideaId == idea.id:
                    activity.ideaId = None
                    activity.updatedAt = stamp
        case "addActivity":
            append_activity(snapshot, command.activity, stamp)
        case "updateActivity":
            existing = find(snapshot.activities, command.activityId, "活动")
            validate_activity(snapshot, command.activity)
            order = existing.sortKey if existing.date == command.activity.date else sum(
                item.date == command.activity.date for item in snapshot.activities)
            updated = Activity(**command.activity.model_dump(), id=existing.id, tripId=existing.tripId,
                               sortKey=order, createdAt=existing.createdAt, updatedAt=stamp)
            snapshot.activities[snapshot.activities.index(existing)] = updated
        case "removeActivity":
            snapshot.activities.remove(find(snapshot.activities, command.activityId, "活动"))
        case "moveActivity":
            existing = find(snapshot.activities, command.activityId, "活动")
            value = existing.model_dump(include=set(ActivityInput.model_fields))
            value["date"] = command.date
            for key in ("startAt", "endAt"):
                if value[key] is not None:
                    value[key] = command.date.isoformat() + value[key][10:]
            moved = ActivityInput.model_validate(value)
            validate_activity(snapshot, moved)
            snapshot.activities.remove(existing)
            target = sorted((a for a in snapshot.activities if a.date == command.date), key=lambda a: a.sortKey)
            if command.index > len(target):
                raise DomainError(422, "INVALID_POSITION", "活动排序位置超出目标日期的范围。")
            replacement = Activity(**moved.model_dump(), id=existing.id, tripId=existing.tripId,
                                   sortKey=command.index, createdAt=existing.createdAt, updatedAt=stamp)
            target.insert(command.index, replacement)
            for index, activity in enumerate(target):
                activity.sortKey = index
            snapshot.activities = [a for a in snapshot.activities if a.date != command.date] + target
        case "adoptIdea":
            idea = find(snapshot.ideas, command.ideaId, "候选")
            append_activity(snapshot, ActivityInput(title=idea.title, date=command.date, place=idea.place,
                                                   ideaId=idea.id, notes=idea.description), stamp)
        case "adoptSuggestion":
            suggestion = find(snapshot.suggestions, command.suggestionId, "建议")
            if suggestion.status != "proposed":
                raise DomainError(409, "SUGGESTION_RESOLVED", "此建议已处理，不能重复采纳。")
            if command.target == "idea":
                append_idea(snapshot, IdeaInput(title=suggestion.title, description=suggestion.rationale,
                                               place=suggestion.place, sourceKind="agent",
                                               evidence=[f"suggestion:{suggestion.id}", *suggestion.evidenceRefs][:20]), stamp)
            else:
                day = command.date or suggestion.proposedDate
                if day is None:
                    raise DomainError(422, "DATE_REQUIRED", "采纳到行程需要选择日期。")
                append_activity(snapshot, ActivityInput(title=suggestion.title, date=day, place=suggestion.place,
                                                       notes=f"来源建议：{suggestion.id}\n{suggestion.rationale}"[:4000]), stamp)
            suggestion.status = "accepted"
        case "dismissSuggestion":
            suggestion = find(snapshot.suggestions, command.suggestionId, "建议")
            if suggestion.status != "proposed":
                raise DomainError(409, "SUGGESTION_RESOLVED", "此建议已处理。")
            suggestion.status = "dismissed"
        case "setPreferences":
            snapshot.trip.preferences = command.preferences
        case "updateTrip":
            value = command.trip
            require_text(value.title)
            if snapshot.activities and (value.startDate is None or value.endDate is None or
                    any(not value.startDate <= a.date <= value.endDate for a in snapshot.activities)):
                raise DomainError(409, "TRIP_DATE_CONFLICT", "新日期范围不能排除已有活动，请先调整这些活动。")
            snapshot.trip = Trip(**{**value.model_dump(), "destination": value.destination.strip()},
                                 id=snapshot.trip.id, createdAt=snapshot.trip.createdAt, updatedAt=stamp)
            # Existing wall times remain wall times; reject newly invalid DST times
            # rather than silently converting or deleting user arrangements.
            for activity in snapshot.activities:
                validate_activity(snapshot, ActivityInput.model_validate(activity.model_dump(include=set(ActivityInput.model_fields))))
        case _:
            raise DomainError(422, "UNKNOWN_COMMAND", "不支持的工作区操作。")
    normalize(snapshot)
    snapshot.trip.updatedAt = stamp
