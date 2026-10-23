# Form module capability audit and modernization plan

Audit date: 2026-08-06

## Executive assessment

The Forms module is a real, integrated product rather than a prototype. It has a normalized form schema, published snapshots and versions, a shared builder/public renderer, conditional rules, secure R2 response media, payment checkout, CRM synchronization, automation runs, analytics, reusable templates, document/signing infrastructure, and responsive editing.

It is not yet accurate to call the whole module “better than Jotform.” After the upgrade in this audit, the core form-builder and submission path is strong, but commerce, collaborative response operations, durable automation orchestration, document generation from responses, true AI editing, and scheduling/routing remain materially behind category leaders.

Current score: **80/100 for production form collection** and **68/100 for Jotform-suite parity**.

Release recommendation: the core form and commerce path can proceed to staging after the browser/E2E and load gates below. The checkout, refund, inventory, and webhook paths are now production-hardened. Unrestricted live use still requires the deployment-specific provider, tax/shipping, mailbox, and monitoring checks described below.

## What was upgraded in this pass

- Added first-class `password`, `multiSelect`, `scale`, `matrix`, `multipleFiles`, `html`, `address`, and `location` blocks.
- Added builder controls and responsive public rendering for every new block.
- Added structured JSON answers for matrix, address, and GPS coordinates.
- Added multiple-file extraction, private R2 authorization, normalized storage records, response hydration, and downloadable response items.
- Added safe owner-authored HTML with an allowlist sanitizer that removes scripts, embeds, event handlers, styles, and unsafe links.
- Added text length validation and configurable multi-file limits.
- Added a canonical field-type registry so renderer coverage tests cannot silently omit a new type.
- Added server-side canonical submission validation. Required rules, visibility, option membership, ranges, structured fields, hidden defaults, calculations, and media constraints can no longer be bypassed by calling the API directly.
- Added shared Redis public-submission rate limits: 30 submissions/minute/client and 3,000 submissions/minute/form, with the existing controlled fallback when Redis is unavailable.
- Removed password/signature/upload values from browser draft persistence.
- Replaced client-side form-password comparison with short-lived, form-scoped server access grants. Passwords are no longer returned in public form payloads, and direct API submissions to password-protected or authenticated-only forms are rejected.
- Applied migration `098_form_builder_advanced_fields.sql` successfully.
- Added shared catalog products and variants to Forms, including multi-product cart selection, variant pricing, quantity limits, stock/backorder rules, tax, flat shipping, free-shipping thresholds, and authoritative checkout quotes.
- Added transactional inventory reservation/release/consume functions, order-line persistence, variant metadata, and a database smoke test for reservation safety.
- Applied migration `099_form_commerce_catalog.sql` successfully.
- Applied migration `101_form_commerce_operations.sql` successfully.
- Added idempotent inventory movement ledger entries, low-stock alerts, manual/set-stock operations, refund-line restock tracking, and protection against deleting variants with held reservations.
- Added server-authoritative refund reservation/release/restock workflows and idempotent Stripe, PayPal, Paystack, and OPay refund callback handling.
- Added destination tax and shipping rules with most-specific country/region matching, default fallbacks, and builder controls. External jurisdiction/carrier providers remain an explicit deployment option for regulated tax and live shipping rates.
- Added `/api/health?mode=live` and `/api/health?mode=ready`, a production configuration verifier, configurable oversell/load smoke testing, and CI jobs for typecheck, lint, full tests, build, commerce smoke, and browser E2E when staging secrets are present.

## End-to-end field matrix

Legend: **Verified** means builder, persistence, public renderer, server validation, normalized answer storage, and response display are implemented. **Partial** means the field works but lacks a category-leading workflow. **Gap** means it is not a production feature yet.

