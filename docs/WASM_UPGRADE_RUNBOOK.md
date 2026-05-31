# WASM Contract Upgrade & State Migration Runbook

This runbook covers the end-to-end process for upgrading Soroban WASM contracts and managing state migrations on Stellar mainnet. It includes pre-upgrade validation, signing ceremonies, state migration procedures, and post-upgrade verification.

---

## Overview

Stargate uses Soroban WASM contracts for:
- **Invoice contract** — manages invoice state, payment authorization, and settlement logic
- **Compliance contract** — enforces OFAC screening and velocity limits on-chain
- **Treasury contract** — manages platform treasury operations and multi-sig coordination

Contract upgrades require:
1. **Contract compilation** and validation on testnet/staging
2. **State schema compatibility** analysis
3. **Multi-sig signing ceremony** (if contract is multi-sig enabled)
4. **State migration script** (if schema changes)
5. **Mainnet deployment** and validation
6. **API/Reconciler reconfiguration** (if contract IDs change)
7. **Post-upgrade monitoring** and rollback procedures

---

## Pre-Upgrade Checklist

Complete all items **72 hours before** the scheduled upgrade window.

### Contract & Code Review

- [ ] All contract source code changes are merged to `main` and reviewed
- [ ] Contract compilation completes without warnings on the build system
- [ ] Unit tests pass: `cargo test --manifest-path reconciler/Cargo.toml`
- [ ] Soroban SDK version matches production environment
- [ ] Contract `spec_version` in `soroban_contract_spec!()` is incremented (e.g., `v1` → `v2`)
- [ ] CHANGELOG.md documents the upgrade with breaking/non-breaking changes

### Schema & Migration Planning

- [ ] Contract storage schema is reviewed for compatibility with existing state
- [ ] If schema changes exist:
  - State migration script is written and tested on staging
  - Migration script is version-controlled and includes rollback logic
  - Data loss scenarios are analyzed and documented
- [ ] If no schema changes, document that state is compatible

### Testing on Testnet

- [ ] Compile the contract:
  ```sh
  cd contracts && ./build.sh  # or soroban contract build --release
  ```
- [ ] Deploy to Stellar testnet and verify functionality:
  ```sh
  soroban contract deploy --wasm path/to/contract.wasm \
    --network testnet \
    --source <testnet-key>
  ```
- [ ] Run integration tests against testnet-deployed contract:
  ```sh
  npm run test:e2e -- --testnet
  ```
- [ ] Verify Horizon indexing picks up contract events on testnet
- [ ] If state migration exists, test migration script on testnet sandbox state

### Reconciler & API Staging Validation

- [ ] Reconciler environment variable `INVOICE_CONTRACT_ID` is updated to testnet contract ID
- [ ] Reconciler is rebuilt and started: `cargo build --release && ./target/release/stargate-reconciler`
- [ ] Reconciler status endpoint returns `200`: `curl http://localhost:9090/status`
- [ ] API environment variable `INVOICE_CONTRACT_ID` is updated (if API consumes contract ID)
- [ ] Run smoke tests on staging:
  ```sh
  npm run test:e2e -- --invoice-contract <testnet-contract-id>
  ```
- [ ] Verify webhook delivery works end-to-end on staging

### Signing Ceremony Preparation

If the contract is wrapped in a multi-sig Stellar transaction (e.g., a `SET_AUTHORIZED_INVOKER` operation):

