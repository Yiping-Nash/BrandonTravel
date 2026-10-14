import { PlaceDetails } from "./place-details";
import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@/components/ui";
import type {
  TravelActivity,
  TravelEntity,
  TravelTrip,
} from "@open-sunsama/types";
import { travelApi } from "./api";
import { inferPlaceCity } from "./place-city";
export function PlacePicker({
  trip,
  activity,
  disabled,
  entity,
  pending,
  onChange,
  onSelect,
}: {
  trip: TravelTrip;
  activity: TravelActivity;
  disabled: boolean;
  entity: TravelEntity | null | undefined;
  pending: boolean;
  onChange: (text: string) => void;
  onSelect: (entity: TravelEntity | null) => void;
}) {
  const inference = inferPlaceCity(trip, activity);
  const [city, setCity] = useState(
    inference.cities.length === 1 ? inference.cities[0]! : "",
  );
  const [manual, setManual] = useState(false),
    [touched, setTouched] = useState(false);
  const [results, setResults] = useState<TravelEntity[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const cache = useRef(new Map<string, { at: number; rows: TravelEntity[] }>());
  const [refresh, setRefresh] = useState(0);
  const inferred = inference.cities.join("|");
  useEffect(() => {
    if (!manual)
      setCity(inference.cities.length === 1 ? inference.cities[0]! : "");
  }, [inferred, manual]);
  useEffect(() => {
    setResults([]);
    setError("");
    setBusy(false);
    if (
      disabled ||
      entity ||
      !touched ||
      activity.place.trim().length < 2 ||
      !city.trim()
    )
      return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const key = city.trim() + "|" + activity.place.trim();
      const cached = cache.current.get(key);
      if (cached && Date.now() - cached.at < 300000) {
        setResults(cached.rows);
        return;
      }
      setBusy(true);
      void travelApi<TravelEntity[]>(
        `/places/search?${new URLSearchParams({ query: activity.place.trim(), city: city.trim() })}`,
        "GET",
        undefined,
        controller.signal,
      )
        .then((rows) => {
          if (!controller.signal.aborted) {
            cache.current.set(key, { at: Date.now(), rows });
            setResults(rows);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted)
            setError(e instanceof Error ? e.message : "查询失败");
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [activity.place, city, disabled, entity, touched, refresh]);
  return (
    <div className="travel-place-picker">
      <div>
        <label htmlFor={"place-" + activity.id}>地点</label>
        {entity ? (
          <div className="travel-place-tag">
            <span>高德地点 · {pending ? "待保存" : "已关联"}</span>
            <strong>{entity.name}</strong>
            <small>
              已关联地点城市：{entity.city} · {entity.address}
            </small>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                onSelect(null);
                setTouched(false);
              }}
            >
              重新输入地点
            </Button>
          </div>
        ) : (
          <Input
            id={"place-" + activity.id}
            aria-label="地点"
            disabled={disabled}
            value={activity.place}
            placeholder="输入地点，自动查询高德候选"
            onChange={(e) => {
              setTouched(true);
              setRefresh(0);
              onChange(e.target.value);
            }}
          />
        )}
      </div>
      {entity && (
        <PlaceDetails
          key={entity.poiId + String(pending)}
          tripId={trip.id}
          revision={trip.revision}
          entity={entity}
          pending={pending}
        />
      )}
      <label>
        搜索城市
        <Input
          aria-label="地点搜索城市"
          disabled={disabled}
          value={city}
          placeholder="请输入或选择城市"
          onChange={(e) => {
            setCity(e.target.value);
            setManual(true);
            setResults([]);
            setTouched(true);
          }}
        />
      </label>
      {manual && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            setManual(false);
            setCity(inference.cities.length === 1 ? inference.cities[0]! : "");
            setTouched(true);
          }}
        >
          使用建议城市
        </Button>
      )}
      {entity && manual && city.trim() && city.trim() !== entity.city && (
        <div>
          <small>搜索城市不会改写已关联地点。请选择新地点并保存。</small>
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => {
              onSelect(null);
              setTouched(true);
              setResults([]);
            }}
          >
            按此城市重新选地点
          </Button>
        </div>
      )}
      <small>
        {manual ? "城市由你选择" : "城市依据：" + inference.source}
        。地点候选需选择并保存。
      </small>
      {!manual && inference.cities.length > 1 && (
        <div className="travel-city-options">
          <span>前后活动城市不同，请选择：</span>
          {inference.cities.map((c) => (
            <Button
              type="button"
              key={c}
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setCity(c);
                setManual(true);
                setTouched(true);
              }}
            >
              {c}
            </Button>
          ))}
        </div>
      )}
      {!entity && (
        <Button
          type="button"
          variant="ghost"
          disabled={
            disabled || busy || activity.place.trim().length < 2 || !city.trim()
          }
          onClick={() => {
            setTouched(true);
            cache.current.delete(city.trim() + "|" + activity.place.trim());
            setRefresh((n) => n + 1);
          }}
        >
          搜索高德地点
        </Button>
      )}
      {busy && <small role="status">正在查询候选…</small>}
      {error && <p role="alert">{error}</p>}
      {!!results.length && !entity && (
        <div className="travel-place-results" aria-label="高德地点候选">
          {results.map((e) => (
            <div key={e.poiId}>
              <details>
                <summary>查看候选资料 · {e.name}</summary>
                <PlaceDetails
                  tripId={trip.id}
                  revision={trip.revision}
                  entity={e}
                  pending={true}
                />
              </details>
              <button
                type="button"
                className="travel-place-result"
                disabled={disabled}
                onClick={() => {
                  onSelect(e);
                  setResults([]);
                }}
              >
                <strong>{e.name}</strong>
                <span>
                  {e.city} · {e.address}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
