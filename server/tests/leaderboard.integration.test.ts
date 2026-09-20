import request from 'supertest'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { signToken } from '../src/auth.js'
import { pool } from '../src/db.js'

const expectedDatabaseUrl =
  'postgresql://chinstein_test:test-only-password@127.0.0.1:5433/chinstein_test'

async function resetTestData() {
  if (process.env.DATABASE_URL !== expectedDatabaseUrl) {
    throw new Error('Refusing to clear a database that is not the test database')
  }

  await pool.query('TRUNCATE TABLE study_sessions, users, characters RESTART IDENTITY CASCADE')
}

async function insertPublicUser(name: string): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `
            INSERT INTO users (name, leaderboard_name_public)
            VALUES ($1, TRUE)
            RETURNING id
        `,
    [name],
  )

  return result.rows[0]!.id
}

async function rebuildLeaderboardScores() {
  await pool.query('TRUNCATE TABLE leaderboard_scores')
  await pool.query(`
        INSERT INTO leaderboard_scores (
            user_id,
            total_points,
            session_count
        )
        SELECT
            user_id,
            SUM(points)::bigint,
            COUNT(*)::bigint
        FROM study_sessions
        GROUP BY user_id
    `)
}

describe('GET /api/leaderboard', () => {
  beforeEach(resetTestData)
  afterEach(resetTestData)

  afterAll(async () => {
    await pool.end()
  })

  it('returns an empty leaderboard and masks an unstudied private user', async () => {
    const privateName = 'Private Account Name'

    const { rows } = await pool.query<{ id: number }>(
      `
                INSERT INTO users (name, email)
                VALUES ($1, $2)
                RETURNING id
            `,
      [privateName, 'private-user@example.com'],
    )

    const userId = rows[0]!.id
    const response = await request(app)
      .get('/api/leaderboard')
      .set('Authorization', `Bearer ${signToken(userId)}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      entries: [],
      currentUser: {
        userId,
        name: `player_${userId}`,
        points: 0,
        rank: null,
      },
    })

    expect(JSON.stringify(response.body)).not.toContain(privateName)
  })

  it('gives a numeric rank to a public user who studied but earned zero points', async () => {
    const userResult = await pool.query<{ id: number }>(
      `
                INSERT INTO users (name, leaderboard_name_public)
                VALUES ($1, TRUE)
                RETURNING id
            `,
      ['Zero Point Player'],
    )

    const characterResult = await pool.query<{ id: number }>(
      `
            INSERT INTO characters (
                character,
                pinyin,
                meaning,
                story,
                level,
                story_status,
                story_source
            )
            VALUES ('零', 'líng', 'zero', 'Test story', 'Beginner', 'ready', 'test')
            RETURNING id`,
    )

    const userId = userResult.rows[0]!.id
    const characterId = characterResult.rows[0]!.id

    await pool.query(
      `
                INSERT INTO study_sessions (
                user_id,
                character_id,
                is_correct,
                points,
                studied_on
                )
                VALUES ($1, $2, FALSE, 0, CURRENT_DATE)
            `,
      [userId, characterId],
    )

    await rebuildLeaderboardScores()

    const response = await request(app)
      .get('/api/leaderboard')
      .set('Authorization', `Bearer ${signToken(userId)}`)

    const expectedEntry = {
      userId,
      name: 'Zero Point Player',
      points: 0,
      rank: 1,
    }

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      entries: [expectedEntry],
      currentUser: {
        ...expectedEntry,
      },
    })
  })

  it('uses shared ranks for tied points and user IDs for stable ordering', async () => {
    const firstUserId = await insertPublicUser('First Tied Player')
    const secondUserId = await insertPublicUser('Second Tied Player')
    const thirdUserId = await insertPublicUser('Third Place Player')

    const characterResult = await pool.query<{ id: number }>(
      `
                INSERT INTO characters (
                    character,
                    pinyin,
                    meaning,
                    story,
                    level,
                    story_status,
                    story_source
                )
                VALUES (
                    '并',
                    'bìng',
                    'tie',
                    'Test story',
                    'Beginner',
                    'ready',
                    'test'
                )
                RETURNING id`,
    )

    const characterId = characterResult.rows[0]!.id

    await pool.query(
      `
                INSERT INTO study_sessions (
                    user_id,
                    character_id,
                    is_correct,
                    points,
                    studied_on
                )
                VALUES
                    ($1, $4, TRUE, 20, CURRENT_DATE),
                    ($2, $4, TRUE, 20, CURRENT_DATE),
                    ($3, $4, FALSE, 10, CURRENT_DATE)
            `,
      [firstUserId, secondUserId, thirdUserId, characterId],
    )

    await rebuildLeaderboardScores()

    const response = await request(app)
      .get('/api/leaderboard')
      .set('Authorization', `Bearer ${signToken(thirdUserId)}`)

    expect(response.status).toBe(200)
    expect(response.body.entries).toEqual([
      {
        userId: firstUserId,
        name: 'First Tied Player',
        points: 20,
        rank: 1,
      },
      {
        userId: secondUserId,
        name: 'Second Tied Player',
        points: 20,
        rank: 1,
      },
      {
        userId: thirdUserId,
        name: 'Third Place Player',
        points: 10,
        rank: 3,
      },
    ])

    expect(response.body.currentUser).toEqual({
      userId: thirdUserId,
      name: 'Third Place Player',
      points: 10,
      rank: 3,
    })
  })

  it('returns exactly ten entries and includes the current user separately', async () => {
    const pointsByPosition = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 10, 5]

    const characterResult = await pool.query<{ id: number }>(
      `
                INSERT INTO characters (
                    character,
                    pinyin,
                    meaning,
                    story,
                    level,
                    story_status,
                    story_source
                )
                VALUES (
                    '榜',
                    'bǎng',
                    'list',
                    'Test story',
                    'Beginner',
                    'ready',
                    'test'
                )
                RETURNING id
            `,
    )

    const characterId = characterResult.rows[0]!.id
    const userIds: number[] = []

    for (const [index, points] of pointsByPosition.entries()) {
      const userId = await insertPublicUser(`Player ${index + 1}`)
      userIds.push(userId)

      await pool.query(
        `
                    INSERT INTO study_sessions (
                        user_id,
                        character_id,
                        is_correct,
                        points,
                        studied_on
                    )
                    VALUES ($1, $2, TRUE, $3, CURRENT_DATE)
                `,
        [userId, characterId, points],
      )
    }

    await rebuildLeaderboardScores()

    const currentUserId = userIds[10]!
    const response = await request(app)
      .get('/api/leaderboard')
      .set('Authorization', `Bearer ${signToken(currentUserId)}`)

    expect(response.status).toBe(200)
    expect(response.body.entries).toHaveLength(10)
    expect(response.body.entries.map((entry: { userId: number }) => entry.userId)).toEqual(
      userIds.slice(0, 10),
    )

    expect(response.body.entries[9]).toMatchObject({
      userId: userIds[9],
      points: 10,
      rank: 10,
    })

    expect(response.body.currentUser).toEqual({
      userId: currentUserId,
      name: 'Player 11',
      points: 10,
      rank: 10,
    })

    expect(
      response.body.entries.some((entry: { userId: number }) => entry.userId === currentUserId),
    ).toBe(false)
  })

  it('rejects an unauthenticated request', async () => {
    const response = await request(app).get('/api/leaderboard')

    expect(response.status).toBe(401)
    expect(response.body).toEqual({
      error: 'Missing or malformed Authorization header',
    })
  })
})
