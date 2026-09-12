import 'dotenv/config'
import { app } from './app.js'
import { pool } from './db.js'
import { parseStartupConfig } from './config.js'
import { isGenerationEnabled } from './claude.js'

const config = parseStartupConfig(process.env)

if (!isGenerationEnabled()) {
  console.warn(
    '[startup] story generation disabled — ANTHROPIC_API_KEY not set',
  )
}

const server = app.listen(config.PORT, () => {
  console.log(`API listening on http://localhost:${config.PORT}`)
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