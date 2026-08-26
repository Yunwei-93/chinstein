import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import type { RequestHandler } from 'express'

const SALT_ROUNDS = 10

// declaration merging so TS knows about req.userId
declare global {
  namespace Express {
    interface Request {
      userId?: number
    }
  }
}

// read lazily so dotenv has definitely run by the time we need it
function getSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set')
  return secret
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS)
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

export function signToken(userId: number): string {
  return jwt.sign({ userId }, getSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  } as jwt.SignOptions)
}


// auth middleware: verify the token and attach userId to the request
export const requireAuth: RequestHandler = (req, res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' })
    return
  }

  const token = header.slice('Bearer '.length)

  try {
    const payload = jwt.verify(token, getSecret()) as { userId: number }
    req.userId = payload.userId
    next()         
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}