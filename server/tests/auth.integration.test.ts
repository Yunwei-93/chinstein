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

describe('authentication integration', () => {
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

  it('logs in a registered user', async () => {
    const registrationResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Login Test User',
        email: 'login@example.com',
        password: 'test-password-123',
      })

    expect(registrationResponse.status).toBe(201)

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'LOGIN@example.com',
        password: 'test-password-123',
      })

    expect(loginResponse.status).toBe(200)
    expect(loginResponse.body).toEqual({
      token: expect.any(String),
      user: registrationResponse.body.user,
    })
  })

  it('rejects an incorrect password', async () => {
    const registrationResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Wrong Password User',
        email: 'wrong-password@example.com',
        password: 'correct-password-123',
      })

    expect(registrationResponse.status).toBe(201)

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'wrong-password@example.com',
        password: 'incorrect-password-123',
      })

    expect(loginResponse.status).toBe(401)
    expect(loginResponse.body).toEqual({
      error: 'Invalid email or password',
    })
  })

  it('does not reveal whether an email is registered', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'does-not-exist@example.com',
        password: 'some-password-123',
      })

    expect(response.status).toBe(401)
    expect(response.body).toEqual({
      error: 'Invalid email or password',
    })
  })

  it('rejects a duplicate email regardless of casing', async () => {
    const firstResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'First User',
        email: 'duplicate@example.com',
        password: 'test-password-123',
      })

    const secondResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Second User',
        email: 'DUPLICATE@example.com',
        password: 'another-password-123',
      })

    expect(firstResponse.status).toBe(201)
    expect(secondResponse.status).toBe(409)
    expect(secondResponse.body).toEqual({
      error: 'Email already registered',
    })

    const result = await pool.query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM users
        WHERE email = $1
      `,
      ['duplicate@example.com'],
    )

    expect(result.rows[0]!.count).toBe(1)
  })

  it('uses a registration token to access the user profile', async () => {
    const registrationResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Protected User',
        email: 'protected@example.com',
        password: 'test-password-123',
      })

    expect(registrationResponse.status).toBe(201)

    const token = registrationResponse.body.token

    const profileResponse = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${token}`)

    expect(profileResponse.status).toBe(200)
    expect(profileResponse.body).toMatchObject({
      id: registrationResponse.body.user.id,
      name: 'Protected User',
      level: 'Beginner',
      points: 0,
      streak: 0,
      learnedCharacterIds: [],
      completedToday: false,
      lastStudiedDate: null,
      lastSession: null,
    })
  })

  it('rejects registration passwords longer than 72 UTF-8 bytes', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Long Password User',
        email: 'long-password@example.com',
        password: '汉'.repeat(25),
      })

    expect(Buffer.byteLength('汉'.repeat(25), 'utf8')).toBe(75)
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      error: 'Invalid request body',
    })
  })

  it('accepts a registration password exactly 72 UTF-8 bytes', async () => {
    const password = '汉'.repeat(24)

    expect(Buffer.byteLength(password, 'utf8')).toBe(72)

    const response = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Boundary Password User',
        email: 'boundary-password@example.com',
        password,
      })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      token: expect.any(String),
      user: {
        name: 'Boundary Password User',
      },
    })
  })

  it('uses the token identity instead of a client-supplied user ID', async () => {
    const aliceResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alice',
        email: 'alice-isolation@example.com',
        password: 'test-password-123',
      })

    const bobResponse = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Bob',
        email: 'bob-isolation@example.com',
        password: 'test-password-123',
      })

    expect(aliceResponse.status).toBe(201)
    expect(bobResponse.status).toBe(201)

    const profileResponse = await request(app)
      .get(`/api/me?userId=${bobResponse.body.user.id}`)
      .set('Authorization', `Bearer ${aliceResponse.body.token}`)

    expect(profileResponse.status).toBe(200)
    expect(profileResponse.body).toMatchObject({
      id: aliceResponse.body.user.id,
      name: 'Alice',
    })

    expect(profileResponse.body.id).not.toBe(bobResponse.body.user.id)
  })
})
