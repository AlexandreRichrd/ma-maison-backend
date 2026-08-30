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
    auth.controller.ts     # POST /auth/login, /auth/register, /auth/activate,
                            #   /auth/forgot-password, /auth/reset-password
    auth.service.ts
    jwt.strategy.ts         # Passport JWT strategy
    jwt-auth.guard.ts       # applied via a global APP_GUARD, not per-route
    invites.controller.ts   # POST /invites (create), scoped to signed-in user
  households/
    households.controller.ts  # GET /households/me — users + member_order; PATCH
                               #   /households/me/members/:userId/notification-preferences;
                               #   PATCH /households/me/member-order — see Household member order
  shopping/
    shopping.controller.ts    # lists + items
    shopping.service.ts
  recipes/
    recipes.controller.ts
    recipes.service.ts
    ingredients.ts              # name normalisation — pure, unit-tested
  cleaning/
    cleaning.controller.ts      # GET /cleaning/week?week=2026-W32, GET /cleaning/day?date=2026-08-20
    rotation.service.ts           # pure chore-rotation function, heavily tested
    chores.controller.ts          # admin CRUD: add/edit/remove chores + subtasks
    household-members.service.ts  # shared "ordered household members" query
  reminders/
    reminders.controller.ts
  climate/
    climate.controller.ts   # POST /climate/measures — device-token ingestion, see Climate
    climate.service.ts
    climate-summary.service.ts  # nightly daily_summaries job + GET /climate/summaries, see Climate
    paris-time.util.ts          # Europe/Paris day-boundary math (luxon) — see Climate
    backfill-daily-summary.ts   # npm run climate:backfill-summary -- <date> ..., see Climate
    device-auth.guard.ts    # static bearer token, not user JWT — see Climate
    climate-alert-trigger.ts         # pure cool-down/close-up trigger fn — see Climate alerts
    climate-alert-trigger.service.ts # wires the trigger fn to ingest events + Prisma
    climate-alert-mail.listener.ts   # emails users with receiveClimateAlerts set, on a fired alert
  settings/
    settings.controller.ts  # GET/PATCH /settings — household_settings, see Climate alerts
    settings.service.ts       # getEffective()/update(), fresh-read (no cache), see Climate alerts
  alexa/
    alexa.controller.ts       # POST /alexa — inbound skill endpoint, see Alexa
    alexa.service.ts            # LaunchRequest/IntentRequest routing, French responses
    alexa-signature.guard.ts    # Amazon request-signature verification, not user JWT — see Alexa
    alexa-verifier.util.ts      # dynamic-import wrapper around the alexa-verifier package
    current-conditions.ts       # pure French speech builder from ClimateService readings
    alexa-response.util.ts      # pure Alexa response-envelope builder
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

Each chore carries its **own** schedule and assignment — there is no fixed
set of rotation groups. Implement the schedule/assignment logic once, as a
pure function in `src/cleaning/rotation.service.ts`, tested in isolation.
Never scatter this logic across controllers or services.

A chore's config (`chores` table — see Database) is:

- `frequencyUnit` (`DAY` | `WEEK`) and `frequencyValue` (positive int) —
  together, "occurs every N days" or "occurs every N weeks" (1 = daily/
  weekly, N = every N days/weeks). Both fields are **always** populated —
  never modeled as two mutually exclusive nullable columns. A chore that
  doesn't occur on a given day isn't returned by `GET /cleaning/day` or
  `GET /cleaning/week`, isn't assigned to anyone, and toggling its
  completion that day is rejected (`chore_not_scheduled`, 409). This is a
  deliberate property, not a gap — "biweekly" means *absent* every other
  week, not "present every week with the assignee swapping."
- `anchorDate` — the calendar date this chore first occurred. Every later
  occurrence is derived from this: with `periodDays = frequencyUnit ===
  'WEEK' ? frequencyValue * 7 : frequencyValue`, a date is an occurrence
  iff it's on-or-after the anchor and `(date - anchorDate)` in days is a
  multiple of `periodDays`. Nothing else is stored about the schedule —
  changing `frequencyUnit`/`frequencyValue`/`anchorDate` immediately
  redefines every past and future occurrence. For `frequencyUnit=WEEK`,
  `anchorDate` **must** be a Monday — `ChoresService` rejects a non-Monday
  anchor with `anchor_date_not_monday` (checked against the *effective*
  post-update value, since either field can be omitted on a `PATCH`),
  otherwise the chore would drift out of alignment with the weekly block.
  No such constraint for `frequencyUnit=DAY` — any calendar date is a
  valid daily anchor.
- `assignmentMode` — `ROTATING` or `PINNED`.
- `anchorUserId` — dual meaning depending on `assignmentMode`: for
  `PINNED`, the permanent assignee, full stop; for `ROTATING`, who was
  assigned on the chore's anchor date (its 0th occurrence) — assignment
  alternates from there, one flip per *occurrence*, not per calendar unit
  (so a biweekly rotating chore alternates every other week, in step with
  its own occurrences, not every week). Two rotating chores are entirely
  independent — there is no cross-chore "opposite person" constraint the
  way the old A/B/C/D groups had; a pinned chore never affects any other
  chore's rotation either.

Rules:

- Signatures, both on `RotationService`:
  - `getChoreAssignment(date: Date, chore: ChoreConfig, users: [RotationUser, RotationUser]): { userId: string } | null`
    — `null` means the chore does not occur on that date
  - `getOccurrences(from: Date, to: Date, chores: ChoreConfig[], users: [RotationUser, RotationUser]): { choreId: string; userId: string; occurrenceDate: Date }[]`
    — a pure filter/map over the above across an inclusive date range,
    only the chores that occur on some day within it. The weekly block
    and the day navigator (see UI, in `my-home/CLAUDE.md`) are both just
    callers with a different `from`/`to` — a single-day range for the day
    view, a Monday-to-Monday range for the weekly block (a WEEK-unit
    chore's occurrence, when it occurs at all, always lands exactly on
    that Monday)
  - `frequencyUnit` is branched on in exactly one place —
    `periodDaysFor()` — never anywhere else in this file; every day-vs-
    week difference collapses to a single days-based formula past that
    point
  - the `[RotationUser, RotationUser]` tuple is load-bearing: this is only
    defined for two people. If the household ever has a third+ member
    (possible now via invites, see Authentication), calling this needs a
    redesign first; don't paper over it with `users[0]`/`users[1]` slicing
  - both throw a plain `Error` (not an `ApiError`) if `anchorUserId`
    matches neither user, or `frequencyValue` isn't a positive integer —
    these are invariants `ChoresService` must enforce on create/update,
    not input either function should have to defend against at call time
- **Pure and deterministic** — same date + chore config in, same result
  out, no database access. A Prisma `Chore` row satisfies `ChoreConfig`
  structurally, so callers pass rows straight through with no mapping step
- Assignments are never written to the database. Only *completions* are stored
- User order is stable, from `households.member_order` (an array of user
  ids), via the shared `HouseholdMembersService`. Rotation does not scramble
  if a row's `created_at` changes
- **Every date this app treats as a calendar date is UTC midnight,
  always** — via a hand-rolled `Date.UTC(...)`-based day arithmetic in
  `rotation.service.ts` and `src/cleaning/iso-date.util.ts`'s
  `parseIsoDate`/`isoDayOfWeekUtc`/`formatIsoDateUtc`, never date-fns's
  `parseISO` (parses a bare `'YYYY-MM-DD'` as *local* midnight, not UTC —
  a real bug caught while building this: it silently shifted `anchorDate`
  by a day on any host not running in UTC) or its local-time helpers
  (`getISODay`, `eachDayOfInterval`, `differenceInCalendarDays`). The `pg`
  driver adapter (`@prisma/adapter-pg`) reads/writes `@db.Date` columns
  using UTC components, so this isn't a style preference — mixing local-
  and UTC-based date handling anywhere in this module reintroduces the
  same class of bug. `iso-week.util.ts`'s `parseIsoWeek` (ISO week ->
  Monday) is likewise a hand-rolled UTC calculation, not date-fns's
  `setISOWeek`/`startOfISOWeek`, for the same reason.

