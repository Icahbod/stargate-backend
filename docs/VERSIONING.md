# API Versioning Strategy

## Overview

Stargate Backend follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) for package releases and a URL-based versioning scheme for the public REST API.

---

## 1. Package versioning

### Version format

```
MAJOR.MINOR.PATCH
```

| Segment | Increment when |
|---------|----------------|
| `MAJOR` | A public API or contract change is **breaking** — removed endpoints, changed required fields, altered auth flows, renamed webhook event types. |
| `MINOR` | New **backwards-compatible** functionality is added — new endpoints, optional request fields, new webhook events, new feature flags. |
| `PATCH` | **Backwards-compatible bug fixes** — incorrect behaviour corrected, performance improvements, documentation-only changes, dependency security patches. |

Pre-1.0 (`0.y.z`) work is treated as unstable; any minor version may contain breaking changes.

### Release process

1. **Branch** — feature work lands on `main` via pull request.
2. **Changelog** — all user-visible changes are recorded in `CHANGELOG.md` under `[Unreleased]` as they merge.
3. **Version bump** — when cutting a release, move the `[Unreleased]` block to a dated section, bump `version` in [package.json](../package.json), and create an annotated git tag:
   ```sh
   git tag -a v1.2.0 -m "chore: release v1.2.0"
   git push origin v1.2.0
   ```
4. **GitHub Release** — the tag triggers a GitHub Release; the CHANGELOG section for that version becomes the release notes.

### Packages

The `packages/types` npm workspace is versioned independently. Its own `CHANGELOG` lives alongside its `package.json`. Breaking changes there increment its own `MAJOR` regardless of the API server version.

### Backport policy

Critical security fixes may be backported to the previous `MINOR` release as a `PATCH` release. Non-security fixes are not backported.

---

## 2. REST API versioning scheme

### URL path prefix

All public API endpoints are grouped under a version prefix:

```
/v{MAJOR}/...
```

Examples:

| Route | Version |
|-------|---------|
| `GET /v1/invoices` | v1 |
| `POST /v1/api-keys` | v1 |
| `GET /v2/invoices` | v2 (hypothetical future) |

The current live version is **v1**. Internal and health endpoints (`/health/*`, `/metrics`) are unversioned.

### Version negotiation

- The version is part of the URL path — there are no `Accept-Version` header negotiations.
- Clients must pin to an explicit version prefix. Requests without a version prefix are rejected with `404 Not Found`.
- A version remains available until its **sunset date** (see §4).

---

## 3. What counts as a breaking change

The following changes require a new `MAJOR` URL version (`/v2/`, `/v3/`, …):

- Removing or renaming an API endpoint or its HTTP method.
- Removing or renaming a required request field, header, or query parameter.
- Changing the shape of a successful response in a way that breaks existing clients (e.g. removing a field, changing a type).
- Removing or renaming a webhook event type or any field in its payload.
- Changing authentication or authorisation semantics (e.g. new required scopes, altered token format).
- Removing a feature flag or configuration key that was previously documented.

The following changes are **not** breaking and do not require a new URL version:

- Adding new optional request fields (ignored by existing clients).
- Adding new fields to response bodies (existing clients skip unknown fields).
- Adding new webhook event types (existing consumers ignore unknown events).
- Adding new optional query parameters with sensible defaults.
- Bug fixes that bring behaviour in line with the documented spec.

---

## 4. Deprecation policy

### Announcement

When a feature, endpoint, or API version is targeted for removal:

1. A `Deprecation: true` response header is added to every affected response, per [RFC 9745](https://www.rfc-editor.org/rfc/rfc9745).
2. A `Sunset` response header is included with the ISO 8601 removal date, per [RFC 8594](https://www.rfc-editor.org/rfc/rfc8594).
3. The deprecation is recorded in `CHANGELOG.md` under the release that introduced it.
4. Affected merchants receive an email notification with the sunset date and migration guide.

Example deprecation headers:

```
Deprecation: true
Sunset: Sat, 01 Nov 2025 00:00:00 GMT
Link: <https://docs.stargate.dev/migration/v2>; rel="successor-version"
```

### Minimum notice period

| Change type | Minimum notice before removal |
|-------------|-------------------------------|
| Entire API version (e.g. v1 → v2 only) | **12 months** from the sunset announcement |
| Individual endpoint removed or replaced | **6 months** |
| Optional field removed from request/response | **3 months** |
| Non-breaking additive change reversed | **1 month** |

These are **minimum** periods. The actual notice period will be longer when usage data shows significant adoption.

### Deprecation lifecycle

```
Supported → Deprecated → Sunset (read-only grace) → Removed
```

| Stage | Description |
|-------|-------------|
| **Supported** | Fully maintained; receives bug and security fixes. |
| **Deprecated** | Still functional; `Deprecation` and `Sunset` headers present on responses; no new features added. |
| **Sunset (grace)** | After the sunset date, write operations (POST/PUT/PATCH/DELETE) return `410 Gone`. GET requests continue to work for one additional month to allow data export. |
| **Removed** | All endpoints return `410 Gone`. The version is dropped from routing. |

---

## 5. Sunset timeline

### Current versions

| Version | Status | Sunset date |
|---------|--------|-------------|
| v1 | **Supported** | No planned sunset |

### Scheduled sunsets

No sunsets are currently scheduled. This table will be updated at least **12 months** before any v1 deprecation is announced.

---

## 6. Client migration guide template

When a new major version is released, a dedicated migration guide is published at `docs/MIGRATION_v{N}_to_v{N+1}.md`. Each guide covers:

1. **Summary of breaking changes** — a concise list of what changed and why.
2. **Side-by-side request/response diffs** — before and after examples for every breaking endpoint.
3. **Coexistence period** — dates during which both versions are live and independently routable.
4. **Step-by-step migration checklist** — ordered actions for upgrading client integrations.
5. **SDK update instructions** — version of `@stargate/types` required for the new API version.

---

## 7. SDK / types package alignment

The `packages/types` npm package reflects the current **supported** API surface. Each published version is tagged with the API version it targets:

```
@stargate/types@1.x.x  →  REST API v1
@stargate/types@2.x.x  →  REST API v2
```

Types for deprecated endpoints are marked with a `@deprecated` JSDoc tag. They are removed from the package no earlier than the corresponding API endpoint's removal date.
