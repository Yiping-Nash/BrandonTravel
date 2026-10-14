import { ActivityEditor } from "@/components/travel/activity-editor";
import {
  useTravelWorkspace,
  clock,
  empty,
} from "@/components/travel/use-travel-workspace";
import { BatchEditor } from "@/components/travel/trip-selection";
import { TripRangeEditor } from "@/components/travel/trip-range-editor";
import { RefreshFactsButton } from "@/components/travel/refresh-facts-button";
import { DayWeather } from "@/components/travel/day-weather";
import { IntelligencePanel } from "@/components/travel/intelligence-panel";
import { MessageCircle } from "lucide-react";
import React from "react";
import { format } from "date-fns";
import {
  Button,
  Input,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui";
import { MultiDayView } from "@/components/calendar/multi-day-view";
import type { TravelTrip, TravelProposal } from "@open-sunsama/types";
import "./travel.css";
import "@/components/travel/travel-components.css";
import { travelApi as api } from "@/components/travel/api";
import { ProposalList } from "@/components/travel/proposal-list";
import { PendingList } from "@/components/travel/pending-list";
import { OperationalFactsPanel } from "@/components/travel/operational-facts-panel";
import { Inspection } from "@/components/travel/inspection";
import { TransitionPanel } from "@/components/travel/transition-panel";
import { ChatPanel } from "@/components/travel/chat-panel";
import { HOUR_HEIGHT } from "@/hooks/useCalendarDnd";
export default function TravelPage() {
  const workspace = useTravelWorkspace();
  const {
    logout,
    user,
    draggingRef,
    snapshotError,
    setSnapshotError,
    snapshot,
    setSnapshot,
    issueTag,
    selectedActivity,
    setSelectedActivity,
    routeRows,
    setRouteRows,
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
  } = workspace;
  return (
    <div className="travel-app" data-trip-id={trip?.id ?? ""}>
      <a href={trip ? `/trips/${trip.id}` : "/"}>返回新版</a>
      <header>
        <strong>BrandonTravel</strong>
        <span>把想去的地方，放进时间里</span>
        <Button variant="ghost" onClick={logout}>
          退出
        </Button>
      </header>
      <section className="travel-toolbar">
        <select
          aria-label="选择行程"
          value={tripId}
          onChange={(e) => {
            setTripId(e.target.value);
            setTrip(null);
            setSelectedActivity("");
            setRouteRows([]);
            void refresh(e.target.value).catch((e) => setError(e.message));
          }}
        >
          {trips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <Button disabled={busy} onClick={() => setNewTrip(true)}>
          新建行程
        </Button>
        {!trips.length && (
          <Button disabled={busy} onClick={() => void sample().catch(() => {})}>
            载入大同三日示例
          </Button>
        )}
        <Button
          disabled={busy}
          onClick={() => void futureSamples().catch(() => {})}
        >
          载入未来模拟样例
        </Button>
        <span role="status">{status}</span>
      </section>
      {error && (
        <div role="alert" className="travel-error">
          {error}
        </div>
      )}
      {trip && (
        <>
          <div className="travel-heading">
            <div>
              <h1>{trip.title}</h1>
              <TripRangeEditor
                trip={trip}
                busy={busy}
                onSave={(op) => mutate([op])}
              />
              <p>
                {trip.startDate} — {trip.endDate} · 北京时间 · 第{" "}
                {trip.revision} 版
              </p>
            </div>
            <Button
              disabled={busy}
              onClick={() =>
                open({
                  ...empty(),
                  position:
                    Math.max(0, ...trip.activities.map((a) => a.position)) + 1,
                })
              }
            >
              添加活动
            </Button>
          </div>
          <DayWeather
            tripId={trip.id}
            onOpen={(id) => {
              const a = trip.activities.find((a) => a.id === id);
              if (a) open(a);
            }}
            data={snapshot}
            dates={days.map((d) => format(d, "yyyy-MM-dd"))}
          />
          <IntelligencePanel
            trip={trip}
            onSnapshot={setSnapshot}
            onReadError={setSnapshotError}
            onOpen={(id) => {
              const a = trip.activities.find((a) => a.id === id);
              if (a) open(a);
            }}
          />
          <div className="travel-workspace">
            <aside data-pending-drop="true" aria-label="待安排拖回区域">
              <PendingList
                activities={pending}
                revision={trip.revision}
                busy={busy}
                onOpen={open}
                onReorder={(ids, revision) =>
                  mutate([{ type: "reorder_pending", ids }], revision)
                }
                onExternal={(a, e) =>
                  drag.startExternalDrag(a.id, a.duration, e)
                }
                onDragging={(v) => {
                  draggingRef.current = v;
                }}
              />
            </aside>
            <main>
              {mobile && (
                <label>
                  查看日期
                  <select value={day} onChange={(e) => setDay(e.target.value)}>
                    {allDays.map((d) => (
                      <option key={format(d, "yyyy-MM-dd")}>
                        {format(d, "yyyy-MM-dd")}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Button
                variant={selection.enabled ? "default" : "outline"}
                onClick={() => {
                  selection.clear();
                  selection.setEnabled(!selection.enabled);
                }}
              >
                {selection.enabled ? "退出选择模式" : "选择模式"}
              </Button>
              {selection.enabled && (
                <BatchEditor
                  trip={trip}
                  ids={selection.ids}
                  busy={busy}
                  onSave={(op) => mutate([op])}
                />
              )}
              <div className="my-2 space-y-1">
                {!snapshot && (
                  <p role="status">
                    {snapshotError
                      ? "连接检查读取失败：" + snapshotError
                      : "连接检查正在读取；暂不显示旧耗时"}
                  </p>
                )}
              </div>
              <div className="travel-grid" {...selection.gridProps}>
                {selection.band && (
                  <div
                    aria-hidden="true"
                    style={{
                      position: "fixed",
                      ...selection.band,
                      border: "2px solid #2563eb",
                      background: "#2563eb22",
                      pointerEvents: "none",
                      zIndex: 100,
                    }}
                  />
                )}
                <MultiDayView
                  renderDayAction={(d) => (
                    <RefreshFactsButton
                      compact
                      tripId={trip.id}
                      date={format(d, "yyyy-MM-dd")}
                      kinds={["route_estimate"]}
                      label="路程"
                      ariaLabel={format(d, "yyyy-MM-dd") + " 获取当天路程"}
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
                  timeBlocks={blocks}
                  renderBlockBadge={(b) => <small>{issueTag(b.id)}</small>}
                  drag={drag}
                  blocksEditable={!busy && !selection.enabled}
                  selectedBlockIds={selection.ids}
                  blockCanEdit={(b) =>
                    !trip.activities.find((a) => a.id === b.id)?.locked
                  }
                  renderDayOverlay={(date) =>
                    (snapshot?.evaluation.tripRevision === trip.revision
                      ? (snapshot.connections ?? [])
                      : routeRows
                          .filter(
                            (t) =>
                              trip.activities.some((a) => a.id === t.fromId) &&
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
                          <button
                            key={t.id}
                            className="travel-timeline-transition"
                            style={{
                              top: Math.min(top, bottom) + 2,
                              height: Math.max(22, Math.abs(bottom - top) - 4),
                              color:
                                t.state === "UNKNOWN"
                                  ? "#94a3b8"
                                  : (t.shortageMinutes ?? 0) > 0
                                    ? "#b94c31"
                                    : "#2f7661",
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedActivity(a.id);
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
                              {(t.shortageMinutes ?? 0) > 0
                                ? ` · 少${t.shortageMinutes}分`
                                : ""}
                            </span>
                          </button>
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
                            start: start.getHours() * 60 + start.getMinutes(),
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
              <ProposalList
                key={trip.id}
                pendingTotal={pendingTotal}
                trip={trip}
                proposals={proposals}
                historyTotal={historyTotal}
                pendingCursor={pendingCursor}
                busy={busy}
                onPendingMore={async () => {
                  if (pendingCursor === null) return;
                  const page = await api<{
                    items: TravelProposal[];
                    nextCursor: number | null;
                  }>(
                    `/trips/${trip.id}/proposals?status=pending&limit=50&cursor=${pendingCursor}`,
                  );
                  setProposals((old) => [
                    ...old,
                    ...page.items.filter(
                      (p) => !old.some((o) => o.id === p.id),
                    ),
                  ]);
                  setPendingCursor(page.nextCursor);
                }}
                onAction={async (id, action) => {
                  await act(
                    () => api(`/proposals/${id}/${action}`, "POST"),
                    action === "confirm" ? "已保存" : "已拒绝",
                  );
                }}
              />
              <div className="travel-day-list">
                <h2>活动清单</h2>
                {trip.activities
                  .filter((a) => a.start !== null)
                  .sort(
                    (a, b) =>
                      (a.date || "").localeCompare(b.date || "") ||
                      (a.start ?? 0) - (b.start ?? 0),
                  )
                  .map((a) => (
                    <div key={a.id} className="travel-activity-row">
                      <button onClick={() => open(a)}>
                        {a.date} {clock(a.start!)} · {a.locked ? "🔒 " : ""}
                        {a.title}
                        <small aria-hidden="true">{issueTag(a.id)}</small>
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || a.locked}
                        onClick={() => void returnPending(a).catch(() => {})}
                      >
                        返回待安排
                      </Button>
                    </div>
                  ))}
              </div>
            </main>
          </div>
          <TransitionPanel
            key={"map-" + trip.id}
            connections={
              snapshot?.evaluation.tripRevision === trip.revision
                ? snapshot.connections
                : undefined
            }
            preferenceKey={`travel-map:${user?.id ?? "user"}:${trip.id}`}
            trip={trip}
            selected={selectedActivity}
            onSelect={(id) => {
              setSelectedActivity(id);
              const selected = trip.activities.find((a) => a.id === id);
              if (mobile && selected?.date) setDay(selected.date);
              const block = document.querySelector(`[data-block-id="${id}"]`);
              block?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            onMutate={mutate}
            onTransitions={setRouteRows}
          />
          {!chatOpen && (
            <Button
              aria-label="打开旅行助手聊天"
              title="打开旅行助手聊天"
              aria-expanded={chatOpen}
              className="travel-chat-toggle"
              variant="outline"
              onClick={() => setChatOpen((v) => !v)}
            >
              <MessageCircle aria-hidden="true" size={24} />
            </Button>
          )}
          {chatOpen && (
            <ChatPanel
              key={"chat-" + trip.id}
              tripId={trip.id}
              title={trip.title}
              onClose={() => setChatOpen(false)}
              proposals={proposals}
              onChanged={() => {
                if (!draggingRef.current) void refresh().catch(() => {});
              }}
            />
          )}
          <OperationalFactsPanel
            key={"facts-" + trip.id}
            tripId={trip.id}
            revision={trip.revision}
          />
          <Inspection key={"inspection-" + trip.id} tripId={trip.id} />
        </>
      )}
      <footer>
        基于 Open Sunsama 改造 · 旅行安排不等于已预订 · 示例信息须自行核实
      </footer>
      <ActivityEditor state={workspace} />
      <Dialog open={newTrip} onOpenChange={setNewTrip}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建旅行</DialogTitle>
          </DialogHeader>
          <form
            className="travel-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act(async () => {
                const t = await api<TravelTrip>("/trips", "POST", {
                  title: f.get("title"),
                  startDate: f.get("startDate"),
                  endDate: f.get("endDate"),
                });
                setTripId(t.id);
                await refresh(t.id);
                setNewTrip(false);
              }).catch(() => {});
            }}
          >
            <label>
              名称
              <Input name="title" required />
            </label>
            <label>
              开始日期
              <Input type="date" name="startDate" required />
            </label>
            <label>
              结束日期
              <Input type="date" name="endDate" required />
            </label>
            <Button disabled={busy}>创建</Button>
            {error && <p role="alert">{error}</p>}
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
