import { mutationSchema } from "./travel-contract";
import { z } from "zod";
const date = z.iso.date();
export const factKindSchema = z.enum([
  "place",
  "opening_hours",
  "route_estimate",
  "weather",
]);
const point = z
  .object({
    longitude: z.number().min(-180).max(180),
    latitude: z.number().min(-85).max(85),
    coordinateSystem: z.literal("GCJ-02"),
  })
  .strict();
const value = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("place"),
      name: z.string(),
      address: z.string(),
      regionCode: z.string().nullable(),
      category: z.enum(["attraction", "restaurant", "hotel", "other"]),
      telephone: z.string().nullable().optional(),
      coordinates: point,
    })
    .strict(),
  z
    .object({
      kind: z.literal("opening_hours"),
      today: z.string().nullable(),
      weekly: z.string().nullable(),
      timezone: z.literal("Asia/Shanghai"),
      parseStatus: z.literal("pending"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("route_estimate"),
      distanceMeters: z.number().nonnegative(),
      durationSeconds: z.number().nonnegative(),
      mode: z.enum(["walking", "driving"]),
      fromEntityId: z.string(),
      toEntityId: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("weather"),
      regionCode: z.string(),
      regionName: z.string(),
      dataKind: z.enum(["observation", "daily_forecast", "outlook"]),
      providerId: z.literal("open-meteo").optional(),
      model: z.string().optional(),
      coordinates: z
        .object({
          longitude: z.number().min(-180).max(180),
          latitude: z.number().min(-90).max(90),
          coordinateSystem: z.literal("WGS84"),
        })
        .strict()
        .optional(),
      memberCount: z.number().int().positive().optional(),
      spatialResolutionKm: z.number().positive().optional(),
      days: z.array(
        z
          .object({
            date: date,
            precipitationProbability: z
              .number()
              .min(0)
              .max(100)
              .nullable()
              .optional(),
            temperatureDistribution: z
              .object({ p10: z.number(), median: z.number(), p90: z.number() })
              .strict()
              .optional(),
            precipitationDistribution: z
              .object({
                p10: z.number().nonnegative(),
                median: z.number().nonnegative(),
                p90: z.number().nonnegative(),
              })
              .strict()
              .optional(),
            dayCondition: z.string().nullable(),
            nightCondition: z.string().nullable(),
            highTemperature: z.number().nullable(),
            lowTemperature: z.number().nullable(),
          })
          .strict(),
      ),
      observation: z
        .object({
          condition: z.string().nullable(),
          temperature: z.number().nullable(),
        })
        .strict()
        .nullable(),
    })
    .strict(),
]);
export const operationalFactSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    kind: factKindSchema,
    subjectKey: z.string(),
    inputFingerprint: z.string(),
    sourceRefId: z.uuid().nullable(),
    collectionId: z.uuid().nullable(),
    status: z.enum(["available", "missing", "failed"]),
    retrievedAt: z.iso.datetime(),
    sourcePublishedAt: z.iso.datetime().nullable(),
    expiresAt: z.iso.datetime(),
    retryAfter: z.iso.datetime().nullable(),
    appliesTo: z
      .object({
        dates: z.array(date),
        regionRef: z.string().nullable(),
        basis: z.enum([
          "selected_place",
          "current_estimate",
          "provider_dates",
          "described_hours",
        ]),
      })
      .strict(),
    quality: z.enum(["complete", "partial", "failed"]),
    value: value.nullable(),
    error: z
      .object({ code: z.string(), retryable: z.boolean() })
      .strict()
      .nullable(),
  })
  .strict()
  .refine((f) => f.value === null || f.value.kind === f.kind, "事实类型不匹配")
  .refine(
    (f) => f.status !== "available" || f.value !== null,
    "可用事实必须有数据",
  )
  .refine(
    (f) => f.status !== "failed" || f.error !== null,
    "失败事实必须有原因",
  );
export const refreshFactsSchema = z
  .object({
    requestId: z.uuid(),
    kinds: z.array(factKindSchema).min(1).max(4),
    entityIds: z.array(z.uuid()).max(60).optional(),
    dates: z.array(date).max(60).optional(),
    force: z.boolean().default(false),
  })
  .strict();
