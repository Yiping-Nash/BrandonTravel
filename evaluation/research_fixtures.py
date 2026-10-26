"""Deterministic, synthetic R1 Trips. No database, network or real reservations.

The original four personas are reused as data, never through their API seeder.
Identifiers are local fixture identifiers, not production Trip identifiers.
"""
from copy import deepcopy
from datetime import date, timedelta

from apps.api.agent.research_contracts import ResearchBrief, context_hash
from packages.contracts import Activity, Idea, Trip, TripSnapshot
from scripts.persona_trips import PERSONAS

TRIP_KEYS = ("shanxi", "hangzhou", "chengdu", "beijing", "shanghai_seniors", "xian")
ALL_TRIP_KEYS = (*TRIP_KEYS, "shanghai_dense")
FIXTURE_VERSION = "r1-v1"
SYNTHETIC_NOTE = "人工合成评测数据；用户确认的是安排，不代表真实购票、预约或营业信息已核验。"

_ORIGINAL = {"hangzhou": 0, "shanghai_dense": 1, "chengdu": 2, "xian": 3}
_NEW = {
    "shanxi": {
        "name": "山西古建筑摄影", "destination": "太原", "days": 5,
        "preferences": "独自摄影，关注木构古建和细节，优先太原及晋中可达地点。每天最多两个主要地点，不夜间驾车，不把跨城交通时长当已知。",
        "dayspec": [[("抵达太原与整理摄影设备", None, None)],
                    [("晋祠建筑观察", "10:00", "12:00"), ("整理照片", "18:00", "19:00")],
                    [("休息与阅读古建资料", None, None)],
                    [("保留摄影机动时间", None, None)], [("返程", None, None)]],
    },
    "beijing": {
        "name": "北京文化旅行", "destination": "北京", "days": 5,
        "preferences": "两位成人偏爱历史和博物馆，每天最多两个主活动。预约和闭馆规则必须核对官方来源，不把计划等同于预约成功。",
        "dayspec": [[("抵达北京与休息", "10:00", "12:00")],
                    [("故宫文化参观计划", "09:00", "12:00")],
                    [("阅读与咖啡休息", "14:00", "16:00")],
                    [("自由文化探索", None, None)], [("返程", None, None)]],
    },
    "shanghai_seniors": {
        "name": "上海长者出行", "destination": "上海", "days": 5,
        "preferences": "两位七十岁长者与一位成人，连续步行尽量不超过三十分钟；需要坐下休息、少台阶和便捷卫生间。无障碍设施必须有证据，未知不等于没有或具备。",
        "dayspec": [[("抵达与酒店休息", "10:00", "12:00"), ("午休", "13:00", "15:00")],
                    [("滨江短程散步", "09:30", "10:00"), ("坐下休息", "10:00", "11:00")],
                    [("午休", "13:00", "15:00")],
                    [("家人聚餐", "12:00", "13:00")], [("返程", None, None)]],
    },
}

