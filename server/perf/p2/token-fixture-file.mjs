import { randomUUID } from 'node:crypto'
import {
  chmod as chmodFile,
  open as openFile,
  rename as renameFile,
  stat as statFile,
  unlink as unlinkFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'

import { validateTokenFixture } from './token-fixture-contracts.mjs'

export const DEFAULT_TOKEN_FIXTURE_PATH = '/tmp/tokens.json'

const OWNER_READ_WRITE = 0o600

const DEFAULT_FILE_SYSTEM = Object.freeze({
  chmod: chmodFile,
  open: openFile,
  rename: renameFile,
  stat: statFile,
  unlink: unlinkFile,
})

function fail(message) {
  throw new Error(`Unable to write PERF token fixture: ${message}`)
}

function validateDestination(destination) {
  if (
    typeof destination !== 'string' ||
    !isAbsolute(destination) ||
    destination.includes('\u0000')
  ) {
    fail('destination must be an absolute path')
  }

  if (basename(destination) !== 'tokens.json') {
    fail('destination filename must be tokens.json')
  }

  return {
    directory: dirname(destination),
    filename: basename(destination),
  }
}

function validateFileSystem(fileSystem) {
  for (const method of ['chmod', 'open', 'rename', 'stat', 'unlink']) {
    if (typeof fileSystem?.[method] !== 'function') {
      fail('file-system adapter is incomplete')
    }
  }
}

async function assertPrivateRegularFile(fileSystem, path) {
  const metadata = await fileSystem.stat(path)

  if (!metadata.isFile()) {
    fail('fixture artifact is not a regular file')
  }

  if ((metadata.mode & 0o777) !== OWNER_READ_WRITE) {
    fail('fixture artifact does not use mode 0600')
  }
}

async function closeQuietly(fileHandle) {
  if (!fileHandle) {
    return
  }

  try {
    await fileHandle.close()
  } catch {}
}

async function removeTemporaryFile(fileSystem, path) {
  try {
    await fileSystem.unlink(path)
    return true
  } catch (error) {
    return error?.code === 'ENOENT'
  }
}

export async function writeTokenFixtureAtomically(
  fixture,
  { destination = DEFAULT_TOKEN_FIXTURE_PATH, fileSystem = DEFAULT_FILE_SYSTEM } = {},
) {
  const fixtureSummary = validateTokenFixture(fixture)
  const { directory, filename } = validateDestination(destination)

  validateFileSystem(fileSystem)

  const serializedFixture = `${JSON.stringify(fixture)}\n`
  const temporaryPath = join(directory, `.${filename}.${process.pid}.${randomUUID()}.tmp`)

  let fileHandle = null

  try {
    fileHandle = await fileSystem.open(temporaryPath, 'wx', OWNER_READ_WRITE)

    await fileHandle.writeFile(serializedFixture, 'utf8')
    await fileHandle.sync()
    await fileHandle.close()
    fileHandle = null

    await fileSystem.chmod(temporaryPath, OWNER_READ_WRITE)
    await assertPrivateRegularFile(fileSystem, temporaryPath)

    // Atomic visibility is sufficient for this ephemeral artifact.
    // The file is fully verified before rename becomes the final operation.
    await fileSystem.rename(temporaryPath, destination)
  } catch {
    await closeQuietly(fileHandle)

    const temporaryCleanupSucceeded = await removeTemporaryFile(fileSystem, temporaryPath)

    if (!temporaryCleanupSucceeded) {
      fail('atomic file write failed and temporary cleanup failed')
    }

    fail('atomic file write failed')
  }

  return {
    destination,
    bytesWritten: Buffer.byteLength(serializedFixture, 'utf8'),
    usersWritten: fixtureSummary.users,
    pools: fixtureSummary.pools,
    tokenTtlSeconds: fixtureSummary.tokenTtlSeconds,
    fileMode: '0600',
    atomicWrite: true,
    tokensReturned: false,
  }
}