Test past, current, and future occurrences plus the year boundary — ISO
weeks do not align with calendar years.

`GET /cleaning/week?week=2026-W32` returns `WEEK`-unit chores only,
grouped by user and merged with that week's stored completions —
`DAY`-unit chores never appear here. `GET /cleaning/day?date=2026-08-20`
is the mirror image: `DAY`-unit chores only, for that single date,
`WEEK`-unit chores never appear. Neither endpoint computes rotation
client-side; the frontend never re-derives it either. Both users are
always present in the response, even with an empty `chores` array for one
of them (e.g. every chore that period landed on the other person, nothing
occurs at all, or the requested date/week precedes every chore's
`anchorDate`). Each returned chore carries its own `occurrenceDate`
(`'YYYY-MM-DD'`) so the frontend never has to compute or assume it — for
a `WEEK`-unit chore this is always the Monday of the requested week.

`GET/POST /cleaning/chores` and `PATCH/DELETE /cleaning/chores/:choreId`
(alongside the existing toggle route) are the admin CRUD for chore configs
— see `ChoresService`. `anchorUserId` is validated against the caller's
household there (a DB lookup, so it can't live in the DTO), reusing the
`invalid_id` code `RemindersService` already uses for the same "referenced
user id doesn't check out" shape. Every chore in these responses also
carries its `subtasks`, ordered by `position` (see Subtasks below).

### Subtasks

A chore can optionally carry subtasks (`chore_subtasks` table — see
Database), each just a `label` and a `position`. Subtasks inherit
everything from their parent chore — no frequency, no assignee of their
own. Admin CRUD (`ChoreSubtasksService`, routes nested under
`/cleaning/chores/:choreId/subtasks`) supports add/edit/delete/reorder;
`reorder` takes the full ordered id list (position is derived from array
index) and rejects a set that doesn't exactly match the chore's current
subtasks. Its route is declared **before** the parameterized
`:choreId/subtasks/:subtaskId` route in `ChoresController` — Nest/Express
match routes in declaration order, so `reorder` would otherwise be
swallowed as a literal `subtaskId` (covered by an e2e regression test).

Completion rules, all enforced in `CleaningService`, never left to the
frontend to derive:

- **A chore is complete iff every one of its subtasks is complete.** For
  a chore with zero subtasks this is unchanged from before (a single
  completion row, `subtaskId` null). For a chore *with* subtasks, "the
  whole chore is done" is never itself a stored completion row — it's
  always computed from whether every current subtask has one.
- **Ticking the parent ticks every subtask** — `toggleCompletion` on a
  chore with subtasks creates a completion for every not-yet-completed
  subtask in one transaction (mirroring `addIngredientsToList`'s
  single-transaction requirement). Toggling it again (now fully done)
  removes every subtask's completion together.
- **Unticking any subtask unticks the parent** — this needs no extra
  code, since "done" is always derived from the current subtask set, not
  a separately stored parent flag.
- Both the parent-level and per-subtask toggle (`PATCH
  /cleaning/chores/:choreId/subtasks/:subtaskId/toggle`) skip the
  `chore_not_scheduled` schedule check when only *removing* completions —
  same stale-completion allowance as the no-subtask case below — and only
  enforce it when a toggle would *create* one.
- **Accepted tradeoff**: adding a subtask to a chore that already has
  completion history retroactively un-completes every past occurrence
  that isn't complete under the *new* subtask set (the new subtask has no
  historical completion rows); deleting a subtask can conversely complete
  previously-incomplete occurrences. This is the direct, deliberate
  consequence of deriving "done" from the *current* subtask set rather
  than snapshotting it per occurrence — same category of tradeoff as
  editing a chore's schedule below, and not scoped by subtask creation
  date for the same reason: that would mean tracking, per occurrence,
  which subtasks existed *at the time*, turning subtasks into their own
  versioned schedule.

### Editing a chore's schedule after completions already exist

Editing `frequencyUnit`/`frequencyValue`/`anchorDate`/`assignmentMode` on
an existing chore redefines what "on"/"off" and "who" mean for *every*
occurrence, including past ones — there's no history-preserving migration
of old `chore_completions` rows when this happens, and none is attempted:

- A completion for an occurrence that no longer satisfies the new
  schedule isn't deleted. It just becomes permanently unreachable through
  the API: `getOccurrences` stops emitting that chore for that date, so
  neither `GET /cleaning/week` nor `GET /cleaning/day` ever surfaces it,
  and `toggleCompletion`/the subtask toggle still let it be *removed*
  (the stale-completion allowance above) but 409 (`chore_not_scheduled`)
  on any attempt to *create* a new one there. The row sits there, inert
  but harmless, and still cascades if the chore itself is deleted.
- The *displayed* assignee can diverge from who actually completed it —
  this predates chores being editable, it's just newly reachable now.
  The grouping in `CleaningService` only ever checks *whether* a
  completion exists for `(choreId, subtaskId, occurrenceDate)`; it never
  reads the completion's stored `userId` back for placement. The
  checkbox renders under whoever the *current* config assigns that
  occurrence, so a previously-completed chore can visibly "jump columns"
  to the other person after an `assignmentMode`/`anchorUserId` edit.
  Documented behavior, not a bug to fix here.

## Households

`households.member_order` decides display order everywhere ordering
matters (Chore rotation's `[RotationUser, RotationUser]` tuple, the
Cleaning/Dashboard two-column layout) — set once by `bootstrap-household.ts`
and appended to on `POST /auth/register` (see Invite / register / activate),
with no way to change it after that until issue #12's
`PATCH /households/me/member-order`.

- Body is `{ memberOrder: string[] }`. `UpdateMemberOrderDto` only checks
  shape (a non-empty array of UUIDs) — the actual constraint, that it's
  exactly a **permutation of the household's current members**, needs a DB
  round trip and lives in `HouseholdsService.updateMemberOrder()`: same
  length, no duplicates, every id a real current member, every current
  member present. Anything partial or malformed (missing a member, an id
  from another household, a duplicate) is rejected with `ApiError(400,
  'memberOrder', 'invalid_member_order')`, never silently accepted or
  partially applied.
- No separate authorization check beyond household membership — any
  signed-in household member can reorder for the household, same "no
  per-user authorization boundary" reasoning as
  `updateNotificationPreferences` (see Climate alerts).

## Reminders

`GET /reminders` (`RemindersController.list()`) takes an optional `from`/
`to` (both-or-neither — a lone one 400s with `range_incomplete`), each a
plain `'YYYY-MM-DD'` validated with `IsIsoDate` and parsed with `cleaning`'s
`parseIsoDate` (see Chore rotation's UTC-date note), reusing the same
pattern as `GET /climate/summaries?from=&to=` and `GET /cleaning/week?week=`
rather than inventing a third shape for "give me a date range". Omitted,
it returns every reminder ever created, ordered by `dueAt` — that's what
the frontend's flat list view still uses. Passed, it filters to reminders
due within `[from, to]` inclusive by calendar day (`dueAt >= from` and
`< to + 1 day`) — what the frontend's week/month calendar views use, since
there's no delete-on-complete (`doneAt` is nullable, see Database): the
unfiltered list only grows over the household's lifetime, never shrinks,
so fetching all of it to render a 7- or ~42-day grid gets more wasteful
over time, not less.

## Climate

`POST /climate/measures` ingests sensor readings forwarded by the
household's Pi bridge — a separate repo (`pi/`, sibling to this one and
`my-home`) that subscribes to the `capteurs/#` MQTT topics `capteurs/`
(also a sibling repo, ESPHome firmware) publishes to, keeps its own local
SQLite history, and forwards batches here over HTTPS. This is the "upcoming
IoT ingestion" `ClimateModule` was scaffolded for.

