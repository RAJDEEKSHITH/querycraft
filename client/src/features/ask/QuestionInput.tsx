import { useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button } from '../../components/Button'
import { QUESTION_MAX_LENGTH } from './suggestions'

interface QuestionInputProps {
  label: string
  placeholder: string
  submitLabel: string
  disabled: boolean
  onSubmit: (text: string) => void
  /** Text put into the box from outside (a suggested question); the key changes each time. */
  preset?: { text: string; key: number }
}

export function QuestionInput({ label, placeholder, submitLabel, disabled, onSubmit, preset }: QuestionInputProps) {
  const id = useId()
  const [text, setText] = useState('')
  const [presetKey, setPresetKey] = useState<number | null>(null)
  if (preset !== undefined && preset.key !== presetKey) {
    setPresetKey(preset.key)
    setText(preset.text)
  }
  const tooLong = text.length > QUESTION_MAX_LENGTH
  const empty = text.trim() === ''

  const submit = (e?: FormEvent): void => {
    e?.preventDefault()
    if (disabled || empty || tooLong) return
    onSubmit(text.trim())
    setText('')
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) submit(e)
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </label>
      <textarea
        id={id}
        value={text}
        rows={2}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        aria-describedby={`${id}-count`}
        aria-invalid={tooLong}
        className="block w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      <div className="flex items-center justify-between gap-2">
        <span id={`${id}-count`} className={`text-xs ${tooLong ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
          {text.length} / {QUESTION_MAX_LENGTH}
          {tooLong ? ' — too long' : ''}
        </span>
        <Button type="submit" variant="primary" disabled={disabled || empty || tooLong}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