| Capability | Status | Notes |
| --- | --- | --- |
| Short/long text | Verified | Required, regex, min/max length, responsive rendering. |
| Number | Verified | Finite-number and min/max enforcement on client and server. |
| Email | Verified | Format validation and CRM identity mapping. DNS/deliverability validation is not included. |
| Phone | Verified | International phone control and server validation. |
| Website | Verified | HTTP/HTTPS URL validation. |
| Password/masked input | Verified | Masked in the browser and excluded from local drafts. Treat as sensitive response data, not as an account-authentication password. |
| Dropdown/radio/yes-no | Verified | Saved options are enforced on the server. |
| Multi-select/checkboxes | Verified | Multiple values, uniqueness, and option membership enforced. |
| Image choice | Partial | Image-backed single choice works; multi-image choice and asset optimization presets remain. |
| Rating/scale/ranking | Verified | Numeric range validation and complete ranking enforcement. |
| Matrix | Verified | Configurable rows/columns and structured answers. Matrix subquestion types and per-row N/A remain. |
| Date/time/date range | Verified | Valid calendar/time values and ordered ranges enforced. |
| Appointment | Partial | Fixed form-defined slots work. Real availability belongs to the Appointments module and is not yet embedded as a live scheduler block. |
| File/image/document upload | Verified | Type/size checks, validated private R2 objects, and response access URLs. |
| Multiple files | Verified | Up to 20 configurable files, per-file validation, private storage, and inbox downloads. |
| Camera | Verified | Image-only capture/selection. |
| Signature | Verified | Touch/mouse capture and durable private image storage. It is not a multi-party legal signing workflow by itself. |
| Address | Verified | Structured street/city/region/postal/country answer. Address autocomplete/geocoding remains. |
| GPS/location | Verified | Browser geolocation or manual coordinates with range validation. Reverse geocoding remains. |
| Hidden/calculated | Verified | Values are rebuilt from the published schema on the server; client tampering is discarded. |
| Heading/section/divider/page | Verified | Multi-step shared renderer and responsive layout. |
| Safe HTML | Verified | Formatting allowlist; executable/embedded content is removed. |
| Coupon | Verified for checkout | Uses the Payments coupon engine and reservation controls. |
| Product choice | Verified | Selects one or more shared catalog products, supports variants, quantities, stock/backorder messaging, and canonical cart answers. |
| Payment | Verified for fixed, variable, one catalog product, or cart | Hosted checkout/provider security lives outside a form field; cart prices, tax, shipping, currency, and inventory are recalculated server-side. |

## Platform capability matrix

| Area | Current state | Main gap to category leadership |
| --- | --- | --- |
| Builder UX | Drag/drop, click-to-add, mobile field picker, live preview, duplicate, styling, versions. | Add real undo/redo command history, keyboard shortcuts, reusable saved blocks, and accessibility linting. |
| Publish lifecycle | Draft/publish/update/archive, immutable live snapshot, version history, availability schedule and limits. | Add staged rollout, preview links tied to a version, rollback, and publish approvals. |
| Conditional logic | Show, hide, require, and skip-to with six operators. | Add AND/OR groups, multiple conditions, answer piping, scoring/outcomes, conditional endings/emails, and a visual logic map. |
| Partial responses | Schema, analytics, filters, and automation trigger exist. | No respondent partial-submit/autosave endpoint currently creates these records; do not advertise partial capture yet. |
| Response inbox | Search, status filter, detail, CSV, selection, delete, tag-for-review, rerun automation. | Add assignee, notes/comments, custom statuses, saved views, spam quarantine, pagination/server filters, audit log, and explicit convert/link-to-CRM actions. |
| CRM | A completed response is synchronized to Contacts; create/update/list actions and contact activity are implemented. | Surface sync failures, provide a mapping UI per form, conflict policy, replay queue, and company/deal/task creation. |
| Automations | Stored workflows/runs/steps, conditions, email/team alerts, contacts, tags, webhooks, Slack and central OAuth providers. | Execution starts synchronously after submission and has no general delayed-step scheduler, retry/backoff queue, dead-letter inbox, approval node, or branching canvas. |
| Documents/signing | Separate Documents module has templates, PDF/block sources, signers/approvers/CC, sequential/parallel order, audit events, reminders and expiry. | Wire form submission → document merge → send/sign/complete as a supported Forms automation action with field mapping. |
| AI | Prompt-to-template/field generation is deterministic and local. | It is not a model-backed copilot. Add schema-constrained generation/editing for fields, design, logic, automations, PDFs, mappings, explanations, and reversible diffs. |
| Analytics | Workspace/form totals, completion/partial, revenue, daily activity, device and country breakdowns. | Add conversion funnel by page/field, abandonment analytics, cohort/source filters, answer charts, and experiment comparison. |
| Scheduling/routing | Appointment field plus a separate production Appointments module. | Embed live availability, booking/reschedule/cancel lifecycle, AND/OR lead routing, fallback routes, owner/team assignment, and meeting workflows. |
| Security | Server validation, private scanned R2 media, access grants, signed-in enforcement, idempotency, response limits, Redis rate limits. | Add CAPTCHA/Turnstile risk scoring, password hashing migration, field-level encryption/redaction, retention policies, consent records, and security/audit exports. |
| Performance | Cached public forms, normalized indexes, direct object storage, idempotent submission insert. | Run measured p95 load gates; add server-side response pagination and async automation dispatch before high-volume enterprise use. |

