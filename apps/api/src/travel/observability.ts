/** Eval-only instrumentation. No domain authorization or retry decisions live here. */
import {
  context,
  trace,
  SpanStatusCode,
  type Attributes,
  type Span,
} from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { SemanticConventions } from "@arizeai/openinference-semantic-conventions";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const allowed = new Set([
  "id",
  "requestId",
  "eventId",
  "proposal",
  "persisted",
  "scope",
  "beforeRevision",
  "afterRevision",
  "details",
  "gapSeconds",
  "durationSeconds",
  "shortageMinutes",
  "openIntervals",
  "uncoveredIntervals",
  "parseQuality",
  "occupiedMinutes",
  "spanMinutes",
  "type",
  "ids",
  "patch",
  "operations",
  "date",
  "start",
  "duration",
  "startDate",
  "endDate",
  "backlogOriginDate",
  "reason",
  "status",
  "revision",
  "expectedRevision",
  "view",
  "activityId",
  "tripId",
  "changes",
  "title",
  "locked",
  "position",
  "fromId",
  "toId",
  "mode",
  "code",
  "retryable",
  "outcome",
  "proposalId",
  "proposalIds",
  "summary",
  "answer",
  "kind",
  "needsClarification",
  "counts",
  "rule",
  "state",
  "reasonCode",
  "results",
  "data",
  "error",
  "input",
  "output",
  "activities",
  "calendar",
  "dates",
  "weekday",
  "day",
  "evaluation",
  "tripRevision",
  "factsVersion",
  "engineVersion",
  "policyVersion",
  "conflicts",
  "VALID",
  "WARNING",
  "CONFLICT",
  "UNKNOWN",
  "expression",
  "query",
  "factRefs",
  "activityIds",
  "entityIds",
]);
export function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 100).map(sanitize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => allowed.has(k))
        .map(([k, v]) => [k, sanitize(v)]),
    );
  if (typeof value === "string")
    return value
      .replace(/(?:sk-|bt_)[\w.-]+/g, "[REDACTED]")
      .replace(/Bearer\s+\S+/gi, "[REDACTED]")
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[REDACTED]");
  return value;
}
export function evalTracingAllowed(env: NodeJS.ProcessEnv = process.env) {
  if (
    env.TRAVEL_EVAL_TRACE !== "true" ||
    env.TRAVEL_EVAL_FIXTURES !== "synthetic"
  )
    return false;
  try {
    return /^bt_eval_[a-f0-9]+$/.test(
      new URL(env.DATABASE_URL!).pathname.slice(1),
    );
  } catch {
    return false;
  }
}
let provider: NodeTracerProvider | undefined;
let exportState = "disabled";
let localWriteFailed = false;
class LocalExporter implements SpanExporter {
  export(
    spans: ReadableSpan[],
    callback: Parameters<SpanExporter["export"]>[1],
  ) {
    try {
      const dir = path.resolve(
        process.env.TRAVEL_TRACE_DIR ?? ".runtime/evals/traces",
      );
      mkdirSync(dir, { recursive: true });
      for (const s of spans)
        appendFileSync(
          path.join(dir, s.spanContext().traceId + ".jsonl"),
          JSON.stringify({
            traceId: s.spanContext().traceId,
            spanId: s.spanContext().spanId,
            parentSpanId: s.parentSpanContext?.spanId,
            name: s.name,
            startTime: s.startTime,
            endTime: s.endTime,
            status: s.status,
            attributes: s.attributes,
          }) + "\n",
        );
      callback({ code: 0 });
    } catch {
      localWriteFailed = true;
      exportState = "local-write-failed";
      callback({ code: 1 });
    }
  }
  async shutdown() {}
}
function init() {
  if (provider || !evalTracingAllowed()) return;
  const processors: SpanProcessor[] = [
    new SimpleSpanProcessor(new LocalExporter()),
  ];
  exportState = "local-only";
  let endpoint = process.env.TRAVEL_PHOENIX_ENDPOINT;
  if (endpoint) {
    try {
      const url = new URL(endpoint);
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.protocol !== "http:"
      ) {
        endpoint = undefined;
        exportState = "endpoint-rejected";
      }
    } catch {
      endpoint = undefined;
      exportState = "endpoint-rejected";
    }
  }
  if (endpoint) {
    const otlp = new OTLPTraceExporter({ url: endpoint, timeoutMillis: 1000 });
    const original = otlp.export.bind(otlp);
    otlp.export = (spans, cb) =>
      original(spans, (result) => {
        exportState = result.code === 0 ? "uploaded" : "upload-failed";
        cb(result);
      });
    processors.push(
      new BatchSpanProcessor(otlp, {
        maxQueueSize: 128,
        maxExportBatchSize: 32,
        scheduledDelayMillis: 200,
        exportTimeoutMillis: 1200,
      }),
    );
    exportState = "pending";
  }
  provider = new NodeTracerProvider({ spanProcessors: processors });
  provider.register();
}
export async function traced<T>(
  name: string,
  kind: "AGENT" | "LLM" | "TOOL" | "CHAIN",
  attributes: Attributes,
  work: (span?: Span) => Promise<T>,
): Promise<T> {
  if (!evalTracingAllowed()) return work();
  try {
    init();
  } catch {
    exportState = "setup-failed";
    return work();
  }
  return trace.getTracer("brandontravel-eval", "1").startActiveSpan(
    name,
    {
      attributes: {
        [SemanticConventions.OPENINFERENCE_SPAN_KIND]: kind,
        ...attributes,
      },
    },
    async (span) => {
      try {
        const result = await work(span);
        const outcome = result as
          { isError?: boolean; status?: string } | undefined;
        if (
          outcome?.isError ||
          ["failed", "cancelled"].includes(outcome?.status ?? "")
        )
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: outcome?.status ?? "tool_error",
          });
        return result;
      } catch (e) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: e instanceof Error ? e.name : "Error",
        });
        span.setAttribute("error.type", e instanceof Error ? e.name : "Error");
        throw e;
      } finally {
        span.end();
      }
    },
  );
}
export async function tracedTool<T>(
  name: string,
  args: unknown,
  work: () => Promise<T>,
) {
  return traced(
    name,
    "TOOL",
    { "input.value": JSON.stringify(sanitize(args)) },
    async (span) => {
      const result = await work();
      const error = (
        result as {
          structuredContent?: {
            error?: { code?: string; retryable?: boolean };
          };
        }
      )?.structuredContent?.error;
      if (error?.code)
        span?.setAttribute("tool.error_code", String(sanitize(error.code)));
      if (error?.retryable !== undefined)
        span?.setAttribute("tool.retryable", error.retryable);
      span?.setAttribute(
        "output.value",
        JSON.stringify(
          sanitize(
            (result as { structuredContent?: unknown })?.structuredContent ??
              result,
          ),
        ) ?? "null",
      );
      return result;
    },
  );
}
export async function tracedModel(
  model: string,
  round: number,
  work: () => Promise<Response>,
) {
  return traced(
    "qwen.chat.completions",
    "LLM",
    { "llm.model_name": model, "eval.round": round },
    async (span) => {
      const response = await work();
      span?.setAttribute("http.status_code", response.status);
      if (!response.ok)
        span?.setStatus({
          code: SpanStatusCode.ERROR,
          message: "provider_http_error",
        });
      try {
        const data = (await response.clone().json()) as {
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          choices?: {
            finish_reason?: string;
            message?: { tool_calls?: unknown };
          }[];
        };
        const known =
          typeof data.usage?.prompt_tokens === "number" &&
          typeof data.usage?.completion_tokens === "number";
        span?.setAttribute("usage.available", known);
        if (known) {
          span?.setAttribute(
            "llm.token_count.prompt",
            data.usage!.prompt_tokens!,
          );
          span?.setAttribute(
            "llm.token_count.completion",
            data.usage!.completion_tokens!,
          );
        }
        const calls = data.choices?.[0]?.message?.tool_calls as
          { function?: { name?: string; arguments?: string } }[] | undefined;
        if (calls)
          span?.setAttribute(
            "llm.tool_calls",
            JSON.stringify(
              calls.map((call) => {
                let args: unknown;
                try {
                  args = sanitize(JSON.parse(call.function?.arguments ?? "{}"));
                } catch {
                  args = { argumentParseError: true };
                }
                return { name: sanitize(call.function?.name), arguments: args };
              }),
            ),
          );
        if (data.choices?.[0]?.finish_reason)
          span?.setAttribute(
            "llm.finish_reason",
            data.choices[0].finish_reason,
          );
      } catch {
        span?.setAttribute("error.type", "InvalidProviderJSON");
        span?.setStatus({
          code: SpanStatusCode.ERROR,
          message: "invalid_provider_json",
        });
      }
      return response;
    },
  );
}
export async function flushTracing() {
  try {
    await provider?.forceFlush();
  } catch {
    exportState = "upload-failed";
  }
  return localWriteFailed ? "local-write-failed" : exportState;
}
export function activeTraceId() {
  return trace.getSpan(context.active())?.spanContext().traceId;
}

