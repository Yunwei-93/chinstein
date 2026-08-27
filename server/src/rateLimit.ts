import rateLimit from 'express-rate-limit'


// login: count failures only, so a legitimate user never locks themselves out
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,          // 15 minutes
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',        // RFC-style headers
  legacyHeaders: false,         
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
})


// register: nobody legitimately creates ten accounts an hour
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,          // 1 hour
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many accounts created from this address. Please try again later.' },
})