import { useRouterState } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { format, addDays } from "date-fns";
import {
  useTravelWorkspace,
  empty,
  wall,
} from "@/components/travel/use-travel-workspace";
import { useIntelligenceSnapshot } from "@/components/travel/use-intelligence-snapshot";
import { V2Shell, useAppearance } from "@/components/travel/v2/shell";
import { WeatherHeader } from "@/components/travel/v2/weather-header";
import { createPortal } from "react-dom";
import { PlanTray } from "@/components/travel/v2/plan-tray";
import {
  CalendarDensity,
  useCalendarGeometry,
} from "@/components/calendar/calendar-geometry";
import { MultiDayView } from "@/components/calendar/multi-day-view";
import { PendingList } from "@/components/travel/pending-list";
import { BatchEditor } from "@/components/travel/trip-selection";
import { TripRangeEditor } from "@/components/travel/trip-range-editor";
import { ActivityEditor } from "@/components/travel/activity-editor";
import { ChatPanel } from "@/components/travel/chat-panel";
import { WorkspaceProposals } from "@/components/travel/workspace-proposals";
import { RefreshToolbar } from "@/components/travel/v2/refresh-toolbar";
import { useCalendarNavigation } from "@/components/travel/v2/use-calendar-navigation";
import { OperationalFactsPanel } from "@/components/travel/operational-facts-panel";
import { TransitionPanel } from "@/components/travel/transition-panel";
import "@/components/travel/travel-components.css";
export default function TripV2() {
  const [height, setHeight] = useState(64);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const id = path.split("/")[2] ?? "";
  return (
    <CalendarDensity.Provider value={height}>
      <TripWorkspace key={id} id={id} height={height} setHeight={setHeight} />
    </CalendarDensity.Provider>
  );
}
function TripWorkspace({
  id,
  height,
  setHeight,
}: {
  id: string;
  height: number;
  setHeight: (n: number) => void;
}) {
  const state = useTravelWorkspace(id);
  const { theme, setTheme } = useAppearance();
  const {
    trip,
    tripId,
    allDays,
    day,
    setDay: setRequestedDay,
    mobile,
    pending,
    busy,
    open,
    mutate,
    drag,
    draggingRef,
    selection,
    blocks,
    error,
    status,
    edit,
    chatOpen,
    setChatOpen,
    proposals,
    refresh,
    setSelectedActivity,
    routeRows,
  } = state;
  const { data: snapshot, error: snapshotError } =
    useIntelligenceSnapshot(trip);
  const { HOUR_HEIGHT } = useCalendarGeometry();
  const [focused, setFocused] = useState<string[]>([]);
  const [mapFocus, setMapFocus] = useState<{
    activityId: string;
    nonce: number;
  }>();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const days = trip
    ? Array.from(
        { length: Math.max(7, Math.ceil(allDays.length / 7) * 7) },
        (_, i) => addDays(wall(trip.startDate, 0), i),
      )
    : [];
  const calendar = useCalendarNavigation(
    days,
    day,
    mobile ? 4 : 7,
    selection.enabled || !!drag.dragState,
  );
  const setDay = (value: string) => {
    setRequestedDay(value);
    calendar.scrollToDate(value);
  };
  const visibleStarts =
    trip?.activities
      .filter(
        (a) =>
          a.start !== null &&
          days.some((d) => format(d, "yyyy-MM-dd") === a.date),
      )
      .map((a) => a.start!) ?? [];
  useEffect(() => {
    if (trip) localStorage.setItem(`bt-recent:${state.user?.id}`, trip.id);
  }, [trip?.id]);
  useEffect(() => {
    selection.clear();
  }, [trip?.revision, day]);
  useEffect(() => {
    setFocused([]);
  }, [trip?.revision]);
  function locate(ids: string[]) {
    const a = trip?.activities.find((a) => ids.includes(a.id) && a.date);
    if (a?.date) setDay(a.date);
    setFocused(ids);
    setSelectedActivity(ids[0] ?? "");
  }
  useEffect(() => {
    if (!focused.length) return;
    const timer = setTimeout(() => {
      const element = workspaceRef.current?.querySelector(
        `[data-block-id="${focused[0]}"]`,
      );
      element?.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
    }, 100);
    return () => clearTimeout(timer);
  }, [focused, day]);
  useEffect(() => {
    const guard = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      if (
        edit &&
        a &&
        a.href !== location.href &&
        !window.confirm("关闭活动详情并放弃未保存修改？")
      )
        e.preventDefault();
    };
    document.addEventListener("click", guard, true);
    return () => document.removeEventListener("click", guard, true);
  }, [edit]);
  return (
    <V2Shell
      theme={theme}
      setTheme={setTheme}
      tripId={tripId || id}
      onChat={() => setChatOpen(!chatOpen)}
    >
      <div
        className={"bt-workspace" + (chatOpen ? " bt-chat-open" : "")}
        ref={workspaceRef}
        data-trip-id={trip?.id ?? ""}
      >
        <div className="bt-title-row">
          <h1>{trip?.title ?? "正在读取旅行…"}</h1>
          <div className="bt-tabs">
            <strong>行程</strong>
            <span>出发准备 · 未开放</span>
            <span>旅行记忆 · 未开放</span>
          </div>
        </div>
        {error && (
          <p className="bt-error" role="alert">
            {error}
          </p>
        )}
        <p className="bt-status" role="status">
          {status}
        </p>
        {trip && (
          <>
            <div className="bt-workspace-layout">
              <aside className="bt-backlog" data-pending-drop>
                <h2>
                  待安排 <small>{pending.length}项</small>
                </h2>
                <p className="bt-muted">保留活动与原日期分组</p>
                <PendingList
                  activities={pending}
                  revision={trip.revision}
                  busy={busy}
                  onOpen={open}
                  onReorder={(ids, r) =>
                    mutate([{ type: "reorder_pending", ids }], r)
                  }
                  onExternal={(a, e) =>
                    drag.startExternalDrag(a.id, a.duration, e)
                  }
                  onDragging={(v) => {
                    draggingRef.current = v;
                  }}
                />
              </aside>
              <main style={{ minWidth: 0 }}>
                <div className="bt-toolbar">
                  <strong>
                    行程日期 {trip.startDate} — {trip.endDate}
                  </strong>
                  <TripRangeEditor
                    trip={trip}
                    busy={busy}
                    onSave={(op) => mutate([op])}
                    v2
                    theme={theme}
                  />
                </div>
                <PlanTray
                  trip={trip}
                  data={snapshot}
                  error={snapshotError}
                  onLocate={locate}
                  onEdit={(id) => {
                    const a = trip.activities.find((a) => a.id === id);
                    if (a) open(a);
                  }}
                />
                <div className="bt-toolbar">
                  <button
                    aria-label="上一组日期"
                    onClick={() =>
                      setDay(
                        format(
                          addDays(wall(day, 0), -(mobile ? 4 : 7)),
                          "yyyy-MM-dd",
                        ) < trip.startDate
                          ? trip.startDate
                          : format(
                              addDays(wall(day, 0), -(mobile ? 4 : 7)),
                              "yyyy-MM-dd",
                            ),
                      )
                    }
                  >
                    ‹
                  </button>
                  <select
                    aria-label="查看日期"
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                  >
                    {allDays.map((d) => (
                      <option key={d.toISOString()}>
                        {format(d, "yyyy-MM-dd")}
                      </option>
                    ))}
                  </select>
                  <button
                    aria-label="下一组日期"
                    onClick={() =>
                      setDay(
                        format(
                          addDays(wall(day, 0), mobile ? 4 : 7),
                          "yyyy-MM-dd",
                        ) > trip.endDate
                          ? trip.endDate
                          : format(
                              addDays(wall(day, 0), mobile ? 4 : 7),
                              "yyyy-MM-dd",
                            ),
                      )
                    }
                  >
                    ›
                  </button>
                  <span className="bt-view-label">周时间表</span>
                  <button
                    onClick={() => {
                      const d = format(new Date(), "yyyy-MM-dd");
                      setDay(
                        d < trip.startDate
                          ? trip.startDate
                          : d > trip.endDate
                            ? trip.endDate
                            : d,
                      );
                    }}
                  >
                    今天
                  </button>
                  <button
                    aria-label="降低时间密度"
                    disabled={height <= 48 || !!drag.dragState}
                    onClick={() => setHeight(height - 16)}
                  >
                    －
                  </button>
                  <span>{height}px／小时</span>
                  <button
                    aria-label="增加时间密度"
                    disabled={height >= 96 || !!drag.dragState}
                    onClick={() => setHeight(height + 16)}
                  >
                    ＋
                  </button>
                  <button
                    onClick={() => {
                      selection.clear();
                      selection.setEnabled(!selection.enabled);
                    }}
                  >
                    {selection.enabled ? "退出选择模式" : "选择模式"}
                  </button>
                  <RefreshToolbar
                    trip={trip}
                    snapshot={snapshot}
                    disabled={busy || !!edit}
                  />
                  <button onClick={() => open({ ...empty(), date: day })}>
                    ＋ 活动
                  </button>
                </div>
                {selection.enabled && (
                  <BatchEditor
                    v2
                    theme={theme}
                    trip={trip}
                    ids={selection.ids}
                    busy={busy}
                    onSave={(op) => mutate([op])}
                  />
                )}{" "}
                <div
                  className="bt-calendar"
                  data-calendar-horizontal
                  ref={calendar.ref}
                  {...selection.gridProps}
                  {...calendar.panProps}
                >
                  {selection.band &&
                    createPortal(
                      <div
                        data-selection-band
                        aria-hidden="true"
                        style={{
                          position: "fixed",
                          ...selection.band,
                          border: "2px solid #2563eb",
                          background: "#2563eb22",
                          pointerEvents: "none",
                          zIndex: 100,
                        }}
                      />,
                      document.body,
                    )}
                  <div
                    className="bt-calendar-content"
                    style={{ width: calendar.contentWidth }}
                  >
                    <MultiDayView
                      replaceDayHeader
                      horizontalOffset={calendar.offset}
                      renderDayHeader={(d) => (
                        <WeatherHeader
                          theme={theme}
                          date={format(d, "yyyy-MM-dd")}
                          snapshot={snapshot}
                          entities={trip.entities ?? []}
                        />
                      )}
                      initialScrollMinute={
                        visibleStarts.length
                          ? Math.max(0, Math.min(...visibleStarts) - 60)
                          : 0
                      }
                      scrollAnchorKey={[
                        trip.id,
                        ...days.map((d) => format(d, "yyyy-MM-dd")),
                        String(visibleStarts.length > 0),
                      ].join(":")}
                      days={days}
                      calendarEvents={[]}
                      timeBlocks={blocks.map((b) => ({
                        ...b,
                        color: trip.activities.find((a) => a.id === b.id)
                          ?.locked
                          ? "#b7791f"
                          : theme === "teal"
                            ? "#39816b"
                            : theme === "blue"
                              ? "#548bc1"
                              : "#c97745",
                      }))}
                      renderBlockBadge={(b) => (
                        <small>
                          {snapshot?.evaluation.results.some(
                            (r) =>
                              r.activityIds.includes(b.id) &&
                              r.state === "CONFLICT",
                          )
                            ? " · 冲突"
                            : ""}
                        </small>
                      )}
                      drag={drag}
                      blocksEditable={!busy && !selection.enabled}
                      selectedBlockIds={[...selection.ids, ...focused]}
                      blockCanEdit={(b) =>
                        !trip.activities.find((a) => a.id === b.id)?.locked
                      }
                      renderDayOverlay={(date) =>
                        (snapshot?.evaluation.tripRevision === trip.revision
                          ? (snapshot.connections ?? [])
                          : routeRows
                              .filter(
                                (t) =>
                                  trip.activities.some(
                                    (a) => a.id === t.fromId,
                                  ) &&
                                  trip.activities.some((a) => a.id === t.toId),
                              )
                              .map((t) => ({
                                ...t,
                                state: "UNKNOWN",
                                durationSeconds: null,
                                reasonCode: "SNAPSHOT_LOADING",
                                shortageMinutes: null,
                              }))
                        )
                          .filter((t) => t.date === format(date, "yyyy-MM-dd"))
                          .map((t) => {
                            const a = trip.activities.find(
                                (a) => a.id === t.fromId,
                              )!,
                              b = trip.activities.find((a) => a.id === t.toId)!;
                            const top =
                                ((a.start! + a.duration) * HOUR_HEIGHT) / 60,
                              bottom = (b.start! * HOUR_HEIGHT) / 60;
                            return (
                              <div
                                key={t.id}
                                className="bt-transition-decoration"
                                style={{
                                  top: Math.min(top, bottom) + 2,
                                  height: Math.max(
                                    22,
                                    Math.abs(bottom - top) - 4,
                                  ),
                                  pointerEvents: "none",
                                }}
                              >
                                <button
                                  className="travel-timeline-transition"
                                  style={{
                                    position: "relative",
                                    top: 0,
                                    height: "auto",
                                    pointerEvents: "auto",
                                    color:
                                      t.state === "UNKNOWN"
                                        ? "#94a3b8"
                                        : (t.shortageMinutes ?? 0) > 0
                                          ? "#b94c31"
                                          : "#2f7661",
                                  }}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedActivity(a.id);
                                    setFocused([a.id, b.id]);
                                    setMapFocus({
                                      activityId: a.id,
                                      nonce: Date.now(),
                                    });
                                    document
                                      .querySelector(".travel-route-panel")
                                      ?.scrollIntoView({
                                        behavior: "smooth",
                                        block: "center",
                                      });
                                  }}
                                  title={`${a.title} → ${b.title}`}
                                >
                                  <span>
                                    ↳ {t.mode === "walking" ? "步行" : "驾车"} ·{" "}
                                    {t.durationSeconds !== null
                                      ? `约${Math.ceil(t.durationSeconds! / 60)}分钟`
                                      : t.reasonCode === "FACT_STALE"
                                        ? "路程未知（估计已过期）"
                                        : t.reasonCode === "FACT_MISSING"
                                          ? "路程未查询"
                                          : t.reasonCode === "SNAPSHOT_LOADING"
                                            ? "检查读取中"
                                            : "路程未知"}
                                    {"gapSeconds" in t && t.gapSeconds !== null
                                      ? ` · 空档${Math.round(t.gapSeconds / 60)}分`
                                      : ""}
                                    {t.state !== "UNKNOWN" &&
                                    "distanceMeters" in t &&
                                    t.distanceMeters !== null
                                      ? ` · ${(t.distanceMeters / 1000).toFixed(1)}km`
                                      : ""}
                                    {(t.shortageMinutes ?? 0) > 0
                                      ? ` · 少${t.shortageMinutes}分`
                                      : ""}
                                  </span>
                                </button>
                              </div>
                            );
                          })
                      }
                      onBlockClick={(b) => {
                        const a = trip.activities.find((a) => a.id === b.id);
                        if (a) {
                          if (selection.enabled) selection.toggle(a.id);
                          else open(a);
                        }
                      }}
                      onTimeSlotClick={
                        selection.enabled
                          ? undefined
                          : (date, start, end) =>
                              open({
                                ...empty(),
                                date: format(date, "yyyy-MM-dd"),
                                start:
                                  start.getHours() * 60 + start.getMinutes(),
                                duration: Math.round(
                                  (end.getTime() - start.getTime()) / 60000,
                                ),
                                position:
                                  Math.max(
                                    0,
                                    ...trip.activities.map((a) => a.position),
                                  ) + 1,
                              })
                      }
                    />
                  </div>
                </div>
                <WorkspaceProposals state={state} />
              </main>
            </div>
            <div className="bt-map">
              <TransitionPanel
                trip={trip}
                selected={state.selectedActivity}
                focusRequest={mapFocus}
                connections={snapshot?.connections}
                preferenceKey={`v2-map:${trip.id}`}
                mapPreferenceKey={`v2-map-mode:${state.user?.id ?? "session"}`}
                onSelect={(id) => locate([id])}
                onMutate={mutate}
                onTransitions={state.setRouteRows}
              />
            </div>
            <details className="bt-details">
              <summary>现实资料与来源</summary>
              <OperationalFactsPanel
                tripId={trip.id}
                revision={trip.revision}
              />
            </details>
            {chatOpen && (
              <aside className="bt-assistant" aria-label="Brandon助手">
                <ChatPanel
                  heading="Brandon · 旅行协作助手"
                  key={trip.id}
                  tripId={trip.id}
                  title={trip.title}
                  proposals={proposals}
                  onChanged={() => {
                    void refresh().catch(() => {});
                    window.dispatchEvent(new Event("travel-facts-updated"));
                  }}
                  onClose={() => setChatOpen(false)}
                />
              </aside>
            )}
          </>
        )}
        <ActivityEditor state={state} v2 theme={theme} />
      </div>
    </V2Shell>
  );
}
