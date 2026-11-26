// B29: the distinct events a participant is entered in, in entry order.
// tenant.entries is one row per participants record, and nothing in the schema
// promises one record per event, so the Event info tab counts events, not
// records: two records in one event must still open that event directly.
export function participantEventIds(entries: ReadonlyArray<{ eventId: string }>): string[] {
  return [...new Set(entries.map((e) => e.eventId))]
}
