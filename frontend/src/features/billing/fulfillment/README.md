# Billing fulfillment

All four services use the same cart, pricing, checkout and kitchen pipeline.

| Service | Required handover detail | Pricing channel |
| --- | --- | --- |
| Table | Selected table | Dine-In |
| Token | Counter token (1–4 digits) | Takeaway |
| Pickup | Future local date and time | Takeaway |
| Delivery | Customer address | Delivery |

Customer name and a ten-digit phone number are required by checkout for every service.

`utils/fulfillmentMode.js` owns mode definitions, mode changes, hydration,
checkout validation and payload construction. Changing modes clears fields that
belong to the previous service. `store/useBillingFulfillment.js` owns React state
and derives the pricing channel and pickup timestamp. Components render these
values; `Billing.js` submits the payload from `buildFulfillmentPayload`.

Pickup input uses local calendar fields and is converted to an ISO timestamp only
for persistence. Hydration converts that timestamp back into local fields.
Delivery addresses use existing bill metadata, so no database migration is needed.
The backend bill request allowlist, metadata normalizer and legacy bill/kitchen
serializers preserve the address.

Token suggestions are based on loaded recent orders. They are editable labels,
not a server-allocated unique sequence. Handover summaries describe the current
checkout; kitchen statuses continue to be driven by the existing KOT workflow.
