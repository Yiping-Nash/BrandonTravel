import type {
  Evaluation,
  ConstraintResult,
  ConstraintReason,
  ParsedHours,
} from "./intelligence";
import type {
  FactView,
  KernelSource,
  TravelEnvironment,
} from "./travel-kernel";
export type InspectionInput = {
  key: string;
  dependency: string;
  status:
    | "PROVIDED"
    | "NOT_QUERIED"
    | "NOT_PROVIDED"
    | "FAILED"
    | "STALE"
    | "MISMATCH"
    | "UNSUPPORTED"
    | "WAITING_PREREQUISITE";
  reason: ConstraintReason | null;
  factRefs: { id: string; version: number }[];
  hoursParsing?: { basis: "today" | "weekly"; parsed: ParsedHours }[];
};
export type InspectionTrace = {
  id: string;
  rule: ConstraintResult["rule"];
  date: string | null;
  activityIds: string[];
  applicability: "APPLICABLE" | "NOT_APPLICABLE" | "DEFERRED" | "UNDETERMINED";
  state: ConstraintResult["state"] | null;
  resultIds: string[];
  inputs: InspectionInput[];
};
export type IntelligenceRoot = {
  id: string;
  reason: ConstraintReason;
  dependency: string;
  category: "ACTION_REQUIRED" | "WAITING_EXTERNAL" | "INFORMATIONAL";
  action:
    | "EDIT_PLAN"
    | "BIND_PLACE"
    | "SET_ENVIRONMENT"
    | "QUERY_FACTS"
    | "REFRESH_FACTS"
    | "WAIT"
    | "VIEW_SOURCE"
    | "NONE";
  activityIds: string[];
  resultIds: string[];
  traceIds: string[];
};
export type IntelligenceSnapshot = {
  projectionVersion: "1.0.0" | "1.1.0" | "1.2.0" | "1.3.0";
  mode: "LIVE" | "DEMO";
  evaluatedAt: string;
  expiresAt: string;
  evaluation: Evaluation;
  days?: IntelligenceDay[];
  connections?: IntelligenceConnection[];
  capabilities: {
    rule: ConstraintResult["rule"];
    status: "READY";
    requiredInputs: string[];
    objects: number;
    evaluated: number;
    needsData: number;
    notApplicable: number;
    deferred: number;
  }[];
  activities: {
    id: string;
    title: string;
    date: string | null;
    start: number | null;
    duration: number;
    locked: boolean;
    entityId: string | null;
    environment: TravelEnvironment;
    markers: string[];
  }[];
  traces: InspectionTrace[];
  roots: IntelligenceRoot[];
  facts: FactView[];
  sources: KernelSource[];
};

export type IntelligenceDay = {
  weatherQuery?: {
    message: string;
    canQuery: boolean;
    locateActivityIds: string[];
  };
  informationGaps?: {
    kind: "place" | "weather" | "hours" | "route" | "environment";
    activityIds: string[];
    action: "QUERY" | "LOCATE" | "ENVIRONMENT" | "VIEW";
  }[];
  weatherRangeNote: string | null;
  date: string;
  activityIds: string[];
  cities: string[];
  unlocatedCount: number;
  regionUnresolvedCount: number;
  noticeRootIds: string[];
  regions: {
    id: string;
    name: string;
    status:
      | "AVAILABLE"
      | "NOT_QUERIED"
      | "OUT_OF_RANGE"
      | "STALE"
      | "FAILED"
      | "NOT_PROVIDED"
      | "MISMATCH";
    reason: string;
    dayCondition: string | null;
    nightCondition: string | null;
    highTemperature: number | null;
    lowTemperature: number | null;
    factRefs: { id: string; version: number }[];
    forecastKind?: "daily_forecast" | "outlook";
    trend?: {
      temperature: { p10: number; median: number; p90: number };
      precipitation: { p10: number; median: number; p90: number };
      members: number;
      resolutionKm: number;
    };
  }[];
};

export type IntelligenceConnection = {
  id: string;
  fromId: string;
  toId: string;
  date: string | null;
  mode: "walking" | "driving";
  state: "VALID" | "WARNING" | "CONFLICT" | "UNKNOWN";
  reasonCode: ConstraintReason;
  gapSeconds: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  shortageMinutes: number | null;
  factRefs: { id: string; version: number }[];
};
