# Compliance Gate Integration

This document explains how the backend calls the compliance contract, where the gate is enforced in the payment flow, and how KYC is triggered.

## Overview

Every payment goes through a two-part compliance check before settlement is allowed:

1. **OFAC / sanctions screening** — the payer's Stellar wallet address is screened against TRM Labs.
2. **Velocity check** — the merchant's rolling hourly payment volume is checked against a configurable cap.

Both checks are performed in `ComplianceService.combinedCheck()` and must pass before a payment proceeds to settlement.

## Integration Points

### 1. Payment Preparation (`GET /payments/:id/prepare-tx`)

Before building the unsigned Stellar XDR, `PaymentsController` calls `ComplianceService.combinedCheck()` with the payer address and invoice amount. If the result is `blocked`, the endpoint returns `403 Forbidden` and no transaction is issued.

```
Client → GET /payments/:id/prepare-tx?payer=G...
           │
           ▼
     ComplianceService.combinedCheck()
           │
     ┌─────┴──────┐
     │            │
  screenAddress  checkVelocity
  (TRM Labs)     (Redis sorted set)
     │            │
     └─────┬──────┘
           │
     result: clear | review | blocked
           │
     blocked → 403 Forbidden
     review  → payment queued for manual approval
     clear   → XDR returned to client
```

### 2. OFAC Screening (`ComplianceService.screenAddress`)

- Calls `POST https://api.trmlabs.com/public/v2/screening/addresses` with the Stellar address.
- Results are cached in Redis under `ofac:{address}` for **1 hour** (`EX 3600`) to avoid redundant API calls.
- Risk score thresholds:
  - `>= 90` → `blocked`
  - `>= 50` → `review`
  - `< 50` → `clear`
- If `OFAC_SCREENING_ENABLED=false` the check is bypassed and always returns `clear`.
- If the TRM Labs API is unreachable (timeout 2 s) the result defaults to `review` (fail-safe).

### 3. Velocity Check (`ComplianceService.checkVelocity`)

- Tracks per-merchant payment volume in a Redis sorted set: `velocity:{merchantId}:{YYYY-MM-DDTHH}`.
- Each payment amount (in cents) is added with `ZADD` and the key expires after 2 hours.
- Default cap: **$50,000.00 / hour** (`VELOCITY_LIMIT_PER_HOUR_CENTS=5000000`).
- If the hourly total exceeds the cap and the OFAC result is `clear`, the combined result is escalated to `review`.

### 4. KYC Document Upload (`POST /compliance/documents`)

Merchants can upload identity documents for manual KYC review. This endpoint is separate from the real-time payment gate and is used during merchant onboarding.

- Requires a valid JWT (`Authorization: Bearer <token>`).
- Accepted `document_type` values: `passport`, `drivers_license`, `national_id`, `utility_bill`, `bank_statement`.
- The document metadata is stored in the `kyc_documents` table; the actual file is uploaded directly to S3 using the pre-signed `upload_url` returned in the response.
- S3 bucket is configured via `KYC_S3_BUCKET` (default: `stargate-kyc-documents`).

```
POST /compliance/documents
Authorization: Bearer <jwt>

{
  "document_type": "passport",
  "file_name": "passport-scan.jpg"
}

→ 201 Created
{
  "id": "uuid",
  "document_type": "passport",
  "file_name": "passport-scan.jpg",
  "status": "pending",
  "uploaded_at": "2026-05-30T13:00:00Z",
  "upload_url": "https://stargate-kyc-documents.s3.us-east-1.amazonaws.com/kyc/..."
}
```

The client must then `PUT` the file binary to `upload_url`.

## Configuration

| Variable | Description | Default |
|---|---|---|
| `OFAC_SCREENING_ENABLED` | Enable live TRM Labs screening | `true` |
| `TRM_LABS_API_KEY` | TRM Labs API key | — |
| `VELOCITY_LIMIT_PER_HOUR_CENTS` | Per-merchant hourly cap in cents | `5000000` ($50,000) |
| `KYC_S3_BUCKET` | S3 bucket for KYC document storage | `stargate-kyc-documents` |
| `AWS_REGION` | AWS region for S3 pre-signed URLs | `us-east-1` |

## Screening Result Reference

| Result | Meaning | Payment outcome |
|---|---|---|
| `clear` | No sanctions match, velocity within limit | Proceeds to settlement |
| `review` | Moderate risk or velocity exceeded | Held for manual compliance review |
| `blocked` | High-risk sanctions match (score ≥ 90) | Rejected immediately (403) |
