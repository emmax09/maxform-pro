# Orders

**Orders** is a workspace-level module: every sale the workspace has taken, from
whichever part of the product produced it, in one ledger.

## One ledger, not five

Every module that takes money already writes the same table. `payment_orders`
carries a `source_type` of `form`, `event`, `invoice`, `subscription` or
`manual`, and the row is the order regardless of where it came from. This module
is the read side of that table, so a workspace can answer "what have we sold"
without opening five screens.

Nothing was migrated or duplicated to make this work — the ledger was already
shared. What was missing was a front door.

> **`event_orders` is not read here.** Nothing has inserted into it since event
> checkout moved onto the shared ledger; the only remaining writer is legacy
> client code, and the only server touch is an `UPDATE`. Event sales arrive as
> `payment_orders` rows with `source_type = 'event'`. Treat that table as
> legacy to retire, not as a second source to merge.

## Tabs

| Tab | What it shows |
| --- | --- |
| **Overview** | Net revenue, order counts, money still owed, where sales come from, best sellers |
| **All orders** | The whole ledger, searchable and filterable by status |
| **Forms** | Product and cart checkout |
| **Events** | Ticket sales |
| **Invoices** | Billed directly |
| **Subscriptions** | Recurring billing |
| **Items sold** | What actually moved, aggregated across every module |

The source tabs are the same list with a filter applied — one implementation
rather than five near-copies. `?section=` deep-links to any of them.

## The order detail

Clicking any row opens the full record — everything an operator needs when a
customer writes in about a payment:

* **Identifiers**, each selectable and copyable: order number, order ID,
  provider reference, transaction ID and payment ID per attempt, contact ID.
* **Full timestamps** for placed and paid, not just dates.
* **Payment attempts**, with provider, amount, status and time.
* **Items**, refunds, invoices and subscriptions attached to the order.
* **Receipt** — a PDF, generated from `src/lib/order-receipt.ts`, the same
  implementation the public payment-verification page uses. A receipt that
  differs depending on which screen produced it is a receipt nobody can
  reconcile against, so there is one.

## Tables: selection, bulk actions, pagination

Every order table uses the shared table furniture from
`src/components/shared/TableFilters.tsx` — `TableSelectionBar`,
`TableBulkActions`, `TableRowSelect` and `TablePagination` — so selection and
paging behave here exactly as they do elsewhere in the product.

Bulk actions: **Export as CSV**, **Cancel unpaid orders**, **Delete**.

> **Delete is guarded, deliberately.** An order that took money is a financial
> record; deleting one destroys the trail a refund, a chargeback or an audit is
> reconciled against. Only `draft`, `pending`, `failed` and `cancelled` orders
> can be deleted. The action is disabled in the menu when the selection
> contains a settled order — naming how many — and the server refuses it with a
> `409` that names the offending orders, so a hand-made request gets the same
> answer. Cancel is the reversible alternative.

A selection is dropped whenever the tab, filter, search or page changes: a
selection only means anything against the rows it was made on.

## How it connects to Payments

Deliberately split: **this module reports, Payments acts.** Refunds, providers
and payouts stay in Payments, and the order detail links across rather than
duplicating them — *Refund in Payments*, *Payment record*, *Reports* — alongside
a link back to the form or event that produced the order.

The detail view reads the Payments-side records (refunds, invoices,
subscriptions) so it can tell you whether an action is available before sending
you there.

## Money and currency

Amounts arrive as numbers, not the driver's numeric strings, so the client never
parses money. A workspace that takes more than one currency is not summed across
them: the dominant currency labels the totals and the overview says
"mixed currencies" rather than quietly adding pounds to naira.

"Settled" means `paid`, `partially_refunded` or `refunded` — money that actually
arrived. "Awaiting payment" means `draft`, `pending` or `processing`. Refunds are
reported separately rather than silently netted off, and net revenue is
gross minus refunds.

## Access

`orders` is a module key like any other, so a workspace owner can grant or
withhold the tab per member from Settings → Members, and the server enforces the
grant. See [WORKSPACE_MEMBERS.md](./WORKSPACE_MEMBERS.md).

## Verifying

```bash
npm run smoke:orders        # API level, no browser needed
npm run dev                 # then, in another shell:
npm run smoke:orders:ui     # browser level, drives the real screens
```

`smoke:orders` seeds one order per source and drives the real HTTP handler:
the cross-module list, the source and status filters, search, the paging totals,
the detail view with its Payments records, and the overview summary — asserting
that settled revenue counts only settled orders and that net subtracts refunds.

`smoke:orders:ui` drives Chromium: the rail entry, the module opening from it,
the overview totals agreeing with the seeded data, the tabs filtering the same
ledger, and an order opening its detail with the Payments links attached.

It also covers the bulk paths: export returns exactly the selection, deleting a
settled order is refused with the order named, unpaid orders cancel and then
delete, and an empty or oversized selection is rejected.

Both delete everything they create in a `finally` block, including on failure.
