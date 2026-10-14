export type Interval = { start: number; end: number };
export type ParsedHours = {
  quality: "complete" | "partial" | "failed";
  raw: string;
  unrecognized: string[];
  days: { weekdays: number[]; intervals: Interval[] }[];
};
export type ConstraintState = "VALID" | "WARNING" | "CONFLICT" | "UNKNOWN";
export type ConstraintReason =
  | "OK"
  | "ACTIVITY_OVERLAP"
  | "TRANSITION_TIME_SHORTAGE"
  | "OPENING_NOT_COVERED"
  | "PLACE_UNCONFIRMED"
  | "ACTIVITY_UNSCHEDULED"
  | "FACT_MISSING"
  | "FACT_STALE"
  | "FACT_INPUT_MISMATCH"
  | "FACT_PROVIDER_FAILED"
  | "FACT_PARSE_INCOMPLETE"
  | "HISTORICAL_HOURS_UNVERIFIED"
  | "HOURS_SOURCE_INCONSISTENT"
  | "SPECIAL_DATE_UNVERIFIED"
  | "FACT_DATE_NOT_APPLICABLE"
  | "ENVIRONMENT_UNSPECIFIED"
  | "WEATHER_REGION_UNRESOLVED"
  | "WEATHER_OUT_OF_RANGE"
  | "WEATHER_CONDITION_UNKNOWN"
  | "OUTDOOR_HEAVY_RAIN";
export type ConstraintBase = {
  id: string;
  state: ConstraintState;
  severity: "info" | "warning" | "error";
  activityIds: string[];
  entityIds: string[];
  transitionId: string | null;
  reasonCode: ConstraintReason;
  factRefs: { id: string; version: number }[];
};
export type ConstraintResult = ConstraintBase &
  (
    | {
        rule: "OVERLAP";
        details: {
          date: string | null;
          overlapStart: number | null;
          overlapEnd: number | null;
          overlapMinutes: number | null;
        };
      }
    | {
        rule: "TRANSITION_GAP";
        details: {
          date: string | null;
          mode: "walking" | "driving";
          gapSeconds: number | null;
          durationSeconds: number | null;
          shortageMinutes: number | null;
        };
      }
    | {
        rule: "WEATHER_EXPOSURE";
        details: {
          date: string | null;
          environment: "indoor" | "outdoor" | "unspecified";
          regionCode: string | null;
          regionName: string | null;
          dayCondition: string | null;
          nightCondition: string | null;
          scope: "daily_forecast";
        };
      }
    | {
        rule: "OPENING_COVERAGE";
        details: {
          date: string | null;
          activityStart: number | null;
          activityEnd: number | null;
          openIntervals: Interval[] | null;
          uncoveredIntervals: Interval[] | null;
          parseQuality: "complete" | "partial" | "failed";
          unrecognized: string[];
        };
      }
  );
export type Evaluation = {
  tripRevision: number;
  factsVersion: number;
  engineVersion: string;
  policyVersion: string;
  evaluatedAt: string;
  expiresAt: string;
  results: ConstraintResult[];
  counts: Record<ConstraintState, number>;
};
export type ConstraintPolicy = {
  version: string;
  specialDates: string[];
  calendarYears: number[];
  tightTransitionMinutes: null;
  nearClosingMinutes: null;
};
