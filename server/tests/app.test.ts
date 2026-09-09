import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import jwt from 'jsonwebtoken'

describe('POST /api/auth/login', () => {
  it('rejects an invalid request body', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'not-an-email',
        password: '',
      })

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      error: 'Invalid request body',
    })
  })

})

describe('GET /api/me authorization', () => {
  it('rejects a request without an Authorization header', async () => {
    const response = await request(app).get('/api/me')

    expect(response.status).toBe(401)
    expect(response.body).toEqual({
      error: 'Missing or malformed Authorization header',
    })
  })

  it('rejects an invalid token', async () => {
    const response = await request(app)
      .get('/api/me')
      .set('Authorization', 'Bearer definitely-not-a-valid-token')

    expect(response.status).toBe(401)
    expect(response.body).toEqual({
      error: 'Invalid or expired token',
    })
  })

  it('rejects an expired token', async () => {
    const expiredToken = jwt.sign(
      { userId: 1 },
      process.env.JWT_SECRET!,
      { expiresIn: -1 },
    )

    const response = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${expiredToken}`)

    expect(response.status).toBe(401)
    expect(response.body).toEqual({
      error: 'Invalid or expired token',
    })
  })

  it('rejects a signed token with an invalid user ID payload', async () => {
    const token = jwt.sign(
      { userId: 'not-a-number' },
      process.env.JWT_SECRET!,
    )

    const response = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(401)
    expect(response.body).toEqual({
      error: 'Invalid or expired token',
    })
  })
})
