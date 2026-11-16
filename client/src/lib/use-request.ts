import { useEffect, useState } from 'react'
import { toApiError, type ApiError } from './http'

// Fetch-and-show helper for server data that is simply displayed (IMPLEMENTATION.md 15:
// "stays in component state or small hooks"). Pass a stable `load` (useCallback);
// a new `load` or reload() fetches again.

export interface RequestState<T> {
  data: T | null
  error: ApiError | null
  loading: boolean
  reload: () => void
}

interface Settled<T> {
  load: () => Promise<T>
  nonce: number
  data: T | null
  error: ApiError | null
}

export function useRequest<T>(load: () => Promise<T>): RequestState<T> {
  const [nonce, setNonce] = useState(0)
  const [settled, setSettled] = useState<Settled<T> | null>(null)

  useEffect(() => {
    let cancelled = false
    load().then(
      (data) => {
        if (!cancelled) setSettled({ load, nonce, data, error: null })
      },
      (err: unknown) => {
        if (!cancelled) setSettled({ load, nonce, data: null, error: toApiError(err) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [load, nonce])

  const current = settled !== null && settled.load === load && settled.nonce === nonce
  return {
    data: current ? settled.data : null,
    error: current ? settled.error : null,
    loading: !current,
    reload: () => {
      setNonce((n) => n + 1)
    },
  }
}
