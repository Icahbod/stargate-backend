# Reconciler Sidecar

The `stargate-reconciler` is a Rust binary that streams payments from Stellar Horizon, matches them to invoices, and publishes status updates to Redis. It runs as a sidecar alongside the NestJS API and shares the same Postgres and Redis instances.

For the full integration flow (data model, SSE fanout, webhook delivery) see [`RECONCILER_INTEGRATION.md`](./RECONCILER_INTEGRATION.md).

---

## Build

**Prerequisites:** Rust toolchain ≥ 1.78 (install via [rustup](https://rustup.rs)).

```sh
# Development build
cargo build --manifest-path reconciler/Cargo.toml

# Release build (used in production images)
cargo build --release --manifest-path reconciler/Cargo.toml

# Run tests
cargo test --manifest-path reconciler/Cargo.toml
```

The release binary is written to `reconciler/target/release/stargate-reconciler`.

---

## Configuration

All configuration is read from environment variables at startup via `Config::from_env()`. The reconciler loads `.env` automatically in development (via `dotenvy`).

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Postgres DSN |
| `REDIS_URL` | yes | — | Redis URL |
| `HORIZON_URL` | yes | — | Stellar Horizon base URL |
| `PLATFORM_TREASURY_PUBLIC_KEY` | yes | — | Platform treasury Stellar public key |
| `STELLAR_ASSET_ISSUER` | yes | — | USDC issuer public key |
| `STELLAR_ASSET_CODE` | no | `USDC` | Asset code to monitor |
| `SOROBAN_RPC_URL` | no | — | Soroban RPC endpoint; enables contract event indexing when set |
| `INVOICE_CONTRACT_ID` | no | — | Soroban contract ID; required when `SOROBAN_RPC_URL` is set |
| `EURC_ASSET_ISSUER` | no | — | EURC issuer; if unset any EURC issuer is accepted |
| `OFAC_SCREENING_ENABLED` | no | `true` | Enable TRM Labs OFAC screening |
| `TRM_LABS_API_KEY` | no | — | Required when `OFAC_SCREENING_ENABLED=true` |
| `RECONCILER_CURSOR` | no | `now` | Starting Horizon paging token; overridden by `reconciler_state` DB row |
| `RECONCILER_STATUS_PORT` | no | `9090` | HTTP port for the status endpoint |
| `RUST_LOG` | no | — | Log filter, e.g. `stargate_reconciler=debug,info` |

---

## Running

```sh
# Development (reads .env)
cd reconciler && cargo run

# Production (env vars injected by secret manager / container runtime)
./stargate-reconciler
```

The reconciler sets `reconciler:status = "running"` in Redis on startup. The NestJS `GET /health` endpoint reads this key.

---

## Status Endpoint

A lightweight HTTP server listens on `RECONCILER_STATUS_PORT` (default `9090`).

```
GET /status   →  200 { "status": "running", "cursor": "<paging_token>" }
```

Use this endpoint for liveness probes in Kubernetes or ECS health checks.

---

## Cursor Management

The reconciler persists its Horizon paging cursor in Postgres:

```sql
SELECT value FROM reconciler_state WHERE key = 'cursor';
```

On startup it reads this row; if absent it falls back to `RECONCILER_CURSOR` (default `"now"`).

**To replay from a specific point:**

```sh
psql "$DATABASE_URL" -c \
  "INSERT INTO reconciler_state (key, value) VALUES ('cursor', '<paging_token>')
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;"
```

Restart the reconciler after updating the cursor.

---

## Operational Runbook

### Reconciler is not detecting payments

1. Check the process is running and healthy:
   ```sh
   curl http://localhost:9090/status
   redis-cli GET reconciler:status
   ```
2. Verify the cursor is advancing:
   ```sh
   psql "$DATABASE_URL" -c "SELECT * FROM reconciler_state;"
   ```
3. Confirm Horizon connectivity:
   ```sh
   curl "$HORIZON_URL/fee_stats"
   ```
4. Check logs for errors (`RUST_LOG=debug` for verbose output).

### Reconciler is stuck / cursor not advancing

1. Check for Horizon rate-limiting (HTTP 429 in logs).
2. Verify `DATABASE_URL` is reachable from the reconciler host.
3. If the cursor points to a gap in Horizon history, reset it:
   ```sh
   psql "$DATABASE_URL" -c "UPDATE reconciler_state SET value='now' WHERE key='cursor';"
   ```
   Then restart the reconciler.

### Duplicate payment events

The reconciler uses `INSERT ... ON CONFLICT DO NOTHING` on `payment_events(stellar_tx_hash)`. Duplicates are safe but indicate the cursor was reset to an already-processed range. Verify the cursor value and check for double-processing in `payment_events`.

### OFAC screening failures

If `OFAC_SCREENING_ENABLED=true` and `TRM_LABS_API_KEY` is missing or invalid, the reconciler logs an error and skips screening (it does **not** halt). Rotate the key following the procedure in [`RECOVERY.md`](./RECOVERY.md#trm-labs-api-key-trm_labs_api_key).

### Soroban indexer errors

The Soroban indexer runs as a separate Tokio task. Errors are logged but do not crash the main Horizon stream. Check logs for `soroban indexer error` and verify `SOROBAN_RPC_URL` and `INVOICE_CONTRACT_ID`.

---

## Deployment

### Docker

```dockerfile
FROM rust:1.78-slim AS builder
WORKDIR /app
COPY reconciler/ reconciler/
RUN cargo build --release --manifest-path reconciler/Cargo.toml

FROM debian:bookworm-slim
COPY --from=builder /app/reconciler/target/release/stargate-reconciler /usr/local/bin/
CMD ["stargate-reconciler"]
```

### Kubernetes sidecar

Run the reconciler as a sidecar container in the same pod as the API, sharing environment variables via a `Secret`. Configure a liveness probe against `GET /status` on port `9090`.

### Scaling

Run **one reconciler instance per environment**. Multiple instances would process the same Horizon stream and create duplicate `payment_events` rows (mitigated by the unique constraint, but wasteful). Horizontal scaling is not needed — the bottleneck is Horizon throughput, not CPU.

---

## Related Documentation

- [`RECONCILER_INTEGRATION.md`](./RECONCILER_INTEGRATION.md) — Full data flow and integration details
- [`RECOVERY.md`](./RECOVERY.md) — Cursor reset after DB restore, secrets rotation
- [`LAUNCH_RUNBOOK.md`](./LAUNCH_RUNBOOK.md) — Production deployment checklist
 - [`RECONCILER_CONTRIBUTING.md`](./RECONCILER_CONTRIBUTING.md) — How to run tests and add reconciliation rules
