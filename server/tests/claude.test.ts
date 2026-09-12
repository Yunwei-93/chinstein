import { afterEach, describe, expect, it } from 'vitest'
import { isGenerationEnabled } from '../src/claude.js'

const originalApiKey = process.env.ANTHROPIC_API_KEY

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY
  } else {
    process.env.ANTHROPIC_API_KEY = originalApiKey
  }
})

describe('isGenerationEnabled', () => {
  it('returns false when the API key is missing', () => {
    delete process.env.ANTHROPIC_API_KEY

    expect(isGenerationEnabled()).toBe(false)
  })

  it('returns false when the API key is empty', () => {
    process.env.ANTHROPIC_API_KEY = ''

    expect(isGenerationEnabled()).toBe(false)
  })

  it('returns false when the API key contains only whitespace', () => {
    process.env.ANTHROPIC_API_KEY = '   '

    expect(isGenerationEnabled()).toBe(false)
  })

  it('returns true when the API key is configured', () => {
    process.env.ANTHROPIC_API_KEY = 'test-only-key'

    expect(isGenerationEnabled()).toBe(true)
  })
})