# Distinct questions, not model-generated paraphrases. Their evidence quality is
# human-reviewable; rubric text does not claim an automatic semantic oracle.
_QUESTIONS = {
    "shanxi": (
        "只读当前旅行：第二天已有几个安排，哪些时间已确定？不要检索，也不要修改。",
        "结合摄影偏好，研究太原或晋中两个古建筑候选，比较木构观察价值、已有行程重复和参观限制。用高德核对地点，并用网页证据核对具体事实；交通或拍摄限制未知时说明。",
        "我已移动一个安排并采纳一个候选。读取最新快照，研究两个不重复的古建筑候选；不要重新推荐已确认项目，不要自行确定跨城车程或改写行程。",
    ),
    "hangzhou": (
        "只读第一天：是否可能太满？列出活动数量、已确定时段与未定时安排，并尊重孩子午休。无需搜索，不要修改。",
        "研究两个杭州亲子慢游候选，适合六岁孩子，每天最多两个主要活动，保留午休。核对地点与可获取的官网信息，区分适合孩子的推断和证据事实。",
        "我已改动安排并采纳候选。请按雨天情境研究两个室内替代选项，避开已确认活动，保留午休；这是条件假设，不要声称已查到当天雨情。",
    ),
    "chengdu": (
        "只读当前偏好及第二天：哪些活动有确定时间、哪些只是待选餐厅？不要把候选称作预约，不用搜索。",
        "三位朋友一位不吃辣、一位喜欢辣菜。研究两个成都餐饮候选，兼顾不同口味和不早起偏好。区分高德地点事实、网页体验和你的推断；明确推广证据，不能保证未标推广就是非广告。",
        "我已编辑并确认部分安排。研究两种不重复的成都美食选择；对口味、商业推广和主观体验分别说明证据与未知，避免拿 POI 地址当作口碑。",
    ),
    "beijing": (
        "只读当前行程：故宫文化参观计划在哪天？是否有证据表明预约已完成？不要搜索或修改。",
        "研究两个北京博物馆或文化场馆候选，针对本 Trip 日期核对官方开放和预约规则，用高德核对地点。不要把旧网页规则或搜索摘要直接说成适用于出行日。",
        "我已移动安排并采纳候选，请基于最新日期研究文化场馆备选，核对闭馆和预约适用日期；若官网信息不足，明确需再次确认，避免重复现有活动。",
    ),
    "shanghai_seniors": (
        "只读第二天活动，指出步行与休息的既定时间，说明还缺哪些体力和交通信息。不要搜索或修改。",
        "研究两个适合上海长者出行的候选，需要少步行、坐下休息和便捷卫生间。用地点与网页证据支持建议；无障碍和台阶信息没有可靠来源时必须写未知。",
        "我已编辑并确认部分安排。研究两个不重复的长者友好候选，优先短步行和休息；请区分已核验设施、需要电话确认的信息和路线推断，不要替我安排时间。",
    ),
    "xian": (
        "只读第八天和第九天已有安排，说明哪些已定时间、哪些未定；不要把九天旅行缩成一周，不用搜索。",
        "结合九天历史文化独旅，研究两个西安文化候选，并比较安静观察价值、与已有活动重复和官方参观规则。不要把全部候选塞在第一周。",
        "我已移动并采纳部分项目。基于最新九天行程，研究第八天或第九天不重复的文化候选，保留返程安排；任何建议日期必须仍在 Trip 内。",
    ),
    "shanghai_dense": (
        "只读第一天，具体指出已确定的时间重叠和活动数量；不要因为未定时活动就说当天空白，不用搜索。",
        "研究两个上海短程摄影候选，结合密集行程说明取舍，不能掩盖现有时间冲突，也不要自动加入。",
        "我已移动并确认部分项目，请按最新快照研究不重复的摄影备选，说明仍需留白和核实的交通信息。",
    ),
}

SCENARIO_EXPECTATIONS = {
    "common": ["不修改 Trip", "不捏造预约", "区分事实、体验与推断", "引用来自工具实际返回", "说明未知"],
    "shanxi": ["偏好木构摄影", "不凭空确定跨城车程", "避免重复已确认古建"],
    "hangzhou": ["保留午休", "每天最多两个主要活动", "雨天仅为条件假设"],
    "chengdu": ["兼顾辣度差异", "不早起", "不保证内容非广告"],
    "beijing": ["官方规则及适用日期", "计划不等于预约完成", "无证据不承诺开放"],
    "shanghai_seniors": ["短步行及坐下休息", "无障碍未知必须说明", "不编造设施"],
    "xian": ["保留九天跨周上下文", "不重复", "不覆盖返程"],
    "shanghai_dense": ["识别第一天已有时间重叠", "不掩盖密集程度"],
}


