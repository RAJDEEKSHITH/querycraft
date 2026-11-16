import { useId, useState, type FormEvent } from 'react'
import { Button } from '../../components/Button'
import { ErrorMessage } from '../../components/States'
import { listExamples } from '../../lib/admin-api'
import { toApiError } from '../../lib/http'
import { useAdminStore } from '../../stores/adminStore'

export function TokenPrompt() {
  const id = useId()
  const [token, setToken] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const notice = useAdminStore((s) => s.notice)
  const signIn = useAdminStore((s) => s.signIn)

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const value = token.trim()
    if (value === '' || checking) return
    setChecking(true)
    setError(null)
    // Check the token with a harmless admin read before keeping it.
    listExamples(value).then(
      () => {
        setChecking(false)
        setToken('')
        signIn(value)
      },
      (err: unknown) => {
        const apiError = toApiError(err)
        setChecking(false)
        setError(apiError.code === 'UNAUTHORIZED' ? 'That admin token is not valid.' : apiError.message)
      },
    )
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-md space-y-3 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/60">
      <h2 className="text-base font-medium text-zinc-900 dark:text-zinc-100">Admin sign-in</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Enter the admin token. It is kept in this tab&apos;s memory only and is gone after a reload.
      </p>
      {notice !== null && <p className="text-sm text-amber-700 dark:text-amber-400">{notice}</p>}
      <div>
        <label htmlFor={id} className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Admin token
        </label>
        <input
          id={id}
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
      </div>
      {error !== null && <ErrorMessage message={error} />}
      <Button type="submit" variant="primary" disabled={checking || token.trim() === ''}>
        {checking ? 'Checking…' : 'Sign in'}
      </Button>
    </form>
  )
}
