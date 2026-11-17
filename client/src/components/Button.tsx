import type { ComponentProps } from 'react'

// The app's buttons: four variants, two sizes, one focus ring. Icons inside are size-3.5
// (sm) or size-4 (md); icon-only buttons use IconButton.

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  // White on indigo-600 is 6.3:1; the same fill in both themes keeps dark mode no heavier.
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500',
  secondary:
    'border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-transparent dark:text-zinc-100 dark:hover:bg-zinc-800',
  ghost: 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
  destructive: 'bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-400',
}

const SIZES: Record<Size, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-xs',
  md: 'h-8 gap-2 px-3 text-sm',
}

interface ButtonProps extends ComponentProps<'button'> {
  variant?: Variant
  size?: Size
}

export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`qc-focus inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

interface IconButtonProps extends ComponentProps<'button'> {
  /** Required: icon-only buttons need an accessible name. */
  'aria-label': string
  pressed?: boolean
}

/** A 32 px icon-only button (icon size-4), ghost style. */
export function IconButton({ className = '', type = 'button', pressed, ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={`qc-focus inline-flex size-8 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 ${
        pressed === true ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100' : ''
      } ${className}`}
      {...props}
    />
  )
}
