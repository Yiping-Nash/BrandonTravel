import { readFileSync, writeFileSync, existsSync } from "node:fs";
const cfg = JSON.parse(readFileSync(".runtime/config.json", "utf8"));
const postgres = (
    await import("../apps/api/node_modules/postgres/src/index.js")
  ).default,
  sql = postgres(
    `postgresql://brandon:${cfg.databasePassword}@127.0.0.1:54329/brandontravel`,
    { max: 1 },
  );
try {
  let exclusions = [];
  const filename = "verification/simulated-usage-exclusions.json";
  if (existsSync(filename))
    exclusions = JSON.parse(readFileSync(filename, "utf8")).recordIds;
  else {
    const a = JSON.parse(readFileSync(".runtime/test-account.json", "utf8"));
    const users =
      await sql`SELECT user_id FROM travel_trips WHERE id=${a.tripId}`;
    const rows =
      await sql`SELECT id FROM travel_api_usage WHERE user_id=${users[0].user_id} AND provider IN ('amap','model')`;
    exclusions = rows.map((r) => r.id);
    writeFileSync(
      filename,
      JSON.stringify(
        {
          reason:
            "隔离模拟API早期记录尚无mock来源标签；按该次测试账号核对，不修改原始日志",
          recordIds: exclusions,
        },
        null,
        2,
      ),
    );
  }
  const real =
    await sql`SELECT provider,status,count(*)::int as count,coalesce(sum(input_tokens),0)::int as input_tokens,coalesce(sum(output_tokens),0)::int as output_tokens FROM travel_api_usage WHERE provider IN ('amap','model') AND endpoint<>'test' AND id <> ALL(${exclusions}) GROUP BY provider,status`;
  writeFileSync(
    "verification/external-usage-totals.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        scope: "本轮日志表创建后真实请求；依据独立模拟证据排除，不修改原始日志",
        real,
      },
      null,
      2,
    ),
  );
  console.log(real);
} finally {
  await sql.end();
}
