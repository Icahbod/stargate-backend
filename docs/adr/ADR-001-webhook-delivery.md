# ADR-001: Event-Driven Webhook Delivery via Redis Streams

**Status:** Accepted  
**Date:** 2026-05-31  
**Deciders:** Platform Engineering

---

## Context

Stargate must deliver webhook notifications (`invoice.paid`, `invoice.expired`, `invoice.cancelled`, `settlement.completed`) to merchant endpoints reliably and with at-least-once semantics. The delivery mechanism must:

- survive API process restarts without losing events,
- support configurable retry with exponential back-off,
- allow multiple worker processes to share the load without duplicate delivery,
- integrate with the existing Redis instance already used for SSE fanout.

## Decision

Use **Redis Streams with a consumer group** as the durable queue for webhook delivery jobs.

The reconciler (and the API for non-payment events) appends an entry to the `webhook:jobs` stream. A `WebhookDeliveryWorker` process reads from the stream via `XREADGROUP`, attempts the HTTP delivery, and acknowledges (`XACK`) only on success. Failed deliveries are retried with exponential back-off up to `WEBHOOK_MAX_RETRIES` attempts; after exhausting retries the entry is moved to a dead-letter stream (`webhook:dlq`).

```
Reconciler / API
      │
      ▼
XADD webhook:jobs  ──────────────────────────────────────────────┐
                                                                  │
WebhookDeliveryWorker (consumer group: "delivery")               │
      │                                                           │
      ├─ XREADGROUP GROUP delivery CONSUMER worker-1 COUNT 10    │
      │                                                           │
      ├─ POST merchant webhook URL                                │
      │     ├─ 2xx  → XACK  (done)                               │
      │     └─ !2xx → schedule retry (exponential back-off)      │
      │                 └─ after max retries → XADD webhook:dlq  │
      └─────────────────────────────────────────────────────────-┘
```

### Stream entry schema

```json
{
  "webhook_id": "<uuid>",
  "merchant_id": "<uuid>",
  "event_type": "invoice.paid",
  "payload": "{ ... }",
  "attempt": 1,
  "next_attempt_at": "<ISO-8601>"
}
```

### Consumer group configuration

| Parameter | Value |
|---|---|
| Stream key | `webhook:jobs` |
| Group name | `delivery` |
| Pending entry expiry | 24 h (via `XAUTOCLAIM`) |
| Max retries | `WEBHOOK_MAX_RETRIES` (default 5) |
| Back-off | `min(2^attempt * 1s, 300s)` |
| DLQ stream | `webhook:dlq` |

## Alternatives Considered

### BullMQ (Redis-backed job queue)

BullMQ provides a higher-level API with built-in retry and delay support. Rejected because it adds a significant dependency and its internal stream/list structure is opaque, making operational debugging harder. Redis Streams are a first-class Redis primitive with well-understood semantics.

### PostgreSQL-backed queue (e.g. pg-boss)

Avoids an extra infrastructure dependency. Rejected because the existing Redis instance is already required for SSE fanout, and a Postgres queue would add write pressure to the primary database on every webhook event.

### Direct HTTP delivery (synchronous, in-process)

Simple but does not survive process restarts and blocks the event-processing path. Rejected — reliability is a hard requirement.

## Consequences

- **Positive:** At-least-once delivery with durable persistence across restarts; horizontal scaling by adding consumer workers; dead-letter stream enables manual replay.
- **Positive:** No additional infrastructure — Redis is already a required dependency.
- **Negative:** Exactly-once delivery is not guaranteed; merchants must implement idempotency using the `id` field in the payload (documented in `WEBHOOK_SECURITY.md`).
- **Negative:** Redis Streams require monitoring (`XPENDING`, `XLEN`) to detect backlogs; add these to the operational dashboard.

## Related

- `docs/WEBHOOK_SECURITY.md` — HMAC verification, replay prevention
- `docs/RECOVERY.md` — Secrets rotation for `WEBHOOK_SIGNING_SECRET`
- `.env.example` — `WEBHOOK_MAX_RETRIES`, `WEBHOOK_TIMEOUT_MS`
