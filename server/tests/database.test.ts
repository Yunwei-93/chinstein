import { afterAll, describe, expect, it } from 'vitest'
import { pool } from '../src/db.js'

describe('test database connection', () => {
  afterAll(async () => {
    await pool.end()
  })

  it('connects only to the isolated test database', async () => {
    expect(process.env.DATABASE_URL).toBe(
      'postgresql://chinstein_test:test-only-password@127.0.0.1:5433/chinstein_test',
    )

    const result = await pool.query<{
      database_name: string
      database_user: string
    }>(`
      SELECT
        current_database() AS database_name,
        current_user AS database_user
    `)

    expect(result.rows[0]).toEqual({
      database_name: 'chinstein_test',
      database_user: 'chinstein_test',
    })
  })

  it('enforces story generation state and attempt defaults', async () => {
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      const inserted = await client.query<{
        id: number
        story_status: string
        story_attempts: number
      }>(`
        INSERT INTO characters (character, pinyin, meaning, level)
        VALUES ('測', 'cè', 'test', 'test')
        RETURNING id, story_status, story_attempts
      `)

      expect(inserted.rows[0]).toMatchObject({
        story_status: 'pending',
        story_attempts: 0,
      })

      const id = inserted.rows[0].id

      await expect(
        client.query(
          `UPDATE characters SET story_status = 'failed' WHERE id = $1`,
          [id],
        ),
      ).resolves.toBeDefined()

      await expect(
        client.query(
          `UPDATE characters SET story_status = 'invalid' WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow()
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
