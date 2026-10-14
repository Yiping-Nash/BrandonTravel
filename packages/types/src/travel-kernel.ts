import type { TravelActivity, TravelTrip, TravelOperation } from "./travel";
export type TravelEnvironment = "indoor" | "outdoor" | "unspecified";
export type KernelSource = {
  id: string;
  providerId: string;
  externalId: string;
  kind: "place" | "region" | "route" | "weather";
  displayName: string;
};
export type KernelEntity = {
  id: string;
  name: string;
  address: string;
  region: { name: string };
  coordinates: {
    longitude: number;
    latitude: number;
    coordinateSystem: "GCJ-02";
  };
  selectedAt: string;
  sourceRefIds: string[];
};
export type KernelTrip = Omit<TravelTrip, "entities" | "activities"> & {
  schemaVersion: 2;
  entities?: KernelEntity[];
  activities: (TravelActivity & { environment: TravelEnvironment })[];
};
export type FactKind = "place" | "opening_hours" | "route_estimate" | "weather";
export type OperationalFact = {
  id: string;
  version: number;
  kind: FactKind;
  subjectKey: string;
  inputFingerprint: string;
  sourceRefId: string | null;
  collectionId: string | null;
  status: "available" | "missing" | "failed";
  retrievedAt: string;
  sourcePublishedAt: string | null;
  expiresAt: string;
  retryAfter: string | null;
  appliesTo: {
    dates: string[];
    regionRef: string | null;
    basis:
      | "selected_place"
      | "current_estimate"
      | "provider_dates"
      | "described_hours";
  };
  quality: "complete" | "partial" | "failed";
  value: FactValue | null;
  error: { code: string; retryable: boolean } | null;
};
export type FactValue =
  | {
      kind: "place";
      name: string;
      address: string;
      regionCode: string | null;
      category: "attraction" | "restaurant" | "hotel" | "other";
      telephone?: string | null;
      coordinates: {
        longitude: number;
        latitude: number;
        coordinateSystem: "GCJ-02";
      };
    }
  | {
      kind: "opening_hours";
      today: string | null;
      weekly: string | null;
      timezone: "Asia/Shanghai";
      /** 采集原文的兼容标记；解析质量由Evaluation.details给出。 */
      parseStatus: "pending";
    }
  | {
      kind: "route_estimate";
      distanceMeters: number;
      durationSeconds: number;
      mode: "walking" | "driving";
      fromEntityId: string;
      toEntityId: string;
    }
  | {
      kind: "weather";
      regionCode: string;
      regionName: string;
      dataKind: "observation" | "daily_forecast" | "outlook";
      providerId?: "open-meteo";
      model?: string;
      coordinates?: {
        longitude: number;
        latitude: number;
        coordinateSystem: "WGS84";
      };
      memberCount?: number;
      spatialResolutionKm?: number;
      days: {
        date: string;
        precipitationProbability?: number | null;
        temperatureDistribution?: { p10: number; median: number; p90: number };
        precipitationDistribution?: {
          p10: number;
          median: number;
          p90: number;
        };
        dayCondition: string | null;
        nightCondition: string | null;
        highTemperature: number | null;
        lowTemperature: number | null;
      }[];
      observation: {
        condition: string | null;
        temperature: number | null;
      } | null;
    };
export type FactView = OperationalFact & {
  freshness: "fresh" | "stale" | "unknown";
  unknownReason: string | null;
};
export type FactSnapshot = {
  tripRevision: number;
  factsVersion: number;
  facts: FactView[];
  sources: KernelSource[];
  gaps: { subjectKey: string; reasonCode: string }[];
};

export type KernelMutation = {
  requestId: string;
  expectedRevision: number;
  operations: TravelOperation[];
  environments: { activityId: string; environment: TravelEnvironment }[];
};
