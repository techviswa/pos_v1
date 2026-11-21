# Combined rounds, item invoices and ingredient allergens

## Staff billing

In Billing or Manager, under **QR final bill requests**, choose **Combine rounds / split items**. A guest can request a bill from their tracking page. Select accepted, unbilled rounds from the current table visit.

- **Issue one combined unpaid invoice** combines selected rounds. Guests can pay equal or custom shares of it, or pay staff.
- **Issue separate unpaid invoices** assigns item quantities to separate invoices. Every quantity must be assigned exactly once. Invoices can be paid independently; online shares within one invoice remain sequential to prevent overlapping collection.
- The interface allows 10 item invoices; the API allows 20. Empty columns are omitted. Another table, outlet, tenant or reopened seating cannot be combined. Already-issued invoices cannot be repartitioned here.
- Service charges and tips are allocated per source round by item value, keeping every paise. Zero-priced lines use unit weights. Tax is calculated per invoice; rounding can differ from one combined invoice.
- Verified loyalty redemption requests must first be cleared through the guest bill request (zero points), or issued on the original order. Allocation never transfers somebody's points. Normal loyalty earning applies to fully paid invoices with an identified customer. Mixed-phone invoices use “Table guests” without a loyalty customer.

Creation is atomic across invoices, inventory, numbering and order allocations. Failure rolls back the batch. Persisted request keys recover lost responses; changing the allocation with the same key is rejected. Order row/advisory locks and the existing settlement lock serialize competing billing paths. Legacy billing refuses allocated orders. Orders retain `qr_bill_ids`; invoices retain source IDs and exact line allocations in server-owned metadata. No artificial kitchen orders are created.

Staff explicitly decide which guests share an invoice. An order link sees only invoices containing that order's items. A shared invoice consequently shows its selected shared lines, never customer phone numbers. Foreign invoice IDs are rejected. All invoices containing an order's items must be paid before its feedback opens. QR analytics includes feedback from allocated invoices under the existing outlet guards.

## Ingredient allergens

Open **Inventory → Ingredient allergens → Manage ingredient allergens**. Record “contains”, supplier “may contain” and current supplier-label review status. Editing a warning clears the checkbox until explicitly verified again. Public menu polling reads current records.

Existing recipe `inventory_id` references connect ingredients. The menu unions product warnings with ingredient warnings from base recipes, variations, add-ons, choice options, linked products and combos. Optional choices are included conservatively. Guest removal notes never suppress warnings. Missing ingredients, unreviewed sources and cyclic legacy links keep public information unconfirmed. Inactive components are included in derivation but excluded as saleable cards.

Products retains the separate dish/kitchen handling review. Staff must maintain accurate supplier and recipe data and assess kitchen cross-contact. Software does not infer allergens from names or certify dishes allergy-safe.

Tenant-owned StateDocument JSON stores ingredient reviews and allocation retry records; no schema migration or provider change is needed. Ingredient APIs require `inventory`; visit billing requires `billing` and current outlet authorization. Existing payment, loyalty, refund and stock ledgers remain in use.

## Verification

- `node backend/scripts/qr-checkout-tests.mjs`: allocations, stock rollback, replay/concurrency, invoice capabilities, payments, ingredient API permissions and closed visits.
- `node backend/scripts/qr-menu-details-tests.mjs`: ingredients, optional recipes, linked products, combos and cycles, plus existing menu checks.
- From backend: `node scripts/rls-isolated-check.mjs --quick --checkout --food --experience` uses a schema-only disposable cluster with restricted PostgreSQL roles, leaving project data unchanged.
- Frontend billing/allergen tests and production build.

Live gateway/SMS configuration, deployment and operational acceptance testing remain separate steps.
