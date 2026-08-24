import 'dotenv/config'
import { pool } from '../db.js'
import { characters } from '../data/characters.js'


// ON CONFLICT DO NOTHING makes re-running the seed safe
for (const c of characters) {
  await pool.query(
    `INSERT INTO characters (character, pinyin, meaning, story, level)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (character) DO NOTHING`,
    [c.character, c.pinyin, c.meaning, c.story, c.level]
  )
}

//  hard-coded user until auth exists
await pool.query(
  `INSERT INTO users (id, name) VALUES (1, 'Yunwei Li')
   ON CONFLICT (id) DO NOTHING`
)
await pool.query(`SELECT setval('users_id_seq', (SELECT MAX(id) FROM users))`)

const { rows } = await pool.query('SELECT COUNT(*) FROM characters')
console.log(`Seeded. characters table now has ${rows[0].count} rows.`)
await pool.end()