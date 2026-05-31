# Merchant Integration Quick-Start Guide

Get your first payment flowing in under five minutes.

---

## 1. Register and get your API key

```bash
curl -X POST https://api.stargate.io/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "<your-email>", "name": "<business-name>", "password": "<password>"}'
```

Response:

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<refresh-jwt>"
}
```

Store the `access_token` — every subsequent request requires `Authorization: Bearer <access_token>`.

> Tokens expire in 15 minutes. Use `POST /auth/refresh` with your `refresh_token` (sent as an httpOnly cookie) to get a new one.

---

## 2. Create your first invoice

```bash
curl -X POST https://api.stargate.io/invoices \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "amount_usdc": "10.00",
    "memo": "Order #1001",
    "expires_in_seconds": 900
  }'
```

Response:

```json
{
  "id": "<invoice-id>",
  "stellar_address": "G...",
  "amount_usdc": "10.00",
  "status": "pending",
  "expires_at": "2024-01-01T00:15:00Z"
}
```

Send the `stellar_address` and `amount_usdc` to your customer. They pay via any Stellar-compatible wallet.

---

## 3. Register a webhook endpoint

Subscribe to the event types you care about. All six supported types are shown below — include only the ones you need.

```bash
curl -X POST https://api.stargate.io/webhooks \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-server.example.com/webhooks/stargate",
    "events": ["invoice.paid", "invoice.expired", "settlement.completed"]
  }'
```

Supported event types:

| Event | Fired when |
|---|---|
| `invoice.paid` | On-chain payment confirmed |
| `invoice.expired` | Invoice passes `expires_at` unpaid |
| `invoice.cancelled` | You cancel via API |
| `settlement.completed` | Batch disbursed to your wallet |
| `merchant.kyc.approved` | KYC review approved |
| `merchant.kyc.rejected` | KYC review rejected |

Response includes a one-time `secret` — **store it in a secret manager immediately**:

```json
{
  "id": "<webhook-id>",
  "url": "https://your-server.example.com/webhooks/stargate",
  "events": ["invoice.paid", "invoice.expired", "settlement.completed"],
  "secret": "whsec_<hex>",
  "active": true
}
```

---

## 4. Verify webhook signatures

Every delivery includes `X-Stargate-Signature: sha256=<hex>`. Always verify before processing:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

function verifySignature(secret: string, rawBody: string, signature: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Express example
app.post("/webhooks/stargate", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["x-stargate-signature"] as string;
  if (!verifySignature(process.env.WEBHOOK_SECRET!, req.body.toString(), sig)) {
    return res.status(401).send("Invalid signature");
  }
  const event = JSON.parse(req.body.toString());
  // handle event.type ...
  res.sendStatus(200);
});
```

> Use `timingSafeEqual` — never `===`. Always verify the raw body before parsing JSON.

---

## 5. Retry behaviour

Failed deliveries are retried automatically with exponential backoff:

| Attempt | Delay |
|---|---|
| 1 | immediate |
| 2 | ~1 minute |
| 3 | ~5 minutes |
| 4 | ~30 minutes |
| 5 | ~2 hours |

After 5 failures the delivery is marked `dead`. You can manually re-queue it:

```bash
curl -X POST https://api.stargate.io/webhooks/deliveries/<delivery-id>/retry \
  -H "Authorization: Bearer <access_token>"
```

Return `200` for duplicate deliveries to suppress retries. Return `500` for transient errors to trigger the next retry.

---

## Next steps

- **Rotate your secret** periodically: `POST /webhooks/<id>/rotate-secret` — the old secret stays valid for 24 hours during the overlap window.
- **Monitor delivery health**: `GET /webhooks/<id>/health` returns success rate, p99 latency, and last failure timestamp.
- **View delivery history**: `GET /webhooks/<id>/deliveries`
- **Signature security**: see [WEBHOOK_SECURITY.md](./WEBHOOK_SECURITY.md) for replay prevention and IP allowlisting.