- [ ] Generate the unsigned XDR transaction on a separate online machine
- [ ] Review the transaction with the launch owner and legal team
- [ ] Schedule the multi-sig signing ceremony (see [Signing Ceremony](#signing-ceremony) below)
- [ ] Confirm all custodians are available for the ceremony

---

## Pre-Upgrade Window (T-24 Hours)

### Code Freeze & Backup

- [ ] Freeze feature merges on `main`; only critical fixes and upgrade-related PRs are merged
- [ ] Create a full backup of the production database:
  ```sh
  pg_dump "$DATABASE_DIRECT_URL" \
    | gzip \
    | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "env:ENCRYPTION_KEY" \
    > "stargate_prod_$(date +%Y%m%d_%H%M%S).sql.gz.enc"
  ```
  Store the encrypted backup in a secure location outside the primary database provider.

- [ ] Create a snapshot of the production Soroban contract state:
  ```sh
  soroban contract invoke --id <PRODUCTION_CONTRACT_ID> \
    --network public \
    --fn get_state \
    --source <api-key> > contract_state_backup.json
  ```

### API & Reconciler Preparation

- [ ] Ensure API health checks pass: `GET /health`, `GET /health/deep`, `GET /health/rpc`
- [ ] Verify reconciler status is healthy: `GET http://reconciler-host:9090/status`
- [ ] Prepare deployment pipeline: confirm CI/CD can deploy new containers with updated contract IDs
- [ ] Have rollback plan ready: previous container image tags and database restore scripts available

---

## Upgrade Window

### Phase 1 — State Migration (If Required)

If the contract schema changes and requires data migration:

**1. Disable Payment Processing**

```sh
# Set a feature flag to prevent new payments from being accepted
export WASM_UPGRADE_IN_PROGRESS=true
# Update API configuration or use feature flag endpoint
curl -X POST http://api-host:3000/admin/feature-flags/wasm-upgrade \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

Wait for in-flight payments to complete (check Redis queue: `redis-cli KEYS "payment:*"`). Monitor `GET /health` to ensure no new payments are queued.

**2. Run State Migration Script**

```sh
# Test the migration script on a copy of production state (optional but recommended)
psql "$DATABASE_STAGING_URL" < scripts/migrate-contract-state-v1-to-v2.sql

# Run the migration on production
psql "$DATABASE_DIRECT_URL" < scripts/migrate-contract-state-v1-to-v2.sql
```

**3. Verify Migration Results**

```sql
-- Verify row counts before and after
SELECT table_name, COUNT(*) AS row_count FROM information_schema.tables
WHERE table_schema = 'public'
GROUP BY table_name;
```

Log the migration results and save to incident log.

### Phase 2 — Deploy New Contract to Mainnet

**1. Compile Contract Binary**

```sh
cd contracts
./build.sh  # produces contract.wasm
sha256sum contract.wasm  # record the hash
```

**2. (If Multi-Sig Required) Signing Ceremony**

See [Signing Ceremony](#signing-ceremony) section below.

Proceed only after the signed transaction is verified.

**3. Deploy Contract**

```sh
# If contract is wrapped in multi-sig transaction, submit the signed XDR
curl -X POST https://horizon.stellar.org/transactions \
  -d "tx=$(urlencode <BASE64_SIGNED_XDR>)"

# OR deploy directly if not wrapped in multi-sig
soroban contract deploy --wasm contracts/contract.wasm \
  --network public \
  --source <platform-treasury-key>
```

**4. Record New Contract ID**

```sh
# After deployment, capture the contract ID
soroban contract deploy --wasm contracts/contract.wasm \
  --network public \
  --source <platform-treasury-key> \
  | jq '.address' > contract_id.txt

NEW_CONTRACT_ID=$(cat contract_id.txt)
echo "Deployed contract ID: $NEW_CONTRACT_ID"
```

Verify the contract exists on mainnet:
```sh
soroban contract info --id "$NEW_CONTRACT_ID" --network public
```

### Phase 3 — Update API & Reconciler Configuration

**1. Update Environment Variables**

Update your secret manager (Vercel, AWS KMS, etc.) with the new contract ID:

```sh
# Kubernetes example
kubectl set env deployment/stargate-api \
  INVOICE_CONTRACT_ID=$NEW_CONTRACT_ID \
  -n production

kubectl set env deployment/stargate-reconciler \
  INVOICE_CONTRACT_ID=$NEW_CONTRACT_ID \
  -n production
```

Or update your CI/CD pipeline to inject the new ID into the container at deployment time.

**2. Restart Services**

```sh
# API restart (usually automatic via secret update in Vercel/Heroku)
# Reconciler restart
kubectl rollout restart deployment/stargate-reconciler -n production

# Verify health checks
curl https://api.example.com/health
curl http://reconciler-host:9090/status
```

Wait 2–3 minutes for the reconciler to connect to Soroban RPC and begin indexing events from the new contract.

**3. Verify Event Indexing**

Check reconciler logs for signs of successful Soroban contract event indexing:

```sh
kubectl logs -f deployment/stargate-reconciler -n production | grep soroban
# Should see: "soroban indexer started" or "indexed event..."
```

---

## Signing Ceremony

If the contract upgrade is guarded by a multi-sig Stellar transaction (e.g., `SET_AUTHORIZED_INVOKER` to authorize the new contract), follow the ceremony steps below. This is adapted from [MAINNET_DEPLOYMENT.md](./MAINNET_DEPLOYMENT.md).

### Pre-Ceremony Setup

- [ ] All custodians have verified the unsigned contract deployment transaction
- [ ] A dedicated signing workstation is prepared (see [MAINNET_DEPLOYMENT.md — Pre-Ceremony Checklist](./MAINNET_DEPLOYMENT.md#pre-ceremony-checklist))
- [ ] The unsigned XDR transaction is generated and reviewed:
  ```sh
  soroban contract deploy \
    --wasm contracts/contract.wasm \
    --network public \
    --source <treasury-key> \
    --simulate  # generates unsigned XDR
  ```

### Ceremony Execution

Refer to [MAINNET_DEPLOYMENT.md — Signing Ceremony Steps](./MAINNET_DEPLOYMENT.md#signing-ceremony-steps) for detailed signing procedures.

Key steps:
1. Custodian 1 signs the XDR with their hardware device
2. Custodian 2 signs the XDR (producing fully-signed transaction if 2-of-3 threshold)
3. Verify signatures before submission
4. Submit signed XDR to Horizon

---

## Post-Upgrade Validation

Complete all validation steps **before** enabling production payment processing.

### 1. Contract Functionality Verification

**Test contract methods directly:**

```sh
# Example: invoke a test method on the new contract
soroban contract invoke \
  --id "$NEW_CONTRACT_ID" \
  --network public \
  --fn get_version \
  --source <api-key>
```

**Verify contract events:**

```sh
# Query Soroban RPC for recent events from the new contract
curl -X POST https://soroban-rpc.example.com/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "getEvents",
    "params": {
      "filters": [{"contractIds": ["'"$NEW_CONTRACT_ID"'"]}],
      "limit": 100
    },
    "id": 1
  }' | jq '.result.events'
```

### 2. Reconciler Integration Test

**Verify reconciler is consuming events from the new contract:**

```sh
# Check Redis for recent reconciler state
redis-cli KEYS "reconciler:*"
redis-cli GET reconciler:status
redis-cli GET reconciler:cursor

# Verify invoice status updates are flowing through
redis-cli KEYS "invoice:*"
```

**Run a test invoice payment end-to-end:**

```sh
# Create a test invoice
curl -X POST https://api.example.com/invoices \
  -H "Authorization: Bearer $MERCHANT_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "amount_cents": 1000,
    "currency": "USDC",
    "description": "WASM upgrade test payment"
  }' | jq '.id' > test_invoice_id.txt

