import { toApiError } from '../../lib/http'
import { useAdminStore } from '../../stores/adminStore'

/** Message for a failed admin call; a rejected token signs the admin out. */
export function adminErrorText(err: unknown): string {
  const e = toApiError(err)
  if (e.code === 'UNAUTHORIZED') {
    useAdminStore.getState().signOut('The server rejected the admin token. Please sign in again.')
    return e.message
  }
  const details = e.details
  const rule = typeof details['rule'] === 'string' ? details['rule'] : null
  const message = typeof details['message'] === 'string' ? details['message'] : null
  const stage = typeof details['stage'] === 'string' ? details['stage'] : null
  if (rule === null) return e.message
  const where = stage === null ? rule : `${stage} / ${rule}`
  return message === null ? `${e.message}: ${where}` : `${e.message}: ${where} — ${message}`
}
