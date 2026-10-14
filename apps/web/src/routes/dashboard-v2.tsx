import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { travelApi } from "@/components/travel/api";
import { V2Shell, useAppearance } from "@/components/travel/v2/shell";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Button,
} from "@/components/ui";
import type { TravelTrip } from "@open-sunsama/types";
import { useIntelligenceSnapshot } from "@/components/travel/use-intelligence-snapshot";
import { ExchangeCard } from "@/components/travel/v2/exchange-card";
export default function DashboardV2() {
  const { isAuthenticated, isLoading, user } = useAuth(),
    { theme, setTheme } = useAppearance();
  const [trips, setTrips] = useState<TravelTrip[]>([]),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false),
    [create, setCreate] = useState(false),
    [busy, setBusy] = useState(false);
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Shanghai",
  });
  const recent = localStorage.getItem(`bt-recent:${user?.id}`);
  const next =
    trips
      .filter((t) => t.endDate >= today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ??
    trips.find((t) => t.id === recent) ??
    trips[0];
  useEffect(() => {
    if (!isLoading && !isAuthenticated) location.replace("/login");
    if (!isAuthenticated) return;
    const c = new AbortController();
    let generation = 0;
    const load = () => {
      const request = ++generation;
      void travelApi<TravelTrip[]>("/trips", "GET", undefined, c.signal)
        .then((t) => {
          if (!c.signal.aborted && request === generation) {
            setTrips(t);
            setLoaded(true);
            setError("");
          }
        })
        .catch((e) => {
          if (!c.signal.aborted && request === generation) setError(e.message);
        });
    };
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 15000);
    window.addEventListener("focus", load);
    return () => {
      c.abort();
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [isAuthenticated, isLoading]);
  const { data: snapshot } = useIntelligenceSnapshot(next ?? null);
  const upcoming =
    next && next.startDate > today
      ? Math.round((Date.parse(next.startDate) - Date.parse(today)) / 86400000)
      : null;
  return (
    <V2Shell theme={theme} setTheme={setTheme}>
      <main className="bt-dashboard">
        <section className="bt-hero">
          <div>
            <p>你好，{user?.name || "旅行者"}</p>
            <h1>每一段旅程，都值得好好安排。</h1>
            <p>从时间表出发，和 Brandon 一起维护你的旅行计划。</p>
          </div>
          <button className="bt-primary" onClick={() => setCreate(true)}>
            ＋ 新建旅行
          </button>
        </section>
        {error && (
          <p role="alert" className="bt-error">
            {error}
          </p>
        )}
        <section className="bt-kpis">
          <div className="bt-card bt-next">
            <small>{upcoming !== null ? "下一站" : "最近的旅行"}</small>
            <h2>
              {next?.title ?? (loaded ? "准备你的第一段旅程" : "正在读取旅行")}
            </h2>
            <p>
              {next
                ? `${next.startDate} — ${next.endDate}`
                : "创建后即可安排活动"}
            </p>
          </div>
          <div className="bt-card">
            <small>{upcoming !== null ? "距离出发" : "我的旅行"}</small>
            <h2>
              {upcoming !== null ? `${upcoming} 天` : `${trips.length} 条`}
            </h2>
            <p className="bt-muted">
              {upcoming !== null ? "按行程开始日期计算" : "真实保存的行程"}
            </p>
          </div>
          <div className="bt-card">
            <small>计划状态 · {next?.title ?? "尚无旅行"}</small>
            <h2>
              {snapshot
                ? `${snapshot.evaluation.counts.CONFLICT} 项冲突`
                : "检查尚未取得"}
            </h2>
            <p>
              {snapshot
                ? `${snapshot.evaluation.counts.WARNING} 项提醒 · ${snapshot.evaluation.counts.UNKNOWN} 项检查待资料`
                : "打开旅行后查看检查范围"}
            </p>
          </div>
        </section>
        <div className="bt-section-head">
          <h2>我的旅行</h2>
          <span className="bt-muted">{trips.length} 条行程</span>
        </div>
        <section className="bt-trip-cards">
          {trips.map((t, i) => (
            <Link
              to="/trips/$tripId"
              params={{ tripId: t.id }}
              key={t.id}
              className="bt-trip-card"
            >
              <div className="bt-trip-cover">
                {["山川与城市", "下一段故事", "慢慢旅行"][i % 3]}
              </div>
              <div className="bt-trip-info">
                <h3>{t.title}</h3>
                <p>
                  {t.startDate} — {t.endDate}
                </p>
                <p>
                  {Math.round(
                    (Date.parse(t.endDate) - Date.parse(t.startDate)) /
                      86400000,
                  ) + 1}
                  天 · {t.activities.length}个活动 ·{" "}
                  {t.activities.filter((a) => a.start === null).length}项待安排
                </p>
                <span className="bt-chip">打开时间表 →</span>
              </div>
            </Link>
          ))}
        </section>
        {loaded && !trips.length && (
          <div className="bt-card">还没有旅行，点击“新建旅行”开始。</div>
        )}
        <section className="bt-dashboard-bottom">
          <div className="bt-card">
            <small>旅行工具</small>
            <h2>让计划保持清晰</h2>
            <p className="bt-muted">门票预约 · 收藏 · 旅行记忆：未开放</p>
            <p className="bt-muted">
              当前可用：时间表、真实地点、路程、计划检查与确认式共同编辑。
            </p>
          </div>
          <ExchangeCard />
        </section>
      </main>
      <Dialog open={create} onOpenChange={setCreate}>
        <DialogContent className="bt-v2 bt-modal" data-theme={theme}>
          <DialogTitle>新建旅行</DialogTitle>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              void travelApi<TravelTrip>("/trips", "POST", {
                title: f.get("title"),
                startDate: f.get("startDate"),
                endDate: f.get("endDate"),
              })
                .then((t) => {
                  location.href = `/trips/${t.id}`;
                })
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            <label>
              名称
              <Input name="title" required />
            </label>
            <label>
              开始日期
              <Input name="startDate" type="date" required />
            </label>
            <label>
              结束日期
              <Input name="endDate" type="date" required />
            </label>
            {error && <p role="alert">{error}</p>}
            <Button disabled={busy}>创建旅行</Button>
          </form>
        </DialogContent>
      </Dialog>
    </V2Shell>
  );
}
