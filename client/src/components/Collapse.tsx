import type { ReactNode } from 'react'

// Smooth expand / collapse (grid-rows transition; instant with reduced motion). Closed
// content is inert, so its controls leave the tab order.

export function Collapse({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  return (
    <div
      id={id}
      inert={!open}
      className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
