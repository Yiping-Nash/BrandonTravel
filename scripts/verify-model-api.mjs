import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
const cfg = JSON.parse(
  readFileSync(".runtime/model-api.json", "utf8").replace(/^\uFEFF/, ""),
);
const client = new Client({
  name: "travel-model-verification",
  version: "1.0",
});
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [process.cwd() + "/mcp/build/travel-index.js"],
    env: {
      ...process.env,
      TRAVEL_KEY_FILE: process.cwd() + "/.runtime/mcp-key.json",
      TRAVEL_API_URL: "http://127.0.0.1:4332",
    },
  }),
);
const tools = (await client.listTools()).tools.map((t) => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  },
}));
const messages = [
  {
    role: "system",
    content:
      "你是旅行助手。只通过工具读取权威状态。首先 list_trips，然后 get_trip，使用当前版本和明确活动ID提出修改。提案不会直接执行，必须等待网页确认。禁止直接修改和解除固定。不要编造ID。requestId使用 " +
      randomUUID() +
      "。",
  },
  {
    role: "user",
    content:
      "找到大同三日示例，把华严寺移到第三天上午11点，保留90分钟停留时长。只提出建议，等我网页确认。",
  },
];
const evidence = {
  date: "2026-10-06",
  model: cfg.model,
  baseUrl: cfg.baseUrl,
  requests: 0,
  usage: [],
  calls: [],
  proposalId: null,
  status: "未验证",
};
try {
  for (let round = 0; round < cfg.maxRequests; round++) {
    evidence.requests++;
    const response = await fetch(cfg.baseUrl + "/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(45000),
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + cfg.apiKey,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        tools,
        tool_choice: "auto",
        enable_thinking: false,
        max_tokens: cfg.maxOutputTokens,
        stream: false,
      }),
    });
    if (!response.ok) throw Error("模型接口HTTP " + response.status);
    const completion = await response.json();
    if (completion.usage) evidence.usage.push(completion.usage);
    const msg = completion.choices?.[0]?.message;
    if (!msg) throw Error("模型没有返回消息");
    messages.push({
      role: "assistant",
      content: msg.content || null,
      ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
    });
    if (!msg.tool_calls?.length) throw Error("模型没有完成工具提案");
    for (const call of msg.tool_calls) {
      if (!tools.some((t) => t.function.name === call.function.name))
        throw Error("模型请求未授权工具");
      const input = JSON.parse(call.function.arguments);
      const result = await client.callTool({
        name: call.function.name,
        arguments: input,
      });
      evidence.calls.push({
        name: call.function.name,
        input,
        isError: !!result.isError,
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
      if (call.function.name === "propose_trip_change" && !result.isError) {
        const data = JSON.parse(result.content[0].text);
        if (data.status !== "pending") throw Error("提案状态异常");
        evidence.proposalId = data.id;
        evidence.status = "通过：真实模型经MCP提出待确认提案";
        break;
      }
    }
    if (evidence.proposalId) break;
  }
  if (!evidence.proposalId) throw Error("达到请求上限但没有成功提案");
  console.log(
    JSON.stringify({
      status: evidence.status,
      model: evidence.model,
      requests: evidence.requests,
      usage: evidence.usage,
      proposalId: evidence.proposalId,
    }),
  );
} catch (e) {
  evidence.status = "失败";
  evidence.error = e.name === "TimeoutError" ? "模型接口超时" : e.message;
  console.log(
    JSON.stringify({
      status: evidence.status,
      error: evidence.error,
      requests: evidence.requests,
    }),
  );
  process.exitCode = 1;
} finally {
  writeFileSync(
    "verification/model-api.json",
    JSON.stringify(evidence, null, 2),
  );
  await client.close();
}
