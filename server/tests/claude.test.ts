import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    generateStory,
    isGenerationEnabled,
    isUsable,
} from '../src/claude.js'

const { messagesCreateMock } = vi.hoisted(() => ({
    messagesCreateMock: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
    default: class AnthropicMock {
        messages = {
            create: messagesCreateMock,
        }
    },
}))

const originalApiKey = process.env.ANTHROPIC_API_KEY

afterEach(() => {
    if (originalApiKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY
    } else {
        process.env.ANTHROPIC_API_KEY = originalApiKey
    }

    messagesCreateMock.mockReset()
    vi.restoreAllMocks()
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

const makeStory = (wordCount: number): string =>
    Array(wordCount).fill('word').join(' ')

describe('isUsable', () => {
    it('accepts stories at the word-count boundaries', () => {
        expect(isUsable(makeStory(35))).toBe(true)
        expect(isUsable(makeStory(80))).toBe(true)
    })

    it('rejects stories outside the word-count boundaries', () => {
        expect(isUsable(makeStory(34))).toBe(false)
        expect(isUsable(makeStory(81))).toBe(false)
    })

    it('rejects an abnormally long story', () => {
        const story = Array(35).fill('abcdefghijklmnopqrst').join(' ')

        expect(isUsable(story)).toBe(false)
    })

    it('rejects a refusal response', () => {
        const story = ['As', 'an', 'AI', ...Array(32).fill('word')].join(' ')

        expect(isUsable(story)).toBe(false)
    })
})

describe('generateStory', () => {
    it('passes a hard deadline and degrades when the SDK rejects', async () => {
        process.env.ANTHROPIC_API_KEY = 'test-only-key'

        const signal = new AbortController().signal
        const timeoutSpy = vi
            .spyOn(AbortSignal, 'timeout')
            .mockReturnValue(signal)
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        messagesCreateMock.mockRejectedValueOnce(
            new Error('simulated SDK failure'),
        )

        await expect(
            generateStory('測', 'cè', 'test'),
        ).resolves.toBeNull()

        expect(timeoutSpy).toHaveBeenCalledWith(35_000)
        expect(messagesCreateMock).toHaveBeenCalledTimes(1)
        expect(messagesCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'claude-haiku-4-5-20251001',
            }),
            { signal },
        )
    })
})
