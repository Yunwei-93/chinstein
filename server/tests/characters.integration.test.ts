import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { pool } from '../src/db.js'
import {
  generateStory,
  isGenerationEnabled,
} from '../src/claude.js'
import { getTodayCharacterForClient } from '../src/characters.js'

vi.mock('../src/claude.js', () => ({
  generateStory: vi.fn(),
  isGenerationEnabled: vi.fn(),
}))

const generateStoryMock = vi.mocked(generateStory)
const isGenerationEnabledMock = vi.mocked(isGenerationEnabled)

const expectedDatabaseUrl =
  'postgresql://chinstein_test:test-only-password@127.0.0.1:5433/chinstein_test'

async function resetTestData(): Promise<void> {
  if (process.env.DATABASE_URL !== expectedDatabaseUrl) {
    throw new Error('Refusing to reset a non-test database')
  }

  await pool.query(
    'TRUNCATE TABLE study_sessions, users, characters RESTART IDENTITY CASCADE',
  )
}

async function seedCharacter(): Promise<void> {
  await pool.query(`
    INSERT INTO characters (character, pinyin, meaning, level)
    VALUES ('測', 'cè', 'test', 'test')
  `)
}

describe('story generation resilience', () => {
  beforeEach(async () => {
    await resetTestData()
    vi.resetAllMocks()
    isGenerationEnabledMock.mockReturnValue(true)
  })

  afterEach(async () => {
    await resetTestData()
  })

  afterAll(async () => {
    await pool.end()
  })

  it('stops generating after three failed claims', async () => {
    await seedCharacter()
    generateStoryMock.mockResolvedValue(null)

    await getTodayCharacterForClient([])
    await getTodayCharacterForClient([])
    await getTodayCharacterForClient([])
    await getTodayCharacterForClient([])

    expect(generateStoryMock).toHaveBeenCalledTimes(3)

    const { rows } = await pool.query<{
      story_status: string
      story_attempts: number
      story_started_at: Date | null
    }>(`
        SELECT story_status, story_attempts, story_started_at
          FROM characters
        WHERE character = '測'
      `)

    expect(rows[0]).toEqual({
      story_status: 'failed',
      story_attempts: 3,
      story_started_at: null,
    })
    })

    it('does not consume an attempt when generation is disabled', async () => {
      await seedCharacter()
      isGenerationEnabledMock.mockReturnValue(false)

      await getTodayCharacterForClient([])

      expect(generateStoryMock).not.toHaveBeenCalled()

      const { rows } = await pool.query<{
        story_status: string
        story_attempts: number
        story_started_at: Date | null
      }>(`
          SELECT story_status, story_attempts, story_started_at
            FROM characters
          WHERE character = '測'
        `)

      expect(rows[0]).toEqual({
        story_status: 'pending',
        story_attempts: 0,
        story_started_at: null,
      })
    })

    it('releases the claim when generation throws', async () => {
      await seedCharacter()
      generateStoryMock.mockRejectedValue(
        new Error('simulated generation failure'),
      )

      await expect(
        getTodayCharacterForClient([]),
      ).rejects.toThrow('simulated generation failure')

      const { rows } = await pool.query<{
        story_status: string
        story_attempts: number
      }>(`
          SELECT story_status, story_attempts
            FROM characters
          WHERE character = '測'
        `)

      expect(rows[0]).toEqual({
        story_status: 'pending',
        story_attempts: 1,
      })
    })

    it('marks an exhausted stale claim as failed', async () => {
      await seedCharacter()

      await pool.query(`
        UPDATE characters
            SET story_status = 'generating',
                story_attempts = 3,
                story_started_at = NOW() - INTERVAL '3 minutes'
          WHERE character = '測'
      `)

      await getTodayCharacterForClient([])

      expect(generateStoryMock).not.toHaveBeenCalled()

      const { rows } = await pool.query<{
        story_status: string
        story_attempts: number
        story_started_at: Date | null
      }>(`
        SELECT story_status, story_attempts, story_started_at
        FROM characters
        WHERE character = '測'
      `)

      expect(rows[0]).toEqual({
        story_status: 'failed',
        story_attempts: 3,
        story_started_at: null,
      })
    })

    it('allows only one concurrent request to generate', async () => {
      await seedCharacter()

      let markGenerationStarted!: () => void
      let resolveGeneration!: (story: string | null) => void

      const generationStarted = new Promise<void>((resolve) => {
        markGenerationStarted = resolve
      })

      const deferredStory = new Promise<string | null>((resolve) => {
        resolveGeneration = resolve
      })

      generateStoryMock.mockImplementation(async () => {
        markGenerationStarted()
        return deferredStory
      })

      const firstRequest = getTodayCharacterForClient([])

      await generationStarted

      const secondResult = await getTodayCharacterForClient([])

      expect(secondResult?.story).toBeNull()
      expect(generateStoryMock).toHaveBeenCalledTimes(1)

      resolveGeneration('generated story')

      const firstResult = await firstRequest

      expect(firstResult?.story).toBe('generated story')

      const { rows } = await pool.query<{
        story_status: string
        story_attempts: number
        story_started_at: Date | null
      }>(`
          SELECT story_status, story_attempts, story_started_at
          FROM characters
          WHERE character = '測'
        `)

      expect(rows[0]).toEqual({
        story_status: 'ready',
        story_attempts: 1,
        story_started_at: null,
      })
    })

    it('reclaims a stale claim while attempts remain', async () => {
      await seedCharacter()

      await pool.query(`
        UPDATE characters
            SET story_status = 'generating',
                story_attempts = 1,
                story_started_at = NOW() - INTERVAL '3 minutes'
          WHERE character = '測'
      `)

      generateStoryMock.mockResolvedValue(null)

      await getTodayCharacterForClient([])

      expect(generateStoryMock).toHaveBeenCalledTimes(1)

      const { rows } = await pool.query<{
        story_status: string
        story_attempts: number
      }>(`
          SELECT story_status, story_attempts
            FROM characters
          WHERE character = '測'
        `)

      expect(rows[0]).toEqual({
        story_status: 'pending',
        story_attempts: 2,
      })
    })
  })