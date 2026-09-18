import assert from 'node:assert/strict'
import test from 'node:test'
import {
  access,
  chmod,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TOTAL_USERS } from '../fixture-config.mjs'

import {
  DESIGNATED_LOGIN_SEQUENCE,
  TOKEN_FIXTURE_SCHEMA_VERSION,
  TOKEN_TTL_SECONDS,
  poolForSequence,
} from './token-fixture-contracts.mjs'

import { writeTokenFixtureAtomically } from './token-fixture-file.mjs'

const ISSUED_AT = 1_800_000_000

const REAL_FILE_SYSTEM = Object.freeze({
  chmod,
  open,
  rename,
  stat,
  unlink,
})

async function createTemporaryDestination(testContext) {
  const directory = await mkdtemp(join(tmpdir(), 'chinstein-p2-token-file-'))

  testContext.after(async () => {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  })

  return {
    directory,
    destination: join(directory, 'tokens.json'),
  }
}

function buildFixture({ version = 'one' } = {}) {
  return {
    schemaVersion: TOKEN_FIXTURE_SCHEMA_VERSION,
    generatedAt: ISSUED_AT + 5,
    source: {
      hostFingerprint: '0123456789ab',
      database: 'neondb',
      seedDate: '2026-09-18',
    },
    dailyCharacter: {
      id: 10,
      answer: 'known-answer',
    },
    login: {
      sequence: DESIGNATED_LOGIN_SEQUENCE,
      email: 'player_00001@example.invalid',
    },
    users: Array.from({ length: TOTAL_USERS }, (_, index) => {
      const sequence = index + 1

      return {
        sequence,
        userId: 10_000 + sequence,
        pool: poolForSequence(sequence),
        token: `test-token-${version}-${sequence}`,
        issuedAt: ISSUED_AT,
        expiresAt: ISSUED_AT + TOKEN_TTL_SECONDS,
      }
    }),
  }
}

test('writes a complete fixture with mode 0600', async (testContext) => {
  const { destination } = await createTemporaryDestination(testContext)

  const fixture = buildFixture()

  const summary = await writeTokenFixtureAtomically(fixture, { destination })

  const savedFixture = JSON.parse(await readFile(destination, 'utf8'))

  const metadata = await stat(destination)

  assert.equal(savedFixture.users.length, TOTAL_USERS)
  assert.equal(savedFixture.users[0].token, fixture.users[0].token)

  assert.equal(metadata.isFile(), true)
  assert.equal(metadata.mode & 0o777, 0o600)

  assert.equal(summary.usersWritten, TOTAL_USERS)
  assert.equal(summary.fileMode, '0600')
  assert.equal(summary.atomicWrite, true)
  assert.equal(summary.tokensReturned, false)
})

test('returns a summary without token values', async (testContext) => {
  const { destination } = await createTemporaryDestination(testContext)

  const fixture = buildFixture()

  const summary = await writeTokenFixtureAtomically(fixture, { destination })

  const serializedSummary = JSON.stringify(summary)

  for (const user of fixture.users) {
    assert.equal(serializedSummary.includes(user.token), false)
  }
})

test('rejects a relative destination', async () => {
  await assert.rejects(
    writeTokenFixtureAtomically(buildFixture(), {
      destination: 'tokens.json',
    }),
    /destination must be an absolute path/,
  )
})

test('rejects an unexpected destination filename', async (testContext) => {
  const { directory } = await createTemporaryDestination(testContext)

  await assert.rejects(
    writeTokenFixtureAtomically(buildFixture(), {
      destination: join(directory, 'other.json'),
    }),
    /destination filename must be tokens.json/,
  )
})

test('does not create a file for an invalid fixture', async (testContext) => {
  const { destination } = await createTemporaryDestination(testContext)

  const fixture = buildFixture()
  fixture.users.pop()

  await assert.rejects(writeTokenFixtureAtomically(fixture, { destination }), /exactly 8100 users/)

  await assert.rejects(
    () => access(destination),
    (error) => error?.code === 'ENOENT',
  )
})

