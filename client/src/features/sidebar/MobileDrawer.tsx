import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

// The sidebar as a slide-over drawer on narrow screens: Escape or the backdrop closes it,
// focus moves into it on open and stays inside while it is open.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function MobileDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
  }, [open])

  if (!open) return null

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab' || panel.current === null) return
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    const first = items[0]
    const last = items.at(-1)
    if (first === undefined || last === undefined) return
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Sidebar" onKeyDown={onKeyDown} className="fixed inset-0 z-40 md:hidden">
      <div aria-hidden="true" onClick={onClose} className="qc-fade-in absolute inset-0 bg-zinc-950/40" />
      <div ref={panel} className="qc-slide-in absolute inset-y-0 left-0 w-[280px] max-w-[85vw] shadow-xl">
        {children}
      </div>
    </div>
  )
}
