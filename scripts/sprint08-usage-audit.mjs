import { readFileSync, writeFileSync } from "node:fs";
const cfg = JSON.parse(readFileSync(".runtime/config.json", "utf8")),
  evidence = JSON.parse(
    readFileSync("verification/sprint08-live.json", "utf8"),
  );
const postgres = (
  await import("../apps/api/node_modules/postgres/src/index.js")
).default;
const sql = postgres(
  `postgresql://brandon:${cfg.databasePassword}@127.0.0.1:54329/brandontravel`,
  { max: 1 },
);
try {
  const rows =
    await sql`SELECT user_id,state FROM travel_trips WHERE id=${evidence.tripId}`;
  const row = rows[0],
    selections = row.state.entities.map((x) => x.selectedAt).sort(),
    start = new Date(Date.parse(selections[0]) - 10000).toISOString();
  const end = evidence.usageAfter.recent
    .map((x) => x.created_at)
    .sort()
    .at(-1);
  const totals =
    await sql`SELECT provider,status,count(*)::int AS count,sum(coalesce(input_tokens,0))::int AS input_tokens,sum(coalesce(output_tokens,0))::int AS output_tokens FROM travel_api_usage WHERE user_id=${row.user_id} AND provider IN ('model','amap') AND created_at>=${start} AND created_at<=${end} GROUP BY provider,status ORDER BY provider,status`;
  const sessions =
    await sql`SELECT count(DISTINCT session_id)::int AS count FROM travel_api_usage WHERE user_id=${row.user_id} AND provider IN ('model','amap') AND created_at>=${start} AND created_at<=${end}`;
  const result = {
    date: new Date().toISOString(),
    start,
    end,
    scope: "本轮隔离真实验收的完整时间窗，跨启动修复前后登录；mock不计实际请求",
    loginSessions: sessions[0].count,
    totals,
    reservations: evidence.budget,
  };
  writeFileSync(
    "verification/sprint08-external-totals.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await sql.end();
}
