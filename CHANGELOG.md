# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [docs/VERSIONING.md](docs/VERSIONING.md) for the full versioning and release policy.

---

## [Unreleased]

### Added
- `PATCH /treasury/signing-quorum` — allow governance admins to update the treasury signing quorum via authenticated API.

---

## [1.2.0] - 2026-05-28

### Added
- Webhook delivery infrastructure improvements and event dispatching hardening.

---

## [1.1.0] - 2026-05-27

### Added
- `POST /invoices/bulk` — atomically create up to 100 invoices in a single request.
- `POST /invoices/:id/refund` — initiate a Soroban-settled refund for a paid invoice.
- `GET /invoices/:id/pdf` — return a formatted PDF receipt for an invoice.
- `POST /compliance/documents` — KYC document upload endpoint.
- `GET /merchants/me/onboarding` — returns structured onboarding steps and completion status.
- `GET /webhooks/:id/health` — reports success rate, p99 latency, and last failure for a webhook endpoint.
- `GET /estimates/fee` — returns the estimated Soroban operation fee before submission.
- `POST /treasury/signatures` — allow authorised signers to submit treasury approval signatures via REST.
- `GET /schedules`, `POST /schedules`, `PATCH /schedules/:id`, `DELETE /schedules/:id` — full CRUD for recurring payment schedules (interval, amount, recipient).
- Reconciler sidecar HTTP status endpoint for liveness probing.
- `merchant.kyc.approved` and `merchant.kyc.rejected` webhook events.
- `merchant.payment_intent.expired` webhook event dispatched on invoice expiry.
- `test_mode` flag per merchant to route all transactions to Stellar testnet.
- Configurable daily and monthly spend limits enforced at the API layer.
- Partial payment support — invoices now track `amount_paid` and `remaining_balance`.
- Deferred settlement — merchants can schedule settlement to a future time.
- Cursor-based pagination for `GET /invoices` (replaces offset pagination).
- Merchant-level maximum invoice amount limits.
- Idempotency key support on `POST /invoices`.
- Audit log entries for API key and webhook changes (#145).
- Webhook secrets hashed at rest with constant-time comparison (#144).
- Settlement dry-run endpoint for admins (`POST /settlement/dry-run`) (#143).
- Webhook secret rotation with a 24-hour overlap window so in-flight deliveries remain valid (#141).
- Webhook secret rotation, payment-link analytics, and idempotency key foundations (#27, #29, #36, #39).
- Resolve issues #59, #78, #83, #88.

### Fixed
- `NUMERIC(18,7)` cast added to `SUM` aggregation to prevent decimal precision loss (#138).
- Duplicate-pending-settlement guard; mark ledger entries correctly (#137).
- Only allow retry of `failed` or `dead` webhook deliveries (#136).
- Return `404` when deactivating a non-existent webhook endpoint (#135).
- Error handling for malformed Redis messages in `PaymentsService.stream()` (#134).

### Changed
- Redis subscription clients are reused across SSE fanout connections to reduce connection churn (#147).
- Composite index added on invoice listing filter columns for faster queries (#146).

### Docs
- Added `docs/RECONCILER_INTEGRATION.md` describing the reconciler ↔ backend integration flow (#148).

---

## [1.0.0] - 2026-05-17

### Added
- Stargate Protocol MVP: NestJS API, PostgreSQL database, Redis event delivery, and Rust reconciler sidecar.
- `GET /health`, `GET /health/deep`, `GET /health/rpc` health-check endpoints.
- Merchant registration, API key management, and KYC compliance foundations.
- Invoice lifecycle: create, pay, expire, and list invoices.
- Webhook delivery with HMAC signing, retry logic, and failure tracking.
- Soroban/Stellar on-chain settlement and treasury management.
- Production deployment workflows and `docs/LAUNCH_RUNBOOK.md`.
- `docs/RECOVERY.md`, `docs/MAINNET_DEPLOYMENT.md`, and `docs/WEBHOOK_SECURITY.md`.

---

[Unreleased]: https://github.com/dreamgeneX/stargate-backend/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/dreamgeneX/stargate-backend/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/dreamgeneX/stargate-backend/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/dreamgeneX/stargate-backend/releases/tag/v1.0.0
