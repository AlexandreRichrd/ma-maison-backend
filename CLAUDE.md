# CLAUDE.md

Project instructions for Claude Code. Read this before making changes.

## Project

**Home Manager API** — the NestJS backend for the Home Manager household app.
Owns PostgreSQL, all domain logic, and authentication. The frontend is a
separate React Router v7 app (`my-home`, sibling repo) that talks to this API
over HTTP — it holds no database connection and no domain logic of its own.
See `my-home/CLAUDE.md` for the frontend side of this split.

This used to be one React Router app with server-side loaders/actions acting
as the backend. That backend was removed from `my-home` and rebuilt here as a
standalone API so the domain layer isn't tied to one frontend. Do not
resurrect direct DB access, Drizzle, or domain logic (chore rotation,
ingredient merging, etc.) inside `my-home` — if frontend code needs data or a
mutation, it calls this API.

Scoped to **one household**. Do not build multi-tenancy, org hierarchies,
third-party household sign-up, or role permission systems. Chore rotation and
reminder assignees are still built for exactly **two** people — see Chore
rotation and Not in scope yet. Invites can technically add a third+ person
today; that will visibly break rotation/assignment until it's redesigned for
N users, which hasn't happened yet.

## Stack

- NestJS 11 — modules/controllers/services, REST over Express
- TypeScript, strict mode
- PostgreSQL via Prisma ORM (`@prisma/client`, generated to `generated/prisma`)
- `class-validator` / `class-transformer` for DTO validation, behind a global
  `ValidationPipe`
- `@nestjs/jwt` for JWT issuance/verification, `argon2` for password hashing
- `@nestjs/throttler` for login rate limiting
- Node 20+
- Jest (unit) + Supertest (e2e, already scaffolded in `test/`)

Do not add GraphQL, a second ORM, a message queue, or Redis unless a real
requirement shows up — there is no scale problem to solve yet. Do not add
session-cookie auth here: see Authentication for why this API is JWT-only,
with the cookie concern pushed to the frontend.

`argon2`, `@nestjs/jwt`, `@nestjs/throttler`, `class-validator`, and
`class-transformer` are not yet in `package.json` — add them when
implementing Authentication, don't invent a substitute.

## Modules

One Nest module per feature area, mirroring the frontend's sections:

```
src/
  main.ts
  app.module.ts
  prisma/
    prisma.service.ts     # PrismaClient singleton, implements OnModuleInit
    prisma.module.ts      # @Global, exports PrismaService
  auth/
    auth.module.ts
    auth.controller.ts     # POST /auth/login, /auth/register, /auth/activate
    auth.service.ts
    jwt.strategy.ts         # Passport JWT strategy
    jwt-auth.guard.ts       # applied via a global APP_GUARD, not per-route
    invites.controller.ts   # POST /invites (create), scoped to signed-in user
  households/
    households.controller.ts  # GET /households/me — users + member_order
  shopping/
    shopping.controller.ts    # lists + items
    shopping.service.ts
  recipes/
    recipes.controller.ts
    recipes.service.ts
    ingredients.ts              # name normalisation — pure, unit-tested
  cleaning/
    cleaning.controller.ts      # GET /cleaning?week=2026-W32
    rotation.ts                   # pure chore-rotation function, heavily tested
  reminders/
    reminders.controller.ts
  common/
    dto/                    # shared DTOs (pagination, etc.) if any emerge
    filters/                # exception filters -> consistent error shape
mail/
  mail.service.ts            # logs instead of sending if SMTP_HOST unset
```

Each feature module owns its own DTOs, controller, and service — don't
centralize DTOs in one giant file. `PrismaModule` is the only cross-cutting
module besides auth.

## API surface

