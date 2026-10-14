import { describe, it, expect, vi } from "vitest";
import { createExchangeService, currencies } from "./exchange-rates.js";
const rows = () =>
  currencies
    .filter((c) => c !== "CNY")
    .map((quote) => ({
      date: "2026-10-12",
      base: "CNY",
      quote,
      rate: 0.14,
      providers: [{ key: "ECB", date: "2026-10-12" }],
    }));
describe("Frankfurter adapter", () => {
  it("validates source/date, caches and coalesces actual requests", async () => {
    let time = Date.parse("2026-10-12T10:00:00Z");
    const fetcher = vi.fn(async () => new Response(JSON.stringify(rows())));
    const service = createExchangeService(fetcher, () => time),
      log = vi.fn(async (_status: string, _elapsed: number) => {});
    const [a, b] = await Promise.all([
      service("CNY", log),
      service("CNY", log),
    ]);
    expect(a.rates?.CNY).toBe(1);
    expect(a.providers).toContain("ECB");
    expect(b.cache).toBe(true);
    await service("CNY", log);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(["success", "coalesced", "cache"]),
    );
    time += 3600001;
    await service("CNY", log);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("never invents a missing currency or zero rate", async () => {
    const log = async () => {};
    await expect(
      createExchangeService(
        async () => new Response(JSON.stringify(rows().slice(1))),
      )("CNY", log),
    ).rejects.toThrow("不完整");
    await expect(
      createExchangeService(
        async () =>
          new Response(JSON.stringify(rows().map((r) => ({ ...r, rate: 0 })))),
      )("CNY", log),
    ).rejects.toThrow();
  });
  it("marks stale cached evidence after failure", async () => {
    let time = 0;
    let fail = false;
    const service = createExchangeService(
        async () => {
          if (fail) throw new Error("timeout");
          return new Response(JSON.stringify(rows()));
        },
        () => time,
      ),
      log = vi.fn(async (_status: string, _elapsed: number) => {});
    await service("CNY", log);
    time = 3600001;
    fail = true;
    const data = await service("CNY", log);
    expect(data.stale).toBe(true);
    expect(data.date).toBe("2026-10-12");
    expect(log).toHaveBeenLastCalledWith("failed", 0);
  });
  it("fails without cached evidence and allows a later retry", async () => {
    let fail = true;
    const service = createExchangeService(async () =>
      fail
        ? new Response("", { status: 503 })
        : new Response(JSON.stringify(rows())),
    );
    await expect(service("CNY", async () => {})).rejects.toThrow();
    fail = false;
    expect((await service("CNY", async () => {})).stale).toBe(false);
  });
  it("rejects inconsistent dates", async () => {
    const r = rows();
    r[0]!.date = "2026-10-11";
    await expect(
      createExchangeService(async () => new Response(JSON.stringify(r)))(
        "CNY",
        async () => {},
      ),
    ).rejects.toThrow("日期不一致");
  });
});