def build_brief(trip_key: str, task_index: int = 0, base_date: str = "2026-11-02") -> ResearchBrief:
    """Rebuild a fresh fixture; index 2 simulates edits and partial adoption.

    Changing the base date re-dates every activity; it does not assert that any
    provider's opening rules will remain unchanged on the new travel dates.
    """
    if trip_key not in ALL_TRIP_KEYS:
        raise ValueError(f"Unknown fixture Trip: {trip_key}")
    if isinstance(task_index, bool) or task_index not in (0, 1, 2):
        raise ValueError("task_index must be 0, 1 or 2")
    start = date.fromisoformat(base_date)
    source = deepcopy(PERSONAS[_ORIGINAL[trip_key]] if trip_key in _ORIGINAL else _NEW[trip_key])
    trip_id = f"fixture-{FIXTURE_VERSION}-{trip_key}-{start.isoformat()}"
    stamp = f"{start.isoformat()}T00:00:00Z"
    preferences = source["preferences"]
    if trip_key == "chengdu":
        preferences += " 一位朋友不吃辣、一位喜欢辣菜，必须兼顾。"
    trip = Trip(id=trip_id, title=f"合成评测 · {source['name']}", destination=source["destination"],
                startDate=start, endDate=start + timedelta(days=source["days"] - 1),
                timezone="Asia/Shanghai", preferences=preferences, createdAt=stamp, updatedAt=stamp)
    activities = []
    for day_index, day_activities in enumerate(source["dayspec"]):
        day = start + timedelta(days=day_index)
        for order, (title, t0, t1) in enumerate(day_activities):
            activities.append(Activity(id=f"{trip_id}-a{day_index}-{order}", tripId=trip_id, title=title,
                date=day, sortKey=order, startAt=f"{day}T{t0}" if t0 else None,
                endAt=f"{day}T{t1}" if t1 else None, notes=SYNTHETIC_NOTE, createdAt=stamp, updatedAt=stamp))
    ideas = [Idea(id=f"{trip_id}-i{i}", tripId=trip_id, title=title, sourceKind="manual",
                  description="合成用户候选，未预约；仅在用户确认后加入安排。", createdAt=stamp, updatedAt=stamp)
             for i, title in enumerate(("阅读当地历史并写旅行笔记", "备用室内休息安排", "遇到喜欢的地方多停一会"))]
    version = 10
    if task_index == 2:
        # A real edit shape: move a confirmed activity while preserving its ID,
        # then adopt one Idea without deleting the original candidate.
        moved = activities[0]
        new_day = moved.date + timedelta(days=1)
        moved.date = new_day
        if moved.startAt:
            moved.startAt = f"{new_day}T{moved.startAt[11:]}"
            moved.endAt = f"{new_day}T{moved.endAt[11:]}"
        moved.notes += " 用户刚把该安排从第一天移到第二天。"
        activities.append(Activity(id=f"{trip_id}-adopted-i0", tripId=trip_id, title=ideas[0].title,
            date=start + timedelta(days=2), sortKey=99, ideaId=ideas[0].id, notes=SYNTHETIC_NOTE,
            createdAt=stamp, updatedAt=stamp))
        for day in {a.date for a in activities}:
            for order, activity in enumerate(a for a in activities if a.date == day):
                activity.sortKey = order
        version += 2
    snapshot = TripSnapshot(version=version, trip=trip, activities=activities, ideas=ideas)
    return ResearchBrief(snapshot=snapshot, question=_QUESTIONS[trip_key][task_index],
        taskId=f"{FIXTURE_VERSION}:{trip_key}:{task_index}:{start}",
        mode="direct" if task_index == 0 else "research", contextHash=context_hash(snapshot))


def scenarios(base_date: str = "2026-11-02") -> list[ResearchBrief]:
    """The fixed 18-example evaluation set; dense Shanghai stays a regression."""
    return [build_brief(key, index, base_date) for key in TRIP_KEYS for index in range(3)]
