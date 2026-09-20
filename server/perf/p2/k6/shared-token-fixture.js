import { SharedArray } from 'k6/data'
import {
  buildSharedTokenFixtureRecords,
  readSharedTokenFixtureMetadata,
  readSharedTokenUser,
} from './k6-token-fixture-contracts.mjs'

const TOKEN_FIXTURE_PATH = '/tmp/tokens.json'

const sharedTokenFixture = new SharedArray('chinstein-p2-token-fixture-v1', () => {
  const serializedFixture = open(TOKEN_FIXTURE_PATH)

  return buildSharedTokenFixtureRecords(serializedFixture)
})

export function getTokenFixtureMetadata() {
  return readSharedTokenFixtureMetadata(sharedTokenFixture)
}

export function getTokenUserBySequence(sequence, expectedPool = null) {
  return readSharedTokenUser(sharedTokenFixture, sequence, expectedPool)
}