export const factQuerySchema = z
  .object({
    kind: factKindSchema.optional(),
    entityId: z.uuid().optional(),
    activityId: z.uuid().optional(),
    date: date.optional(),
    cursor: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const state = z.enum(["VALID", "WARNING", "CONFLICT", "UNKNOWN"]);
export const constraintReasonSchema = z.enum([
  "OK",
  "ACTIVITY_OVERLAP",
  "TRANSITION_TIME_SHORTAGE",
  "OPENING_NOT_COVERED",
  "PLACE_UNCONFIRMED",
  "ACTIVITY_UNSCHEDULED",
  "FACT_MISSING",
  "FACT_STALE",
  "FACT_INPUT_MISMATCH",
  "FACT_PROVIDER_FAILED",
  "FACT_PARSE_INCOMPLETE",
  "HISTORICAL_HOURS_UNVERIFIED",
  "HOURS_SOURCE_INCONSISTENT",
  "SPECIAL_DATE_UNVERIFIED",
  "FACT_DATE_NOT_APPLICABLE",
  "ENVIRONMENT_UNSPECIFIED",
  "WEATHER_REGION_UNRESOLVED",
  "WEATHER_OUT_OF_RANGE",
  "WEATHER_CONDITION_UNKNOWN",
  "OUTDOOR_HEAVY_RAIN",
]);
const interval = z
  .object({
    start: z.number().min(0).max(1440),
    end: z.number().min(0).max(1440),
  })
  .strict()
  .refine((v) => v.end >= v.start);
const base = {
  id: z.string(),
  state,
  severity: z.enum(["info", "warning", "error"]),
  activityIds: z.array(z.string()),
  entityIds: z.array(z.string()),
  transitionId: z.string().nullable(),
  reasonCode: constraintReasonSchema,
  factRefs: z.array(
    z.object({ id: z.string(), version: z.number().int().positive() }).strict(),
  ),
};
export const constraintResultSchema = z.discriminatedUnion("rule", [
  z
    .object({
      ...base,
      rule: z.literal("WEATHER_EXPOSURE"),
      details: z
        .object({
          date: date.nullable(),
          environment: z.enum(["indoor", "outdoor", "unspecified"]),
          regionCode: z.string().nullable(),
          regionName: z.string().nullable(),
          dayCondition: z.string().nullable(),
          nightCondition: z.string().nullable(),
          scope: z.literal("daily_forecast"),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      rule: z.literal("OVERLAP"),
      details: z
        .object({
          date: date.nullable(),
          overlapStart: z.number().nullable(),
          overlapEnd: z.number().nullable(),
          overlapMinutes: z.number().nonnegative().nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      rule: z.literal("TRANSITION_GAP"),
      details: z
        .object({
          date: date.nullable(),
          mode: z.enum(["walking", "driving"]),
          gapSeconds: z.number().nullable(),
          durationSeconds: z.number().nonnegative().nullable(),
          shortageMinutes: z.number().int().nonnegative().nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      rule: z.literal("OPENING_COVERAGE"),
      details: z
        .object({
          date: date.nullable(),
          activityStart: z.number().nullable(),
          activityEnd: z.number().nullable(),
          openIntervals: z.array(interval).nullable(),
          uncoveredIntervals: z.array(interval).nullable(),
          parseQuality: z.enum(["complete", "partial", "failed"]),
          unrecognized: z.array(z.string()),
        })
        .strict(),
    })
    .strict(),
]);
export const evaluationSchema = z
  .object({
    tripRevision: z.number().int().nonnegative(),
    factsVersion: z.number().int().nonnegative(),
    engineVersion: z.string(),
    policyVersion: z.string(),
    evaluatedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    results: z.array(constraintResultSchema),
    counts: z
      .object({
        VALID: z.number().int().nonnegative(),
        WARNING: z.number().int().nonnegative(),
        CONFLICT: z.number().int().nonnegative(),
        UNKNOWN: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export const intelligenceQuerySchema = z
  .object({ date: date.optional(), activityId: z.uuid().optional() })
  .strict()
  .refine((v) => !(v.date && v.activityId), "日期和活动筛选不能同时提交");

export const kernelMutationSchema = mutationSchema
  .extend({
    environments: z
      .array(
        z
          .object({
            activityId: z.uuid(),
            environment: z.enum(["indoor", "outdoor", "unspecified"]),
          })
          .strict(),
      )
      .max(60),
  })
  .strict();
