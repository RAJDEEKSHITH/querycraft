import type {
  ConversationView,
  CreatedQuestion,
  FeedbackRating,
  FeedbackResult,
  QuestionView,
  RerunResult,
} from '../types/api'
import { http } from './http'

// Public question endpoints (IMPLEMENTATION.md 14.1). Response bodies follow the
// server contract mirrored in types/api.ts.

export async function createQuestion(question: string, conversationId: string | null): Promise<CreatedQuestion> {
  const body = conversationId === null ? { question } : { question, conversationId }
  const res = await http.post<CreatedQuestion>('/questions', body)
  return res.data
}

export async function getQuestion(id: string): Promise<QuestionView> {
  const res = await http.get<QuestionView>(`/questions/${encodeURIComponent(id)}`)
  return res.data
}

export async function getConversation(id: string): Promise<ConversationView> {
  const res = await http.get<ConversationView>(`/conversations/${encodeURIComponent(id)}`)
  return res.data
}

export async function sendClarification(id: string, answer: string): Promise<void> {
  await http.post(`/questions/${encodeURIComponent(id)}/clarification`, { answer })
}

export async function sendApproval(id: string, approved: boolean): Promise<void> {
  await http.post(`/questions/${encodeURIComponent(id)}/approval`, { approved })
}

export async function rerunQuestion(id: string): Promise<RerunResult> {
  const res = await http.post<RerunResult>(`/questions/${encodeURIComponent(id)}/rerun`)
  return res.data
}

export async function sendFeedback(id: string, rating: FeedbackRating, comment: string): Promise<FeedbackResult> {
  const trimmed = comment.trim()
  const body = trimmed === '' ? { rating } : { rating, comment: trimmed }
  const res = await http.post<FeedbackResult>(`/questions/${encodeURIComponent(id)}/feedback`, body)
  return res.data
}
