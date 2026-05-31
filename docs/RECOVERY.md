# Stargate Database Recovery

## Targets

- RTO: less than 1 hour.
- RPO: less than 5 minutes when provider point-in-time recovery is enabled.

## Backup Policy

- Enable provider PITR for the production PostgreSQL database.
- Keep daily encrypted logical backups for at least 30 days.
- Store backups outside the primary database provider account.
- Test restore before launch and after every material schema change.

## Restore Procedure

1. Identify the restore point or backup file.
2. Provision a fresh PostgreSQL instance.
3. Restore the selected PITR snapshot or logical dump.
4. Verify critical table row counts: merchants, invoices, payment events, ledger entries, settlements, webhooks.
5. Run `npm run db:migrate` against the restored database.
6. Point a staging API instance at the restored database and run smoke tests.
7. Promote only after approval from the launch owner.

## Logical Backup Example

```sh
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
pg_dump "$DATABASE_DIRECT_URL" \
  | gzip \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "env:ENCRYPTION_KEY" \
  > "stargate_prod_${TIMESTAMP}.sql.gz.enc"
```

---

## Postgres Disaster Recovery

### Failure Scenarios

| Scenario | Action |
|---|---|
| Primary instance unreachable | Promote read replica or restore from PITR snapshot |
| Data corruption / accidental delete | PITR restore to a point before the event |
| Full region outage | Restore from cross-region backup into a new region |

### Failover Procedure

1. Confirm the primary is truly unavailable (check provider console and `GET /health`).
2. If a read replica exists, promote it via the provider console or CLI.
3. Update `DATABASE_URL` in the secret manager to point to the promoted replica.
4. Restart the API and reconciler processes so they pick up the new DSN.
5. Verify `GET /health` returns `200` and run smoke tests.
6. Notify the on-call team and open a post-mortem ticket.

### Point-in-Time Recovery (PITR)

1. Identify the target recovery timestamp (just before the incident).
2. Initiate a PITR restore in the provider console to a **new** instance — never overwrite the primary until the restore is verified.
3. Once the restore completes, run:
   ```sh
   npm run db:migrate          # apply any pending migrations
   ```
4. Verify critical table row counts: `merchants`, `invoices`, `payment_events`, `ledger_entries`, `settlements`, `webhooks`.
5. Point a staging API instance at the restored database and run `npm test` and `npm run test:e2e`.
6. Promote the restored instance to primary after approval from the launch owner.
7. Update `DATABASE_URL` in the secret manager and restart services.

### Reconciler Cursor After Restore

After a database restore the `reconciler_state` cursor may be stale or missing.

```sh
# Set cursor to a safe point before the incident (use a Stellar paging token or "now")
psql "$DATABASE_URL" -c "UPDATE reconciler_state SET value='<paging_token>' WHERE key='cursor';"
# Or clear it so the env-var default takes effect
psql "$DATABASE_URL" -c "DELETE FROM reconciler_state WHERE key='cursor';"
```

Restart the reconciler after updating the cursor.

---

## Secrets Rotation

Rotate secrets immediately if any are suspected to be compromised, and on a scheduled basis (recommended: every 90 days for signing secrets, every 180 days for database credentials).

### JWT Secret (`JWT_SECRET`)

1. Generate a new secret:
   ```sh
   openssl rand -hex 32
   ```
2. Update the value in your secret manager.
3. Restart the API. All existing JWT tokens are immediately invalidated — users must re-authenticate.

### Webhook Signing Secrets

Each webhook endpoint has its own `whsec_<hex>` secret stored in the `webhooks` table.

1. Generate a new secret per endpoint:
   ```sh
   openssl rand -hex 32
   ```
2. Update the secret in the database and in the merchant's secret manager.
3. The new secret takes effect on the next delivery — no restart required.
4. Notify the merchant so they update their verification logic before the old secret is removed.

### Database Credentials (`DATABASE_URL`)

1. Create a new Postgres user or rotate the password via the provider console.
2. Update `DATABASE_URL` (and `DATABASE_DIRECT_URL` if used) in the secret manager.
3. Restart the API and reconciler to pick up the new credentials.
4. Revoke the old credentials only after confirming the services are healthy.

### AWS KMS Key (`AWS_KMS_KEY_ID`)

Follow the AWS KMS key rotation guide. Enable automatic annual rotation in the KMS console, or trigger manual rotation:

```sh
aws kms enable-key-rotation --key-id "$AWS_KMS_KEY_ID"
```

KMS handles re-encryption of data keys transparently — no application restart is required.

### TRM Labs API Key (`TRM_LABS_API_KEY`)

1. Generate a new key in the TRM Labs dashboard.
2. Update the value in the secret manager.
3. Restart the reconciler (the key is read at startup via `Config::from_env()`).
4. Revoke the old key in the TRM Labs dashboard.

### Rotation Checklist

- [ ] New secret generated with sufficient entropy (`openssl rand -hex 32` or equivalent)
- [ ] Secret stored in secret manager — never committed to Git
- [ ] Dependent services restarted and health-checked
- [ ] Old secret revoked
- [ ] Rotation event logged in the incident/change log
