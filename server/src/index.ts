import 'dotenv/config'
import { app } from './app.js'
import { pool } from './db.js'

const port = Number(process.env.PORT) || 3000

const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`)
})

// on SIGTERM: stop accepting connections, drain in-flight requests, close the pool
async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`)
  server.close(async () => {
    await pool.end()
    console.log('closed cleanly')
    process.exit(0)
  })

  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))