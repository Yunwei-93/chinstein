import { Pool } from 'pg'

function getDatabaseHost(databaseUrl: string): string | null {
  try {
    return new URL(databaseUrl).hostname
  } catch {
    return null
  }
}

const databaseHost = getDatabaseHost(process.env.DATABASE_URL ?? '')

export const isLocalDatabase =
  databaseHost === 'localhost' ||
  databaseHost === '127.0.0.1' ||
  databaseHost === '[::1]'

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDatabase ? false : { rejectUnauthorized: true },
  connectionTimeoutMillis: 5_000,
  query_timeout: 5_000,
})
