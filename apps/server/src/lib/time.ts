/** Current UTC time as an ISO-8601 string (the only timestamp format stored in the DB). */
export function nowIso(): string {
  return new Date().toISOString();
}
