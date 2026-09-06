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

async function resetTestUsers() {
  if (process.env.DATABASE_URL !== expectedDatabaseUrl) {
    throw new Error('Refusing to clear a database that is not the test database')
  }

  await pool.query(
    'TRUNCATE TABLE study_sessions, users RESTART IDENTITY CASCADE',
  )
}

describe('POST /api/auth/register', () => {
  beforeEach(resetTestUsers)
  afterEach(resetTestUsers)

  afterAll(async () => {
    await pool.end()
  })

  it('creates a user and returns a token', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test User',
        email: 'TEST@example.com',
        password: 'test-password-123',
      })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      token: expect.any(String),
      user: {
        id: expect.any(Number),
        name: 'Test User',
      },
    })

    const result = await pool.query<{
      name: string
      email: string
      password_hash: string
    }>(
      `
        SELECT name, email, password_hash
        FROM users
        WHERE email = $1
      `,
      ['test@example.com'],
    )

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.name).toBe('Test User')
    expect(result.rows[0]!.email).toBe('test@example.com')
    expect(result.rows[0]!.password_hash).not.toBe('test-password-123')
  })
})
