import express, { type ErrorRequestHandler } from 'express'
import { pool } from './db.js'
import { getTodayCharacterForClient } from './characters.js'
import { getUserProfile } from './users.js'
import { z } from 'zod'
import {
  createSession,
  AlreadyStudiedTodayError,
  CharacterNotFoundError,
  NotTodayCharacterError,
} from './sessions.js'
import cors from 'cors'
import { hashPassword, verifyPassword, signToken, requireAuth } from './auth.js'
import { loginLimiter, registerLimiter } from './rateLimit.js'

export const app = express()

// behind Render's proxy every request shares one IP unless we trust exactly one hop
app.set('trust proxy', 1)

// browsers block cross-origin reads by default; list allowed origins explicitly, never *
app.use(cors({
  origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',')
}))

app.use(express.json())

app.get('/api/health', async (_req, res) => {
  try {
    const result = await pool.query('SELECT NOW()')
    res.json({ status: 'ok', time: result.rows[0].now })
  } catch (err) {
    console.error('[health] database unreachable:', err)
    res.status(503).json({ status: 'error', message: 'database unreachable' })
  }
})

app.get('/api/characters/today', requireAuth, async (req, res) => {
  try {
    // userId now comes from the token, not from ?userId=
    const profile = await getUserProfile(req.userId!)
    const learnedIds = profile?.learnedCharacterIds ?? []
    const character = await getTodayCharacterForClient(learnedIds)

    if (!character) {
      res.status(404).json({ error: 'No characters in the database' })
      return
    }
    res.json(character)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const profile = await getUserProfile(req.userId!)
    // path params are always strings — convert and validate yourself
    if (!profile) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    res.json(profile)

  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})



// zod validates the body at runtime — the Pydantic equivalent
const createSessionSchema = z.object({
  characterId: z.number().int().positive(),
  answer: z.string().min(1),
})

app.post('/api/sessions', requireAuth, async (req, res) => {
  const parsed = createSessionSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues })
    return
  }

  // use parsed.data, not req.body — extra fields have been stripped
  const { characterId, answer } = parsed.data

  try {
    const session = await createSession(req.userId!, characterId, answer)
    res.status(201).json(session)
  } catch (err) {
    if (err instanceof AlreadyStudiedTodayError) {
      res.status(409).json({
        error: 'Already studied today',
        code: 'ALREADY_STUDIED_TODAY',
      })
      return
    }
    if (err instanceof NotTodayCharacterError) {
      res.status(409).json({
        error: "Character is not today's character",
        code: 'NOT_TODAYS_CHARACTER',
      })
      return
    }

    if (err instanceof CharacterNotFoundError) {
      res.status(404).json({
        error: 'Character not found',
        code: 'CHARACTER_NOT_FOUND',
      })
      return
    }

    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})


// registration enforces a password policy
const BCRYPT_MAX_PASSWORD_BYTES = 72


const registerSchema = z.object({
  email: z.email(),
  password: z
    .string()
    .min(8)
    .refine(
      password =>
        Buffer.byteLength(password, 'utf8') <= BCRYPT_MAX_PASSWORD_BYTES,
      {
        message: `Password must be at most ${BCRYPT_MAX_PASSWORD_BYTES} UTF-8 bytes`,
      },
    ),
  name: z.string().min(1).optional(),
})


// login only needs a non-empty string; enforcing the policy here would leak it
const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})

app.post('/api/auth/register', registerLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues })
    return
  }

  const { email, password, name } = parsed.data
  const displayName = name ?? email.split('@')[0]

  try {
    const password_hash = await hashPassword(password)

    // normalise the email so casing doesn't create duplicate accounts
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      [displayName, email.toLowerCase(), password_hash]
    )

    const id = rows[0]!.id
    res.status(201).json({ token: signToken(id), user: { id, name: displayName } })
  } catch (err) {
    // 23505 = unique_violation
    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'Email already registered' })
      return
    }
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body' })
    return
  }

  const { email, password } = parsed.data

  try {
    const { rows } = await pool.query<{
      id: number
      name: string
      password_hash: string | null
    }>(`SELECT id, name, password_hash FROM users WHERE email = $1`, [email.toLowerCase()])

    const user = rows[0]

    // one message for both cases, otherwise an attacker can enumerate accounts
    if (!user?.password_hash || !(await verifyPassword(password, user.password_hash))) {
      res.status(401).json({ error: 'Invalid email or password' })
      return
    }

    res.json({ token: signToken(user.id), user: { id: user.id, name: user.name } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (
    err instanceof SyntaxError &&
    'status' in err &&
    err.status === 400 &&
    'type' in err &&
    err.type === 'entity.parse.failed'
  ) {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  if (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    err.status === 413 &&
    'type' in err &&
    err.type === 'entity.too.large'
  ) {
    res.status(413).json({ error: 'Request body too large' })
    return
  }

  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
}

app.use(errorHandler)