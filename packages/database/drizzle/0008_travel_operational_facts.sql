CREATE TABLE travel_source_references (
 trip_id uuid NOT NULL REFERENCES travel_trips(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id), id uuid NOT NULL, source jsonb NOT NULL,
 PRIMARY KEY(trip_id,id)
);
--> statement-breakpoint
CREATE TABLE travel_operational_facts (
 trip_id uuid NOT NULL REFERENCES travel_trips(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id), kind text NOT NULL, subject_key text NOT NULL,
 fact jsonb NOT NULL, PRIMARY KEY(trip_id,kind,subject_key)
);
--> statement-breakpoint
CREATE TABLE travel_fact_collections (
 id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES travel_trips(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id), state jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE travel_fact_refreshes (
 user_id uuid NOT NULL REFERENCES users(id), request_id uuid NOT NULL,
 trip_id uuid NOT NULL REFERENCES travel_trips(id) ON DELETE CASCADE,
 payload jsonb NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,request_id)
);
--> statement-breakpoint
ALTER TABLE travel_trips ADD COLUMN facts_version integer NOT NULL DEFAULT 0;
--> statement-breakpoint
INSERT INTO travel_source_references(trip_id,user_id,id,source)
SELECT t.id,t.user_id,(e->>'id')::uuid,jsonb_build_object('id',e->>'id','providerId',e->>'provider','externalId',e->>'poiId','kind','place','displayName',e->>'name')
FROM travel_trips t CROSS JOIN LATERAL jsonb_array_elements(coalesce(t.state->'entities','[]'::jsonb)) e
WHERE coalesce(t.state->>'schemaVersion','1')='1';
--> statement-breakpoint
UPDATE travel_trips SET state=jsonb_set(jsonb_set(state,'{schemaVersion}','2'::jsonb),'{activities}',
coalesce((SELECT jsonb_agg(a || jsonb_build_object('environment','unspecified') ORDER BY ord) FROM jsonb_array_elements(state->'activities') WITH ORDINALITY arr(a,ord)),'[]'::jsonb))
WHERE coalesce(state->>'schemaVersion','1')='1';
--> statement-breakpoint
UPDATE travel_trips SET state=jsonb_set(state,'{entities}',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e->>'id','name',e->>'name','address',e->>'address','region',jsonb_build_object('name',e->>'city'),'coordinates',jsonb_build_object('longitude',e->'longitude','latitude',e->'latitude','coordinateSystem',e->>'coordinateSystem'),'selectedAt',e->>'selectedAt','sourceRefIds',jsonb_build_array(e->>'id')) ORDER BY ord) FROM jsonb_array_elements(state->'entities') WITH ORDINALITY arr(e,ord)),'[]'::jsonb))
WHERE state ? 'entities' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(state->'entities') e WHERE e ? 'sourceRefIds');
--> statement-breakpoint
INSERT INTO travel_operational_facts(trip_id,user_id,kind,subject_key,fact)
SELECT r.trip_id,t.user_id,'route_estimate',r.transition_id,jsonb_build_object(
 'id',gen_random_uuid(),'version',1,'kind','route_estimate','subjectKey',r.transition_id,'inputFingerprint',r.fingerprint,
 'sourceRefId',NULL,'collectionId',NULL,'status',CASE WHEN r.estimate->>'status'='ready' THEN 'available' ELSE 'failed' END,
 'retrievedAt',r.estimate->>'queriedAt','sourcePublishedAt',NULL,'expiresAt',to_char(((r.estimate->>'queriedAt')::timestamptz+interval '15 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'retryAfter',NULL,'appliesTo',jsonb_build_object('dates','[]'::jsonb,'regionRef',NULL,'basis','current_estimate'),
 'quality',CASE WHEN r.estimate->>'status'='ready' THEN 'complete' ELSE 'failed' END,
 'value',CASE WHEN r.estimate->>'status'='ready' THEN jsonb_build_object('kind','route_estimate','distanceMeters',r.estimate->'distanceMeters','durationSeconds',r.estimate->'durationSeconds','mode',coalesce(t.state->'transitionModes'->>r.transition_id,'driving'),'fromEntityId',coalesce((SELECT a->>'entityId' FROM jsonb_array_elements(t.state->'activities') a WHERE a->>'id'=split_part(r.transition_id,':',1)),''),'toEntityId',coalesce((SELECT a->>'entityId' FROM jsonb_array_elements(t.state->'activities') a WHERE a->>'id'=split_part(r.transition_id,':',2)),'')) ELSE NULL END,
 'error',CASE WHEN r.estimate->>'status'='ready' THEN NULL ELSE jsonb_build_object('code','LEGACY_ROUTE_UNKNOWN','retryable',true) END)
FROM travel_route_estimates r JOIN travel_trips t ON t.id=r.trip_id;
