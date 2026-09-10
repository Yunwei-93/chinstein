import { z } from 'zod'

const startupConfigSchema = z.object({
    DATABASE_URL: z.url(),
    JWT_SECRET: z.string().min(32),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
})

export function parseStartupConfig(env: NodeJS.ProcessEnv) {
    return startupConfigSchema.parse(env)
}