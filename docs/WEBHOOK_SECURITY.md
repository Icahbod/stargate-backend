# Webhook Security Best Practices

This guide covers HMAC signature verification, IP allowlisting, and replay prevention for Stargate webhooks.

---

## 1. HMAC Signature Verification

Every delivery includes `X-Stargate-Signature: sha256=<hex>` computed as:

```
HMAC-SHA256(webhook_secret, JSON.stringify(payload))
```

The `secret` (`whsec_<hex>`) is returned once at webhook creation — store it in a secret manager immediately.

### Node.js / TypeScript

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

function verifySignature(
  secret: string,
  rawBody: string,
  signature: string,
): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

> Always use `timingSafeEqual` — never `===`. String equality is vulnerable to timing attacks.

### Python

```python
import hashlib, hmac

def verify_signature(secret: str, raw_body: bytes, signature: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

### Common mistakes

| Mistake                          | Why it breaks                                             |
| -------------------------------- | --------------------------------------------------------- |
| Parsing JSON before verifying    | Key ordering may differ, changing the byte representation |
| Using `===` for comparison       | Vulnerable to timing side-channel attacks                 |
| Trimming or normalising the body | Alters the bytes the HMAC was computed over               |
| Logging the raw secret           | Exposes it in log aggregation systems                     |

---

## 2. IP Allowlisting

Stargate delivers webhooks from a fixed set of egress IPs listed in your merchant dashboard under **Settings → Webhooks → Egress IPs**.

> Never rely on IP filtering alone — always verify the HMAC signature as the primary control. IP ranges can change during infrastructure migrations.

### NestJS middleware example

```typescript
import { Injectable, NestMiddleware, ForbiddenException } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

const ALLOWED_IPS = new Set(["203.0.113.10", "203.0.113.11"]); // replace with real Stargate IPs

@Injectable()
export class WebhookIpGuardMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
      req.socket.remoteAddress;
    if (!ALLOWED_IPS.has(ip ?? ""))
      throw new ForbiddenException("Webhook source IP not allowed");
    next();
  }
}
```

---

## 3. Replay Attack Prevention

Stargate includes `X-Stargate-Timestamp` (Unix seconds, UTC) on every delivery.

**Two-layer defence:**

1. Reject deliveries where `|now − timestamp| > 300` seconds (5 min window).
2. Cache the payload `id` in Redis with a 10-minute TTL and reject duplicates.

### TypeScript + Redis example

```typescript
async function handleWebhook(req: Request, secret: string): Promise<void> {
  // 1. Verify signature first
  const sig = req.headers["x-stargate-signature"] as string;
  if (!verifySignature(secret, req.rawBody, sig))
    throw new Error("Invalid signature");

  // 2. Check timestamp freshness
  const ts = Number(req.headers["x-stargate-timestamp"]);
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > 300)
    throw new Error("Stale timestamp");

  // 3. Deduplicate by delivery ID
  const payload = JSON.parse(req.rawBody);
  const stored = await redis.set(`webhook:seen:${payload.id}`, "1", {
    NX: true,
    EX: 600,
  });
  if (!stored) return; // duplicate — return 200 to suppress retries

  await processEvent(payload);
}
```

### HTTP response guide

| Scenario           | Status | Effect                                     |
| ------------------ | ------ | ------------------------------------------ |
| Signature invalid  | `401`  | Stargate retries up to 5 times             |
| Replay / duplicate | `200`  | Stargate marks delivered, no retry         |
| Transient error    | `500`  | Stargate retries with exponential back-off |

---

## 4. Supported Event Types

| Event                  | Fired when                                    |
| ---------------------- | --------------------------------------------- |
| `invoice.paid`           | On-chain payment confirmed by reconciler      |
| `invoice.expired`        | Pending invoice passes `expires_at`           |
| `invoice.cancelled`      | Merchant cancels via API                      |
| `settlement.completed`   | Settlement batch disbursed to merchant wallet |
| `merchant.kyc.approved`  | KYC review approved                           |
| `merchant.kyc.rejected`  | KYC review rejected                           |

---

## 5. Security Checklist

- [ ] Store the webhook secret in a secret manager, never in source code or `.env` committed to Git
- [ ] Verify HMAC on every incoming request before any processing
- [ ] Use timing-safe comparison (`timingSafeEqual` / `hmac.compare_digest`)
- [ ] Reject requests with timestamp skew > 5 minutes
- [ ] Deduplicate by payload `id` with a short-lived Redis cache
- [ ] Optionally allowlist Stargate egress IPs as a secondary control
- [ ] Return `200` for replays and duplicates to suppress retries
- [ ] Rotate the secret immediately if it is ever exposed
