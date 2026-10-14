export type TravelJsonValue =
  | string
  | number
  | boolean
  | null
  | TravelJsonValue[]
  | { [key: string]: TravelJsonValue };
export type TravelActivity = {
  id: string;
  title: string;
  notes: string;
  place: string;
  date: string | null;
  start: number | null;
  duration: number;
  locked: boolean;
  position: number;
  entityId?: string | null;
  backlogOriginDate?: string;
};
export type TravelTrip = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  timezone: "Asia/Shanghai";
  revision: number;
  activities: TravelActivity[];
  entities?: TravelEntity[];
  transitionModes?: Record<string, TravelMode>;
};
export type TravelMode = "walking" | "driving";
export type TravelEntity = {
  id: string;
  provider: "amap";
  poiId: string;
  name: string;
  address: string;
  city: string;
  longitude: number;
  latitude: number;
  coordinateSystem: "GCJ-02";
  selectedAt: string;
  selectionProof?: string;
};
export type TravelEstimate = {
  fingerprint: string;
  status: "ready" | "unknown";
  distanceMeters: number | null;
  durationSeconds: number | null;
  queriedAt: string;
  source: "amap";
  error?: string;
};
export type TravelTransition = {
  id: string;
  fromId: string;
  toId: string;
  date: string;
  mode: TravelMode;
  fingerprint: string | null;
  gapMinutes: number;
  estimate: TravelEstimate | null;
  freshness: "fresh" | "stale" | "unknown";
  shortageMinutes: number | null;
};
export type TravelChatEvent = {
  kind: "tool" | "answer" | "error" | "control";
  name?: string;
  status?: "running" | "done" | "failed";
  text: string;
  proposalId?: string;
  proposalStatus?: "pending" | "applied" | "rejected";
  arguments?: Record<string, TravelJsonValue>;
};
export type TravelChatRun = {
  /** Eval-only, absent for ordinary user chats. */
  traceId?: string;
  diagnostics?: {
    round: number;
    contextChars: number;
    usageAvailable?: boolean;
    toolNames: string[];
    inputTokens: number;
    outputTokens: number;
    reason?: string;
  }[];
  candidates?: {
    candidateId: string;
    name: string;
    city: string;
    address: string;
    query: string;
    straightDistanceMeters?: number;
  }[];
  outcome?:
    "proposal_created" | "answered" | "needs_clarification" | "incomplete";
  id: string;
  tripId: string;
  message: string;
  status: "running" | "done" | "cancelled" | "failed";
  events: TravelChatEvent[];
  requests: number;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
};
export type TravelOperation =
  | { type: "set_trip_range"; startDate: string; endDate: string }
  | { type: "return_to_pending"; ids: string[] }
  | { type: "shift_activities"; ids: string[]; days: number; minutes: number }
  | { type: "delete_activities"; ids: string[] }
  | { type: "reorder_pending"; ids: string[] }
  | { type: "bind_entity"; id: string; entity: TravelEntity | null }
  | { type: "transition_mode"; fromId: string; toId: string; mode: TravelMode }
  | { type: "add"; activity: TravelActivity }
  | { type: "edit"; id: string; patch: Partial<Omit<TravelActivity, "id">> }
  | { type: "delete"; id: string }
  | {
      type: "trip";
      patch: Partial<Pick<TravelTrip, "title" | "startDate" | "endDate">>;
    };
export type TravelProposal = {
  /** Snapshot assessment at proposal creation, never live verification. */
  evaluation?: import("./intelligence.js").Evaluation;
  createdAt?: string;
  processedAt?: string;
  dateConstraints?: { activityId: string; date: string; expression: string }[];
  id: string;
  tripId: string;
  revision: number;
  reason: string;
  status: "pending" | "applied" | "rejected";
  operations: TravelOperation[];
  before: TravelTrip;
  after: TravelTrip;
  result: TravelTrip | null;
};
