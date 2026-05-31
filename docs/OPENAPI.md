# OpenAPI Generation

## Overview

`docs/openapi.yaml` is the single source of truth for the Stargate API contract. It is generated from NestJS/Swagger decorators and consumed by `stargate-frontend` for type-safe client generation.

## Generating the spec

```sh
npm run generate:openapi
```

This runs `scripts/generate-openapi.ts` which:

1. Bootstraps the NestJS app without starting an HTTP server.
2. Builds the OpenAPI document via `@nestjs/swagger`'s `DocumentBuilder` and `SwaggerModule.createDocument`.
3. Writes the result to `docs/openapi.yaml`.

The script uses `logger: false` so no application logs are emitted during generation.

## CI integration

The GitHub Actions workflow (`.github/workflows/backend-ci.yml`) runs `npm run generate:openapi` as part of the CI pipeline. If the generated file differs from the committed version, the diff is surfaced in the PR so reviewers can confirm the contract change is intentional.

To keep the committed spec in sync locally, run `npm run generate:openapi` after any controller or DTO change and commit the updated `docs/openapi.yaml`.

## Frontend consumption

`stargate-frontend` points its OpenAPI code-generator at `docs/openapi.yaml`. Any breaking change to the spec (removed field, changed type, renamed operation) requires a coordinated update in the frontend repo.

## Adding new endpoints

1. Annotate the controller method with `@ApiOperation`, `@ApiResponse`, and any relevant `@ApiProperty` on DTOs.
2. Run `npm run generate:openapi`.
3. Commit both the source change and the updated `docs/openapi.yaml` in the same PR.