## Commerce finding

The Forms commerce path now uses the shared Payments catalog rather than trusting prices from the browser. Owners can create products from the Payments module or directly from the Form builder, add variants with option values/SKUs/price overrides, configure quantity limits, inventory tracking, backorders, tax, shipping, and free-shipping thresholds, then select multiple products for a form cart.

The public form hydrates active catalog data, shows variant and quantity controls, and submits only product/variant IDs and quantities. The server rehydrates live catalog rows, validates active status/currency/stock, calculates subtotal/tax/shipping/coupons, reserves stock atomically before provider checkout, releases failed or expired reservations, consumes stock after successful completion, and persists one order line per product/variant.

Implemented production design:

1. Extended catalog products with inventory policy, stock-on-hand, low-stock threshold, tax rate, shipping requirement, and backorder policy.
2. Added `payment_product_variants` with SKU, option values, price override, image, active state, and stock.
3. Stored form product configuration as catalog/variant references; browser prices and names are never authoritative.
4. Stored structured cart answers containing product/variant IDs and requested quantities.
5. Added server-side cart quotes for active catalog rows, coupons, tax, and flat/free-threshold shipping.
6. Added an atomic reservation function with expiry, release, consume, and backorder handling.
7. Added failure/expiry release and successful checkout consumption paths, including idempotent provider webhook reconciliation for payment and refund events.
8. Persisted one order line per product/variant and rendered an itemized checkout summary.
9. Added a reservation/refund smoke test, inventory ledger, restock events, low-stock alerts, and reconciliation-safe operations.
10. Added a configurable concurrency/load test that asserts no negative stock and exactly the available number of successful reservations.

## Competitor benchmark

The comparison uses current official documentation, not marketing-memory assumptions.

