import { LogoMark } from '../../components/icons'
import { STARTER_CARDS } from './suggestions'

/** New conversation: heading, one line on what QueryCraft does, demo questions as cards. */
export function EmptyThread({ disabled, onPick }: { disabled: boolean; onPick: (question: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
      <LogoMark className="size-10" />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-50">Ask your database anything</h1>
      <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        QueryCraft turns plain-English questions about the AdventureWorks database into checked, read-only SQL and answers with the result.
      </p>
      <ul aria-label="Suggested questions" className="mt-8 grid w-full gap-2.5 text-left sm:grid-cols-2">
        {STARTER_CARDS.map((card) => (
          <li key={card.question}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(card.question)}
              className="flex h-full w-full flex-col gap-1 rounded-xl border border-zinc-200 px-4 py-3 text-left hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
            >
              <span className="line-clamp-2 text-sm text-zinc-800 dark:text-zinc-200">{card.question}</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-500">{card.shows}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