REST, one small endpoint per resource — no single aggregating "dashboard"
endpoint. The frontend's dashboard loader calls several of these in parallel
(reminders due today, shopping previews, this week's chores), same shape as
the old in-process loader, just over HTTP instead of direct queries. Keep it
that way: don't build bespoke aggregate endpoints per frontend page, or the
API balloons into one endpoint per screen.

Every mutation validates its body with a `class-validator` DTO before
touching Prisma. Return a `400` with a structured error on failure:

```ts
{ statusCode: 400, errors: [{ field: string, code: string }] }
```

`code` is a stable machine-readable string (e.g. `"required"`,
`"invalid_email"`), not a message. **User-facing French copy is a frontend
concern** — this API is not French-localized and returns no UI strings; the
frontend maps `code` to the French message shown to the user. Do not put
French text, or any display copy, in this codebase.

## Chore rotation

The core domain rule, ported as-is from the old frontend. Implement it once,
as a pure function in `src/cleaning/rotation.ts`, tested in isolation. Never
scatter this logic across controllers or services.

Two rotating groups, both keyed off the ISO week number relative to a fixed
`ROTATION_EPOCH` constant:

**Weekly swap** — alternates every week:
- Group A: Kitchen, Trash
- Group B: Bathroom, Surfaces, Floors

**Biweekly swap** — alternates every two weeks:
- Group C: Bedsheets
- Group D: Corridor

The biweekly pair is always assigned to **opposite** people: whoever has
Bedsheets does not have Corridor that week.

Rules:

- Signature: `getWeekAssignment(isoWeek: string, users: [User, User]): Assignment`
  — the tuple type is load-bearing: this function is only defined for two
  people. If the household ever has a third+ member (possible now via
  invites, see Authentication), calling this needs a redesign first; don't
  paper over it with `users[0]`/`users[1]` slicing
- **Pure and deterministic** — same week in, same result out, no database access
- Assignments are never written to the database. Only *completions* are stored.
- User order is stable, from `households.member_order` (an array of user
  ids). Rotation does not scramble if a row's `created_at` changes.

Test past, current, and future weeks plus the year boundary — ISO weeks do
not align with calendar years. Use `date-fns` (`getISOWeek`, `parseISO`),
never a hand-rolled division by 7.

`GET /cleaning?week=2026-W32` returns the computed assignment merged with
that week's stored completions — the frontend never computes rotation itself.

## Database

Prisma schema at `prisma/schema.prisma`. Connection string in `DATABASE_URL`
(see `prisma.config.ts`). `PrismaService` is the only place a `PrismaClient`
is constructed — inject it, never `new PrismaClient()` elsewhere.

| Table | Notes |
|---|---|
| `households` | single row; holds `member_order` for stable rotation |
| `users` | email, password_hash, household_id, name, avatar_key, role, email_verified_at nullable — see Authentication |
| `invites` | household_id, invited_by_user_id, email, token, expires_at, accepted_at nullable |
| `email_verifications` | user_id, token, expires_at, consumed_at nullable |
| `shopping_lists` | name |
| `shopping_items` | list_id, name, quantity, unit, checked, source_recipe_id nullable |
| `recipes` | name, servings, instructions |
| `recipe_ingredients` | recipe_id, name, quantity, unit, position |
| `chores` | name, rotation_group (`A`\|`B`\|`C`\|`D`) |
| `chore_completions` | chore_id, user_id, iso_week, completed_at |
| `reminders` | title, due_at, done_at nullable, assignee_ids (0-2, no FK — array column) |

This is the same schema the old Drizzle setup used — port it into
`schema.prisma` rather than redesigning it. Conventions:

- `id` is a `uuid` with a default (`dbgenerated("gen_random_uuid()")` or
  Prisma's `uuid()` default — pick one and use it everywhere)
- `created_at` / `updated_at` are `@db.Timestamptz`, not plain `timestamp`
- Chore *assignment* is computed by `rotation.ts`. Only completions are
  persisted, keyed by `(chore_id, iso_week)` with a unique constraint
- Reminder completion is `done_at` nullable, not a boolean — undo sets it to null
- `shopping_items.source_recipe_id` is `onDelete: SetNull`: deleting a recipe
  must never remove items already on a list
- Ingredient count on the recipe overview is an aggregate query
  (`_count`), not a stored counter column
- Foreign keys always declare `onDelete` explicitly
- Schema changes: edit `schema.prisma`, run `prisma migrate dev`, review the
  generated SQL, commit the migration folder — never hand-edit a migration
  after it's been applied anywhere
- `password_hash` must never be selected outside the auth service. Any
  query, controller, or DTO that touches `users` — this service or a future
  one (`households/me`, an admin listing, whatever) — returns a projected
  type, never the raw Prisma `User`. `AuthService`'s `PublicUser` (`Omit<User,
  'passwordHash'>` plus a `toPublicUser()` helper) is the existing pattern;
  reuse or mirror it, don't invent a new shape per endpoint. This bit
  `my-home` for real: `getOrderedUsers()` selected full `User` rows and the
  hash rode along into five different loaders' SSR payloads before anyone
  noticed — the fix there was the same idea, an explicit column list instead
  of a bare `select()`

`addIngredientsToList()` (recipe -> shopping list) is the one multi-step
write that must stay a single Prisma `$transaction`; partial application is
not acceptable:

- inserts one `shopping_items` row per ingredient
- **merges** with an existing *unchecked* row of the same normalised name and
  unit in the target list, summing quantities, rather than creating a duplicate
- a *checked* row is not merged into — it is treated as already bought, so a
  new unchecked row is created
- tags each created row with `source_recipe_id`

Name normalisation (trim, lowercase, collapse whitespace) lives in
`src/recipes/ingredients.ts` and is unit-tested. Do not inline it.

## Authentication

JWT bearer tokens, not server-side sessions — this API is stateless and
meant to be called by more than an SSR frontend in principle, even though
today `my-home` is the only client.

- `POST /auth/login` verifies email + password (argon2id) and returns
  `{ accessToken, user }`. No refresh token for now — a single household app
  doesn't need the complexity; pick an expiry (e.g. 30 days) long enough that
  re-login isn't constant, and revisit if that turns out to be wrong
- The JWT payload carries `sub` (user id) only — no roles/permissions to
  encode, this app still has no authorization system beyond "signed in"
- **RS256, not HS256.** This service signs with `JWT_PRIVATE_KEY` (an RSA
  private key, PEM, never committed — see `.env.example` for how to
  generate one); any client verifies with the matching `JWT_PUBLIC_KEY`.
  The public key isn't a secret — handing it to `my-home` (or a future
  mobile client) to verify tokens locally doesn't create the coupling a
  shared symmetric secret would: rotating the keypair means updating
  `JWT_PUBLIC_KEY` wherever it's copied to, but a leaked public key alone
  can't forge a token, only a leaked private key can. `src/auth/jwt-keys.ts`
  loads and normalizes both from the environment (see the PEM-to-single-
  line note there); `JwtStrategy` pins `algorithms: ['RS256']` explicitly —
  without that allow-list, a forged token could set `alg: HS256` in its
  header and get verified using the public key as an HMAC secret, since
  it's public
- Public key distribution today is a plain env var copied into `my-home`'s
  own `.env`, not an HTTP endpoint — the only client is a server-side app
  that already reads its config from the environment, so an endpoint would
  add a network dependency (and a cache-invalidation question on rotation)
  to solve a problem the env var doesn't have. Revisit if a client shows up
  that can't be handed the key at deploy time (a third-party integration,
  say) — a `GET /.well-known/jwks.json` alongside the env var, not instead
  of it, would be the natural next step, and wouldn't require touching
  existing clients
- A global `JwtAuthGuard` (via `APP_GUARD`) protects every route by default;
  opt out per-route with a `@Public()` decorator for `/auth/login`,
  `/auth/register`, `/auth/activate`
- **This API does not set cookies.** The frontend is responsible for storing
  the JWT in its own `HttpOnly`/`Secure`/`SameSite=Lax` cookie and forwarding
  it as `Authorization: Bearer <token>` — never assume the token is safe in
  browser JS just because it's a JWT. See `my-home/CLAUDE.md` for that side
- Passwords hashed with argon2id
- `POST /auth/login` is rate-limited via `@nestjs/throttler`, per IP and per
  identifier (email)
- Constant-time failure delay, and the same error message whether the
  account doesn't exist or the password is wrong — never reveal which
- Login additionally refuses any account with `email_verified_at IS NULL`,
  with a distinct error code — this check happens *after* password
  verification, not before, so it can't be used to probe whether an email
  has an account
- Still out of scope: OAuth, password reset, refresh tokens/token revocation

### Invite / register / activate

Household growth is invite-gated, not self-serve:

1. `POST /invites` (authenticated) writes an `invites` row with a random
   token (32 bytes hex) and a 7-day expiry, then sends an email via
   `MailService` with a link the frontend renders as `/register?token=…`
2. `POST /auth/register` is `@Public()` but rejects a missing, expired, or
   already-accepted token. On success it runs one transaction: creates the
   `users` row (unverified), appends the new user's id to
   `households.member_order` (see Chore rotation), marks the invite
   accepted, and issues an `email_verifications` row (24h expiry). The
   activation email is sent after the transaction commits
3. `POST /auth/activate` (or `GET`, matching whatever link shape the
   frontend needs) is `@Public()`, consumes the token (sets
   `email_verified_at`, marks the verification row consumed). Login is
   refused until this step happens

`MailService`: if `SMTP_HOST` isn't set, it logs the email (with the link) to
the console instead of sending — that's the local-dev path, and how you find
invite/activation links when testing without real SMTP. Production sends for
real, through the household's mailbox (`contact@aureus-lab.fr` on OVH's
Zimbra, port 587/STARTTLS — see `.env.example`), and needs `SMTP_HOST`,
`SMTP_USER`, `SMTP_PASS`, and `APP_URL` set, so emailed links point at the
frontend's real domain, not this API's. There is no separate "from address"
setting — the From header is always built from `SMTP_USER`, since DMARC
checks From against the authenticated sending mailbox and letting the two
diverge is how mail lands in spam.

## Commands

```bash
npm run start:dev        # nest start --watch
npm run build
npm run start:prod
npm run lint
npm run test              # jest, unit
npm run test:e2e          # supertest against a real Nest app instance
npx prisma migrate dev
npx prisma generate
```

Run `npm run test` (and `test:e2e` when routes changed) before considering
work finished — there's no separate typecheck script; `nest build` is the
type-checking step if needed ad hoc.

## Git workflow

Commit after each todo item is completed — this is standing authorization to
commit without asking each time, scoped to local commits only.

- One commit per completed todo-list item, not per file and not batched across
  a whole feature. If a task wasn't broken into a todo list, commit once the
  discrete piece of work is done.
- Run `npm run test` (and `npm run test:e2e` when routes changed) before
  committing. Do not commit code that fails either.
- A Prisma schema change and its generated migration folder belong in the
  **same commit** — never commit a `schema.prisma` edit without the migration
  it produced, or the next person's `prisma migrate dev` will diverge.
- Never commit `.env`, `JWT_PRIVATE_KEY`, `DATABASE_URL`, SMTP credentials,
  or `pg_dump` output. Secrets live in the environment, not the repo.
  `JWT_PUBLIC_KEY` is the exception — it's not a secret, and `.env.test`
  commits a dedicated test-only keypair for exactly that reason.
- Commit messages: short, imperative, present tense (`add invite expiry check`,
  `fix login timing leak`), following the style of prior commits in the repo.
- **Do not add a `Co-Authored-By` trailer or any AI-attribution line to commit
  messages.**
- **Never push.** Commits stay local until the user explicitly asks for a
  push — the general git safety protocol around pushing still applies.
- Still ask before any destructive or history-rewriting git operation
  (`reset --hard`, `rebase`, `commit --amend`, force-push).

## Testing

- `rotation.ts` is the highest-value test target — cover weekly alternation,
  biweekly alternation, the opposite-person constraint, and year boundaries
- `addIngredientsToList()` — cover merge into an unchecked row, no-merge into
  a checked row, unit mismatch, and the new-list-then-redirect path
- Services get unit tests against a test database (or a mocked
  `PrismaService` for pure logic — prefer a real test DB for anything
  touching a transaction)
- Every DTO gets an invalid-input e2e test, not just the happy path
- e2e (Supertest) covers: login, invite -> register -> activate, check off a
  shopping item, add a recipe to an existing list, create a list from a
  recipe, complete a chore, toggle a reminder

## Conventions

- `type` over `interface` in application code; Prisma generates its own types
- No `any`. No non-null assertions (`!`) — narrow properly
- Dates: store UTC, return ISO 8601; the frontend renders in the household's
  local timezone
- Quantities: `Decimal`/`numeric` in Postgres, strings over the wire. Never
  floats
- No display copy of any kind in this codebase (see API surface) — errors
  are machine-readable codes, not messages

## Deployment

Runs as its own container on the same VPS as `my-home`, reverse-proxied by
the same Caddy instance.

- Docker, one service in the shared `compose.yml` alongside `my-home` and
  Postgres
- **Path-routed behind one domain**: Caddy sends `/api/*` to this container,
  everything else to `my-home`. One TLS cert, one origin — chosen over a
  separate `api.` subdomain since there's no cookie same-site constraint
  driving a split (auth is JWT bearer, not a cookie this API sets) and one
  domain is operationally simpler
- Binds `127.0.0.1:<port>` (or an internal Docker network address) only —
  Caddy is the only thing that talks to it directly. Never `0.0.0.0`
  reachable from outside the Docker network
- Postgres stays on the Docker network only — no `ports:` mapping in the
  prod compose file, not even to `127.0.0.1`. A `127.0.0.1:5432` mapping is
  fine in a local-dev-only compose override so `prisma migrate dev` can
  reach it from the host, but must not exist in whatever ships to the VPS
- Back up with scheduled `pg_dump`, copied off the VPS — a volume snapshot is
  not a backup, and neither is a backup that lives on the box it's meant to
  protect against

**Flagged, not yet a problem**: the dashboard's home-climate widget is
currently hardcoded placeholder data in the frontend (no real weather API or
indoor sensor wired up). If that becomes real, an *indoor* sensor reading
implies this API needs to reach a device on the household's home LAN — and a
VPS can't reach a private home IP directly. That would need a tunnel (e.g.
Tailscale/WireGuard) between the VPS and the home network. Don't build that
now; it's not needed until the widget stops being a placeholder.

## Not in scope yet

Do not build these unless explicitly asked:

- Refresh tokens / token revocation / logout-everywhere
- OAuth, password reset
- Household edit, remove-user, or invite revocation endpoints
- Redesigning chore rotation or reminder assignees for more than two people
  — invites can technically create a third+ user today, but nothing
  downstream handles it (see Chore rotation)
- Recipe creation/editing endpoints — recipes are seeded, not authored via
  the API
- Servings scaling of ingredient quantities
- Store tags on shopping items
- Push or in-app notifications (transactional invite/activation email is the
  only mail this API sends)
- Multi-tenancy or third-party household sign-up
- Row-Level Security
- GraphQL, microservices, a message queue, or Redis
- Real weather/indoor-sensor integration (see Deployment)

## When unsure

Ask before adding a dependency, changing the Prisma schema, or introducing a
new architectural pattern. Prefer the boring solution that fits the stack
already here.

**Migration history note**: `home_manager`'s tables were originally created
by Drizzle, from the old frontend backend, not by Prisma. That's still
physically true and always will be — it's history, not a live risk. The
`20260812193239_init` migration was baselined onto that existing schema with
`prisma migrate resolve --applied`, not run for real (its `CREATE TABLE`
statements would have failed outright against tables that already existed;
check `git log -- prisma/migrations` if that's ever in doubt). `prisma
migrate status` confirms the migration history and the live schema agree
("Database schema is up to date"), and `schema.prisma` has had no changes
since that baseline. `prisma migrate dev` is safe to use normally for future
schema changes — re-run `prisma migrate status` first if you have any doubt
before trusting that. `my-home`'s `app/db/` (Drizzle) still exists, but only
for local dev seeding (see its `CLAUDE.md`'s Database section) — it doesn't
touch schema or migrations, so it has no bearing on any of the above.
