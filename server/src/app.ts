import express from 'express'
import { pool } from './db.js'
import { getTodayCharacter } from './characters.js'
import { getUserProfile } from './users.js'
import { z } from 'zod'
import {
  createSession,
  AlreadyStudiedTodayError,
  CharacterNotFoundError,
} from './sessions.js'

export const app = express()

app.use(express.json())

app.get('/api/health', async (_req, res) => {
  try {
    const result = await pool.query('SELECT NOW()')
    res.json({ status: 'ok', time: result.rows[0].now })
  } catch {
    res.status(503).json({ status: 'error', message: 'database unreachable' })
  }
})

app.get('/api/characters/today', async (_req, res) => {
    try{
        const character = await getTodayCharacter()
        if (!character){
            res.status(404).json({ error: 'No characters in the database' })
            return
        }
        res.json(character)
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    }
})

app.get('/api/users/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    // path params are always strings — convert and validate yourself
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid user id' })
      return
    }
    const profile = await getUserProfile(id)
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
  userId: z.number().int().positive(),
  characterId: z.number().int().positive(),
  answer: z.string().min(1),
})

app.post('/api/sessions', async (req, res) => {
  const parsed = createSessionSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues })
    return
  }

  // use parsed.data, not req.body — extra fields have been stripped
  const { userId, characterId, answer } = parsed.data

  try {
    const session = await createSession(userId, characterId, answer)
    res.status(201).json(session)
  } catch (err) {
    if (err instanceof AlreadyStudiedTodayError) {
      res.status(409).json({ error: 'Already studied today' })
      return
    }
    if (err instanceof CharacterNotFoundError) {
      res.status(404).json({ error: 'Character not found' })
      return
    }
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})
