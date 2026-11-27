# Store lock and customer registration

An effective site lock blocks the signup page, the registration POST, and new
`auth.users` inserts. The database trigger also covers requests made directly to
Supabase Auth instead of the website endpoint. This follows Supabase's documented
[Auth-user trigger pattern](https://supabase.com/docs/guides/auth/managing-user-data).

Existing users can still authenticate. The server storefront layout checks the
current account role and fresh lock state before rendering customer content;
staff retain their preview access. Missing/unreadable access settings fail closed
for registration and non-staff storefront rendering.

Successful signup, verification, password login, and OTP login use a same-origin
document navigation. This starts a fresh Next.js client rather than reusing a
prefetched unlocked page after the authentication cookie changes. A cached signup
form receiving HTTP 423 also navigates to the lock screen.

## Migration and release

Migration `20261127010000_block_signup_while_store_locked.sql` installs the Auth
insert guard. Apply it through the existing migration/release pipeline alongside
the application change. Application checks alone do not block direct provider
signup until this migration is applied.

The trigger blocks **all new Auth user records** during an effective lock,
including administrative creation/invitations. It does not change existing users
or block their sign-in updates. Provision new staff before enabling a lock, or
after its scheduled opening. An unconfigured database without a tenant retains
the bootstrap behavior; the website itself fails closed without store settings.

Existing date semantics are preserved: a disabled lock or an elapsed unlock time
allows registration; an enabled lock without a deadline remains closed.

## Verification

- `node node_modules/jest/bin/jest.js --config jest.config.ts --runInBand --runTestsByPath tests/unit/registration-lock.test.tsx tests/unit/storefront-lock-layout.test.tsx tests/unit/auth-navigation.test.ts --roots src tests`
- `node tests/browser/auth-lock-navigation.mjs`
- `node --test --test-concurrency=1 tests/database/site-lock-registration.test.mjs`

The database test requires the existing marked local disposable database fixture
via `SPECIALTY_TEST_DATABASE_URL`. Use a local fixture administrator able to assume
`supabase_auth_admin`; the test refuses non-local/non-disposable targets. Its
schema and test rows are confined to that database, which is removed afterward.

The browser test renders the real authentication components, models a cached
Next-router boundary, and serves fresh document redirects from a local HTTP
fixture. It makes no real signup calls. The SQL test exercises actual PostgreSQL
inserts as Supabase Auth's database role, including rejected-creation rollback and
scheduled opening. Hosted signup and deployment are separate release checks.
