import { Pool } from 'pg'

export const isLocalDatabase = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDatabase ? false : { rejectUnauthorized: true },
})