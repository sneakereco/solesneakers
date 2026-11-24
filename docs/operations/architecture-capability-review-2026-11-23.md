# Architecture capability review

Working assessment for [issue #44](https://github.com/sneakereco/solesneakers/issues/44).
Review existing capabilities individually with the storefront owner before deciding
what to retain, retire, or investigate. Code reachability and business need are
separate evidence; a hidden entry does not establish that a capability is unused.

## Agreed organization

- Sole Sneakers operates one Store. Seller accounts and tenant businesses are
  retired concepts; multi-tenant capabilities belong to a separate platform.
- Modules represent business capabilities.
- Features represent business actions within a module.
- Feature implementation belongs in `Modules/<Module>/Source/Features/<Feature>`.
- Feature tests belong in `Modules/<Module>/Tests/Features/<Feature>`.
- Shared implementation remains within its owning module where practical, with
  deliberately small interfaces for collaboration.
- Framework route entries and chronological database migrations retain their
  required locations; module ownership still needs to be documented.

The full module map, interfaces, migration sequence, and implementation tasks
remain to be designed. No module restructuring has been performed.

## Reviewed capabilities

| ID  | Capability                                | Decision | Business evidence                                                                              | Required change                                                    | Proposed owner                 |
| --- | ----------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------ |
| 001 | Passwordless sign-in with an emailed code | Retain   | The user confirmed on November 23 that it is used and intended to be available                 | Expose the existing sign-in switch on the password-login screen    | Identity / SignInWithEmailCode |
| 002 | Administrator invitation links            | Retire   | The user confirmed that invitations are unused and authorized removal of their routes and code | Remove application entry points and invitation-only implementation | Retired                        |
| 003 | Seller account role                       | Retire   | User confirmed unused                                                                          | Remove application role/context; retain financial facts            | Retired                        |
| 004 | Tenant business model                     | Retire   | User confirmed single Store; separate multi-tenant platform                                    | Coordinated application/schema retirement; design proposed         | Store-owned modules            |

## 001: Passwordless sign-in with an emailed code

The customer requests an emailed code and uses it to sign in without entering a
password. This is distinct from confirming an email address during registration
or recovering a password.

### Current evidence

- `src/components/auth/login/LoginFormRouter.tsx` selects the flow when
  `flow=otp` and preserves existing query parameters when switching between
  password and email-code sign-in.
- `src/components/auth/login/OtpLoginForm.tsx` supplies the request and verification
  UI, calling the existing `/api/auth/otp/request` and `/api/auth/otp/verify` routes.
- `src/components/auth/login/PasswordLoginForm.tsx` contained a wired switch that
  was hidden, excluded from tab navigation, and hidden from assistive technology.
- `EmailCodeFlow` also supports email verification and is not exclusive to this
  sign-in capability.

### Decision and local change

Retain this capability. The initial investigation status is resolved by the
user's confirmation of its business use. Make the existing switch visible using
the established authentication link styling and allow normal keyboard and
assistive-technology access. Disable the switch while password sign-in submits,
consistent with the form's other controls.

The existing sign-in implementation remains in place. Its eventual proposed home
is `Modules/Identity/Source/Features/SignInWithEmailCode`; that relocation belongs
to the separately designed architecture migration.

### Verification scope

Verify visibility, keyboard activation, switching into the actual email-code form,
returning to password sign-in, and preservation of the checkout return destination.
Browser navigation is adapted for the isolated UI check. This does not verify
email delivery, code verification with the authentication provider, MFA completion,
or a deployed environment. No live authentication request is required for the
visibility change.

### Local verification result

- The isolated browser check failed before the change because the email-code
  switch was absent from accessible button discovery.
- After the change, the check passed for visibility, tab navigation, keyboard
  activation, entry into email-code sign-in, return to password sign-in, and
  preservation of `next=/checkout` in both directions.
- Targeted ESLint, TypeScript with `--noEmit --incremental false`, formatting,
  and whitespace checks passed.

## 002: Administrator invitation links

This capability generated a link that an administrator could share with a new
staff member. The recipient signed in or registered and accepted the invitation
to receive the invited administrator role. The user confirmed that the capability
is unused and explicitly authorized removing its routes and implementation.

### Evidence before retirement

- The administrator profile offered invitation generation to permitted roles.
- A dedicated page handled links and called an acceptance route after loading
  the signed-in user.
- That page still requested `/api/me`, which had no matching route in the source
  inventory. This was a stale-dependency finding, not a live reproduction.

### Decision and local change

Retire the application capability:

- Remove `/api/admin/invites`, `/api/invites/accept`, and `/invite/admin`.
- Remove the invitation panel and generation/copying state from the administrator
  profile, retaining its account identity display and profile lookup.
- Remove the invitation implementation, repository, request schemas, permission
  map, and role helper functions whose only consumers belonged to invitations.
- Remove the now-uncalled profile role setter and invitation token helpers.
- Preserve existing administrator role recognition, sign-in, MFA, and the token
  generation and HMAC functions used for guest order access.

The unused `/api/me` request disappears with the invitation acceptance page.
No replacement invitation flow or module is planned.

### Database disposition

The `admin_invites` table, its historical indexes and policies, and its generated
database declarations are retained for separately reviewed schema cleanup. The
application no longer needs them. Before removal, verify deployed application and
migration versions, database/external consumers, and any retention requirements;
use a forward migration and regenerate types from the resulting schema. Preserve
historical migrations. This application cleanup changes no deployed schema or
retained invitation records.

### Verification scope

Verify that the administrator profile still loads for an existing administrator
without offering invitation controls, that retired routes and helpers have no
remaining application callers, and that the existing authentication and guest
order access checks remain green. A generated database type or historical
migration referencing the retained table is not an application caller.

### Local verification result

- The isolated administrator-profile check failed before removal because the
  invitation controls were present for a developer-role profile. After removal,
  the same check passed while retaining the profile heading and account email.
- A source scan found no remaining invitation routes, application callers,
  invitation permission helpers, or invitation token helpers. The only remaining
  `src` references are the generated declarations for the retained database table.
- Existing Jest suites passed: 110 unit suites / 475 tests and 3 integration
  suites / 21 tests. The integration suites include schema-text assertions;
  this is not evidence of live database behavior.
- Targeted ESLint, formatting, whitespace checks, and TypeScript passed. Next.js
  route definitions were regenerated after deleting routes; stale development
  type-cache references were removed before the final TypeScript check.
- No database migration, live authentication action, invitation action, or
  deployment was performed.

## 003: Seller account role

Decision: retire. The user confirmed that seller accounts are unused and that
Sole Sneakers is not a multi-tenant platform.

### Local application change

- Remove `seller` from accepted profile roles.
- Remove unused `sellerId` context fields and null arguments from product creation
  and duplication.
- Rename seller revenue variables and transaction labels to Store terminology,
  preserving the calculations and financial records.
- Preserve Square's `sellerKeyedIn` contract field and the valid independent
  reseller wording in the legal terms.

TypeScript, targeted ESLint, formatting, the existing transaction browser check,
and all 110 unit / 3 integration suites passed (475 / 21 tests). No new database
migration or deployment was performed.

The local database has zero seller profiles and already restricts profile roles
to customer/admin/super_admin/dev. The obsolete sellers table is covered by an
existing committed retirement migration that is missing locally. Verify each
target's baseline before schema cleanup; do not restore obsolete generated types
from the drifted local schema.

## 004: Tenant business model

Decision: retire. The user explicitly confirmed that this is a single-store
application and that a separate platform is being built for multi-tenant needs.

This supersedes tenant-scoping requirements in historical plans. Store, Customer
and Staff vocabulary is recorded in `GLOSSARY.md`.

The user approved the coordinated tenant migration design on November 23, 2026. Runtime
code still relies on tenant IDs for profile creation, settings, catalog queries,
payment contracts, protection counters, storage paths, audits and SQL routines.
Replacing those dependencies is covered by the
[single-store retirement design](../superpowers/specs/2026-11-23-single-store-retirement-design.md).

The approved end state removes tenant bootstrap and normal application tenant
arguments, uses store-wide settings and uniqueness, preserves customer/staff
authorization and retained business data, and removes old schema through
separate compatibility and contraction releases. Temporary compatibility has
explicit exit criteria; a permanent default tenant is not the target.

The read-only preflight is implemented with 13 real PostgreSQL tests and fresh
review. All 105 historical migrations replayed in an empty disposable database;
a populated backup restored with original ownership/ACLs and passed preflight
after alignment. The ordinary local database remains unchanged and still lacks
two committed historical retirement migrations.

The Checkout compatibility module now reads legacy and future permit, address,
and cart-hash formats, with module-owned tests. Production producers retain
their legacy formats. Fresh review, 543 unit / 21 integration tests, TypeScript,
targeted lint/formatting, new-adapter cyclomatic complexity at most 10, and three
isolated checkout browser checks passed. These are local results, not deployed
provider evidence. See the [contract documentation](single-store-checkout-contracts.md)
and [release ledger](single-store-retirement-runbook.md).

Additive database expansion and its deployment preflight gate are implemented
and independently reviewed. Twenty-five real PostgreSQL tests passed, including
old/new callers competing for the last stock unit. The exact expansion replayed
over empty and populated disposable baselines without changing retained data,
old routine bodies/ACLs, policies, triggers, columns or indexes. Gate regression
checks also passed against isolated 105/106/107-migration commits.

Staging/production state and the application cutover/contraction gates remain
outstanding. No deployment or ordinary-database tenant migration was performed;
the local compatibility release passed final independent review. Deployment
checks keep historical migration validation unconditional, while expansion data
checks apply only before expansion is recorded, preserving unrelated releases.

## Remaining review

Continue the capability inventory one item at a time after the coordinated
tenant-retirement checkpoint. No additional capability has been approved
for retirement or architectural relocation.