# Prepare a payment on the invoice
curl -X GET "https://api.example.com/payments/$(cat test_invoice_id.txt)/prepare-tx" \
  -H "Authorization: Bearer $PAYER_JWT" | jq '.tx'

# Verify webhook delivery (check logs and database)
psql "$DATABASE_DIRECT_URL" -c \
  "SELECT id, status, created_at FROM webhook_deliveries ORDER BY created_at DESC LIMIT 5;"
```

### 3. Health Checks

**API health:**

```sh
curl https://api.example.com/health -v
curl https://api.example.com/health/deep -v
curl https://api.example.com/health/rpc -v
```

All must return `200 OK` with healthy sub-services.

**Reconciler health:**

```sh
curl http://reconciler-host:9090/status
# Expected: {"status":"running","cursor":"<paging_token>"}
```

### 4. Sentry & Monitoring

- [ ] Check Sentry for new error spikes in the last 10 minutes
- [ ] Monitor payment success rate (should remain >98%)
- [ ] Verify webhook delivery success rate (Redis queue length should remain low)
- [ ] Check database query latency and connection pool utilization

### 5. Production Smoke Test

**Send a low-value payment end-to-end:**

```sh
# Execute a real Stellar payment on the test invoice
# Verify it settles within 5 minutes

# Check settlement in database
psql "$DATABASE_DIRECT_URL" -c \
  "SELECT id, status, settled_at FROM invoices 
   WHERE id = '$(cat test_invoice_id.txt)' LIMIT 1;"
```

**Expected result:** Invoice status is `settled`, `settled_at` is recent.

---

## Re-Enable Payment Processing

Once all validation steps pass and the launch owner approves:

```sh
# Disable the upgrade feature flag
curl -X POST https://api.example.com/admin/feature-flags/wasm-upgrade \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'

# Verify new payments are accepted
curl -X GET "https://api.example.com/health" -v
# Should return 200 with no upgrade warnings
```

Monitor the payment success rate for the next **30 minutes** and watch for any errors related to the new contract.

---

## Rollback Procedure

If critical issues arise after upgrade, follow this rollback procedure.

### Decision Tree

| Issue | Severity | Rollback Required |
|-------|----------|-------------------|
| Contract method unavailable | Critical | Yes |
| Event indexing failures | Critical | Yes |
| Payment settlement failures | Critical | Yes |
| Reconciler unable to connect to contract | Critical | Yes |
| Minor event parsing error (non-blocking) | Medium | No — patch and redeploy |
| Cosmetic API response change | Low | No |

### Rollback Steps

**1. Disable new contract**

```sh
# Revert to previous contract ID in environment
kubectl set env deployment/stargate-api \
  INVOICE_CONTRACT_ID=$PREVIOUS_CONTRACT_ID \
  -n production

