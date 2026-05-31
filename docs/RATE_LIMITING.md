# Rate Limiting

Stargate enforces two complementary rate-limiting mechanisms: a per-merchant payment velocity cap and a standard HTTP throttle on all API endpoints.

## HTTP Rate Limit Headers

Every API response includes the following headers so clients can track their quota:

| Header | Description |
|---|---|
| `X-RateLimit-Limit` | Maximum requests allowed in the current window |
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the window resets |
| `Retry-After` | Seconds to wait before retrying (only present on 429 responses) |

## 429 Response Body

When a request is rejected due to rate limiting the API returns HTTP `429 Too Many Requests` with the following JSON body:

```json
{
  "statusCode": 429,
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Retry after 30 seconds."
}
```

## Payment Velocity Limit

In addition to the HTTP throttle, the compliance layer enforces a rolling hourly payment velocity cap per merchant. This is tracked in Redis using a sorted set keyed by `velocity:{merchantId}:{YYYY-MM-DDTHH}`.

- Default limit: **$50,000.00 USD per hour** (`VELOCITY_LIMIT_PER_HOUR_CENTS=5000000`)
- Configurable via the `VELOCITY_LIMIT_PER_HOUR_CENTS` environment variable (value in cents)
- When the hourly total exceeds the cap the payment screening result is escalated from `clear` to `review`, which blocks settlement until a compliance officer approves

The velocity window expires automatically after 2 hours (`EXPIRE 7200`).

## Retry Guidance

1. Read the `Retry-After` header from a 429 response and wait that many seconds before retrying.
2. Use exponential back-off with jitter for automated clients to avoid thundering-herd retries.
3. For payment velocity rejections, contact support to request a temporary limit increase or wait for the hourly window to reset.

## Example: Handling a 429

```bash
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1717070400
Retry-After: 30
Content-Type: application/json

{
  "statusCode": 429,
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Retry after 30 seconds."
}
```

```javascript
async function callWithRetry(fn) {
  while (true) {
    const res = await fn();
    if (res.status !== 429) return res;
    const wait = Number(res.headers.get('Retry-After') ?? 5) * 1000;
    await new Promise(r => setTimeout(r, wait));
  }
}
```
