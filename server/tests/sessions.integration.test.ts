import request from 'supertest'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'
import { app } from '../src/app.js'
import { pool } from '../src/db.js'

const expectedDatabaseUrl =
  'postgresql://chinstein_test:test-only-password@127.0.0.1:5433/chinstein_test'

async function resetTestData() {
  if (process.env.DATABASE_URL !== expectedDatabaseUrl) {
    throw new Error('Refusing to clear a database that is not the test database')
  }

  await pool.query(
    'TRUNCATE TABLE study_sessions, users, characters RESTART IDENTITY CASCADE',
  )
}

async function seedCharacters() {
  await pool.query(`
    INSERT INTO characters (
      character,
      pinyin,
      meaning,
      story,
      level,
      story_status,
      story_source
    )
    VALUES
      ('一', 'yī', 'one', 'Test story one', 'Beginner', 'ready', 'test'),
      ('二', 'èr', 'two', 'Test story two', 'Beginner', 'ready', 'test'),
      ('三', 'sān', 'three', 'Test story three', 'Beginner', 'ready', 'test')
  `)
}

async function registerTestUser(email: string) {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      name: 'Session Test User',
      email,
      password: 'test-password-123',
    })

  expect(response.status).toBe(201)

  return {
    token: response.body.token as string,
    userId: response.body.user.id as number,
  }
}

async function getTodayCharacterId(token: string): Promise<number> {
  const response = await request(app)
    .get('/api/characters/today')
    .set('Authorization', `Bearer ${token}`)

  expect(response.status).toBe(200)
  expect(response.body.id).toEqual(expect.any(Number))

  return response.body.id as number
}

describe('POST /api/sessions', () => {
  beforeEach(async () => {
    await resetTestData()
    await seedCharacters()
  })

  afterEach(resetTestData)

  afterAll(async () => {
    await pool.end()
  })

  it("rejects a character that is not today's character", async () => {
    const { token, userId } = await registerTestUser(
      'session@example.com',
    )

    const todayCharacterId = await getTodayCharacterId(token)

    const otherCharacterResult = await pool.query<{
      id: number
      meaning: string
    }>(
      `
        SELECT id, meaning
        FROM characters
        WHERE id <> $1
        ORDER BY id
        LIMIT 1
      `,
      [todayCharacterId],
    )

    const otherCharacter = otherCharacterResult.rows[0]!

    const sessionResponse = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        characterId: otherCharacter.id,
        answer: otherCharacter.meaning,
      })

    expect(sessionResponse.status).toBe(409)
    expect(sessionResponse.body).toEqual({
      error: "Character is not today's character",
      code: 'NOT_TODAYS_CHARACTER',
    })

    const countResult = await pool.query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM study_sessions
        WHERE user_id = $1
      `,
      [userId],
    )

    expect(countResult.rows[0]!.count).toBe(0)
  })

  it("accepts today's character and records the correct answer", async () => {
    const { token, userId } = await registerTestUser(
      'correct-session@example.com',
    )

    const todayCharacterId = await getTodayCharacterId(token)

    const characterResult = await pool.query<{
      character: string
      meaning: string
    }>(
      `
        SELECT character, meaning
        FROM characters
        WHERE id = $1
      `,
      [todayCharacterId],
    )

    const todayCharacter = characterResult.rows[0]!

    const sessionResponse = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        characterId: todayCharacterId,
        answer: todayCharacter.meaning,
      })

    expect(sessionResponse.status).toBe(201)
    expect(sessionResponse.body).toMatchObject({
      characterId: todayCharacterId,
      character: todayCharacter.character,
      meaning: todayCharacter.meaning,
      isCorrect: true,
      gainedPoints: 20,
    })

    const sessionResult = await pool.query<{
      user_id: number
      character_id: number
      is_correct: boolean
      points: number
    }>(
      `
        SELECT user_id, character_id, is_correct, points
        FROM study_sessions
        WHERE user_id = $1
      `,
      [userId],
    )

    expect(sessionResult.rows).toEqual([
      {
        user_id: userId,
        character_id: todayCharacterId,
        is_correct: true,
        points: 20,
      },
    ])
  })

  it('ignores client-supplied scoring and records an incorrect answer', async () => {
    const { token, userId } = await registerTestUser(
      'incorrect-session@example.com',
    )

    const todayCharacterId = await getTodayCharacterId(token)

    const sessionResponse = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        characterId: todayCharacterId,
        answer: 'definitely-not-a-correct-answer',

        // A malicious client tries to award itself points.
        isCorrect: true,
        points: 9999,
      })

    expect(sessionResponse.status).toBe(201)
    expect(sessionResponse.body).toMatchObject({
      characterId: todayCharacterId,
      isCorrect: false,
      gainedPoints: 0,
    })

    const sessionResult = await pool.query<{
      is_correct: boolean
      points: number
    }>(
      `
        SELECT is_correct, points
        FROM study_sessions
        WHERE user_id = $1
      `,
      [userId],
    )

    expect(sessionResult.rows).toEqual([
      {
        is_correct: false,
        points: 0,
      },
    ])
  })

  it('allows only one study session per user per day', async () => {
    const { token, userId } = await registerTestUser(
      'duplicate-session@example.com',
    )

    const todayCharacterId = await getTodayCharacterId(token)

    const requestBody = {
      characterId: todayCharacterId,
      answer: 'definitely-not-a-correct-answer',
    }

    const firstResponse = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send(requestBody)

    const secondResponse = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send(requestBody)

    expect(firstResponse.status).toBe(201)
    expect(secondResponse.status).toBe(409)
    expect(secondResponse.body).toEqual({
      error: 'Already studied today',
      code: 'ALREADY_STUDIED_TODAY',
    })

    const countResult = await pool.query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM study_sessions
        WHERE user_id = $1
      `,
      [userId],
    )

    expect(countResult.rows[0]!.count).toBe(1)
  })

  it('returns 404 when the character does not exist', async () => {
    const { token, userId } = await registerTestUser(
      'missing-character@example.com',
    )

    const sessionResponse = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        characterId: 999999,
        answer: 'anything',
      })

    expect(sessionResponse.status).toBe(404)
    expect(sessionResponse.body).toEqual({
      error: 'Character not found',
      code: 'CHARACTER_NOT_FOUND',
    })

    const countResult = await pool.query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM study_sessions
        WHERE user_id = $1
      `,
      [userId],
    )

    expect(countResult.rows[0]!.count).toBe(0)
  })

  it('allows only one concurrent study session per user per day', async () => {
    const { token, userId } = await registerTestUser(
      'concurrent-session@example.com',
    )

    const todayCharacterId = await getTodayCharacterId(token)
    const characterResult = await pool.query<{ meaning: string }>(
      'SELECT meaning FROM characters WHERE id = $1',
      [todayCharacterId],
    )

    const requestBody = {
      characterId: todayCharacterId,
      answer: characterResult.rows[0]!.meaning,
    }

    const sendSession = () =>
      request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send(requestBody)

    const responses = await Promise.all([
      sendSession(),
      sendSession(),
    ])

    expect(responses.map(response => response.status).sort()).toEqual([201, 409])

    const conflictResponse = responses.find(response => response.status === 409)
    expect(conflictResponse?.body).toEqual({
      error: 'Already studied today',
      code: 'ALREADY_STUDIED_TODAY',
    })

    const result = await pool.query<{ count: number; points: number }>(
      `
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(points), 0)::int AS points
      FROM study_sessions
      WHERE user_id = $1
    `,
      [userId],
    )

    expect(result.rows[0]).toEqual({
      count: 1,
      points: 20,
    })
  })
})
