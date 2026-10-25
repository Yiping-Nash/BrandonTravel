import { UTCDate } from '@date-fns/utc';

/**
 * Calendar coordinates are civil trip-local fields, not instants in the browser's
 * timezone. UTCDate is an arithmetic carrier only; no UTC conversion is sent to
 * the API. date-fns preserves its constructor through add/start/format helpers.
 */
export function parseWall(value:string):UTCDate {
 return new UTCDate(`${value.length===10?`${value}T00:00`:value}Z`);
}
export { UTCDate };
