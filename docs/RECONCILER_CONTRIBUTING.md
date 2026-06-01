# Reconciler Contributor Guide

This guide explains the reconciler architecture, how to run its tests, and the recommended process for adding new reconciliation rules.

## Architecture (high-level)

- The reconciler is a Rust sidecar binary located in `reconciler/`.
- Entry point: `reconciler/src/main.rs` — starts the Horizon stream reader, optional Soroban indexer, and status HTTP server.
- Stream parsing and business logic are implemented in `reconciler/src/processor.rs` and `reconciler/src/stream.rs`.
- Status and operational helpers are in `reconciler/src/status.rs`.
- Persistent state: Postgres tables (`reconciler_state`, `payment_events`, `ledger_entries`, `invoices`, etc.).
- Short-lived caches and coordination use Redis (keys like `reconciler:status` and `ofac:<address>`).
- Tests for processing logic live in `reconciler/src/processor_tests.rs` (unit/integration-style tests using a test Postgres DB and Redis).

Read the runtime and deployment overview in `docs/RECONCILER.md` for environment variables, status endpoint, and runbook.

## Running the code and tests

- Install Rust toolchain (recommended via `rustup`) — Rust ≥ 1.78.
- Build:

```sh
cargo build --manifest-path reconciler/Cargo.toml
```

- Run locally (dev):

```sh
cd reconciler
cargo run
```

- Run the reconciler test suite (processor tests require a reachable Postgres and Redis):

```sh
# from repo root
cargo test --manifest-path reconciler/Cargo.toml
```

Test environment tips:
- The tests use `DATABASE_URL` and `REDIS_URL` environment variables. By default the tests fall back to `postgresql://postgres:postgres@localhost:5432/stargate_test` and `redis://127.0.0.1:6379` respectively — override these to point at your local test DB/Redis.
- The tests in `processor_tests.rs` seed and clean up rows they touch, but they expect a clean test DB schema. Use the repository migrations in `db/migrations/` to create the schema in your test database before running tests.
- Example run (assuming docker-compose provides services):

```sh
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/stargate_test
export REDIS_URL=redis://127.0.0.1:6379
cargo test --manifest-path reconciler/Cargo.toml
```

## How reconciliation rules are organized

- Core payment processing lives in `reconciler/src/processor.rs`.
- The processor receives parsed Horizon payments (`HorizonPayment` from `stream.rs`) and applies rule checks in sequence:
  - asset / asset-issuer matching
  - parsing memo / muxed destination matching to invoices
  - amount verification (gross/net values)
  - OFAC/TRM screening integration
  - inserts into `payment_events` and `ledger_entries` and invoice state transitions

Most rules are implemented as small helper functions inside `processor.rs` so they are easy to unit test.

## Adding a new reconciliation rule

Follow this recommended workflow to add a new rule safely and with test coverage:

1. Design the rule and DB changes
   - Decide whether the rule requires schema changes (new columns, tables, or indexes). If so, add a migration under `db/migrations/` following the repository's migration conventions.
   - Choose telemetry/log lines you want for observability and add concise `tracing::info!`/`debug!` calls.

2. Implement the rule in `reconciler/src/processor.rs`
   - Keep the rule small and side-effect free when possible (helper pure function returning an enum/result).
   - Call the helper from the main `process_payment` flow where appropriate, before committing DB writes.
   - If the rule needs external integration (e.g., a new HTTP call or cache key), add it behind configuration flags and fall back safely when unavailable.

3. Add unit tests
   - Add focused tests to `reconciler/src/processor_tests.rs` that exercise the new rule's behavior (happy path, failure path, edge cases).
   - Use the existing helpers (`seed_merchant_and_invoice`, `make_payment`, `cleanup`) to avoid duplicating setup logic.
   - Tests should assert DB state (e.g., `payment_events`, `invoices.status`, `ledger_entries`) as other tests do.

4. Run tests locally

```sh
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/stargate_test
export REDIS_URL=redis://127.0.0.1:6379
cargo test --manifest-path reconciler/Cargo.toml
```

5. Add or update integration/e2e tests if the rule affects system behavior beyond the reconciler's unit boundary (optional but recommended for cross-service rules).

6. Update docs and changelog
   - Document the behavioral change in this guide and in `CHANGELOG.md` if the change alters public behavior.
   - If you added DB migrations, add a short note under `docs/RECONCILER.md` or the runbook describing any deployment steps.

## Testing checklist for PRs

- `cargo test --manifest-path reconciler/Cargo.toml` passes locally.
- New unit tests cover both success and failure paths for the new rule.
- If migrations were added, they apply cleanly: `psql "$DATABASE_URL" -f db/migrations/<your_migration>.sql`.
- Changes that affect the NestJS API or DB schema include an updated integration test or e2e test in `test/e2e/` where appropriate.

## Debugging tips

- Increase logging: `RUST_LOG=stargate_reconciler=debug cargo run --manifest-path reconciler/Cargo.toml`.
- Inspect `reconciler:status` and OFAC keys in Redis with `redis-cli GET reconciler:status` and `redis-cli GET ofac:<address>`.
- Replay or reset the Horizon cursor by updating `reconciler_state` as documented in `docs/RECONCILER.md`.

## Where to look for examples

- Reference tests: `reconciler/src/processor_tests.rs` — shows common patterns for seeding data and asserting outcomes.
- Production flow: `reconciler/src/main.rs` and `reconciler/src/processor.rs`.

If you'd like, I can also: run the reconciler's `cargo test` here, add a short example migration template, or link this guide from `docs/RECONCILER.md`.