test('atomically replaces an existing destination', async (testContext) => {
  const { directory, destination } = await createTemporaryDestination(testContext)

  await writeFile(destination, 'old incomplete contents', {
    mode: 0o644,
  })

  const fixture = buildFixture({
    version: 'replacement',
  })

  await writeTokenFixtureAtomically(fixture, { destination })

  const savedFixture = JSON.parse(await readFile(destination, 'utf8'))

  const metadata = await stat(destination)
  const directoryEntries = await readdir(directory)

  assert.equal(savedFixture.users[0].token, 'test-token-replacement-1')

  assert.equal(metadata.mode & 0o777, 0o600)

  assert.deepEqual(directoryEntries, ['tokens.json'])
})

test('preserves the previous file when rename fails', async (testContext) => {
  const { directory, destination } = await createTemporaryDestination(testContext)

  const previousContents = 'previous-complete-fixture\n'

  await writeFile(destination, previousContents, {
    mode: 0o600,
  })

  const fixture = buildFixture({
    version: 'rename-failure',
  })

  const failingFileSystem = {
    ...REAL_FILE_SYSTEM,

    async rename() {
      throw new Error('simulated rename failure with private details')
    },
  }

  await assert.rejects(
    writeTokenFixtureAtomically(fixture, {
      destination,
      fileSystem: failingFileSystem,
    }),
    (error) => {
      assert.equal(error.message, 'Unable to write PERF token fixture: atomic file write failed')

      assert.equal(error.message.includes(fixture.users[0].token), false)

      return true
    },
  )

  assert.equal(await readFile(destination, 'utf8'), previousContents)

  assert.deepEqual(await readdir(directory), ['tokens.json'])
})

test('rejects an incomplete file-system adapter', async (testContext) => {
  const { destination } = await createTemporaryDestination(testContext)

  await assert.rejects(
    writeTokenFixtureAtomically(buildFixture(), {
      destination,
      fileSystem: {},
    }),
    /file-system adapter is incomplete/,
  )
})

test('rejects an unsafe temporary mode before rename', async (testContext) => {
  const { directory, destination } = await createTemporaryDestination(testContext)

  const previousContents = 'previous-safe-file\n'

  await writeFile(destination, previousContents, {
    mode: 0o600,
  })

  let renameCalled = false

  const unsafeModeFileSystem = {
    ...REAL_FILE_SYSTEM,

    async stat(path) {
      const metadata = await stat(path)

      return {
        isFile: () => metadata.isFile(),
        mode: 0o100644,
      }
    },

    async rename(from, to) {
      renameCalled = true
      await rename(from, to)
    },
  }

  await assert.rejects(
    writeTokenFixtureAtomically(
      buildFixture({
        version: 'unsafe-mode',
      }),
      {
        destination,
        fileSystem: unsafeModeFileSystem,
      },
    ),
    /atomic file write failed/,
  )

  assert.equal(renameCalled, false)

  assert.equal(await readFile(destination, 'utf8'), previousContents)

  assert.deepEqual(await readdir(directory), ['tokens.json'])
})

test('reports a temporary cleanup failure without leaking tokens', async (testContext) => {
  const { directory, destination } = await createTemporaryDestination(testContext)

  const fixture = buildFixture({
    version: 'cleanup-failure',
  })

  const failingFileSystem = {
    ...REAL_FILE_SYSTEM,

    async rename() {
      throw new Error('simulated rename failure')
    },

    async unlink() {
      throw new Error('simulated cleanup failure')
    },
  }

  await assert.rejects(
    writeTokenFixtureAtomically(fixture, {
      destination,
      fileSystem: failingFileSystem,
    }),
    (error) => {
      assert.equal(
        error.message,
        'Unable to write PERF token fixture: atomic file write failed and temporary cleanup failed',
      )

      assert.equal(error.message.includes(fixture.users[0].token), false)

      return true
    },
  )

  const directoryEntries = await readdir(directory)

  assert.equal(directoryEntries.length, 1)
  assert.match(directoryEntries[0], /^\.tokens\.json\..+\.tmp$/)
})
