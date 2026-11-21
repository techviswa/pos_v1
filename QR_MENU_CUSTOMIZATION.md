QR menu customization, allergens and availability

Guest menu layout: cards show the photo, name, dietary badge, base price and Add button. Tapping the item or Add opens one accessible item sheet (a bottom sheet on phones). Sizes, required choices and extras live there; allergen information and optional kitchen requests are expandable sections. Confirmed selections and notes appear in the cart. Closing the sheet does not add anything, and opening a fresh configuration resets its draft choices.

Ingredient-based propagation is now available in Inventory → Ingredient allergens. See [QR_VISIT_BILLING_ALLERGENS.md](QR_VISIT_BILLING_ALLERGENS.md) for automatic recipe/choice/combo warnings and review rules.

Owners: open Products, edit an item and use “Customer QR menu details”. Enter the guest description, contains/may-contain allergen names, and whether restaurant staff reviewed the information. These fields are stored in the existing product channel_settings.qr JSON. No database migration is needed. Editing channel prices preserves QR settings and existing schedules.

Guests: sizes, add-ons and required/optional choice groups display their prices. Optional single choices can be cleared. The cart lists selected choices and per-item kitchen requests; different requests create separate cart lines. Requests reach the chef and kitchen print payload and require restaurant confirmation. Dietary filtering uses the restaurant's product labels. Allergen labels are entered by staff, never inferred from dish names; unknown information is marked unconfirmed, and customization/shared equipment can change exposure.

Availability: hide an item from QR, mark it temporarily sold out while retaining its menu card, or opt into checking recorded product stock. Stock limits aggregate all selected sizes/choices of the same product. Made-to-order dishes can leave this limit off. This check does not reserve stock for pending QR orders; existing billing/inventory checks still apply. Existing outlet/channel and scheduled visibility rules remain in effect.

The menu refreshes every 30 seconds while visible and when focused. Background refresh does not add scans or reopen ended visits. Existing cart selections remain; unavailable items or changed choices/prices block submission until removed/re-added. The API independently checks current availability, prices and choices. A retry of an already saved order returns that order even after stock or price changes.

Verification: backend/scripts/qr-menu-details-tests.mjs covers saved metadata, invalid update rollback, required/inactive choices, trusted prices, aggregate stock, kitchen notes and printing, sold-out/hidden items, retry recovery and refresh side effects. Frontend QrMenuCustomization.test.js exercises guest selection/submission; QrFoodInformation.test.js covers unknown allergen presentation and admin input normalization.
