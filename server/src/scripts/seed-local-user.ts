import 'dotenv/config'
import { pool, isLocalDatabase } from '../db.js'
import { hashPassword } from '../auth.js'

if (!isLocalDatabase) {
  throw new Error('Refusing to seed a development user into a non-local database')
}

try {
  await pool.query(
    `INSERT INTO users (id, name)
     VALUES (1, 'Yunwei Li')
     ON CONFLICT (id) DO NOTHING`,
  )

  const result = await pool.query<{ password_hash: string | null }>(
    `SELECT password_hash
       FROM users
      WHERE id = 1`,
  )

  if (result.rows[0]?.password_hash === null) {
    await pool.query(
      `UPDATE users
          SET email = $1,
              password_hash = $2
        WHERE id = 1`,
      [
        'yunweili@example.com',
        await hashPassword('test-only-password'),
      ],
    )
  }

  await pool.query(
    `SELECT setval('users_id_seq', (SELECT MAX(id) FROM users))`,
  )

  console.log('Local development user is ready.')
} finally {
  await pool.end()
}