- **Not user JWT auth.** The caller is a device on the household's home
  LAN, not a signed-in person — the route is `@Public()` (opting out of the
  global `JwtAuthGuard`) and instead guarded by `DeviceAuthGuard`, which
  compares the `Authorization: Bearer <token>` header against
  `CLIMATE_INGEST_TOKEN` (constant-time comparison) with no per-user
  identity behind it
- Body is `{ measures: [{ deviceName, type, value, recordedAt }] }`, capped
  at 500 per request. `type` is an unvalidated string, not a fixed enum —
  same reasoning as the `Measure` model (see Database): a new sensor kind
  is a new string, not a migration or a DTO change
- **Resolves the tunnel concern below**: this is the Pi *pushing* out to
  the VPS over HTTPS, not the VPS reaching into the home LAN — no
  Tailscale/WireGuard needed for ingestion itself
- `GET /climate/current` is the read side, for the dashboard widget —
  behind the global `JwtAuthGuard` like any other read endpoint (not
  `@Public()`, unlike ingestion). Returns the latest reading per
  `(deviceName, type)`, via Postgres `DISTINCT ON` (Prisma's `distinct` +
  a matching `orderBy`), filtered to a hardcoded known-types list
  (`temperature`, `humidite`, `batterie` — matching `capteur-salon.yaml`'s
  and `capteur-exterieur.yaml`'s sensor `state_topic`s). Filtering matters
  because the Pi's `capteurs/#` subscription also picks up non-climate
  topics (`rssi`, `uptime`, `statut`, and an ESPHome debug/log message that
  leaks through) that land in the same `measures` table — see
  `ClimateService.getCurrent()`'s comment. `my-home`'s dashboard widget is
  wired to this now (see its `CLAUDE.md`'s Dashboard section) — indoor
  temperature/humidity and outdoor temperature are all real readings,
  distinguished by `deviceName` (`capteur-salon` vs `capteur-exterieur`),
  not separate endpoints

### Daily summaries and retention

`measures` grows unbounded otherwise (two sensors reporting every 1-2
minutes is ~2900 rows/day) — `ClimateSummaryService`
(`src/climate/climate-summary.service.ts`) keeps long-range history cheap
by aggregating into `daily_summaries` (one row per device+type+day, kept
indefinitely — see Database) and then purging raw rows past a retention
window.

- **Timezone**: a "day" means a **Europe/Paris calendar day**, not a UTC
  one — `measures.recorded_at` is UTC, and computing day boundaries on UTC
  midnight would shift min/max by up to two hours in summer (CEST,
  UTC+2) vs winter (CET, UTC+1). `src/climate/paris-time.util.ts` handles
  this with `luxon` (already a transitive dependency via
  `@nestjs/schedule` -> `cron` -> `luxon`, added here as a direct one):
  `parisDayBoundsUtc()` gives the `[start, end)` UTC instants for a Paris
  calendar date, `yesterdayParisDate()` gives the date the nightly job
  should summarize, and `purgeCutoffUtc()` subtracts whole Paris calendar
  days (not a flat `N * 24h` in milliseconds, which would land an hour off
  across a DST transition).
- **Nightly job**: `ClimateSummaryService.runNightlySummaryAndPurge()`,
  `@Cron('10 0 * * *', { timeZone: 'Europe/Paris' })` — 00:10 Paris time,
  10 minutes past midnight as a buffer for any still-in-flight reading.
  Always **summarize the day that just ended before purging** — the two
  are separate calls in sequence, and the purge is only reached if the
  summarize call didn't throw (aggregating after purging would lose data
  permanently). `ScheduleModule.forRoot()` is registered in `AppModule`
  for `@Cron` to be picked up.
- **Idempotent**: `summarizeDay(isoDate)` upserts into `daily_summaries`
  keyed on `(deviceName, type, date)` (the table's `@@unique`) — re-running
  for a date that already has a row overwrites it instead of duplicating,
  so a restart or a missed night is harmless to re-run.
- **No data, no row**: a device+type with zero readings that Paris day
  gets no `daily_summaries` row (not a row of nulls) — this falls out of
  the aggregation query's `GROUP BY device_name, type`, which only emits
  groups that have at least one matching `measures` row; there's no
  separate "was there any data" branch.
- **Retention**: `purgeOlderThan(retentionDays)` deletes `measures` rows
  older than `retentionDays` Paris calendar days back from today.
  `household_settings.climate_summary_retention_days` (default `7`)
  controls the window — read via `SettingsService.getEffective()` once per
  nightly run (issue #11 moved this off `CLIMATE_SUMMARY_RETENTION_DAYS`;
  see Climate alerts). Independent of which day `summarizeDay()` just
  processed, so a missed night doesn't shrink the window.
- **Backfill**: `src/climate/backfill-daily-summary.ts` (run via `npm run
  climate:backfill-summary -- <date> [<date> ...]`, or directly as `node
  dist/climate/backfill-daily-summary.js <date> ...`) calls
  `summarizeDay()` for one or more explicit past dates and never purges —
  needed once, for any date range with raw history older than the
  retention window that hasn't been summarized yet, so it isn't lost the
  first time the nightly purge runs. `ClimateBackfillModule` mirrors
  `BootstrapModule`'s pattern of importing only what the script needs
  (`PrismaModule`), not the full `ClimateModule` (which would pull in the
  websocket gateway).
- `GET /climate/summaries?deviceName=capteur-salon&from=2026-08-01&to=2026-08-22`
  is the read side, for `my-home`'s per-sensor history view — behind the
  global `JwtAuthGuard` like `/climate/current`. `from`/`to` reuse
  `cleaning`'s `IsIsoDate` validator and `parseIsoDate()` (see Chore
  rotation's UTC-date note) rather than a second copy of the same date
  handling.

### Climate alerts

`ClimateAlertTriggerService` (issue #9) notifies by email when it's worth
opening or closing windows — driven by `ClimateService.ingest()`'s existing
`climate.measures.ingested` event, not a second polling read path.

- **Trigger logic lives in `climate-alert-trigger.ts`**, a pure function
  (`evaluateClimateAlert`) taking the current state, a reading, and config,
  and returning the next state plus which direction (if any) fired — no
  Prisma/event-emitter access, tested in isolation the same way
  `broadcast-selection.ts` is.
- **Two independent hysteresis (Schmitt-trigger) gates**, both required for
  the cool-down direction: `thermalZone` (`cool`/`neutral`/`warm`) on
  `indoor - outdoor`, entering/leaving each side `hysteresisC` apart from
  `±marginC`; `comfortZone` (`comfortable`/`uncomfortable`) on indoor
  temperature alone around `indoorThresholdC`. `cool_down` fires only when
  both `thermalZone === 'cool'` and `comfortZone === 'uncomfortable'`;
  `close_up` fires on `thermalZone === 'warm'` alone — closing up doesn't
  need the comfort gate, since outside being warmer than inside is worth
  acting on regardless of how hot indoor currently is.
- **One notification per crossing**: a direction fires the moment it
  becomes active (a fresh crossing), then suppresses further fires while
  continuously active until either the cooldown period
  (`household_settings.climate_alert_cooldown_minutes`) elapses (a repeat
  reminder, in case the first email was missed) or the direction goes
  inactive and re-activates later (a new crossing, which always fires
  immediately regardless of the cooldown clock).
- **Outdoor readings are smoothed** over the last 5 samples (roughly 5
  minutes at the Pi's ~1/minute cadence) before evaluation — the outdoor
  sensor isn't in a Stevenson screen yet, so a direct-sun reading can spike
  several degrees within minutes and would otherwise cause a false
  `close_up` or mask a real `cool_down` window. Revisit once the screen is
  installed. Indoor readings aren't smoothed — that sensor isn't exposed to
  direct sun.
- **Config is a settings-table row for everything but hysteresis** (issue
  #11): margin, indoor threshold, cooldown, and an enabled/disabled switch
  live in `household_settings`, read via `SettingsService.getEffective()` —
  called fresh on every ingested measurement (`ClimateAlertTriggerService`
  never caches this at startup), so a saved change takes effect on the next
  measurement, no redeploy or restart needed. `climateAlertEnabled: false`
  skips evaluation entirely (no state mutation, so re-enabling later resumes
  from wherever the crossing state was left). `CLIMATE_ALERT_HYSTERESIS_C`
  alone stays an env var — a flap-prevention tuning knob, not something a
  household member would reasonably want to change from the UI. See
  `.env.example` for its default, and `SettingsService`'s `DEFAULT_SETTINGS`
  for the others' (identical to what these were as env vars, so a fresh
  install or a household that's never opened the settings page behaves
  unchanged).
- **Sensor display names** (issue #12) also live on `household_settings`
  (`indoorSensorLabel`/`outdoorSensorLabel`, both nullable — `null` means
  the frontend's own hardcoded default, not this API's concern) despite
  having nothing to do with the alert trigger itself; they share the table
  because both are small, household-wide, single-row config, and a second
  table for two nullable strings wasn't worth it. `INDOOR_DEVICE`/
  `OUTDOOR_DEVICE` (`'capteur-salon'`/`'capteur-exterieur'`) stay hardcoded
  constants here — this API never renders a label, so it has no reason to
  resolve device name to display name itself, only to store the override.
- **Channel-agnostic by design**: the trigger service emits
  `climate.alert.triggered` (`ClimateAlertEvent`: direction + readings +
  `firedAt`, the timestamp of this specific firing). `ClimateAlertMailListener`
  (email, via `MailService`) and `AlexaProactiveEventListener` (issue #14,
  see the Alexa section) are today's listeners — adding another channel
  later is just another `@OnEvent` listener, no change to the trigger
  service itself. `firedAt` was added for #14's idempotency `referenceId`
  (see below) but is generic, not Alexa-specific — any listener needing a
  stable per-firing identity can use it.
- **In-memory state**, same reasoning as `ClimateGateway`'s
  `lastBroadcastAt` (single process, no scale problem to solve yet):
  resets on restart, so a crossing already in progress before a restart can
  fire again immediately after. Acceptable at this app's scale.
- **Open questions resolved**: which household members get the email is now
  a per-user preference, `users.receive_climate_alerts` (default `true`,
  preserving the original "everyone gets alerts" behaviour), editable via
  `PATCH /households/me/members/:userId/notification-preferences` (issue
  #11) — `ClimateAlertMailListener` filters to `receiveClimateAlerts: true`
  rather than emailing every user unconditionally; there's still no
  snooze/disable-for-today control (the household-wide `climateAlertEnabled`
  switch added by issue #11 covers "off entirely", not "off until
  tomorrow"), and none is planned unless a real need shows up (see Not in
  scope yet); no explicit time-window suppression (e.g. blackout at 3am) —
  the indoor-comfort gate already prevents pointless overnight/winter
  firing in practice, per the issue's own reasoning. Issue #14 raised the
  same question for the Alexa channel specifically and resolved it the same
  way: no separate night-time suppression there either, same gate, same
  reasoning — `AlexaProactiveEventListener` fires under exactly the
  conditions email does, no time-window logic of its own.
- **No audit trail on settings changes** (issue #11's storage-shape
  decision) — `household_settings.updated_at` is the only history kept,
  last-write-wins. Fine for a two-person household; revisit only if a real
  need shows up.

## Alexa

`AlexaModule` covers both halves of the Alexa design from #10: the inbound
skill endpoint (#13, `POST /alexa`) that answers "what's the temperature?"
in French when the household opens the shared Echo's skill, and the
outbound channel (#14, `AlexaProactiveEventListener`) that lights up the
Echo's notification ring when a climate alert fires. Issue #15 (a
settings-page toggle for the Alexa channel) builds on top of this and isn't
done yet.

- **Not user JWT auth, and not `DeviceAuthGuard`'s static bearer token
  either.** Amazon signs every request instead, so `AlexaSignatureGuard`
  verifies `SignatureCertChainUrl`/`Signature-256` against the raw request
  body (cert-chain fetch/validate against Amazon's root CA + RSA-SHA256
  signature + a 150-second timestamp tolerance) via the `alexa-verifier` npm
  package — a small, focused package doing exactly this, chosen over
  hand-rolling X.509 chain validation (meaningfully more security-sensitive
  code to get subtly wrong) or pulling in the full
  `ask-sdk-core`/`ask-sdk-express-adapter` framework (a whole
  request-routing/response-builder layer this endpoint doesn't need). It's
  ESM-only, loaded via a dynamic `import()` in `alexa-verifier.util.ts` —
  kept in its own file so `alexa-signature.guard.spec.ts` can `jest.mock` it
  instead of mocking a dynamic import directly. **Read `Signature-256`
  (SHA-256), never the legacy `Signature` header (SHA-1)** —
  `alexa-verifier` hard-codes RSA-SHA256, so pairing it with the SHA-1
  header produces the exact same generic "invalid signature" it returns for
  an actually corrupted request: every real request fails identically, with
  cert-chain fetch and the timestamp check both still passing, which is
  what made this hard to diagnose the one time it happened for real — the
  guard's diagnostic logging (see `diagnostics()`) exists because of that
  incident. As defense-in-depth beyond Amazon's signature,
  the guard also checks the request's `applicationId` against
  `ALEXA_SKILL_ID`, the same "throw 500 if the required env var is missing"
  pattern as `DeviceAuthGuard`.
- **`rawBody` is enabled globally** (`NestFactory.create(AppModule, { rawBody: true })`
  in `main.ts`) because the signature must be verified against the *exact*
  bytes Amazon sent, not a re-serialization of the parsed JSON. This is a
  global flag, but its only effect is making `request.rawBody` available
  alongside the normal parsed `request.body` — every other route is
  unaffected, since nothing else reads it.
- **French text is a deliberate, scoped exception** to the "no display copy
  in this codebase" rule (see API surface) — Alexa speaks `current-conditions.ts`'s
  output directly, with no frontend intermediary to localize it. Every other
  route in this API still returns machine-readable codes only.
- `AlexaService.handleRequest()` answers `LaunchRequest` and the
  `GetCurrentConditionsIntent` (custom intent, so the skill can be re-asked
  without reopening) with the same live reading `ClimateService.getCurrent()`
  gives the dashboard widget — `current-conditions.ts` is a pure function,
  unit-tested the same way as `climate-alert-trigger.ts`, and never throws:
  a missing reading gets a graceful French fallback sentence instead of a
  500, since Alexa times out around 8 seconds. `INDOOR_DEVICE`/`OUTDOOR_DEVICE`
  live in `src/climate/device-names.ts`, shared with
  `ClimateAlertTriggerService` rather than duplicated. `AMAZON.StopIntent`/
  `CancelIntent`/`HelpIntent`/`FallbackIntent` and `SessionEndedRequest` are
  also handled — the last of these never gets a spoken response, per the
  Alexa spec.
- **`@HttpCode(200)` on the controller, not Nest's default `201`** —
  Amazon's skill service treats anything but `200` as an invalid response,
  even a well-formed body. Found via a real developer-console simulator
  retest, the same way `Signature-256` was: verifying against Amazon's
  actual behavior, not assuming a framework default is fine.
- **`SKILL_PROACTIVE_SUBSCRIPTION_CHANGED` handling is deferred**, per
  issue #13's own open-question leaning — it's only useful for detecting
  that notifications were turned off in the Alexa app, not required for the
  core read-back flow, and isn't built until a real need shows up.
- `skill.json` and the fr-FR interaction model live under
  `my-home-backend/alexa/` (not `src/`, not built or deployed) — a
  version-controlled reference. The endpoint URI in `skill.json` is a
  `<DOMAIN>` placeholder filled in when actually configuring the skill.
  **Correction to #13's "no ASK CLI pipeline" claim**: that holds for the
  *interaction model* (`alexa/models/fr-FR.json`), still pasted manually
  into the developer console — but not for the *manifest*
  (`alexa/skill.json`). The proactive-events permission (see below) cannot
  be granted from the console UI at all; it only exists in the manifest,
  which must be pushed via SMAPI. No Lambda, no separate AWS account is
  needed for this — a custom-HTTPS skill can use ASK CLI purely to manage
  the manifest, never touching Lambda deployment.
  - One-time setup: `npm install -g ask-cli`, then `ask configure`
    (interactive; logs in with the household's Amazon developer account —
    AWS credential linking, which that command also offers, isn't needed
    since this skill has no Lambda function to deploy).
  - **`skill.json`'s endpoint URIs are a `<DOMAIN>` placeholder, and must
    stay that way in git** — the real domain isn't committed here. Don't
    edit the file in place to substitute it (editing it, pushing, then
    having to remember to revert before the next commit is exactly how a
    real domain almost got committed while first pushing this manifest).
    Instead substitute into a throwaway copy and point `--manifest` at
    that:
    ```bash
    sed 's|<DOMAIN>|hearth.aureus-lab.fr|' alexa/skill.json > /tmp/skill-manifest.json
    ask smapi update-skill-manifest \
      -s amzn1.ask.skill.11dd43e1-1632-4292-a360-51375b4c60d5 \
      -g development \
      --manifest "file:/tmp/skill-manifest.json"
    rm /tmp/skill-manifest.json
    ```
    Run this manually, from `my-home-backend/`, not part of any deploy
    script. Not run by this session; treat any validation error it reports
    as authoritative over this doc — as happened with `events.endpoint`
    below.
  - `skill.json`'s `manifest.permissions` declares
    `alexa::devices:all:notifications:write` and `manifest.events.publications`
    declares `AMAZON.MessageAlert.Activated` — required for #14's outbound
    proactive events to be accepted at all; without them, every
    `AlexaProactiveEventListener` POST is rejected regardless of how
    correct the request body is.
  - **`events.endpoint` is required whenever `events` exists at all**, even
    with only `publications` declared and no `subscriptions` — confirmed
    the hard way: the first real push of this manifest failed with
    `MISSING_REQUIRED_PROPERTY` on `$.manifest.events`, naming `endpoint`
    specifically (and nothing else — `regions`/`subscriptions` are still
    genuinely optional, per that same error only ever naming one missing
    property). `events.endpoint` now mirrors `apis.custom.endpoint`
    exactly (same URI, same `sslCertificateType`) — Amazon calls this
    endpoint for skill events the way it calls `apis.custom.endpoint` for
    intents, and #14 has no separate infrastructure for skill events, so
    it's the same `POST /alexa` either way (see Skill events below for how
    that's handled). Still deliberately **no** `events.subscriptions`
    entry: that's what would make `SKILL_PROACTIVE_SUBSCRIPTION_CHANGED`
    actually arrive with real subscription-state content, and #13 already
    decided to defer handling that — declaring `endpoint` alone doesn't
    subscribe to anything by itself, per Amazon's schema (`subscriptions`
    is what opts in to specific event types).
  - While first adding `permissions`/`events`, also found
    `apis.custom.endpoint` was missing `sslCertificateType: "Trusted"` —
    required on every HTTPS (non-Lambda) endpoint declaration in the
    manifest schema, not specific to proactive events. This was presumably
    tolerated so far because the skill was likely configured through the
    console UI directly rather than by pushing this file; now that this
    file is pushed via SMAPI for real, a missing required field could fail
    that push outright, so it's fixed here rather than left as a landmine.

### Skill events (issue #14's manifest fix)

Declaring `events.endpoint` means Amazon now sends skill events — notably
`SKILL_PROACTIVE_SUBSCRIPTION_CHANGED` — to the same `POST /alexa` as every
other request. `AlexaSignatureGuard` accepts these like any other signed
request (`applicationId` lives at the same `context.System.application.applicationId`
path regardless of request type, so no guard change was needed here — this
was checked, not assumed, given how easy it is for an envelope shape to
differ in exactly the field a guard reads). Before this fix,
`AlexaService.handleRequest()`'s dispatch switch had no case for a skill
event's `request.type` (`AlexaSkillEvent.*`) — **not** a fall-through to
the French "not understood" fallback (that only exists inside the
intent-name switch, one level down), but an unhandled case falling out of
the outer switch entirely, silently resolving to `undefined` instead of a
real `ResponseEnvelope`. It happened to typecheck only because the
declared `AlexaRequest` union was narrower than what Amazon can actually
send — with no DTO validation on this route (a deliberate choice, see
above), that narrowness was never actually enforced at runtime.
`handleRequest()` now recognizes a skill-event envelope explicitly (an
`isSkillEventRequest()` type guard checking the `AlexaSkillEvent.` prefix)
and answers with an empty `200`, no speech — the same shape
`SessionEndedRequest` already gets. No subscription state is tracked or
persisted: #14 uses `BROADCAST`/`Multicast` events with no `userId`
targeting, so there's nothing to key a stored subscription against, and
#13's deferral of `SKILL_PROACTIVE_SUBSCRIPTION_CHANGED` handling still
stands — this only makes the request a recognized, correctly-answered
case instead of an unrecognized one.

### Outbound: proactive events (issue #14)

`AlexaProactiveEventListener` is the Alexa channel for
`climate.alert.triggered`, alongside `ClimateAlertMailListener` (see
Climate alerts) — sends a silent `BROADCAST` proactive event so the shared
Echo's ring goes yellow. It never sends the actual reading; that's read
back on-demand by the inbound endpoint above. Failure here (token or POST)
is caught and logged, never rethrown — email must go out regardless of
whether this channel succeeds, same requirement that already shapes
`ClimateAlertMailListener`'s own per-recipient `.catch()`.

- **`AlexaLwaTokenService`** obtains an LWA (Login with Amazon) access
  token via the `client_credentials` grant, scoped to
  `alexa::proactive_events`: `POST https://api.amazon.com/auth/o2/token`
  (a single global endpoint, not region-specific — unlike the user-facing
  authorization-code grant), `application/x-www-form-urlencoded`, body
  `grant_type=client_credentials&client_id=…&client_secret=…&scope=alexa::proactive_events`,
  response `{ access_token, token_type, expires_in, scope }`. Caches the
  token in memory (same in-memory-state reasoning as `ClimateGateway`/
  `ClimateAlertTriggerService`) and refreshes it a minute before actual
  expiry, not on-the-dot. `ALEXA_LWA_CLIENT_ID`/`ALEXA_LWA_CLIENT_SECRET`
  are the skill's OAuth client credentials for this — distinct from
  `ALEXA_SKILL_ID` above, which is the application id checked on *inbound*
  requests; both come from the same developer console but are different
  values (client credentials are on the skill's Permissions tab, after
  enabling "Send Alexa Events" there).
- **The proactive event itself**: `POST
  https://api.eu.amazonalexa.com/v1/proactiveEvents/stages/development`
  (development-stage, deliberately permanent per #10/#14's design note: a
  skill enabled only on the household's own Amazon account never needs
  certification to reach production, so there's no reason to ever move off
  `stages/development`), `Authorization: Bearer <token>`, an
  `AMAZON.MessageAlert.Activated` event (`state: { status: 'UNREAD',
  freshness: 'NEW' }`, `messageGroup: { creator: { name: 'eurse' }, count:
  1 }` — `NOTIFICATION_CREATOR_NAME` spelled for French pronunciation
  rather than the skill's actual name, since it's read aloud by whatever
  fr-FR rendering Amazon has for this event, if any), `relevantAudience: {
  type: 'Multicast', payload: {} }` (this is
  the actual field name for what the issue calls `BROADCAST` — reaches
  every device with notifications enabled for the skill, no per-user
  targeting), and a required top-level `localizedAttributes: [{ locale:
  'fr-FR' }]` even though this event type has no locale-specific strings of
  its own.
- **`referenceId`** is derived from `event.direction` + `event.firedAt`
  (`ClimateAlertEvent`'s new field, see Channel-agnostic by design above),
  not from wall-clock time observed by the listener — stable across a retry
  of the *same* emitted event, so Amazon treats a retried send as an update
  to the same proactive event instance rather than a duplicate (per
  Amazon's reference: reusing a `referenceId` with a new `timestamp`
  replaces the earlier instance; it's per-skill-and-customer, not globally
  unique). **Must be alphanumeric characters and `~` only** — a real bug
  caught by re-reading the reference doc rather than trusting the original
  implementation: the first version joined `direction` and an ISO
  timestamp with hyphens (`climate-alert-cool_down-2026-…`), which put `-`,
  `:`, and `.` into the field. Every unit test still passed, since they
  mock the HTTP call and never checked the character set — this would have
  been a 400 on every single real send. `buildReferenceId()` in
  `alexa-proactive-event.listener.ts` now strips to `[A-Za-z0-9~]` after
  concatenating, which keeps the same stability/uniqueness properties
  without depending on a separator surviving.
- **`expiryTime`** is 10 minutes after `firedAt`. Amazon's Proactive Events
  API reference caps this to **5 minutes–24 hours** from `timestamp` (a 400
  outside that range) — 10 minutes is comfortably inside that floor, long
  enough to notice the yellow ring, short enough that a stale "open the
  windows now" alert doesn't sit in the queue overnight, per the issue's
  own framing.
- **A 202 response is not evidence of delivery — confirmed against
  Amazon's own reference, not assumed.** The Proactive Events API
  reference states 202 means "Alexa created the event successfully" —
  accepted for further, asynchronous processing, nothing more. There is no
  webhook, no polling endpoint, no signal of any kind back to this API
  once Amazon returns 202: the event can still be silently discarded
  downstream (bad locale, no eligible device, whatever) with zero
  indication to the sender. A real send attempt (via the trigger script
  below) got 202 for both `cool_down` and `close_up`, with the manifest
  correctly configured and notifications enabled in the Alexa app, yet
  produced no yellow ring and no entry in the Alexa app's notification
  feed — fully consistent with "accepted, discarded downstream" and not
  distinguishable from it using only the HTTP response. `sendProactiveEvent()`
  logs a permanent diagnostic line for exactly this reason: the accurate
  status note (202 explicitly flagged as non-confirmatory, vs. any other
  status logged plainly), the full request body actually sent, the full
  response body, and the response headers — logged whether or not the POST
  ultimately succeeds, since diagnosing a silent non-delivery needs the
  exact bytes Amazon received compared against its reference by hand, not
  a pass/fail boolean. Never logs the access token or client secret.
- **Checked against Amazon's `AMAZON.MessageAlert.Activated` reference
  field-by-field — no discrepancy found in the payload shape itself**:
  `state.status` (required, `UNREAD`/`FLAGGED`) and `messageGroup.creator.name`/
  `messageGroup.count` (both required) are all present and valid;
  `state.freshness` is optional and set anyway (`NEW`); there is no
  documented `urgency` field for this event type, so there's nothing
  missing there. `relevantAudience: { type: 'Multicast', payload: {} }`
  matches Amazon's own documented example for a broadcast audience
  verbatim.
- **Open risk, still not resolved — this is the leading suspect**: whether
  Amazon actually has a French rendering of the `AMAZON.MessageAlert.Activated`
  notification template. Checked directly against the event-type reference,
  not inferred: Amazon explicitly documents `AMAZON.WeatherAlert.Activated`
  as `en-US`-only, with equivalent locale restrictions called out for a
  couple of other event types — and states **no such restriction** for
  `AMAZON.MessageAlert.Activated`. That absence is weak evidence *for*
  broader locale support, not confirmation of `fr-FR` specifically; the
  docs simply don't enumerate which locales this event type is rendered
  in, one way or the other. `localizedAttributes: [{ locale: 'fr-FR' }]`
  is structurally correct regardless (a required top-level field on every
  proactive event request; this event's own payload defines no
  `localizedattribute:`-style placeholder fields to fill in, so `locale`
  alone is the complete, correct shape for this event type specifically —
  not a shortcut). If `fr-FR` has no template for this event type, the
  most likely failure mode is exactly what was observed: the API still
  returns 202 (locale support is a rendering-side concern downstream of
  acceptance, not a request-validation one), while nothing ever reaches
  the device. Nothing in this codebase can distinguish that from other
  silent-discard causes without a live device test on a different locale,
  which hasn't been done and isn't planned — noting the risk plainly
  rather than guessing at it further.
- No new HTTP client dependency for any of this — Node 20's global `fetch`
  is enough, avoiding another dependency-approval round like
  `alexa-verifier`'s.
- **Triggering a send on demand, for testing**: waiting for real climate
  conditions to satisfy the cool-down/close-up trigger makes live testing
  impractical, but this never gets an HTTP route of its own — this API
  already has one public unauthenticated endpoint for Alexa
  (`AlexaController`), and a second trigger surface that exists purely for
  testing convenience isn't worth the risk. Instead:
  `npm run alexa:trigger-proactive-event -- cool_down` (or `close_up`),
  same `NestFactory.createApplicationContext()` + one-off `AlexaTriggerModule`
  pattern as `climate:backfill-summary`/`ClimateBackfillModule` — resolves
  the real `AlexaProactiveEventListener` from a minimal Nest context and
  calls its real `handleClimateAlert()` directly with a synthetic
  `ClimateAlertEvent`, so it exercises the actual LWA token fetch and the
  actual proactive-event POST, not a reimplementation of either. On the
  VPS: `docker compose exec api npm run alexa:trigger-proactive-event -- cool_down`.
  Failures are caught and logged by the listener itself, exactly as a real
  climate-triggered send would be — the script can't tell you whether the
  send succeeded beyond that log line, by design (it's exercising the real
  method, which itself never reports success/failure to its caller).

## Database

Prisma schema at `prisma/schema.prisma`. Connection string in `DATABASE_URL`
(see `prisma.config.ts`). `PrismaService` is the only place a `PrismaClient`
is constructed — inject it, never `new PrismaClient()` elsewhere.

| Table | Notes |
|---|---|
| `households` | single row; holds `member_order` for stable rotation |
| `users` | email, password_hash, household_id, name, avatar_key, email_verified_at nullable, receive_climate_alerts (default true) — see Authentication, Climate alerts |
| `household_settings` | one row per household (in practice, at most one row ever), created lazily on first `PATCH /settings` — climate_alert_enabled/margin_c/indoor_threshold_c/cooldown_minutes, climate_summary_retention_days, indoor/outdoor_sensor_label (nullable, issue #12), updated_at. See Climate alerts |
| `invites` | household_id, invited_by_user_id, email, token, expires_at, accepted_at nullable |
| `email_verifications` | user_id, token, expires_at, consumed_at nullable |
| `password_resets` | user_id, token, expires_at, consumed_at nullable — same shape as `email_verifications`, deliberately a separate table (see Authentication's Forgot / reset password) |
| `shopping_lists` | name |
| `shopping_items` | list_id, name, quantity, unit (`Unit` enum), checked, source_recipe_id nullable |
| `recipes` | name, servings |
| `recipe_ingredients` | recipe_id, name, quantity, unit (`Unit` enum), position |
| `recipe_steps` | recipe_id, text, position — an ordered child table, same shape as `recipe_ingredients`/`chore_subtasks`. Replaces the old free-text `recipes.instructions` column |
| `chores` | name, frequency_unit (`DAY`\|`WEEK`), frequency_value, assignment_mode (`ROTATING`\|`PINNED`), anchor_date, anchor_user_id |
| `chore_subtasks` | chore_id, label, position |
| `chore_completions` | chore_id, user_id, subtask_id nullable, occurrence_date, completed_at |
| `reminders` | title, due_at, done_at nullable, assignee_ids (0-2, no FK — array column) |
| `measures` | device_name, type, value (all text — see Climate), recorded_at, created_at. One row per metric, so a device reporting temperature and humidity together produces two rows. Purged past `CLIMATE_SUMMARY_RETENTION_DAYS` — see Daily summaries and retention |
| `daily_summaries` | device_name, type, date (a Europe/Paris calendar day, `@db.Date`), min/max/avg (`Decimal`), sample_count. One row per device+type+day, kept indefinitely — see Daily summaries and retention |

This is the same schema the old Drizzle setup used — port it into
`schema.prisma` rather than redesigning it. Conventions:

- `id` is a `uuid` with a default (`dbgenerated("gen_random_uuid()")` or
  Prisma's `uuid()` default — pick one and use it everywhere)
- `created_at` / `updated_at` are `@db.Timestamptz`, not plain `timestamp`
- Chore *assignment* is computed by `rotation.service.ts` from each chore's
  own `frequency_unit`/`frequency_value`/`assignment_mode`/`anchor_date`/
  `anchor_user_id` — never stored. Only completions are persisted, keyed by
  `(chore_id, subtask_id, occurrence_date)` — `subtask_id` nullable (null
  for a chore with no subtasks). Since Postgres treats every `NULL` as
  distinct in a normal unique index, the real uniqueness guarantee is two
  hand-written *partial* unique indexes, one per case, not a single
  `@@unique` (which schema.prisma still can't express for the partial
  case) — deliberate schema.prisma/DB drift, see the Migration history
  note below
- `chores.anchor_user_id` is `onDelete: Restrict`, not `Cascade` — a chore
  config is household-level, not the anchor user's own data; it shouldn't
  vanish (or drag its completion history down with it) if a remove-user
  flow is ever added
- Reminder completion is `done_at` nullable, not a boolean — undo sets it to null
- `shopping_items.source_recipe_id` is `onDelete: SetNull`: deleting a recipe
  must never remove items already on a list
- Ingredient count on the recipe overview is an aggregate query
  (`_count`), not a stored counter column
- `Unit` (`recipe_ingredients.unit`, `shopping_items.unit`) is a real DB
  enum, not a validated string like `Measure.type` — units are a small,
  real-world-bounded domain (unlike sensor types, which grow with new
  hardware), worth the DB guarantee and a frontend `<Select>`'s
  exhaustiveness over a string's flexibility. Both columns share the one
  enum on purpose: `ShoppingService.addIngredientsToList` merges on unit
  equality, so a hand-added shopping item and a recipe-sourced one must
  speak the same closed vocabulary to ever merge
- `RecipesService.update` replaces the *entire* `ingredients`/`steps` array
  in one transaction when either is present in the `PATCH` body (delete
  all, recreate with `position` from array index) — there's no per-row
  ingredient/step endpoint the way chores have per-subtask ones. A recipe
  is filled out and submitted as one document; reordering/adding/removing
  rows is client-side state until submit
- Foreign keys always declare `onDelete` explicitly
- Schema changes: edit `schema.prisma`, then see the Migration history
  note below — `prisma migrate dev` cannot be trusted to apply cleanly
  against the real datasource here, so migrations are scaffolded/hand-
  written and applied via `prisma db execute` + `prisma migrate resolve
  --applied` instead. Never hand-edit a migration after it's been applied
  anywhere
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

### Servings scaling (issue #16)

`GET /recipes/:id?servings=N` scales returned ingredient quantities from the
recipe's own `servings` to `N` — display/export only, never touching
`recipes.servings` or the stored `recipe_ingredients` rows. `POST
/shopping-lists/add-ingredients` accepts the same optional `servings` field;
when given, it's what gets merged/inserted (via the existing `increment`
path above), not the recipe's stored quantities — so a recipe viewed scaled
to N servings sends N-servings quantities to the shopping list. Both go
through one shared function, `src/recipes/quantity-scaling.ts`'s
`scaleQuantity()`, using `Prisma.Decimal` throughout (never `parseFloat`/JS
floats, matching Quantities under Conventions) — a single implementation so
the two paths can never drift apart, which is what makes the summed-total
case below correct.

Two design calls, made deliberately rather than left to default:

- **Rounding differs by unit.** *Countable* units (`GOUSSE`, `TRANCHE`,
  `SACHET`, `PAQUET`, `BOITE`, `POT`, `BOUTEILLE`, `TETE`, `DOUZAINE`,
  `MICHE`, `UNITE`) round to the nearest whole number (half-up), floored at
  1 whenever the original quantity was `> 0` — never "0 gousses" for a
  scaled-down recipe. *Continuous* units (`G`, `KG`, `ML`, `L`,
  `CUILLERE_A_CAFE`, `CUILLERE_A_SOUPE`, `PINCEE`) round to 2 decimal
  places. Nearest-rounding rather than always-round-up, since rounding up
  systematically biases every scale-up too generous and every scale-down
  too stingy, compounding across many ingredients.
- **No per-ingredient "don't scale" flag.** Every ingredient scales
  proportionally, salt/pepper included — same as Marmiton. A flag is
  schema + UI surface (a migration, a form field, an extra branch in
  `scaleQuantity`/the merge loop) for a benefit a cook can just as easily
  judge by eye; not worth it here.

Because `addIngredientsToList()` scales *before* the merge/increment step,
two recipes contributing the same ingredient at different serving
multipliers still sum to one correct total on the list — covered by
`shopping.service.spec.ts`.

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
  `/auth/register`, `/auth/activate`, `/auth/forgot-password`,
  `/auth/reset-password`
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
- Still out of scope: OAuth, refresh tokens/token revocation

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

### Bootstrapping the first account

Registration is invite-gated (above), which is a chicken-and-egg problem for
a brand new database: there's no signed-in user to issue the first invite.
`src/bootstrap-household.ts` (run via `npm run bootstrap:household <email>`,
or directly as `node dist/bootstrap-household.js <email>`) breaks that
deadlock:

- Creates the single `households` row, then calls
  `InvitesService.createBootstrap()` — the same invite mechanism `POST
  /invites` uses (same `invites` table, token generation, 7-day TTL, and
  `MailService.sendInviteEmail()`), just with `invitedByUserId: null` since
  no user exists yet to be the inviter. That's why `invites.invited_by_user_id`
  is nullable in the schema — every other invite still sets it
- From there it's the normal flow: `/register?token=…` on the frontend,
  same as any other invite
- Prints the invite link to stdout in addition to sending the email, so a
  lost or spam-filtered email doesn't strand the operator
- Refuses to run if a `households` row already exists (`HouseholdBootstrapService.bootstrap()`)
  — this seeds an empty database once, it isn't a reset path
- Runs via `NestFactory.createApplicationContext(BootstrapModule)`, not the
  full `AppModule` — `BootstrapModule` only imports `PrismaModule` and
  `MailModule` and declares `InvitesService` directly, skipping
  `AuthModule`'s `JwtModule`/`PassportModule`/global guard setup, which the
  script has no need for and which would otherwise require the JWT keypair
  just to construct
- Must run after migrations are applied and before anyone can log in — see
  the top-level repo's Production (VPS) deploy notes for the exact command

### Forgot / reset password

Registration is invite-gated, but recovery isn't: any signed-up user can
request a reset, since there's otherwise no way back into an account whose
password is forgotten short of editing the database by hand.

1. `POST /auth/forgot-password` is `@Public()`, takes an email, and always
   returns `{ ok: true }` — whether or not the email has an account. Only
   when a matching user actually exists does it create a `password_resets`
   row (random 32-byte-hex token, **1-hour** expiry — short on purpose,
   unlike the 7-day invite or 24h verification window, since a reset link
   is used right away or not at all) and send mail via `MailService` with a
   link the frontend renders as `/reset-password?token=…`. Rate-limited via
   `@nestjs/throttler`, per IP and per identifier (email), same policy as
   login
2. `POST /auth/reset-password` is `@Public()`, takes a token and a new
   password, and rejects a missing, expired, or already-consumed token with
   `reset_invalid`. On success it hashes the new password (argon2id),
   consumes the token, and — see below — verifies the account if it wasn't
   already. No throttle guard: the token is unguessable, so a request-volume
   limit here protects against nothing a rate limiter would help with (same
   reasoning as `/auth/activate`)
3. `password_resets` is a separate table from `email_verifications`, not the
   same table with a `type` column, despite the identical
   token/expiry/consumed-at shape — same reasoning that already keeps
   `invites` apart from `email_verifications`. A reset token controls the
   credential itself, not just a verified flag, so a bug in one query can
   never accidentally match the wrong kind of token if they're on different
   tables
4. **Resetting also verifies an unverified account**, if it wasn't already
   (never overwrites a real `email_verified_at` with a later timestamp).
   Deliberate: completing a reset — clicking a link mailed to the inbox,
   then setting a new credential — proves control of that address at least
   as strongly as clicking the original activation link would. There's no
   resend-activation endpoint today, so refusing the reset for an
   unverified account would leave that user with no way back in at all,
   which is the exact lockout this feature exists to prevent

## Commands

```bash
npm run start:dev        # nest start --watch
npm run build
npm run start:prod
npm run lint
npm run typecheck        # tsc --noEmit — see below for why this exists separately
npm run test              # jest, unit
npm run test:e2e          # supertest against a real Nest app instance
npx prisma migrate dev  # see Database's Migration history note before using this for real
npx prisma generate
npm run bootstrap:household -- <email>  # one-off, empty database only — see Bootstrapping the first account
```

Run `npm run typecheck` and `npm run test` (and `test:e2e` when routes
changed) before considering work finished. Neither `nest build` nor a
passing test run can be trusted to catch a type error on their own:
`nest build` compiles from `tsconfig.build.json`, which excludes `test/`
and every `*.spec.ts` entirely, so it never sees fixture/test code; and
`tsconfig.json` sets `isolatedModules: true`, which puts ts-jest in
transpile-only mode — each test file is compiled in isolation with no
cross-file type-checking, so `npm test` passing is not evidence the test
file itself type-checks. `npm run typecheck` (`tsc --noEmit` against the
unrestricted `tsconfig.json`) is the only command that actually checks
`src/` and `test/` together. A four-error mismatch between
`chores.e2e-spec.ts`'s fixtures and Prisma's `AssignmentMode` enum sat
unnoticed through the per-chore-configuration migration for exactly this
reason before this script existed — run it.

## Git workflow

Commit after each todo item is completed — this is standing authorization to
commit without asking each time, scoped to local commits only.

- One commit per completed todo-list item, not per file and not batched across
  a whole feature. If a task wasn't broken into a todo list, commit once the
  discrete piece of work is done.
- Run `npm run typecheck` and `npm run test` (and `npm run test:e2e` when
  routes changed) before committing. Do not commit code that fails any of
  them.
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

- `rotation.service.ts` is the highest-value test target — cover weekly and
  every-N-week occurrence, off-week `null`s, the anchor week itself, pinned
  vs. rotating, two independent rotating chores landing on the same person
  the same week (no cross-chore constraint), and year boundaries
- `addIngredientsToList()` — cover merge into an unchecked row, no-merge into
  a checked row, unit mismatch, and the new-list-then-redirect path
- Services get unit tests against a test database (or a mocked
  `PrismaService` for pure logic — prefer a real test DB for anything
  touching a transaction)
- Every DTO gets an invalid-input e2e test, not just the happy path
- e2e (Supertest) covers: login, invite -> register -> activate, forgot ->
  reset -> login, check off a shopping item, add a recipe to an existing
  list, create a list from a recipe, complete a chore, toggle a reminder,
  add/edit/remove a chore config
- e2e spec files with several tests: seed the household and log in once in
  `beforeAll`, not per-test in `beforeEach` — the login-identifier throttle
  (5 per 15 minutes, see `throttler.config.ts`) trips otherwise. Truncate
  only the tables that need per-test isolation in `beforeEach`

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

**Resolved**: the tunnel concern this section used to flag is moot — see
Climate. Indoor sensor readings reach this API via the household's Pi
bridge *pushing* batches to `POST /climate/measures` over HTTPS, so
nothing here needs to reach into the home LAN the way a pull-based
integration would have. `GET /climate/current` now serves the dashboard's
home-climate widget in `my-home`, both indoor and outdoor readings.

## Not in scope yet

Do not build these unless explicitly asked:

- Refresh tokens / token revocation / logout-everywhere
- OAuth
- Household edit, remove-user, or invite revocation endpoints
- Redesigning chore rotation or reminder assignees for more than two people
  — invites can technically create a third+ user today, but nothing
  downstream handles it (see Chore rotation)
- Store tags on shopping items
- Push or in-app notifications (transactional invite/activation/password-reset
  email is the only mail this API sends)
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
since that baseline.

**`prisma migrate dev` is *not* safe to run normally here, and this has now
been tested for real** (the per-chore-configuration migration, see Chore
rotation): the naming/default differences between what Drizzle originally
created and what a fresh `prisma migrate dev` replay of the migration
history produces (e.g. `_key` vs. `_unique` index suffixes,
`DbGenerated("gen_random_uuid()")` vs. Prisma's own default) make its shadow-
database drift check fire on the *real* datasource — it asks to reset the
actual dev database, not a disposable shadow one, to "fix" drift that isn't
real. Do not answer yes to that prompt. Instead, for any future schema
change: run `prisma migrate dev --create-only` to get a scaffolded
migration folder (or write one by hand), edit `migration.sql` to do exactly
what's needed, apply it directly against each real datasource with
`prisma db execute --file <path> --schema prisma/schema.prisma` (this
skips the shadow-db diff entirely), then run
`prisma migrate resolve --applied <migration_name>` against each datasource
so `prisma migrate status` recognizes it without replaying — the same
two-step pattern the original baseline already used. Both `.env`'s
`DATABASE_URL` (dev) and `.env.test`'s (a *separate* database,
`hearth_backend_test`) need the migration applied and resolved
independently — `prisma migrate resolve` only touches whichever
`DATABASE_URL` is active when it's run.

`my-home`'s `app/db/` (Drizzle) still exists, but only for local dev
seeding (see its `CLAUDE.md`'s Database section) — it doesn't touch schema
or migrations, so it has no bearing on any of the above.
