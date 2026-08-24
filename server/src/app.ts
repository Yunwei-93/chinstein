import express from 'express'
import { pool } from './db.js'

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