#131 Invoice muxed ID allocation races under concurrent invoice creation
Repo Avatar
dreamgeneX/stargate-backend
Summary
nextInvoiceSequence counts existing invoices, so simultaneous creates for one merchant can allocate the same muxed ID.

Scope
Backend repo: stargate-backend
Type: bug
Area: Bug
Acceptance Criteria
The behavior is implemented or fixed in the backend service, worker, reconciler, migration, docs, or tests as appropriate.
Relevant automated coverage is added or updated.
npm run typecheck, npm test, and any relevant e2e/Cargo checks pass.
Batch source: PDF supplement; item 131 of 150.

#132 Enterprise fixed fee can exceed invoice amount and hide negative net
Repo Avatar
dreamgeneX/stargate-backend
Summary
Invoice creation clamps negative net_usdc to zero instead of rejecting or surfacing fee configuration errors.

Scope
Backend repo: stargate-backend
Type: bug
Area: Bug
Acceptance Criteria
The behavior is implemented or fixed in the backend service, worker, reconciler, migration, docs, or tests as appropriate.
Relevant automated coverage is added or updated.
npm run typecheck, npm test, and any relevant e2e/Cargo checks pass.
Batch source: PDF supplement; item 132 of 150.

#133 Public payment endpoint exposes expired invoices as payable
Repo Avatar
dreamgeneX/stargate-backend
Summary
getPublic returns expired or cancelled invoice payment details without a payment eligibility state.

Scope
Backend repo: stargate-backend
Type: bug
Area: Bug
Acceptance Criteria
The behavior is implemented or fixed in the backend service, worker, reconciler, migration, docs, or tests as appropriate.
Relevant automated coverage is added or updated.
npm run typecheck, npm test, and any relevant e2e/Cargo checks pass.
Batch source: PDF supplement; item 133 of 150.

#85 Document generate:openapi workflow and CI integration
Repo Avatar
dreamgeneX/stargate-backend
Summary
Explain how openapi.yaml is generated, validated, and consumed by the frontend.

Scope
Backend repo: stargate-backend
Type: docs
Area: Documentation
Acceptance Criteria
The behavior is implemented or fixed in the backend service, worker, reconciler, migration, docs, or tests as appropriate.
Relevant automated coverage is added or updated.
npm run typecheck, npm test, and any relevant e2e/Cargo checks pass.