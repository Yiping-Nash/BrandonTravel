import { useState } from "react";
import type {
  IntelligenceSnapshot,
  InspectionInput,
  ConstraintResult,
  FactValue,
} from "@open-sunsama/types";
import { travelApi } from "./api";
import { reasonLabel, ruleName } from "./intelligence-panel";
const statuses: Record<InspectionInput["status"], string> = {
  PROVIDED: "已提供",
  NOT_QUERIED: "未查询",
  NOT_PROVIDED: "未提供",
  FAILED: "查询失败",
  STALE: "已过期",
  MISMATCH: "不匹配",
  UNSUPPORTED: "不支持／日期限制",
  WAITING_PREREQUISITE: "等待前置条件",
};
const applicable = {
  APPLICABLE: "适用",
  NOT_APPLICABLE: "不适用",
  DEFERRED: "尚未进入检查",
  UNDETERMINED: "适用性待确定",
};
const minute = (n: number) =>
  String(Math.floor(n / 60)).padStart(2, "0") +
  ":" +
  String(n % 60).padStart(2, "0");
function ResultValues({ r }: { r: ConstraintResult }) {
  if (r.rule === "OVERLAP")
    return (
      <p>
        重叠{r.details.overlapMinutes ?? "未知"}分钟
        {r.details.overlapStart !== null && r.details.overlapEnd !== null
          ? " · " +
            minute(r.details.overlapStart) +
            "–" +
            minute(r.details.overlapEnd)
          : ""}
      </p>
    );
  if (r.rule === "TRANSITION_GAP")
    return (
      <p>
        空档
        {r.details.gapSeconds === null
          ? "未知"
          : r.details.gapSeconds / 60 + "分钟"}{" "}
        · 路程
        {r.details.durationSeconds === null
          ? "未知"
          : r.details.durationSeconds / 60 + "分钟"}{" "}
        · 不足
        {r.details.shortageMinutes === null
          ? "无法判断"
          : r.details.shortageMinutes + "分钟"}
      </p>
    );
  if (r.rule === "OPENING_COVERAGE")
    return (
      <>
        <p>
          规则采用的营业解析：{r.details.parseQuality}；开放区间
          {r.details.openIntervals
            ?.map((i) => minute(i.start) + "–" + minute(i.end))
            .join("、") ?? "无法判断"}
          ；未覆盖区间
          {r.details.uncoveredIntervals
            ?.map((i) => minute(i.start) + "–" + minute(i.end))
            .join("、") ?? "无法判断"}
        </p>
        {r.details.unrecognized.map((x) => (
          <p key={x}>不支持：{x}</p>
        ))}
      </>
    );
  return (
    <p>
      预报日期{r.details.date} · 区域
      {r.details.regionName ?? r.details.regionCode ?? "未知"} · 日间
      {r.details.dayCondition ?? "未知"}／夜间
      {r.details.nightCondition ?? "未知"}（日级）
    </p>
  );
}
function FactValues({ v }: { v: FactValue | null }) {
  if (!v) return <p>供应商没有可用值，缺失或失败不作通过。</p>;
  if (v.kind === "opening_hours")
    return (
      <p>
        今日营业原文：{v.today ?? "供应商未提供"}；每周营业原文：
        {v.weekly ?? "供应商未提供"}
      </p>
    );
  if (v.kind === "route_estimate")
    return (
      <p>
        {v.mode === "driving" ? "驾车" : "步行"} · {v.distanceMeters}米 ·{" "}
        {v.durationSeconds / 60}分钟
      </p>
    );
  if (v.kind === "place")
    return (
      <p>
        {v.name} · {v.address} · 区域{v.regionCode ?? "供应商未提供"}
      </p>
    );
  return (
    <p>
      {v.regionName} ·{" "}
      {v.days
        .map(
          (d) =>
            d.date +
            " " +
            (d.dayCondition ?? "未知") +
            "/" +
            (d.nightCondition ?? "未知"),
        )
        .join("；")}
      （日级预报）
    </p>
  );
}
export function SnapshotDetails({ data }: { data: IntelligenceSnapshot }) {
  const [date, setDate] = useState(""),
    [object, setObject] = useState("");
  const dates = [
    ...new Set(
      data.activities.map((a) => a.date).filter((d): d is string => !!d),
    ),
  ];
  const traces = data.traces.filter(
    (t) =>
      (!date || t.date === date) && (!object || t.activityIds.includes(object)),
  );
  return (
    <div className="space-y-3 text-sm">
      <p>
        计划版本{data.evaluation.tripRevision} · 事实版本
        {data.evaluation.factsVersion} · 引擎{data.evaluation.engineVersion} ·
        策略{data.evaluation.policyVersion} · 投影{data.projectionVersion}
      </p>
      <p>
        评估 {data.evaluatedAt}；有效至 {data.expiresAt}
      </p>
      <p>
        活动{data.activities.length} · 已确认地点
        {
          new Set(
            data.activities.flatMap((a) => (a.entityId ? [a.entityId] : [])),
          ).size
        }{" "}
        · 连接{data.traces.filter((t) => t.rule === "TRANSITION_GAP").length} ·
        事实{data.facts.length}
      </p>
      {data.capabilities.map((c) => (
        <article key={c.rule} className="rounded border p-2">
          <b>{ruleName[c.rule]} · READY（功能已实现）</b>
          <p>需要：{c.requiredInputs.join("、")}</p>
          <p>
            检查对象{c.objects} · 已判定{c.evaluated} · 待资料{c.needsData} ·
            不适用{c.notApplicable} · 待安排{c.deferred}
          </p>
        </article>
      ))}
      <p>能力覆盖数属于当前快照范围；下方选择仅筛选轨迹列表。</p>
      <label>
        日期{" "}
        <select
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setObject("");
          }}
        >
          <option value="">全行程</option>
          {dates.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </label>
      <label className="ml-3">
        活动／相关连接{" "}
        <select value={object} onChange={(e) => setObject(e.target.value)}>
          <option value="">全部</option>
          {data.activities
            .filter((a) => !date || a.date === date)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
        </select>
      </label>
      <div className="max-h-[32rem] overflow-auto space-y-2">
        {traces.map((t) => (
          <details key={t.id} className="border rounded p-2">
            <summary>
              {ruleName[t.rule]} ·{" "}
              {t.activityIds
                .map(
                  (id) => data.activities.find((a) => a.id === id)?.title ?? id,
                )
                .join(" → ")}{" "}
              · {applicable[t.applicability]} · {t.state ?? "—"}
            </summary>
            {t.activityIds.map((id) => {
              const a = data.activities.find((a) => a.id === id);
              return (
                a && (
                  <p key={id}>
                    {a.date ?? "无日期"} · 开始
                    {a.start === null
                      ? "待安排"
                      : Math.floor(a.start / 60) +
                        ":" +
                        String(a.start % 60).padStart(2, "0")}{" "}
                    · 时长{a.duration}分钟 · {a.locked ? "固定" : "可编辑"} ·
                    环境{a.environment} · 地点{a.entityId ?? "未绑定"}
                  </p>
                )
              );
            })}
            {t.inputs.map((i, index) => (
              <p key={index}>
                {i.key}：{statuses[i.status]}
                {i.reason ? " · " + reasonLabel(i.reason) : ""}
                {i.hoursParsing?.map((h) => (
                  <span className="block" key={h.basis}>
                    {h.basis === "today" ? "今日" : "每周"}原文解析：
                    {h.parsed.quality}；
                    {h.parsed.days
                      .map(
                        (d) =>
                          "星期" +
                          d.weekdays.map((n) => "一二三四五六日"[n]).join("/") +
                          " " +
                          d.intervals
                            .map((i) => minute(i.start) + "–" + minute(i.end))
                            .join("、"),
                      )
                      .join("；")}{" "}
                    {h.parsed.unrecognized.join("；")}
                    （解析成功仍需日期、新鲜度等前置条件）
                  </span>
                ))}
              </p>
            ))}
            {t.resultIds.map((id) => {
              const r = data.evaluation.results.find((r) => r.id === id);
              return (
                r && (
                  <div key={id}>
                    <p>
                      {r.reasonCode === "OK"
                        ? t.applicability === "NOT_APPLICABLE"
                          ? "该规则不适用"
                          : "按已提供输入通过"
                        : reasonLabel(r.reasonCode)}{" "}
                      · 依据计划
                      {data.evaluation.tripRevision}/事实
                      {data.evaluation.factsVersion}
                    </p>
                    <ResultValues r={r} />
                  </div>
                )
              );
            })}
            {data.roots
              .filter((r) => r.traceIds.includes(t.id))
              .map((r) => (
                <p key={r.id}>
                  根因：{reasonLabel(r.reason)} · {r.category} · 关联
                  {r.resultIds.length}项评估
                </p>
              ))}
            {[
              ...new Set(t.inputs.flatMap((i) => i.factRefs.map((f) => f.id))),
            ].map((id) => {
              const f = data.facts.find((f) => f.id === id);
              return (
                f && (
                  <article key={id} className="p-2 bg-muted rounded">
                    <p>
                      资料 {f.kind} · {f.status} · {f.freshness} · 版本
                      {f.version} · 来源
                      {data.sources.find((s) => s.id === f.sourceRefId)
                        ?.displayName ?? "未关联来源"}
                    </p>
                    <p>
                      查询{f.retrievedAt} · 有效至{f.expiresAt} · 日期
                      {f.appliesTo.dates.join("、") || "按领域适用性判断"}
                    </p>
                    <FactValues v={f.value} />
                  </article>
                )
              );
            })}
          </details>
        ))}
      </div>
      <details>
        <summary>脱敏结构化快照（只读）</summary>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}
function RootEvidence({ data }: { data: IntelligenceSnapshot }) {
  return (
    <div className="max-h-72 overflow-y-auto space-y-2 my-2">
      {data.roots.map((root) => {
        const results = data.evaluation.results.filter((r) =>
          root.resultIds.includes(r.id),
        );
        const refs = [
          ...new Set(results.flatMap((r) => r.factRefs.map((f) => f.id))),
        ];
        return (
          <details key={root.id} className="rounded border p-2 text-sm">
            <summary>
              {reasonLabel(root.reason)} ·{" "}
              {root.activityIds
                .map(
                  (id) => data.activities.find((a) => a.id === id)?.title ?? id,
                )
                .join("、")}
            </summary>
            <p>
              关联{root.traceIds.length}次检查 · 计划
              {data.evaluation.tripRevision}／事实{data.evaluation.factsVersion}
            </p>
            {results.map((r) => (
              <ResultValues key={r.id} r={r} />
            ))}
            {refs.map((id) => {
              const f = data.facts.find((f) => f.id === id);
              return (
                f && (
                  <div key={id}>
                    <p>
                      来源
                      {data.sources.find((s) => s.id === f.sourceRefId)
                        ?.displayName ?? "未关联来源"}{" "}
                      · 查询{f.retrievedAt} · 记录版本{f.version} ·{" "}
                      {f.freshness}
                    </p>
                    <FactValues v={f.value} />
                  </div>
                )
              );
            })}
            {!refs.length && (
              <p>这项缺口尚无可引用资料；详见下方智能检查器的输入状态。</p>
            )}
          </details>
        );
      })}
    </div>
  );
}
export function IntelligenceInspector({
  data,
}: {
  data: IntelligenceSnapshot;
}) {
  return (
    <>
      <p className="my-2 text-sm">
        打开只读取已保存资料，不查询高德。按活动保留前后连接。
      </p>
      <RootEvidence data={data} />
      <details>
        <summary>开发验收 · 智能检查器</summary>
        <SnapshotDetails data={data} />
        <RuleDemo />
      </details>
    </>
  );
}
function RuleDemo() {
  const [scenes, setScenes] = useState<{ id: string; title: string }[]>([]),
    [scene, setScene] = useState("overlap"),
    [data, setData] = useState<IntelligenceSnapshot | null>(null),
    [changes, setChanges] = useState<
      Record<
        string,
        { start?: number; environment?: "indoor" | "outdoor" | "unspecified" }
      >
    >({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(id: string, draft: typeof changes = {}) {
    setBusy(true);
    setError("");
    try {
      const value = await travelApi<IntelligenceSnapshot>(
        "/intelligence-demo",
        "POST",
        {
          scene: id,
          changes: Object.entries(draft).map(([activityId, value]) => ({
            activityId,
            ...value,
          })),
        },
      );
      setData(value);
      setChanges(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "演示失败");
    } finally {
      setBusy(false);
    }
  }
  async function open() {
    if (scenes.length) return;
    try {
      setScenes(await travelApi("/intelligence-demo"));
      await load(scene);
    } catch (e) {
      setError(e instanceof Error ? e.message : "演示失败");
    }
  }
  return (
    <details
      className="my-3 border rounded p-3"
      onToggle={(e) => {
        if (e.currentTarget.open) void open();
      }}
    >
      <summary>规则演示 · 不落库沙盒</summary>
      <p>
        固定模拟时钟；模拟资料不是高德数据。草稿仅在此页面，刷新重置；不修改真实行程，不调用模型或高德。
      </p>
      <select
        aria-label="演示场景"
        disabled={busy}
        value={scene}
        onChange={(e) => {
          setScene(e.target.value);
          void load(e.target.value);
        }}
      >
        {scenes.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </select>
      <button
        className="ml-3 underline"
        disabled={busy}
        onClick={() => void load(scene)}
      >
        重置演示
      </button>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p>模拟时刻：{data.evaluatedAt}</p>
          {data.activities.map((a) => (
            <div key={a.id} className="my-2">
              <b>{a.title}</b>
              <label className="ml-2">
                开始{" "}
                <input
                  aria-label={a.title + "演示时间"}
                  type="time"
                  disabled={busy}
                  value={
                    a.start === null
                      ? ""
                      : String(Math.floor(a.start / 60)).padStart(2, "0") +
                        ":" +
                        String(a.start % 60).padStart(2, "0")
                  }
                  onChange={(e) => {
                    const parts = e.target.value.split(":").map(Number);
                    if (parts.length === 2)
                      void load(scene, {
                        ...changes,
                        [a.id]: {
                          ...changes[a.id],
                          start: parts[0]! * 60 + parts[1]!,
                        },
                      });
                  }}
                />
              </label>
              <select
                aria-label={a.title + "演示环境"}
                disabled={busy}
                value={a.environment}
                onChange={(e) =>
                  void load(scene, {
                    ...changes,
                    [a.id]: {
                      ...changes[a.id],
                      environment: e.target.value as
                        "indoor" | "outdoor" | "unspecified",
                    },
                  })
                }
              >
                <option value="unspecified">未指定</option>
                <option value="outdoor">户外</option>
                <option value="indoor">室内</option>
              </select>
            </div>
          ))}
          <SnapshotDetails data={data} />
        </>
      )}
    </details>
  );
}
