import type { AuditDecision, AuditPage, ExampleStatus, ExampleView, ReindexStats } from '../types/api'
import { http } from './http'

// Admin endpoints used by the client (IMPLEMENTATION.md 14.2, 15: Examples and Audit
// tabs). The token comes from adminStore (memory only) and is sent only on these calls.

function auth(token: string): { headers: { Authorization: string } } {
  return { headers: { Authorization: `Bearer ${token}` } }
}

export async function listExamples(token: string): Promise<ExampleView[]> {
  const res = await http.get<{ examples: ExampleView[] }>('/admin/examples', auth(token))
  return res.data.examples
}

export interface ExamplePatch {
  question?: string
  sql?: string
  status?: ExampleStatus
}

export async function updateExample(token: string, id: string, patch: ExamplePatch): Promise<ExampleView> {
  const res = await http.patch<ExampleView>(`/admin/examples/${encodeURIComponent(id)}`, patch, auth(token))
  return res.data
}

export async function reindex(token: string): Promise<ReindexStats> {
  const res = await http.post<ReindexStats>('/admin/reindex', undefined, auth(token))
  return res.data
}

export const AUDIT_PAGE_SIZE = 50

export async function listAudit(
  token: string,
  options: { decision: AuditDecision | null; before: string | null },
): Promise<AuditPage> {
  const params: Record<string, string | number> = { limit: AUDIT_PAGE_SIZE }
  if (options.decision !== null) params['decision'] = options.decision
  if (options.before !== null) params['before'] = options.before
  const res = await http.get<AuditPage>('/admin/audit', { ...auth(token), params })
  return res.data
}