kubectl set env deployment/stargate-reconciler \
  INVOICE_CONTRACT_ID=$PREVIOUS_CONTRACT_ID \
  -n production
```

**2. Restart services**

```sh
kubectl rollout restart deployment/stargate-api -n production
kubectl rollout restart deployment/stargate-reconciler -n production
```

**3. Restore database state (if state migration was performed)**

```sh
# List available backups
aws s3 ls s3://backup-bucket/stargate_prod_*.sql.gz.enc

# Restore from the encrypted backup
aws s3 cp s3://backup-bucket/stargate_prod_<timestamp>.sql.gz.enc - \
  | openssl enc -aes-256-cbc -d -pbkdf2 -pass "env:ENCRYPTION_KEY" \
  | gunzip \
  | psql "$DATABASE_DIRECT_URL"

# Update reconciler cursor to the pre-upgrade point
psql "$DATABASE_DIRECT_URL" -c \
  "UPDATE reconciler_state SET value='<pre-upgrade-paging-token>' WHERE key='cursor';"

# Restart reconciler
kubectl rollout restart deployment/stargate-reconciler -n production
```

**4. Verify rollback**

```sh
curl https://api.example.com/health -v
curl http://reconciler-host:9090/status
```

**5. Incident Documentation**

- [ ] Create incident ticket with timeline and root cause
- [ ] Schedule post-mortem meeting with engineering and operations
- [ ] Document lessons learned and prevention measures

---

## Contract Versioning & Maintenance

### Tracking Contract Versions

Keep a log of all contract deployments in a version control file:

```yaml
# contracts/DEPLOYMENTS.md
---
- contract: invoice
  network: mainnet
  version: 2.0
  contract_id: CABC...
  deployed_at: 2025-06-15T10:30:00Z
  deployed_by: eng-lead
  status: active
  migration_applied: state_v1_to_v2

- contract: invoice
  network: mainnet
  version: 1.0
  contract_id: CDEF...
  deployed_at: 2025-05-01T14:00:00Z
  deployed_by: eng-lead
  status: archived
```

### State Migration Archive

For each migration, keep a version-controlled migration script:

```sh
# scripts/migrations/
# contract-state-v1-to-v2.sql
# contract-state-v2-to-v3.sql
```

Each script should include:
- Pre-migration validation (row counts, checksums)
- Migration steps (DDL/DML)
- Post-migration validation
- Rollback procedure (reverse migration)

---

## Troubleshooting

### Issue: Reconciler unable to connect to Soroban RPC

**Symptoms:** Reconciler logs show `soroban rpc error` or connection timeout.

**Resolution:**
1. Verify `SOROBAN_RPC_URL` is correct and reachable
2. Check network connectivity from reconciler pod: `ping soroban-rpc.stellar.org`
3. Review Soroban RPC rate limits (default 100 req/s)
4. Restart reconciler with fresh connection

### Issue: Contract event indexing stops or falls behind

**Symptoms:** Reconciler cursor in Redis is stale; new payments are not reflected in the API.

**Resolution:**
1. Check reconciler logs for indexing errors: `kubectl logs deployment/stargate-reconciler -n production | grep soroban`
2. Verify contract ID is correct: `soroban contract info --id "$INVOICE_CONTRACT_ID" --network public`
3. Manually update reconciler cursor to `now`:
   ```sh
   psql "$DATABASE_DIRECT_URL" -c \
     "UPDATE reconciler_state SET value='now' WHERE key='cursor';"
   kubectl rollout restart deployment/stargate-reconciler -n production
   ```

### Issue: State migration fails partway through

**Symptoms:** Database state is partially migrated; API returns errors or inconsistent data.

**Resolution:**
1. **Stop the upgrade immediately** — disable payment processing and isolate the database
2. **Restore from backup** (see [Rollback Procedure](#rollback-procedure))
3. **Analyze migration script** for errors (usually bad SQL or schema assumptions)
4. **Test migration on a copy** of production state in staging
5. **Replan and reschedule** the upgrade after root cause is fixed

---

## Related Documentation

- [LAUNCH_RUNBOOK.md](./LAUNCH_RUNBOOK.md) — mainnet launch procedures
- [MAINNET_DEPLOYMENT.md](./MAINNET_DEPLOYMENT.md) — multi-sig signing ceremony details
- [RECOVERY.md](./RECOVERY.md) — database recovery and backup procedures
- [RECONCILER.md](./RECONCILER.md) — reconciler configuration and operations
- [RECONCILER_INTEGRATION.md](./RECONCILER_INTEGRATION.md) — reconciler data flow and webhook integration

---
