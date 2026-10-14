export async function travelApi<T>(
  url: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch("/api/travel" + url, {
    method,
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${localStorage.getItem("open_sunsama_token")}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await r.json();
  if (!r.ok) throw Error(result.error?.message ?? "请求失败");
  return result.data as T;
}