export async function annotateGrader(
  spanId: string,
  passed: boolean,
  scenarioId: string,
) {
  const endpoint = process.env.TRAVEL_PHOENIX_ENDPOINT;
  if (!endpoint || !evalTracingAllowed()) return "disabled";
  try {
    const url = new URL(endpoint);
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      url.protocol !== "http:"
    )
      return "endpoint-rejected";
    const { createClient } = await import("@arizeai/phoenix-client");
    const { logSpanAnnotations } =
      await import("@arizeai/phoenix-client/spans");
    const client = createClient({
      options: {
        baseUrl: new URL(endpoint).origin,
        fetch: (input: Request) =>
          fetch(input, { signal: AbortSignal.timeout(2000) }),
      },
      getEnvironmentOptions: () => ({}),
    });
    // OTLP ingestion acknowledges before SQLite makes spans queryable.
    // Annotation identifiers make these bounded observation-only retries idempotent.
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      try {
        await logSpanAnnotations({
          client,
          spanAnnotations: [
            {
              spanId,
              name: "domain_invariants",
              annotatorKind: "CODE",
              identifier: "eval-" + spanId,
              label: passed ? "PASS" : "FAIL",
              score: passed ? 1 : 0,
              metadata: { scenarioId, graderVersion: "1" },
            },
          ],
          sync: true,
        });
        return "uploaded";
      } catch {
        if (attempt === 2) return "upload-failed";
      }
    }
    return "uploaded";
  } catch {
    return "upload-failed";
  }
}
