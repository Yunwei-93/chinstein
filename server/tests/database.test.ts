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
})
