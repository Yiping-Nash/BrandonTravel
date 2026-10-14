/** Eval clock is accepted only in an explicitly synthetic, isolated database. */
export function travelNow(): Date {
  const env = process.env;
  const name = (() => {
    try {
      return new URL(env.DATABASE_URL ?? "").pathname.slice(1);
    } catch {
      return "";
    }
  })();
  if (
    env.TRAVEL_EVAL_FIXTURES === "synthetic" &&
    /^bt_eval_[a-f0-9]+$/.test(name) &&
    env.TRAVEL_EVAL_CLOCK
  ) {
    const now = new Date(env.TRAVEL_EVAL_CLOCK);
    if (!Number.isFinite(+now)) throw Error("Invalid isolated eval clock");
    return now;
  }
  return new Date();
}
