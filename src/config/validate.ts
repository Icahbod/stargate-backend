import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url().or(z.string().startsWith('postgresql://')),
  REDIS_URL: z.string().url().or(z.string().startsWith('redis://')),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  STELLAR_ASSET_ISSUER: z.string().min(3),
  PLATFORM_TREASURY_PUBLIC_KEY: z.string().min(3),
  STELLAR_ASSET_CODE: z.string().default('USDC'),
  HORIZON_URL: z.string().url(),
  STELLAR_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  WEBHOOK_SIGNING_SECRET: z.string().min(16).default('local-webhook-signing-secret'),
  GRAPHQL_GATEWAY_ENABLED: z.coerce.boolean().default(false),
  PORT: z.coerce.number().default(3001),
});

export type AppEnv = z.infer<typeof envSchema>;

export function validate(config: Record<string, unknown>): AppEnv {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment: ${message}`);
  }
  return result.data;
}
