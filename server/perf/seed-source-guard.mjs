import { PerfSafetyError } from './staging-guard.mjs'
import { assertSafeSeedClock, assertSeedPrivileges } from './seed-preflight.mjs'
import { assertCoreColumns, assertCoreRelations } from './seed-schema-preflight.mjs'
import {
  approvedSeedSourcesMatch,
  assertApprovedSeedSourceDataset,
} from './seed-dataset-preflight.mjs'

// Run every safety check required before replacing a staging dataset.
export async function runWriteSafetyGates(
  client,
  { expectedDataset = null, expectedClassification = null } = {},
) {
  const requiredClassification = expectedClassification ?? expectedDataset?.classification ?? null

  const clock = await assertSafeSeedClock(client, {
    requireReadWrite: true,
  })
  const privileges = await assertSeedPrivileges(client)
  const coreRelations = await assertCoreRelations(client)
  const coreColumns = await assertCoreColumns(client)
  const dataset = await assertApprovedSeedSourceDataset(client, {
    expectedClassification: requiredClassification,
  })

  if (expectedDataset !== null && !approvedSeedSourcesMatch(expectedDataset, dataset)) {
    throw new PerfSafetyError('Approved seed source changed while acquiring locks')
  }

  return {
    clock,
    privileges,
    coreRelations,
    coreColumns,
    dataset,
  }
}

// Lock every table that belongs to the selected approved source.
export async function lockApprovedSeedSource(client, dataset) {
  if (dataset.mappingState === 'absent') {
    await client.query(`
      LOCK TABLE
        public.users,
        public.study_sessions,
        public.characters
      IN ACCESS EXCLUSIVE MODE
    `)

    return
  }

  if (dataset.mappingState === 'present') {
    await client.query(`
      LOCK TABLE
        public.users,
        public.study_sessions,
        public.characters,
        public.perf_users,
        public.perf_characters
      IN ACCESS EXCLUSIVE MODE
    `)

    return
  }

  throw new PerfSafetyError('Cannot lock an unapproved seed source')
}
