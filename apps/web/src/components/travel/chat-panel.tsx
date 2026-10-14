import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import type { TravelChatRun, TravelProposal } from "@open-sunsama/types";
import { travelApi } from "./api";
export function ChatPanel({
  tripId,
  title,
  proposals,
  onChanged,
  onClose,
  heading = "与旅行助手对话",
}: {
  heading?: string;
  tripId: string;
  title: string;
  proposals: TravelProposal[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<TravelChatRun[]>([]),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [sending, setSending] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>();
  const mounted = useRef(true);
  const pending = runs.find((r) => r.status === "running");
  useEffect(() => {
    mounted.current = true;
    setRuns([]);
    setError("");
    let previous = "";
    let generation = 0;
    const controller = new AbortController();
    const load = async () => {
      const request = ++generation;
      try {
        const data = await travelApi<TravelChatRun[]>(`/trips/${tripId}/chat`);
        if (
          !mounted.current ||
          controller.signal.aborted ||
          request !== generation
        )
          return;
        setRuns(data);
        const state = data
          .map((r) => r.status + ":" + r.events.length)
          .join("|");
        if (previous && previous !== state) onChanged();
        previous = state;
      } catch (e) {
        if (
          mounted.current &&
          !controller.signal.aborted &&
          request === generation
        )
          setError(e instanceof Error ? e.message : "读取失败");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 1500);
    return () => {
      mounted.current = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [tripId]);
  async function send() {
    if (!message.trim()) return;
    setSending(true);
    setError("");
    try {
      const run = await travelApi<TravelChatRun>(
        `/trips/${tripId}/chat`,
        "POST",
        { requestId: crypto.randomUUID(), message, selectedCandidateId },
      );
      setRuns((r) => [...r, run]);
      setMessage("");
      setSelectedCandidateId(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送失败");
    } finally {
      setSending(false);
    }
  }
  return (
    <section className="travel-chat">
      <div className="travel-chat-heading">
        <h2>{heading}</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          关闭
        </Button>
        <span>MCP · {title}</span>
      </div>
      <p>
        助手先读当前行程，修改会生成提案。每条最多6轮、90秒；点击发送才调用模型。
      </p>
      <div className="travel-chat-history" aria-live="polite">
        {!runs.length && (
          <div className="travel-empty">
            试试“检查第三天路程是否来得及”或“将华严寺改到下午两点”。
          </div>
        )}
        {runs.map((r) => (
          <article key={r.id}>
            <div className="travel-chat-user">{r.message}</div>
            {!r.outcome && r.status !== "running" && (
              <p className="travel-error">
                历史回复未经过结果验证，以提案记录和当前行程为准。
              </p>
            )}
            {r.events.map((e, i) =>
              e.kind === "tool" ? (
                <details key={i} className="travel-tool">
                  <summary>
                    MCP · {e.name} ·{" "}
                    {e.status === "done"
                      ? "完成"
                      : e.status === "failed"
                        ? "失败"
                        : "调用中"}
                  </summary>
                  <pre>{e.text}</pre>
                  {e.proposalId && (
                    <p>
                      提案：
                      {e.proposalStatus ??
                        proposals.find((p) => p.id === e.proposalId)?.status ??
                        "待刷新"}
                      {(e.proposalStatus ??
                        proposals.find((p) => p.id === e.proposalId)
                          ?.status) === "pending"
                        ? "；请在待处理建议区确认。"
                        : "；已处理，请查看历史记录。"}
                    </p>
                  )}
                </details>
              ) : (
                <p
                  className={
                    e.kind === "error" ? "travel-error" : "travel-chat-answer"
                  }
                  key={i}
                >
                  {e.kind === "answer" && r.outcome === "proposal_created"
                    ? "生成时的提案摘要：\n"
                    : e.kind === "control"
                      ? "执行校验："
                      : ""}
                  {e.text}
                </p>
              ),
            )}
            {!!r.candidates?.length && (
              <div className="travel-chat-candidates">
                {r.candidates.slice(0, 3).map((c) => (
                  <Button
                    key={c.candidateId}
                    size="sm"
                    variant="outline"
                    disabled={!!pending}
                    onClick={() => {
                      setSelectedCandidateId(c.candidateId);
                      setMessage(`我选择${c.name}，请安排到`);
                    }}
                  >
                    选择 {c.name}
                  </Button>
                ))}
              </div>
            )}
            {!!r.diagnostics?.length && (
              <details className="travel-tool">
                <summary>执行诊断（{r.diagnostics.length}轮）</summary>
                <pre>{JSON.stringify(r.diagnostics, null, 2)}</pre>
              </details>
            )}
            <small>
              {r.outcome ?? r.status} · 模型{r.requests}次 · 输入{r.inputTokens}
              /输出
              {r.outputTokens} tokens
            </small>
            {r.status === "running" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void travelApi(
                    `/trips/${tripId}/chat/${r.id}/stop`,
                    "POST",
                  ).catch((e) => setError(e.message))
                }
              >
                停止本条
              </Button>
            )}
          </article>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="对旅行助手说"
          value={message}
          maxLength={4000}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="描述你的需求，修改仍由你确认…"
        />
        <Button
          disabled={sending || !!pending || !message.trim()}
          type="submit"
        >
          {sending ? "发送中…" : "发送"}
        </Button>
      </form>
    </section>
  );
}
