# Project Overview

Sole Sneakers combines a customer storefront with a role-protected operations console.

Customers can browse and search products, manage a cart and account, submit contact requests, and inspect existing orders. Administrators can manage first-party inventory, catalog metadata, featured products, customers, existing orders, fulfillment, pickups, shipping, nexus settings, store access, and admin invitations.

Supabase is the system of record for users, products, variants, inventory, customers, and orders. Shippo is limited to shipping workflows, and Amazon SES is limited to transactional email.

No active payment or external tax processor exists. Checkout is intentionally unavailable until those capabilities are replaced with a cohesive server-side workflow.
