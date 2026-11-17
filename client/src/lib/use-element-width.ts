import { useEffect, useRef, useState, type RefObject } from 'react'

/** Width of an element in CSS pixels, kept current with ResizeObserver; `fallback` until measured. */
export function useElementWidth<T extends HTMLElement>(fallback: number): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const element = ref.current
    if (element === null || typeof ResizeObserver === 'undefined') return undefined
    // The observer reports the initial size right after observe(), then every change.
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined && entry.contentRect.width > 0) setWidth(Math.round(entry.contentRect.width))
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])
  return [ref, width]
}
