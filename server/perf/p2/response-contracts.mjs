import { getBaselineScenario } from './baseline-contracts.mjs'

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property)
}

function classifyUnexpectedStatus(status) {
  if (status === 0) {
    return 'transport-error'
  }

  if (status === 401) {
    return 'unauthorized'
  }

  if (status === 409) {
    return 'unexpected-conflict'
  }

  if (status === 429) {
    return 'rate-limited'
  }

  if (status >= 500) {
    return 'server-error'
  }

  return 'unexpected-status'
}

function validateHealth(body, reasons) {
  if (!isObject(body)) {
    reasons.push('health response is not an object')
    return
  }

  if (body.status !== 'ok') {
    reasons.push('health status is not ok')
  }

  if (typeof body.time !== 'string' || body.time.length === 0) {
    reasons.push('health response has no database time')
  }
}

function validateLogin(body, reasons) {
  if (!isObject(body)) {
    reasons.push('login response is not an object')
    return
  }

  if (typeof body.token !== 'string' || body.token.length === 0) {
    reasons.push('login response has no token')
  }

  if (!isObject(body.user)) {
    reasons.push('login response has no user')
    return
  }

  if (!isPositiveInteger(body.user.id)) {
    reasons.push('login user ID is invalid')
  }

  if (typeof body.user.name !== 'string' || body.user.name.length === 0) {
    reasons.push('login user name is invalid')
  }
}

function validateTodayCharacter(body, reasons, expectedTodayAnswer) {
  if (!isObject(body)) {
    reasons.push('today-character response is not an object')
    return
  }

  if (!isPositiveInteger(body.id)) {
    reasons.push('today-character ID is invalid')
  }

  if (hasOwn(body, 'meaning')) {
    reasons.push('today-character response exposes meaning')
  }

  if (typeof body.story !== 'string' || body.story.length === 0) {
    reasons.push('today-character story is missing')
  }

  if (!Array.isArray(body.options) || body.options.length !== 3) {
    reasons.push('today-character must contain three options')
    return
  }

  if (new Set(body.options).size !== 3) {
    reasons.push('today-character options are not distinct')
  }

  if (typeof expectedTodayAnswer !== 'string' || expectedTodayAnswer.length === 0) {
    reasons.push('known today-character answer was not supplied')
    return
  }

  if (!body.options.includes(expectedTodayAnswer)) {
    reasons.push('today-character options omit the known answer')
  }
}

function validateCurrentUser(body, reasons) {
  if (!isObject(body)) {
    reasons.push('current-user response is not an object')
    return
  }

  if (!isPositiveInteger(body.id)) {
    reasons.push('current-user ID is invalid')
  }

  if (typeof body.name !== 'string' || body.name.length === 0) {
    reasons.push('current-user name is invalid')
  }

  if (!Number.isFinite(body.points)) {
    reasons.push('current-user points are invalid')
  }

  if (!Number.isInteger(body.streak) || body.streak < 0) {
    reasons.push('current-user streak is invalid')
  }

  if (!Array.isArray(body.badges)) {
    reasons.push('current-user badges are invalid')
  }

  if (!Array.isArray(body.learnedCharacterIds)) {
    reasons.push('current-user learned character IDs are invalid')
  }

  if (typeof body.completedToday !== 'boolean') {
    reasons.push('current-user completedToday is invalid')
  }
}

function validateLeaderboard(body, reasons) {
  if (!isObject(body)) {
    reasons.push('leaderboard response is not an object')
    return
  }

  if (!Array.isArray(body.entries)) {
    reasons.push('leaderboard entries are invalid')
  }

  if (!isObject(body.currentUser)) {
    reasons.push('leaderboard current user is invalid')
    return
  }

  if (!isPositiveInteger(body.currentUser.userId)) {
    reasons.push('leaderboard current-user ID is invalid')
  }

  if (!Number.isFinite(body.currentUser.points)) {
    reasons.push('leaderboard current-user points are invalid')
  }
}

function validateCreatedSession(body, reasons, expectedCharacterId) {
  if (!isObject(body)) {
    reasons.push('created-session response is not an object')
    return
  }

  if (!isPositiveInteger(body.characterId)) {
    reasons.push('created-session character ID is invalid')
  }

  if (Number.isInteger(expectedCharacterId) && body.characterId !== expectedCharacterId) {
    reasons.push('created-session used the wrong character')
  }

  if (typeof body.isCorrect !== 'boolean') {
    reasons.push('created-session isCorrect is invalid')
  }

  if (!Number.isFinite(body.gainedPoints)) {
    reasons.push('created-session gainedPoints is invalid')
  }

  if (!Array.isArray(body.newBadges)) {
    reasons.push('created-session newBadges is invalid')
  }
}

function validateExistingSessionConflict(body, reasons, expectedCode) {
  if (!isObject(body)) {
    reasons.push('conflict response is not an object')
    return
  }

  if (body.code !== expectedCode) {
    reasons.push('conflict response has the wrong code')
  }
}

export function classifyScenarioResponse({
  scenarioId,
  status,
  body,
  expectedTodayAnswer = null,
  expectedCharacterId = null,
}) {
  const scenario = getBaselineScenario(scenarioId)
  const reasons = []

  if (status !== scenario.expectedStatus) {
    return {
      scenarioId,
      expected: false,
      category: classifyUnexpectedStatus(status),
      status,
      reasons: [`expected status ${scenario.expectedStatus}, received ${status}`],
    }
  }

  switch (scenario.responseContract) {
    case 'health':
      validateHealth(body, reasons)
      break

    case 'login':
      validateLogin(body, reasons)
      break

    case 'today-character':
      validateTodayCharacter(body, reasons, expectedTodayAnswer)
      break

    case 'current-user':
      validateCurrentUser(body, reasons)
      break

    case 'leaderboard':
      validateLeaderboard(body, reasons)
      break

    case 'created-session':
      validateCreatedSession(body, reasons, expectedCharacterId)
      break

    case 'existing-session-conflict':
      validateExistingSessionConflict(body, reasons, scenario.expectedCode)
      break

    default:
      reasons.push(`unknown response contract: ${scenario.responseContract}`)
  }

  return {
    scenarioId,
    expected: reasons.length === 0,
    category: reasons.length === 0 ? 'expected' : 'contract-error',
    status,
    reasons,
  }
}
