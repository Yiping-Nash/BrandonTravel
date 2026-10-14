import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { AuthVariables } from "../middleware/auth.js";
import { db } from "./store.js";
export const currencies = ["CNY", "USD", "EUR", "JPY", "GBP", "HKD"] as const;
const rowsSchema = z.array(
  z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    base: z.string(),
    quote: z.string(),
    rate: z.number().positive().finite(),
    providers: z
      .array(
        z.object({
          key: z.string(),
          date: z.string(),
          excluded: z.boolean().optional(),
        }),
      )
      .optional(),
  }),
);
export function createExchangeService(
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
) {
  const cache = new Map<
    string,
    {
      date: string;
      base: string;
      rates: Record<string, number>;
      source: string;
      providers: string[];
      queriedAt: string;
    }
  >();
  const pending = new Map<string, Promise<ReturnType<typeof cache.get>>>();
  return async (
    base: string,
    log: (status: string, elapsed: number) => Promise<void>,
  ) => {
    const stored = cache.get(base);
    if (stored && now() - Date.parse(stored.queriedAt) < 3600000) {
      await log("cache", 0);
      return { ...stored, cache: true, stale: false };
    }
    if (pending.has(base)) {
      await log("coalesced", 0);
      try {
        const value = await pending.get(base);
        return { ...value, cache: true, stale: false };
      } catch (e) {
        if (stored) return { ...stored, cache: true, stale: true };
        throw e;
      }
    }
    const work = (async () => {
      const start = now();
      try {
        const url = new URL("https://api.frankfurter.dev/v2/rates");
        url.search = new URLSearchParams({
          base,
          quotes: currencies.filter((c) => c !== base).join(","),
          expand: "providers",
        }).toString();
        const response = await fetcher(url, {
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error("汇率供应商暂不可用");
        const rows = rowsSchema.parse(await response.json());
        if (
          currencies.some(
            (c) =>
              c !== base && !rows.some((r) => r.base === base && r.quote === c),
          )
        )
          throw new Error("汇率返回不完整");
        const dates = [...new Set(rows.map((r) => r.date))];
        if (dates.length !== 1) throw new Error("汇率日期不一致");
        const value = {
          base,
          date: dates[0]!,
          rates: Object.fromEntries([
            [base, 1],
            ...rows.map((r) => [r.quote, r.rate]),
          ]),
          source: "Frankfurter · 多机构参考汇率",
          providers: [
            ...new Set(
              rows.flatMap(
                (r) =>
                  r.providers?.filter((p) => !p.excluded).map((p) => p.key) ??
                  [],
              ),
            ),
          ],
          queriedAt: new Date(now()).toISOString(),
        };
        cache.set(base, value);
        await log("success", now() - start);
        return value;
      } catch (e) {
        await log("failed", now() - start);
        throw e;
      }
    })();
    pending.set(base, work);
    try {
      return { ...(await work), cache: false, stale: false };
    } catch (e) {
      if (stored) return { ...stored, cache: true, stale: true };
      throw e;
    } finally {
      pending.delete(base);
    }
  };
}
const readRates = createExchangeService();
export const exchangeRouter = new Hono<{ Variables: AuthVariables }>();
exchangeRouter.get("/exchange-rates", async (c) => {
  const input = z
    .object({ base: z.enum(currencies).default("CNY") })
    .safeParse(c.req.query());
  if (!input.success)
    return c.json({ success: false, error: { message: "不支持的币种" } }, 422);
  try {
    const data = await readRates(input.data.base, async (status, elapsed) => {
      await db()`INSERT INTO travel_api_usage(id,user_id,session_id,provider,endpoint,purpose,status,elapsed_ms) VALUES(${randomUUID()},${c.get("userId")},${c.get("travelSession") ?? "unknown"},'frankfurter','GET /v2/rates',${c.req.header("X-Travel-Test") === "true" ? "acceptance" : "interactive"},${status},${elapsed})`.catch(
        () => {},
      );
    });
    return c.json({ success: true, data });
  } catch {
    return c.json(
      { success: false, error: { message: "汇率查询失败，请稍后重试" } },
      503,
    );
  }
});
