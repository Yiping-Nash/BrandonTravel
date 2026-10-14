import { useEffect, useRef, useState } from "react";
import type { TravelTrip, IntelligenceSnapshot } from "@open-sunsama/types";
import { travelApi } from "../api";
import {
  refreshDemand,
  refreshInputKey,
  attemptAllowed,
  type RefreshKind,
  type RefreshAttempt,
} from "./refresh-policy";
type Result = {
  attempted: number;
  succeeded: number;
  failed: number;
  blocked: number;
  cooldown: number;
  cache: number;
  discarded: number;
  coalesced?: number;
};
const preference = "bt-auto-facts:v2";
export function RefreshToolbar({
  trip,
  snapshot,
  disabled,
}: {
  trip: TravelTrip;
  snapshot: IntelligenceSnapshot | null;
  disabled: boolean;
}) {
  const [auto, setAuto] = useState(
      () => localStorage.getItem(preference) !== "false",
    ),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false),
    [message, setMessage] = useState("尚未更新"),
    [updated, setUpdated] = useState<string | null>(null);
  const current = useRef({ trip, snapshot, disabled, auto });
  current.current = { trip, snapshot, disabled, auto };
  const alive = useRef(true),
    running = useRef(false),
    buttonRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!buttonRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, []);
  async function refresh(kinds: RefreshKind[], manual = false) {
    const state = current.current;
    if (
      running.current ||
      state.disabled ||
      (!manual && (document.hidden || !state.auto)) ||
      !kinds.length
    )
      return;
    const dates = [
      ...new Set(
        state.trip.activities
          .filter((a) => a.start !== null && a.date)
          .map((a) => a.date!),
      ),
    ];
    if (!dates.length) {
      if (alive.current) setMessage("没有已安排活动，无需查询");
      return;
    }
    const now = Date.now();
    const selected = manual
      ? kinds
      : kinds.filter((kind) => {
          try {
            const old = JSON.parse(
              localStorage.getItem(`bt-refresh:${state.trip.id}:${kind}`) ||
                "null",
            ) as RefreshAttempt | null;
            return attemptAllowed(old, refreshInputKey(state.trip, kind), now);
          } catch {
            return true;
          }
        });
    if (!selected.length) return;
    const work = async () => {
      if (!alive.current || (!manual && document.hidden)) return;
      // Recheck after acquiring the cross-tab lock; another tab may have refreshed meanwhile.
      if (
        !manual &&
        selected.every((kind) => {
          try {
            return !attemptAllowed(
              JSON.parse(
                localStorage.getItem(`bt-refresh:${state.trip.id}:${kind}`) ||
                  "null",
              ),
              refreshInputKey(state.trip, kind),
              Date.now(),
            );
          } catch {
            return false;
          }
        })
      )
        return;
      running.current = true;
      setBusy(true);
      selected.forEach((kind) =>
        localStorage.setItem(
          `bt-refresh:${state.trip.id}:${kind}`,
          JSON.stringify({
            input: refreshInputKey(state.trip, kind),
            nextAttemptAt: Date.now() + 60000,
          }),
        ),
      );
      try {
        const result = await travelApi<Result>(
          `/trips/${state.trip.id}/intelligence/refresh`,
          "POST",
          {
            requestId: crypto.randomUUID(),
            dates,
            kinds: selected,
            force: false,
          },
        );
        const failed = result.failed + result.blocked + result.cooldown;
        const retry = failed ? 5 * 60000 : 60000;
        selected.forEach((kind) =>
          localStorage.setItem(
            `bt-refresh:${state.trip.id}:${kind}`,
            JSON.stringify({
              input: refreshInputKey(state.trip, kind),
              nextAttemptAt: Date.now() + retry,
            }),
          ),
        );
        if (alive.current) {
          setUpdated(
            new Date().toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            }),
          );
          setMessage(
            `取得${result.succeeded}项 · 缓存${result.cache}项` +
              (result.failed ? ` · 失败${result.failed}项` : "") +
              (result.cooldown ? ` · 冷却${result.cooldown}项` : "") +
              (result.blocked ? ` · 未启用${result.blocked}项` : "") +
              (result.discarded ? ` · 失配丢弃${result.discarded}项` : "") +
              (result.attempted === 0 && !result.cache
                ? " · 无可取得的新资料"
                : ""),
          );
        }
      } catch (e) {
        selected.forEach((kind) =>
          localStorage.setItem(
            `bt-refresh:${state.trip.id}:${kind}`,
            JSON.stringify({
              input: refreshInputKey(state.trip, kind),
              nextAttemptAt: Date.now() + 5 * 60000,
            }),
          ),
        );
        if (alive.current)
          setMessage(e instanceof Error ? e.message : "更新失败");
      } finally {
        window.dispatchEvent(
          new CustomEvent("travel-facts-updated", {
            detail: { tripId: state.trip.id },
          }),
        );
        running.current = false;
        if (alive.current) setBusy(false);
      }
    };
    if (navigator.locks) {
      await navigator.locks.request(
        `bt-facts:${state.trip.id}`,
        { ifAvailable: true },
        async (lock) => {
          if (lock) await work();
          else if (manual && alive.current)
            setMessage("其他页面正在更新此行程，请稍后查看结果");
        },
      );
    } else {
      const key = `bt-refresh-lease:${state.trip.id}`,
        owner = crypto.randomUUID();
      let old: { until: number } | null = null;
      try {
        old = JSON.parse(localStorage.getItem(key) || "null");
      } catch {
        /* Malformed lease is treated as absent. */
      }
      if (old && old.until > Date.now()) {
        if (manual) setMessage("其他页面正在更新此行程");
        return;
      }
      localStorage.setItem(
        key,
        JSON.stringify({ owner, until: Date.now() + 120000 }),
      );
      try {
        await work();
      } finally {
        if (JSON.parse(localStorage.getItem(key) || "null")?.owner === owner)
          localStorage.removeItem(key);
      }
    }
  }
  useEffect(() => {
    const check = () => {
      const s = current.current;
      if (!document.hidden && s.auto && !s.disabled)
        void refresh(refreshDemand(s.trip, s.snapshot));
    };
    const timer = setInterval(check, 60000),
      debounce = setTimeout(check, 1000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      clearTimeout(debounce);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [trip.id, trip.revision, snapshot, auto, disabled]);
  const choose = (kinds: RefreshKind[]) => {
    setMenu(false);
    void refresh(kinds, true);
  };
  return (
    <div className="bt-refresh-toolbar" ref={buttonRef}>
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => choose(["weather", "route_estimate"])}
        aria-label="更新全部天气与路程"
      >
        {busy ? "更新中…" : "⟳ 更新资料"}
      </button>
      <button
        type="button"
        aria-label="资料更新选项"
        aria-expanded={menu}
        onClick={() => setMenu(!menu)}
      >
        ⌄
      </button>
      {menu && (
        <div className="bt-refresh-menu" role="group" aria-label="资料更新选项">
          <button
            disabled={busy || disabled}
            onClick={() => choose(["weather"])}
          >
            仅更新天气
          </button>
          <button
            disabled={busy || disabled}
            onClick={() => choose(["route_estimate"])}
          >
            仅更新路程
          </button>
          <label>
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => {
                setAuto(e.target.checked);
                localStorage.setItem(preference, String(e.target.checked));
              }}
            />{" "}
            自动更新当前行程
          </label>
          <p>天气6小时／路程20分钟；远期趋势12小时。仅页面可见时检查。</p>
          <p role="status">
            {updated ? `最近更新 ${updated}：` : ""}
            {message}
          </p>
        </div>
      )}
    </div>
  );
}
