import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  z,
  agentProposalSchema,
  TRAVEL_INSTRUCTIONS,
  entitySchema,
  activitySchema,
  operationSchema,
} from "@open-sunsama/utils/travel-contract";
import { readFileSync } from "node:fs";
import { defineTool } from "./lib/define-tool.js";
export function createTravelMcp(
  baseUrl: string,
  key: string,
  scopeTripId?: string,
  sessionId?: string,
  options: {
    compact?: boolean;
    onCandidates?: (
      rows: z.infer<typeof entitySchema>[],
      query: string,
    ) => void;
  } = {},
) {
  const server = new McpServer(
    { name: "brandontravel", version: "0.1.0" },
    {
      instructions: TRAVEL_INSTRUCTIONS,
    },
  );
  async function request(url: string, body?: unknown): Promise<unknown> {
    if (scopeTripId) {
      const match = url.match(/^\/trips\/([^/]+)/);
      if (match && match[1] !== scopeTripId)
        throw Error("仅允许访问当前聊天行程");
      if (url === "/trips") return [await request(`/trips/${scopeTripId}`)];
    }
    const r = await fetch(baseUrl + "/travel" + url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Travel-Key": key,
        ...(sessionId ? { "X-Travel-Session": sessionId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await r.json()) as {
      success: boolean;
      error?: { message: string };
      data: unknown;
    };
    if (!r.ok) {
      const error = new Error(
        data.error?.message || "旅行服务请求失败",
      ) as Error & { status: number };
      error.status = r.status;
      throw error;
    }
    if (
      scopeTripId &&
      url.startsWith("/proposals/") &&
      (data.data as { tripId?: string })?.tripId !== scopeTripId
    )
      throw Error("仅允许当前行程提案");
    return data.data;
  }
  const result = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: { data },
  });
  const safe = async (fn: () => Promise<unknown>) => {
    try {
      return result(await fn());
    } catch (e) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: e instanceof Error ? e.message : "工具失败",
            }),
          },
        ],
        structuredContent: {
          error: {
            code:
              e instanceof TypeError
                ? "NETWORK_ERROR"
                : ((
                    {
                      401: "UNAUTHORIZED",
                      403: "FORBIDDEN",
                      404: "NOT_FOUND",
                      409: "CONFLICT",
                      422: "VALIDATION",
                      429: "RATE_LIMITED",
                    } as Record<number, string>
                  )[(e as { status?: number })?.status ?? 0] ??
                  "TRAVEL_TOOL_ERROR"),
            message: e instanceof Error ? e.message : "工具失败",
            retryable:
              e instanceof TypeError ||
              [409, 429, 502, 503, 504].includes(
                (e as { status?: number })?.status ?? 0,
              ),
          },
        },
        isError: true,
      };
    }
  };
  const errorShape = z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  });
  const tripShape = z
    .object({
      id: z.uuid(),
      revision: z.number().int().min(0),
      title: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      timezone: z.literal("Asia/Shanghai"),
      activities: z.array(activitySchema),
      entities: z.array(entitySchema).optional(),
    })
    .passthrough();
  const proposalShape = z
    .object({
      id: z.uuid(),
      tripId: z.uuid(),
      status: z.enum(["pending", "applied", "rejected"]),
      revision: z.number().int(),
      operations: z.array(operationSchema),
    })
    .passthrough();
  const transitionShape = z
    .object({
      id: z.string(),
      fromId: z.uuid(),
      toId: z.uuid(),
      mode: z.enum(["walking", "driving"]),
      freshness: z.enum(["fresh", "stale", "unknown"]),
      shortageMinutes: z.number().nullable(),
    })
    .passthrough();
  const viewShape = z
    .object({ view: z.string(), tripId: z.uuid(), revision: z.number().int() })
    .passthrough();
  const receiptShape = z
    .object({
      id: z.uuid(),
      tripId: z.uuid(),
      revision: z.number().int(),
      status: z.enum(["pending", "applied", "rejected"]),
      changes: z.array(z.unknown()),
    })
    .passthrough();
  const candidateShape = z.object({
    candidateId: z.uuid(),
    name: z.string(),
    city: z.string(),
    address: z.string(),
    query: z.string(),
    source: z.literal("amap"),
  });
  const outputs = {
    list_trips: z.array(tripShape),
    get_recent_changes: z.object({
      tripId: z.uuid(),
      changes: z.array(z.unknown()),
    }),
    preview_restore: z
      .object({
        tripId: z.uuid(),
        revision: z.number().int(),
        operations: z.array(operationSchema),
        persisted: z.literal(false),
      })
      .passthrough(),
    find_proposal: z.object({
      tripId: z.uuid(),
      requestId: z.uuid(),
      proposal: receiptShape.nullable(),
    }),
    prepare_operational_facts: z
      .object({
        tripRevision: z.number().int(),
        factsVersion: z.number().int(),
      })
      .passthrough(),
    get_trip_context: z
      .object({ tripId: z.uuid(), scope: z.literal("current_trip") })
      .passthrough(),
    evaluate_trip: z
      .object({ tripId: z.uuid(), revision: z.number().int() })
      .passthrough(),
    preview_trip_change: z
      .object({
        tripId: z.uuid(),
        revision: z.number().int(),
        persisted: z.literal(false),
      })
      .passthrough(),
    get_trip: z.union([tripShape, viewShape]),
    propose_trip_change: z.union([proposalShape, receiptShape]),
    get_proposal: z.union([proposalShape, receiptShape]),
    search_places: z.union([z.array(entitySchema), z.array(candidateShape)]),
    resolve_trip_date: z.object({
      expression: z.string(),
      matches: z.array(
        z.object({
          date: z.string(),
          weekday: z.string(),
          day: z.number().int(),
        }),
      ),
      needsClarification: z.boolean(),
    }),
    get_transitions: z.array(transitionShape),
    refresh_transitions: z.array(transitionShape),
  };
  const register = defineTool as unknown as (
    server: McpServer,
    name: string,
    description: string,
    schema: unknown,
    handler: unknown,
    output: unknown,
  ) => void;
  const tool = (
    srv: McpServer,
    name: keyof typeof outputs,
    description: string,
    schema: unknown,
    handler: unknown,
  ) =>
    register(srv, name, description, schema, handler, {
      data: outputs[name].optional(),
      error: errorShape.optional(),
    });
  tool(server, "list_trips", "读取自己的旅行列表，不修改行程。", {}, () =>
    safe(() => request("/trips")),
  );
  tool(
    server,
    "get_trip",
    "读取最新权威行程、版本和活动身份。",
    {
      tripId: z.uuid(),
      view: z
        .enum(["snapshot", "overview", "day", "activity"])
        .optional()
        .describe(
          "overview含日期表和范围，修改行程范围通常只需它；day必须同时提供date；activity必须同时提供activityId。query不能替代这两个必填条件。",
        ),
      date: z.string().optional().describe("day视图必填：日期表中的YYYY-MM-DD"),
      activityId: z
        .uuid()
        .optional()
        .describe("activity视图必填：已读取的稳定活动ID"),
      query: z.string().max(4000).optional(),
      cursor: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(30).optional(),
    },
    ({
      tripId,
      ...input
    }: {
      tripId: string;
      view?: string;
      date?: string;
      activityId?: string;
      query?: string;
      cursor?: number;
      limit?: number;
    }) =>
      safe(() => {
        const view = input.view ?? (options.compact ? "overview" : "snapshot");
        const params = new URLSearchParams(
          Object.entries({ ...input, view })
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, String(value)] as [string, string]),
        );
        return request(
          view === "snapshot"
            ? `/trips/${tripId}`
            : `/trips/${tripId}/agent?${params}`,
        );
      }),
  );
  tool(
    server,
    "propose_trip_change",
    "保存修改提案，行程保持原样，必须由用户在网页确认。使用刚读取的版本和明确活动 ID；时间为当地午夜后的分钟，保留时长。",
    { tripId: z.uuid(), ...agentProposalSchema.shape },
    ({
      tripId,
      ...input
    }: { tripId: string } & z.infer<typeof agentProposalSchema>) =>
      safe(async () => {
        const proposal = (await request(
          `/trips/${tripId}/proposals`,
          input,
        )) as { id: string };
        return options.compact
          ? request(`/proposals/${proposal.id}/agent`)
          : proposal;
      }),
  );
  tool(
    server,
    "search_places",
    "搜索高德候选地点，调用外部高德服务并消耗额度；用户须选择后才能绑定，不自动猜城市。",
    { query: z.string().min(1), city: z.string().min(1) },
    ({ query, city }: { query: string; city: string }) =>
      safe(async () => {
        const rows = (await request(
          `/places/search?${new URLSearchParams({ query, city })}`,
        )) as z.infer<typeof entitySchema>[];
        options.onCandidates?.(rows, query);
        return options.compact
          ? rows.slice(0, 3).map((e) => ({
              candidateId: e.id,
              name: e.name,
              city: e.city,
              address: e.address,
              query,
              source: "amap" as const,
            }))
          : rows;
      }),
  );
  tool(
    server,
    "get_transitions",
    "读取同日相邻活动路程、估计来源/时间和可行性；未知不能当零。",
    { tripId: z.uuid(), date: z.string().optional() },
    ({ tripId, date }: { tripId: string; date?: string }) =>
      safe(async () => {
        const rows = (await request(`/trips/${tripId}/transitions`)) as {
          date: string;
        }[];
        return date ? rows.filter((r) => r.date === date) : rows;
      }),
  );
  tool(
    server,
    "refresh_transitions",
    "查询当前连接的高德路程，可能消耗额度并更新估计缓存，不增加计划revision。15分钟缓存，失败显示未知。",
    { tripId: z.uuid() },
    ({ tripId }: { tripId: string }) =>
      safe(() =>
        request(`/trips/${tripId}/transitions/refresh`, { force: false }),
      ),
  );
  tool(
    server,
    "get_proposal",
    "查询提案状态；只有 applied 才代表网页确认并保存成功。",
    { proposalId: z.uuid() },
    ({ proposalId }: { proposalId: string }) =>
      safe(() =>
        request(`/proposals/${proposalId}${options.compact ? "/agent" : ""}`),
      ),
  );
  tool(
    server,
    "resolve_trip_date",
    "根据行程时区解析明确日期、星期或第几天。多结果必须澄清，不用模型推算星期。",
    { tripId: z.uuid(), expression: z.string().min(1).max(100) },
    ({ tripId, expression }: { tripId: string; expression: string }) =>
      safe(() =>
        request(
          `/trips/${tripId}/agent?${new URLSearchParams({ view: "date", expression })}`,
        ),
      ),
  );
  tool(
    server,
    "evaluate_trip",
    "纯读当前计划的营业、路程、天气评估和来源；UNKNOWN不是通过。按日读取；不查询供应商，不写计划。",
    {
      tripId: z.uuid(),
      date: z
        .string()
        .optional()
        .describe("按天读取；与activityId互斥，不能同时提供"),
      activityId: z.uuid().optional().describe("按活动读取；与date互斥"),
    },
    ({
      tripId,
      ...filter
    }: {
      tripId: string;
      date?: string;
      activityId?: string;
    }) =>
      safe(() =>
        request(
          `/trips/${tripId}/planning-context?${new URLSearchParams(filter)}`,
        ),
      ),
  );
  tool(
    server,
    "preview_trip_change",
    "只计算候选安排，不创建提案、不修改计划、不查询供应商。先检查营业/路程，缺新连接资料须明确UNKNOWN，不能声称可行。",
    {
      tripId: z.uuid(),
      ...agentProposalSchema.omit({ reason: true, dateConstraints: true })
        .shape,
    },
    ({ tripId, ...input }: { tripId: string } & Record<string, unknown>) =>
      safe(() => request(`/trips/${tripId}/plan-preview`, input)),
  );
  tool(
    server,
    "prepare_operational_facts",
    "按需获取单日运营资料，可能消耗供应商额度并更新Facts，不改计划版本；最多2种资料/3个地点，缓存/冷却不可强制绕过。失败仍未知，查询后evaluate_trip读回。",
    {
      tripId: z.uuid(),
      requestId: z.uuid(),
      date: z.string(),
      kinds: z
        .array(z.enum(["place", "opening_hours", "route_estimate", "weather"]))
        .min(1)
        .max(2),
      entityIds: z.array(z.uuid()).min(1).max(3).optional(),
    },
    ({ tripId, ...input }: { tripId: string } & Record<string, unknown>) =>
      safe(() => request(`/trips/${tripId}/prepare-operational-facts`, input)),
  );
  tool(
    server,
    "get_trip_context",
    "读取当前行程最多20个用户回合原话和来源；仅本行程，不是永久记忆，不把聊天当权威计划。",
    { tripId: z.uuid() },
    ({ tripId }: { tripId: string }) =>
      safe(() => request(`/trips/${tripId}/trip-context`)),
  );
  tool(
    server,
    "get_recent_changes",
    "只读最近10条实际操作历史；恢复只针对用户指定活动，不整体回滚。",
    { tripId: z.uuid() },
    ({ tripId }: { tripId: string }) =>
      safe(() => request(`/trips/${tripId}/recent-changes`)),
  );
  tool(
    server,
    "preview_restore",
    "依据历史生成安全的日期/开始时间逆操作，不保存；后续目标字段已变则冲突。保留新增和其他字段，之后仍需提案及用户确认。",
    {
      tripId: z.uuid(),
      eventId: z.uuid(),
      activityId: z.uuid(),
      expectedRevision: z.number().int(),
    },
    ({ tripId, ...input }: { tripId: string } & Record<string, unknown>) =>
      safe(() => request(`/trips/${tripId}/restore-preview`, input)),
  );
  tool(
    server,
    "find_proposal",
    "网络失败先按宿主请求ID读回是否已保存提案，避免盲目重复写。null代表未找到；applied代表用户已确认。",
    { tripId: z.uuid(), requestId: z.uuid() },
    ({ tripId, requestId }: { tripId: string; requestId: string }) =>
      safe(() => request(`/trips/${tripId}/proposal-request/${requestId}`)),
  );
  return server;
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("travel-index.js")) {
  const keyFile = process.env.TRAVEL_KEY_FILE;
  if (!keyFile) throw Error("TRAVEL_KEY_FILE is required");
  const { travelKey } = JSON.parse(
    readFileSync(keyFile, "utf8").replace(/^\uFEFF/, ""),
  ) as { travelKey?: string };
  if (!travelKey) throw Error("Local travel credential missing");
  await createTravelMcp(
    process.env.TRAVEL_API_URL || "http://127.0.0.1:4332",
    travelKey,
  ).connect(new StdioServerTransport());
}
