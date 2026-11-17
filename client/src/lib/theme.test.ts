import { describe, expect, it } from 'vitest'
import { isNearBottom } from './scroll'
import { applyTheme, parseTheme, resolveTheme } from './theme'

describe('theme', () => {
  it('parses a stored choice and defaults to system', () => {
    expect(parseTheme('dark')).toBe('dark')
    expect(parseTheme('light')).toBe('light')
    expect(parseTheme('system')).toBe('system')
    expect(parseTheme('purple')).toBe('system')
    expect(parseTheme(null)).toBe('system')
  })

  it('system follows the OS preference; an explicit choice wins', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('applies the dark class and the colour scheme', () => {
    const classes = new Set<string>()
    const root = {
      classList: {
        toggle: (token: string, force?: boolean): boolean => {
          if (force === true) classes.add(token)
          else classes.delete(token)
          return force === true
        },
      },
      style: { colorScheme: '' },
    }
    applyTheme(root, 'dark')
    expect(classes.has('dark')).toBe(true)
    expect(root.style.colorScheme).toBe('dark')
    applyTheme(root, 'light')
    expect(classes.has('dark')).toBe(false)
    expect(root.style.colorScheme).toBe('light')
  })
})

describe('isNearBottom', () => {
  it('is true at or close to the bottom and false after scrolling up', () => {
    expect(isNearBottom({ scrollTop: 1000, scrollHeight: 1500, clientHeight: 500 })).toBe(true)
    expect(isNearBottom({ scrollTop: 930, scrollHeight: 1500, clientHeight: 500 })).toBe(true)
    expect(isNearBottom({ scrollTop: 900, scrollHeight: 1500, clientHeight: 500 })).toBe(false)
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 400, clientHeight: 500 })).toBe(true)
  })
})