- Jotform currently combines forms, payment/order forms, stock control, Inbox tags, collaborative Tables, Sign, PDF generation, approvals/workflows, and AI-driven conditional editing. Sources: [Jotform guides](https://www.jotform.com/help/), [stock control](https://www.jotform.com/help/1370-how-to-enable-and-manage-product-stocks-in-payment-fields/), [Inbox tags](https://www.jotform.com/help/how-to-use-tags-in-jotform-inbox/), [Tables collaboration](https://www.jotform.com/help/1010-how-to-share-your-jotform-tables-and-collaborate/), [Sign](https://www.jotform.com/help/guide-jotform-sign/), [AI conditions](https://www.jotform.com/help/how-to-set-up-conditions-with-jotform-ai/).
- Typeform’s differentiators include a visual branching model, scoring/variables, partial-submit points and per-question partial capture, partial-response webhooks/integrations, enriched response data, and polished conversational completion UX. Sources: [logic](https://help.typeform.com/hc/en-us/articles/36047433913364-Which-type-of-logic-should-I-use-and-where-can-I-find-it), [partial responses](https://help.typeform.com/hc/en-us/articles/21102221958676-Collect-partial-responses), [responses](https://help.typeform.com/hc/en-us/articles/360029253732-Working-with-your-responses).
- HubSpot’s advantage is native CRM behavior, stronger email validation, saved management views, record/task assignment, lists/audiences, and form-triggered workflows. Sources: [form management](https://knowledge.hubspot.com/forms/manage-your-forms), [form automations](https://knowledge.hubspot.com/forms/form-automations), [validation](https://knowledge.hubspot.com/forms/forms-faq).
- Calendly’s advantage is live scheduling and answer-driven routing to event types, teams, messages, or URLs with AND/OR conditions and fallback routes, plus meeting-lifecycle reminders/follow-ups. Sources: [Routing Forms](https://help.calendly.com/hc/en-us/articles/4418606043927-Getting-started-with-Routing-Forms), [Workflows](https://help.calendly.com/hc/en-us/articles/360051017814-Automate-tasks-with-Workflows).

## Roadmap to exceed Jotform

### P0 — production integrity

- Complete browser E2E for all new blocks, access grants, publish/reload, uploads, and response downloads.
- Add CAPTCHA/Turnstile and a spam quarantine/risk score.
- Hash form access passwords with backward-compatible migration and never return hashes to the editor.
- Add field-level sensitive-data controls, export masking, retention/deletion policy, and audit events.
- Move all automation starts to a durable queue with retry/backoff, idempotency, dead letters, and alerts.
- Add server-side response pagination/filtering before high-volume response inbox use.

### P1 — operational parity

- Build response assignee, notes, custom status, multi-tag management, saved views, activity history, spam, and CRM conversion/linking.
- Implement true partial-submit points and optional per-step autosave with one idempotent response identity.
- Add grouped AND/OR logic, scoring/outcomes, conditional endings, conditional recipients, and a visual logic graph.
- Wire the Documents module into Forms automations with merge-field mapping and signed-document completion triggers.
- Embed live Appointments availability and route qualified respondents to an event type/team.

### P2 — commerce completion

- Add carrier/destination-based shipping and jurisdiction-aware tax adapters beyond the built-in destination-rule engine when the deployment sells into regulated jurisdictions or needs live carrier quotes.
- Add digital-product fulfillment and richer inventory analytics; core refund/restock rules, adjustment history, low-stock alerts, and ledger reconciliation are now implemented.
- Keep concurrency and provider-webhook replay tests in CI and run them against the production-like staging database before increasing limits.

### P3 — differentiation

- Replace deterministic prompt matching with a schema-constrained AI copilot that proposes reversible patches and explains every change.
- Generate fields, design systems, grouped logic, automations, documents, CRM mappings, analytics dashboards, and localization from one brief.
- Add automated form QA: accessibility, ambiguity, conversion friction, sensitive-data, broken logic, deliverability, payment, and mobile-layout checks before publish.
- Add experimentation: form/version split tests, completion lift, field drop-off, and statistically guarded recommendations.

## Release gates

- TypeScript: zero errors.
- Targeted Forms lint: zero warnings.
- Focused Forms regression: commerce/form tests pass; the latest focused run covered 4 files / 62 tests.
- Component regression: 29 files / 282 tests pass, including the full CampaignsModule suite (55/55).
- Server regression: 18 files / 138 tests pass.
- Core library regression: 16 files / 98 tests pass.
- Full repository regression: 66 files / 530 tests pass with four bounded Vitest workers.
- Migrations 098, 099, and 101: applied successfully.
- Database read smoke: pass.
- Commerce reservation smoke: pass (reserve/release restored the test SKU from 5 back to 5).
- Commerce operations smoke: pass (20-way oversell race, idempotent resize/release, alert acknowledgement/restock, refund restock, and ledger de-duplication).
- Inventory load smoke: pass locally at 50 concurrent reservations with exactly 25 successful reservations against 25 units and no negative stock.
- Production build: pass (4,204 modules transformed; largest emitted chunk is approximately 507 kB before gzip).
- Browser E2E: the CI workflow now has assertion-based publish/reload/public-submit/response/analytics/automation/settings/responsive checks and staging credentials. This audit session could not execute it because no in-app browser was available.
- Monitoring: `/api/health?mode=live` is suitable for liveness and `/api/health?mode=ready` is checked by `npm run check:forms:health`; wire the latter to the deployed uptime monitor through `FORMS_HEALTH_URL`.
- Production configuration: the latest `npm run verify:forms:production` run correctly fails exactly three deployment checks in this dev environment: `NODE_ENV=production`, `PAYMENT_MODE=live`, and a stable non-tunnel `PUBLIC_APP_URL`.
- External verification: a real merchant-provider checkout/refund, inbox delivery, webhook callback, tax jurisdiction, and carrier quote still require a deployed staging origin and credentials; code-level mocks cannot prove those external systems.
- Load: demonstrate public-form read p95 < 300 ms cached, submission p95 < 800 ms excluding uploads/external automation, zero lost/idempotency-duplicate submissions, and stable behavior at the intended concurrency.

## Files changed by this audit

- `src/components/forms/form-types.ts`
- `src/components/forms/FormBuilder.tsx`
- `src/components/forms/FormRenderer.tsx`
- `src/components/forms/FormsModule.tsx`
- `src/components/forms/ai-form-generator.ts`
- `src/pages/PublicForm.tsx`
- `src/lib/forms.ts`
- `src/lib/form-html.ts`
- `server/forms-data.ts`
- `server/storage-api.ts`
- `migrations/098_form_builder_advanced_fields.sql`
- `migrations/099_form_commerce_catalog.sql`
- `migrations/101_form_commerce_operations.sql`
- `scripts/smoke-form-commerce.ts`
- `scripts/smoke-form-commerce-operations.ts`
- `scripts/load-form-inventory.ts`
- `scripts/verify-form-production-config.ts`
- `scripts/check-form-health.ts`
- `scripts/.codex-forms-check.mjs`
- `server/health.ts`
- `api/health.ts`
- `.github/workflows/ci.yml`
- focused tests under `src/components/forms` and `src/lib`
