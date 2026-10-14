import { useTripSelection } from "./trip-selection";
import { useAuth } from "@/hooks/useAuth";
import { useState, useEffect, useRef } from "react";
import { format, addDays } from "date-fns";
import { useMultiDayEventDrag } from "@/components/calendar/multi-day-event-drag";
import { travelApi as api } from "./api";
import { importFutureSamples } from "./future-samples";
import type {
  KernelTrip,
  TravelEnvironment,
  IntelligenceSnapshot,
  TimeBlock,
  TravelTrip,
  TravelActivity,
  TravelOperation,
  TravelProposal,
  TravelEntity,
  TravelTransition,
} from "@open-sunsama/types";
export const clock = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export const empty = (): TravelActivity => ({
  id: crypto.randomUUID(),
  title: "",
  notes: "",
  place: "",
  date: null,
  start: null,
  duration: 60,
  locked: false,
  position: 0,
});
export const wall = (date: string, start: number) =>
  new Date(`${date}T${clock(start)}:00`);
export function useTravelWorkspace(
  initialTripId = new URLSearchParams(location.search).get("tripId") ?? "",
) {
  const readGeneration = useRef(0);
  const readAbort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      readGeneration.current++;
      readAbort.current?.abort();
    },
    [],
  );
  const { logout, user, isAuthenticated, isLoading } = useAuth();
  const selectedRef = useRef(initialTripId);
  const draggingRef = useRef(false),
    dragRevisionRef = useRef(0);
  const [snapshotError, setSnapshotError] = useState("");
  const [snapshot, setSnapshot] = useState<IntelligenceSnapshot | null>(null);
  const issueTag = (id: string) =>
    snapshot?.evaluation.tripRevision === trip?.revision
      ? " " +
        (snapshot?.activities
          .find((a) => a.id === id)
          ?.markers.map((m) => "[" + m + "]")
          .join(" ") ?? "")
      : "";
  const [environments, setEnvironments] = useState<
    Record<string, TravelEnvironment>
  >({});
  const [editEnvironment, setEditEnvironment] =
    useState<TravelEnvironment>("unspecified");
  const [selectedActivity, setSelectedActivity] = useState("");
  const [routeRows, setRouteRows] = useState<TravelTransition[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<
    TravelEntity | null | undefined
  >();
  const [pendingTotal, setPendingTotal] = useState(0);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [pendingCursor, setPendingCursor] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [trips, setTrips] = useState<TravelTrip[]>([]),
    [tripId, setTripId] = useState(""),
    [trip, setTrip] = useState<TravelTrip | null>(null),
    [proposals, setProposals] = useState<TravelProposal[]>([]),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<TravelActivity | null>(null),
    [draftRevision, setDraftRevision] = useState(0),
    [day, setDay] = useState(""),
    [mobile, setMobile] = useState(window.innerWidth < 768),
    [newTrip, setNewTrip] = useState(false);
  useEffect(() => {
    setSnapshot(null);
    setRouteRows([]);
    setSnapshotError("");
  }, [trip?.id]);
  async function refresh(id?: string) {
    const generation = ++readGeneration.current;
    readAbort.current?.abort();
    const controller = new AbortController();
    readAbort.current = controller;
    const requested = id || selectedRef.current;
    if (id) selectedRef.current = id;
    try {
      const ts = await api<TravelTrip[]>(
        "/trips",
        "GET",
        undefined,
        controller.signal,
      );
      if (generation !== readGeneration.current) return;
      setTrips(ts);
      const selected = requested || selectedRef.current || ts[0]?.id;
      if (selectedRef.current && selectedRef.current !== selected) return;
      if (selected) {
        selectedRef.current = selected;
        const t = await api<TravelTrip>(
          `/trips/${selected}`,
          "GET",
          undefined,
          controller.signal,
        );
        const kernel = await api<KernelTrip>(
          `/trips/${selected}/kernel`,
          "GET",
          undefined,
          controller.signal,
        );
        if (
          generation !== readGeneration.current ||
          draggingRef.current ||
          selectedRef.current !== selected
        )
          return;
        if (kernel.revision !== t.revision) return;
        setEnvironments(
          Object.fromEntries(
            kernel.activities.map((a) => [a.id, a.environment]),
          ),
        );
        setTrip(t);
        setTripId(selected);
        setDay((d) => (d >= t.startDate && d <= t.endDate ? d : t.startDate));
        const page = await api<{
          items: TravelProposal[];
          total: number;
          historyTotal: number;
          nextCursor: number | null;
        }>(
          `/trips/${selected}/proposals?status=pending&limit=50`,
          "GET",
          undefined,
          controller.signal,
        );
        if (
          generation !== readGeneration.current ||
          selectedRef.current !== selected
        )
          return;
        setProposals(page.items);
        setPendingTotal(page.total);
        setHistoryTotal(page.historyTotal);
        setPendingCursor(page.nextCursor);
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      throw e;
    }
  }

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      window.location.replace("/login");
      return;
    }
    if (isAuthenticated) void refresh().catch((e) => setError(e.message));
  }, [isAuthenticated, isLoading]);
  useEffect(() => {
    const resize = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    const load = () => {
      if (!document.hidden && !busy && !draggingRef.current)
        void refresh(tripId).catch((e) => setError(e.message));
    };
    const timer = setInterval(load, 5000);
    window.addEventListener("focus", load);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [tripId, busy]);
  async function act(work: () => Promise<unknown>, message = "已保存") {
    setBusy(true);
    setStatus("保存中…");
    setError("");
    try {
      await work();
      await refresh();
      setStatus(message);
    } catch (e) {
      setStatus("未保存");
      setError(e instanceof Error ? e.message : "保存失败");
      await refresh().catch(() => {});
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function mutate(
    operations: TravelOperation[],
    revision = trip?.revision,
  ) {
    if (!trip) return;
    await act(() =>
      api(`/trips/${trip.id}/operations`, "POST", {
        requestId: crypto.randomUUID(),
        expectedRevision: revision,
        operations,
      }),
    );
  }
  function open(a: TravelActivity) {
    setSelectedActivity(a.id);
    setSelectedEntity(undefined);
    setEditEnvironment(environments[a.id] ?? "unspecified");
    setEdit(structuredClone(a));
    setDraftRevision(trip?.revision ?? 0);
    setError("");
  }
  function returnPending(a: TravelActivity, revision = trip?.revision) {
    if (!trip || a.locked) return Promise.resolve();
    return mutate([{ type: "return_to_pending", ids: [a.id] }], revision);
  }

  const drag = useMultiDayEventDrag({
    onStart: () => {
      draggingRef.current = true;
      dragRevisionRef.current = trip?.revision ?? 0;
    },
    onEnd: () => {
      draggingRef.current = false;
    },
    onUnschedule: (id) => {
      const a = trip?.activities.find(
        (a) => a.id === id.replace(/^block:/, ""),
      );
      if (a) void returnPending(a, dragRevisionRef.current).catch(() => {});
    },
    onCommit: (id, start, end) => {
      if (!trip || busy) return;
      const a = trip.activities.find((a) => a.id === id.replace(/^block:/, ""));
      if (!a || a.locked) return;
      const patch = {
        date: format(start, "yyyy-MM-dd"),
        start: start.getHours() * 60 + start.getMinutes(),
        duration: Math.round((end.getTime() - start.getTime()) / 60000),
      };
      void mutate(
        [{ type: "edit", id: a.id, patch }],
        dragRevisionRef.current,
      ).catch(() => {});
    },
  });
  const allDays = trip
    ? Array.from(
        {
          length:
            Math.round(
              (Date.parse(trip.endDate) - Date.parse(trip.startDate)) /
                86400000,
            ) + 1,
        },
        (_, i) => addDays(wall(trip.startDate, 0), i),
      )
    : [];
  const days = mobile && day ? [wall(day, 0)] : allDays;
  const visibleStarts =
    trip?.activities
      .filter(
        (a) =>
          a.start !== null &&
          days.some((d) => format(d, "yyyy-MM-dd") === a.date),
      )
      .map((a) => a.start!) ?? [];
  const selection = useTripSelection(
    (trip?.id ?? "") +
      ":" +
      (trip?.revision ?? 0) +
      ":" +
      days.map((d) => format(d, "yyyy-MM-dd")).join(","),
  );
  const blocks: TimeBlock[] =
    trip?.activities
      .filter((a) => a.date && a.start !== null)
      .map((a) => ({
        id: a.id,
        userId: user?.id || "",
        taskId: null,
        title: (a.locked ? "🔒 " : "") + a.title,
        startTime: wall(a.date!, a.start!),
        endTime: new Date(
          wall(a.date!, a.start!).getTime() + a.duration * 60000,
        ),
        color:
          a.id === selectedActivity
            ? "#245ab0"
            : a.locked
              ? "#b7791f"
              : "#2f7661",
        notes: a.notes,
        createdAt: new Date(),
        updatedAt: new Date(),
      })) ?? [];
  async function sample() {
    await act(async () => {
      const t = await api<TravelTrip>("/trips", "POST", {
        title: "大同 · 慢慢走（示例）",
        startDate: "2026-10-01",
        endDate: "2026-10-03",
      });
      const rows: [
        string,
        number | null,
        number | null,
        number,
        string,
        boolean,
      ][] = [
        ["抵达大同南站", 0, 540, 30, "大同南站", true],
        ["华严寺 · 慢看辽金", 0, 630, 90, "华严寺", false],
        ["古城墙散步", 0, 870, 45, "大同古城墙", false],
        ["来一碗刀削面", 0, 1080, 60, "刀削面小馆（示例）", false],
        ["古城酒店入住", 0, 1230, 30, "古城酒店（示例）", true],
        ["睡个懒觉，留点白", 1, 600, 60, "古城酒店（示例）", false],
        ["云冈石窟", 1, 840, 150, "云冈石窟", false],
        ["善化寺", 2, 570, 90, "善化寺", false],
        ["返程 · 大同南站", 2, 1050, 30, "大同南站", true],
        ["朋友提到的小院", null, null, 60, "地点待确认", false],
        ["古城喝茶", null, null, 45, "地点待确认", false],
        ["再逛一次古城墙", null, null, 60, "大同古城墙", false],
      ];
      const operations = rows.map(
        ([title, d, start, duration, place, locked], position) => ({
          type: "add",
          activity: {
            ...empty(),
            title,
            date:
              d === null
                ? null
                : format(addDays(wall(t.startDate, 0), d), "yyyy-MM-dd"),
            start,
            duration,
            place,
            locked,
            position,
            notes: "示例安排，非真实车票、酒店订单或开放时间",
          },
        }),
      );
      await api(`/trips/${t.id}/operations`, "POST", {
        requestId: crypto.randomUUID(),
        expectedRevision: 0,
        operations,
      });
      setTripId(t.id);
      await refresh(t.id);
    }, "示例已创建");
  }
  async function futureSamples() {
    await act(async () => {
      const imported = await importFutureSamples();
      const selected = imported[0]!;
      setTripId(selected.id);
      await refresh(selected.id);
    }, "两条未来模拟样例已载入（地点与耗时未核实）");
  }
  const pending =
    trip?.activities
      .filter((a) => a.start === null)
      .sort((a, b) => a.position - b.position) || [];

  return {
    logout,
    user,
    isAuthenticated,
    isLoading,
    selectedRef,
    draggingRef,
    dragRevisionRef,
    snapshotError,
    setSnapshotError,
    snapshot,
    setSnapshot,
    issueTag,
    environments,
    editEnvironment,
    setEditEnvironment,
    selectedActivity,
    setSelectedActivity,
    routeRows,
    setRouteRows,
    selectedEntity,
    setSelectedEntity,
    pendingTotal,
    historyTotal,
    pendingCursor,
    setPendingCursor,
    chatOpen,
    setChatOpen,
    trips,
    tripId,
    setTripId,
    trip,
    setTrip,
    proposals,
    setProposals,
    error,
    setError,
    status,
    busy,
    edit,
    setEdit,
    draftRevision,
    day,
    setDay,
    mobile,
    newTrip,
    setNewTrip,
    refresh,
    act,
    mutate,
    open,
    returnPending,
    drag,
    allDays,
    days,
    visibleStarts,
    selection,
    blocks,
    sample,
    futureSamples,
    pending,
  };
}
export type TravelWorkspace = ReturnType<typeof useTravelWorkspace>;
