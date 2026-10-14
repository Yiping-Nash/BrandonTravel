import { useEffect, useState } from "react";
import { travelApi } from "../api";
type Rates = {
  base: string;
  date: string;
  rates: Record<string, number>;
  source: string;
  providers?: string[];
  queriedAt: string;
  cache: boolean;
  stale: boolean;
};
export function ExchangeCard() {
  const [base, setBase] = useState("CNY"),
    [quote, setQuote] = useState("USD"),
    [amount, setAmount] = useState("100"),
    [data, setData] = useState<Rates | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  const currencies = ["CNY", "USD", "EUR", "JPY", "GBP", "HKD"];
  useEffect(() => {
    const c = new AbortController();
    setBusy(true);
    setError("");
    void travelApi<Rates>(
      `/exchange-rates?base=${base}`,
      "GET",
      undefined,
      c.signal,
    )
      .then(setData)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setBusy(false);
      });
    return () => c.abort();
  }, [base, reload]);
  const rate = data?.base === base ? data.rates[quote] : undefined;
  return (
    <div className="bt-card">
      <small>旅行汇率 · 每日参考</small>
      <div className="bt-exchange-fields">
        <input
          aria-label="换算金额"
          type="number"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <select
          aria-label="源币种"
          value={base}
          onChange={(e) => setBase(e.target.value)}
        >
          {currencies.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <span>→</span>
        <select
          aria-label="目标币种"
          value={quote}
          onChange={(e) => setQuote(e.target.value)}
        >
          {currencies.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </div>
      <h2>
        {rate !== undefined &&
        amount !== "" &&
        Number.isFinite(Number(amount)) &&
        Number(amount) >= 0
          ? `${(Number(amount) * rate).toFixed(2)} ${quote}`
          : busy
            ? "正在查询"
            : "汇率不可用"}
      </h2>
      {error && <p role="alert">{error}</p>}
      <button
        disabled={busy}
        onClick={() => setReload((n) => n + 1)}
        className="bt-secondary"
      >
        {busy ? "正在查询" : "更新汇率"}
      </button>
      {data?.base === base && (
        <p className="bt-muted">
          {data.date} · {data.source}
          {data.stale ? " · 缓存已过期" : ""}
          {data.cache ? " · 缓存" : ""}
        </p>
      )}
      {data?.base === base && (
        <details className="bt-muted">
          <summary>查询时间与具体来源</summary>
          <p>
            {new Date(data.queriedAt).toLocaleString()} ·{" "}
            {(data.providers ?? []).join("／") || "来源列表未提供"}
          </p>
        </details>
      )}
      <small>
        参考汇率，非实时兑换报价。
        <a href="https://frankfurter.dev/" target="_blank" rel="noreferrer">
          查看来源
        </a>
      </small>
    </div>
  );
}
