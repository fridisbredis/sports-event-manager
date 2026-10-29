// What create_event can carry over from the source event. Mirrors the keys
// the RPC reads from p_copy (migration 20261029081215). Its own module rather
// than in the action: a 'use server' file may only export async functions,
// and the dialog needs the list on the client.
export const COPY_OPTIONS = [
  'details',
  'stages',
  'distances',
  'facilities',
  'work_areas',
  'checklists',
] as const
export type CopyOption = (typeof COPY_OPTIONS)[number]
