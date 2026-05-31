# E2E Test Setup and Teardown

This guide explains how to run the end-to-end test suite (`npm run test:e2e`) locally.

## Prerequisites

- Node.js 20+
- Docker (for Postgres and Redis)
- A `.env` file with test-specific values (see below)

## 1. Start Infrastructure

The e2e tests require a live Postgres database and Redis instance. Use Docker Compose:

```bash
docker compose up -d postgres redis
```

This starts:
- Postgres on `localhost:5432`
- Redis on `localhost:6379`

## 2. Configure Environment

Copy the example env file and set the test database URL:

```bash
cp .env.example .env
```

Key variables for e2e tests:

| Variable | Purpose | Example |
|---|---|---|
| `DATABASE_URL` | Primary DB (used by the app under test) | `postgresql://stargate:pass@localhost:5432/stargate` |
| `DATABASE_URL_TEST` | Separate test DB to avoid clobbering dev data | `postgresql://stargate:pass@localhost:5432/stargate_test` |
| `REDIS_URL` | Redis for caching and velocity tracking | `redis://localhost:6379` |
| `JWT_SECRET` | Must be ≥ 32 characters | `minimum-32-chars-high-entropy-secret` |
| `OFAC_SCREENING_ENABLED` | Set to `false` to skip live TRM Labs calls | `false` |

## 3. Run Migrations

Apply all database migrations before running tests:

```bash
npm run db:migrate
```

## 4. Run the E2E Suite

```bash
npm run test:e2e
```

This runs Jest with `./test/jest-e2e.json` as the config, which matches all files ending in `.e2e-spec.ts` under `test/e2e/`.

To run a single spec file:

```bash
npx jest --config ./test/jest-e2e.json test/e2e/concurrent-muxed-id.e2e-spec.ts
```

## Test Structure

Each e2e spec follows this lifecycle:

```
beforeAll  → spin up NestJS app (Test.createTestingModule + app.init())
beforeEach → seed test data (register merchant, obtain JWT)
afterEach  → clean up test data (DELETE from invoices, merchants)
afterAll   → close DB pool and app (pool.end(), app.close())
```

Example skeleton:

```typescript
describe('Feature (e2e)', () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    pool = new Pool({ connectionString: app.get(ConfigService).getOrThrow('DATABASE_URL') });
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  afterEach(async () => {
    // Always clean up rows created during the test
    await pool.query('DELETE FROM invoices WHERE merchant_id = $1', [merchantId]);
    await pool.query('DELETE FROM merchants WHERE id = $1', [merchantId]);
  });
});
```

## Teardown Notes

- Each test is responsible for deleting its own rows in `afterEach`. This keeps tests isolated and avoids cross-test pollution.
- The `pool.end()` call in `afterAll` is required to release Postgres connections and allow Jest to exit cleanly.
- `app.close()` shuts down the NestJS application and all its lifecycle hooks (Redis connections, scheduled tasks, etc.).
- If a test fails mid-run and `afterEach` is skipped, leftover rows in the test database are harmless but can be cleared manually:

```sql
TRUNCATE invoices, merchants CASCADE;
```

## CI

The GitHub Actions workflow (`.github/workflows/backend-ci.yml`) runs e2e tests against a service container:

```yaml
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_USER: stargate
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: stargate_test
  redis:
    image: redis:7
```

The `DATABASE_URL` and `REDIS_URL` secrets are injected automatically in CI.
