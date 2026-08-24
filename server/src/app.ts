import express from 'express'
import { pool } from './db.js'
import { getTodayCharacter } from './characters.js'

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
  
