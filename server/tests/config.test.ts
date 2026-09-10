import { describe, expect, it } from 'vitest'
import { parseStartupConfig } from '../src/config.js'

describe('startup configuration', () => {
    it('rejects a non-numeric PORT', () => {
        expect(() =>
            parseStartupConfig({
                DATABASE_URL: 'postgresql://localhost/chinstein',
                JWT_SECRET: 'test-only-jwt-secret-at-least-32-characters',
                PORT: 'not-a-number',
            }),
        ).toThrow('PORT')
    })

    it('rejects a missing JWT_SECRET', () => {
        expect(() =>
            parseStartupConfig({
                DATABASE_URL: 'postgresql://localhost/chinstein',
                PORT: '3000',
            }),
        ).toThrow('JWT_SECRET')
    })

    it('rejects a short JWT_SECRET', () => {
        expect(() =>
            parseStartupConfig({
                DATABASE_URL: 'postgresql://localhost/chinstein',
                JWT_SECRET: 'too-short',
                PORT: '3000',
            }),
        ).toThrow('JWT_SECRET')
    })

    it('rejects a missing DATABASE_URL', () => {
        expect(() =>
            parseStartupConfig({
                JWT_SECRET: 'test-only-jwt-secret-at-least-32-characters',
                PORT: '3000',
            }),
        ).toThrow('DATABASE_URL')
    })

    it('parses a numeric PORT and defaults it when omitted', () => {
        const requiredConfig = {
            DATABASE_URL: 'postgresql://localhost/chinstein',
            JWT_SECRET: 'test-only-jwt-secret-at-least-32-characters',
        }

        expect(parseStartupConfig({
            ...requiredConfig,
            PORT: '4000',
        }).PORT).toBe(4000)

        expect(parseStartupConfig(requiredConfig).PORT).toBe(3000)
    })

    it('rejects a malformed DATABASE_URL', () => {
        expect(() =>
            parseStartupConfig({
                DATABASE_URL: 'not-a-url',
                JWT_SECRET: 'test-only-jwt-secret-at-least-32-characters',
                PORT: '3000',
            }),
        ).toThrow('DATABASE_URL')
    })
})