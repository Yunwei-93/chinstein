# Chinstein Performance Test Protocol

Last updated: 2026-09-18

Status: PERF-P0 frozen and PERF-P1 complete. Both the initial seed and the
mapped-fixture repeat-seed passed full rollback and confirmed-commit execution
against `aws-staging`; the final replacement passed fresh guarded read-only
verification. ECS staging was restored to 1 desired, 1 running, and 0 pending
tasks for acceptance, then intentionally returned to 0 desired, 0 running, and 0
pending tasks after closeout to control pause-period cost. PERF-P2 has not run yet.
The first fourteen PERF-P2 tooling checkpoints have frozen the 1-VU and 5-VU
execution rules, the bounded Pool A reserve, the response-classification
contracts, the secret-free 8,100-user token-fixture contract, the injectable
token-fixture builder, the 32-72-byte login-password boundary, atomic owner-only
temporary-file delivery, and guarded read-only extraction of the approved user
mapping and daily-character fixture. The sixth checkpoint reuses the compiled
application signer, scopes token lifetime to exactly four hours, and performs
cryptographic verification restricted to HS256 before a token can enter the
fixture. Before orchestration, those components passed 80 configuration and
contract tests without database, HTTP, AWS, or Neon access. The source-reader
contract requires the approved staging identity, a read-only repeatable-read
transaction, current-date fixture anchors, and an unused Pool A before baseline
token creation.

The seventh checkpoint coordinates these boundaries without opening a live test
path: it verifies the compiled signer before database access, reads the approved
source inside one read-only repeatable-read transaction, commits and closes that
connection before loading the JWT adapter, and only then builds and atomically
writes `/tmp/tokens.json`. Its allowlisted result excludes tokens, secrets, email,
the daily answer, and the complete fixture. With this checkpoint, all 104 PERF-P2
configuration, contract, source, signer, file-delivery, and orchestration tests
pass offline without database, HTTP, AWS, or Neon access.

The eighth checkpoint connects the out-of-band `PERF_LOGIN_PASSWORD` contract to
both rollback and committed reseeding. The entrypoint validates and hashes the
credential once, before opening a database connection, and passes only a strict
cost-10 bcrypt hash through the write path. The dry-run, committed-seed, and user
insert boundaries reject plaintext or malformed hashes before issuing SQL. The
credential and hash remain excluded from results and errors. All 113 PERF-P2
offline tests now pass without database, HTTP, AWS, or Neon access.

The ninth checkpoint replaces the token generator's local staging-file default
with an ECS-compatible runtime connector. It accepts only an injected
`DATABASE_URL`, verifies the approved pooled staging hostname fingerprint and
database before network access, reconstructs an explicit TLS client configuration
so connection-string parameters cannot override the verified target, and confirms
the live database identity inside a short read-only transaction. Failed
connections are sanitized, rolled back when needed, and closed; the connector has
no `.env.staging` fallback. All 121 PERF-P2 offline tests now pass with fake
clients and no database, HTTP, AWS, or Neon access.

The tenth checkpoint adds the dedicated token-fixture CLI used by the future ECS
load-generator entrypoint. It requires three exact confirmation flags before
calling the generator, permits only `/tmp/tokens.json`, returns a reconstructed
allowlisted success summary, and suppresses raw generator failures and unsafe
error codes. Direct execution without the confirmations exits before database
access. All 129 PERF-P2 offline tests now pass without database, HTTP, AWS, or
Neon access.

The eleventh checkpoint adds the shared k6 token-fixture loader. Its pure contract
parses and revalidates `/tmp/tokens.json` at k6 startup, rejects invalid or
backward load-generator clocks, and requires at least three hours of token
lifetime to remain before a run begins. It builds one indexed record set with
metadata at index zero and each synthetic user's sequence at the matching array
index. The k6 runtime creates that record set through one `SharedArray`, while
lookups also enforce the expected pool boundary. All 136 PERF-P2 offline tests
now pass without database, HTTP, AWS, Neon, or live k6 request execution.

The twelfth checkpoint adds the pure scenario request-planning layer. It maps
timed virtual users deterministically into Pool R or Pool B, reserves the exact
330 distinct Pool A identities for the six bounded S5 rounds, and constructs the
method, path, request body, and response expectations for S0 through S6. These
plans intentionally contain neither bearer tokens nor the login password; the
runtime request layer must inject those values only at the final execution
boundary. All 144 PERF-P2 offline tests now pass without database, HTTP, AWS,
Neon, or live k6 request execution.

The thirteenth checkpoint adds the controlled k6 HTTP execution boundary. It
accepts only an HTTPS origin and a frozen scenario plan, injects a matching bearer
token or the validated login password only while constructing the final request,
disables redirects, applies bounded timeouts and low-cardinality scenario tags,
and marks S6's approved `409` as an expected HTTP response. Response bodies and
raw transport errors are reduced to an allowlisted classification containing no
token, password, answer, email, or raw body. All 154 PERF-P2 offline tests now pass
with an injected fake HTTP client; no live request has been sent.

The fourteenth checkpoint adds the k6 scenario-metrics boundary. It converts
only validated scenario outcomes into low-cardinality tags, records attempted,
expected, and unexpected response counters plus the unexpected-response rate and
response-byte trend, and keeps warm-up and measured observations separated. Only
expected responses enter the latency trend, so transport failures and unexpected
responses remain visible without corrupting the baseline p50 and p95 samples.
Raw failure reasons, user sequences, credentials, and fixture values are excluded
from metric output. All 163 PERF-P2 offline tests now pass with injected metric,
check, and HTTP adapters; no live k6 or HTTP request has been run.

The JWT adapter is authorized only inside the dedicated, short-lived fixture
generation process, after `npm run build` has produced the compiled application
signer. It must not run inside the API service or another concurrent signing
process. Before any measured request, one generated token must pass a protected
staging-endpoint canary; a `401` response invalidates the fixture and fails closed.

Verified PERF-P1 preflight evidence on 2026-09-14:

- the local staging and production environment files resolve to different pooled
  Neon hostname fingerprints;
- the Neon Console identifies the selected active branch as `aws-staging` in AWS
  US East 2 (Ohio); and
- the branch expiration was extended to 2026-09-30 22:24 America/New_York so it
  cannot expire during the planned PERF window.

These checks did not connect to PostgreSQL or modify database contents.

Additional verified PERF-P1 preflight evidence on 2026-09-15 and 2026-09-16:

- the guarded runtime connection resolved to the previously verified staging host
  fingerprint and `neondb`, with a zero-offset database timezone, PostgreSQL 18.6,
  and no recovery replica;
- the approved initial staging snapshot contained 2 users, 2 study sessions, 365
  characters, no active story generation, no synthetic PERF users, and no existing
  PERF mapping tables;
- the current role passed 13 required table privileges, 2 sequence privileges,
  and 2 schema privileges;
- the three core relations were ordinary tables with no row-level security or
  enabled user triggers, and all 23 expected columns matched their type,
  nullability, and default-presence contract;
- the required primary keys, unique constraints, foreign keys, story-status check,
  and `(user_id, studied_on)` uniqueness were validated and enforced; the
  `idx_sessions_user_date` B-tree was valid and ready with the expected
  `(user_id, studied_on DESC)` order;
- a rolled-back 100,000-row sizing probe added no persistent rows and supported the
  estimate that the 1,458,200-row fixture fits within the available staging storage;
- the local one-hash bcrypt path produced a valid 60-character, 10-round hash
  without printing or persisting the password or hash; and
- the existing built `signToken()` path accepted `JWT_EXPIRES_IN=4h`, preserved
  the numeric user ID, used HS256, and produced an exact 14,400-second lifetime
  with only an in-memory dummy secret and no printed or persisted token.

All database checks above used read-only transactions or an explicitly verified
rollback probe. An integrated `--plan` run also correctly stopped inside the frozen
UTC-midnight exclusion window.

Verified PERF-P1 rollback-rehearsal evidence on 2026-09-17:

- a later integrated `--plan` run passed outside the UTC exclusion window with the
  approved 2-user, 2-session, 365-character initial snapshot unchanged;
- the AWS staging ECS service was changed from 1 desired and 1 running task to 0
  desired, 0 running, and 0 pending tasks before the write transaction; the prior
  desired count of 1 was recorded for restoration;
- the guarded read-write transaction repeated the target, clock, privilege, core
  relation, core column, and approved-dataset checks both before and after taking
  the exclusive locks;
- the rehearsal created 8,100 synthetic users, 8,100 user mappings, 365 character
  mappings, 1,458,000 historical sessions, and 200 current-day Pool B sessions;
- all 365 characters received the same 341-byte `perf-synthetic` story with ready
  status, zero attempts, and no active generation start time;
- structural verification found 1,458,200 sessions and zero invalid fixture users,
  unmapped rows, character-mapping mismatches, or invalid synthetic stories;
- all 8,100 users had exactly 180 historical sessions and 180 learned characters;
  7,900 users had no current-day session, 200 Pool B users had exactly one, and the
  deterministic scores produced 94 distinct values and 94 tied groups;
- session-quality verification found zero out-of-range or invalid rows across the
  2026-03-21 through 2026-09-17 fixture date range; and
- the write transaction reported `committed: false`, `rolledBack: true`, and
  `restorationVerified: true`. A separate read-only check found the original and
  restored counts both at 2 users, 2 sessions, and 365 characters, with matching
  unprinted content fingerprints and both PERF mapping tables absent.

The rehearsal also reported `sequenceValuesMayAdvance: true`, as required.

Verified PERF-P1 committed-seed evidence on 2026-09-17:

- immediately before the committed write, the guarded plan still identified the
  approved 2-user, 2-session, 365-character staging snapshot, and the ECS staging
  service remained at 0 desired, 0 running, and 0 pending tasks;
- one atomic replacement transaction repeated the target and dataset gates before
  and under exclusive locks, replaced the approved initial rows, created 8,100
  synthetic users and both complete mapping tables, inserted 1,458,000 historical
  sessions plus 200 current-day Pool B sessions, normalized all 365 stories to the
  canonical synthetic `ready` state, and ran `ANALYZE` on the three application
  tables;
- the transaction reported `committed: true` and `commitOutcome: "confirmed"`;
- in-transaction verification found exactly 1,458,200 sessions, complete 180-day
  history and learned-character sets for all 8,100 users, the expected 7,900/200
  non-conflict/conflict split, 94 score values and tied groups, and zero invalid,
  unmapped, mismatched, or out-of-range rows;
- a new guarded read-only connection repeated the structural, distribution, and
  session-quality checks and reported `postCommitVerified: true`;
- all checks used the database date 2026-09-17 and completed outside the frozen
  UTC-midnight exclusion window; and
- a post-seed read-only measurement reported a 214,171,648-byte database
  (204.25 MiB), including a 202,571,776-byte `study_sessions` relation, within the
  Neon 0.5 GB allowance and the prior capacity estimate.

Verified repeat-seed entry evidence on 2026-09-17:

- the unified source selector accepted the existing mapped fixture only as
  `approved-perf-source`, with both mapping tables present;
- the source contract reported 8,100 users and user mappings, 365 characters and
  character mappings, 1,458,000 historical sessions, 200 fixture-date Pool B
  sessions, and zero fixture-date Pool A sessions;
- shared safety gates select and lock either the approved initial source or the
  approved mapped PERF source without a fallback catch that could hide a database
  error;
- chunked core-data fingerprints avoid constructing one 1.46-million-row JSON
  value, are retained only for internal comparison, and are not printed;
- the committed-seed recovery state machine requires an exact source
  classification before bcrypt work or a database connection, records distinct
  source and target snapshots before `COMMIT`, never retries an ambiguous commit,
  and uses a fresh stable read to classify the visible state;
- local syntax and module-integration checks passed for the source guard, snapshot,
  dry-run, committed-seed, and fresh-state modules; missing and unknown commit
  confirmations were rejected before database access; and
- a real guarded `REPEATABLE READ READ ONLY` observation of `aws-staging` matched
  the approved PERF identity and the 8,100-user, 1,458,200-session, 365-character
  core snapshot without printing its fingerprints or performing a write.
- a subsequent read-only recovery simulation re-observed the same source through
  fresh stable transactions, verified both its approved identity and core snapshot,
  and classified it as `not-committed-source-restored` when compared with an
  in-memory target that deliberately retained the same logical identity but had a
  different fingerprint; the source identity and snapshot matched, while the
  simulated target snapshot did not, and no fingerprint value was printed.
- after the repeat-seed tooling changes, and again after the final formatting and
  closeout documentation pass, the local regression baseline passed all 8 test
  files and 56 tests, followed by the test TypeScript check and production
  TypeScript build; provider behavior remained mocked and no real Anthropic
  request was made; and
- the final repository-scope check found no patch-whitespace errors and no changes
  to application source, existing tests, migrations, or runtime configuration;
  a filenames-only scan of the PERF modules and affected documentation found no
  database credential URL, Anthropic key, AWS access key, JWT-shaped token, or
  private-key block.

Verified repeat-seed execution evidence on 2026-09-17:

- after explicit approval, the Neon organization was moved to the usage-based
  Launch plan to remove the 0.5 GB Free-plan transaction headroom constraint; the
  staging API remained at 0 desired, 0 running, and 0 pending tasks during both
  write exercises;
- the real repeat-seed rollback rehearsal accepted only the existing
  `approved-perf-source`, rebuilt and verified the full 8,100-user,
  1,458,200-session, 365-character target, and reported `committed: false`,
  `rolledBack: true`, and `restorationVerified: true`;
- the rollback check re-observed the approved source with matching original and
  restored counts plus matching unprinted fingerprints; only the documented
  non-transactional sequence advancement remained possible;
- the subsequent atomic committed reseed again required the exact
  `approved-perf-source`, reported `committed: true`,
  `commitOutcome: "confirmed"`, `postCommitVerified: true`, and proved that the
  replacement snapshot differed from its source even though their logical counts
  were intentionally identical;
- a new guarded read-only connection verified the committed target identity and
  snapshot, all expected pool and date distributions, and zero invalid, unmapped,
  mismatched, or out-of-range rows;
- both write exercises began and ended outside the frozen UTC-midnight exclusion
  window, retained the same 2026-09-17 database date, and made zero Anthropic
  calls; and
- after the verified commit, the ECS staging service was restored and reached 1
  desired, 1 running, and 0 pending tasks; after final local regression and branch
  publication, it was intentionally returned to 0 desired, 0 running, and 0
  pending tasks for the pause before PERF-P2.

PERF-P1 is therefore closed. No PERF load test or PERF Anthropic call has occurred
yet; those remain separated into PERF-P2 through PERF-P5 as defined below.

This protocol measures the AWS ECS and Neon staging stack. It does not authorize
any use of the Vercel, Render, or Neon production environment.

PERF uses the existing Neon `aws-staging` branch. It does not create a separate
Neon performance branch or change the ECS API database connection. The temporary
performance mapping tables described below exist only in `aws-staging` and are
never added to the application migration.

## Phase plan and time budget

| Phase | Scope | Estimated time |
| --- | --- | ---: |
| PERF-P0 | Freeze the protocol | 0.5-1 hour |
| PERF-P1 | Verify the staging target and seed reproducible synthetic data | 1-2 hours |
| PERF-P2 | Measure single-request and five-VU baselines | 1-1.5 hours |
| PERF-P3 | Run isolated endpoint ladders and one mixed read/write run | 2-3 hours |
| PERF-P4 | Run a bounded 30-minute soak while observing ECS, CloudWatch, and Neon | 1-2 hours |
| PERF-P5 | Run the separate, low-volume external-AI experiment | 1-2 hours |
| PERF-P6 | Select at most one evidence-backed optimization and repeat the protocol | 3-8 hours |
| PERF-P7 | Publish the report, complete acceptance, and clean up staging | 1-2 hours |

The remaining PERF-P2 through PERF-P7 work is expected to take about 9-20 hours.
If the baseline meets
the derived targets and does not identify a credible bottleneck, PERF-P6 may
conclude that no optimization is justified.

## Safety and experiment boundaries

- Every database write must be preceded by a sanitized target check that confirms
  the Neon `aws-staging` branch and does not display a connection string, password,
  API key, JWT secret, account ID, or secret ARN.
- The AWS region, CLI profile, ECS service, task-definition revision, immutable
  image identity, Git commit, and load-generator location belong in the environment
  fingerprint. Secrets and private identifiers do not.
- Vercel Production, Render Production, and Neon production are excluded.
- The core benchmark uses only synthetic stories already marked `ready`.
- Anthropic calls, input tokens, output tokens, and story-attempt increments must
  all remain zero throughout PERF-P1 through PERF-P4 and the core part of PERF-P6.
- Registration is explicitly excluded from load testing. The registration limiter
  permits only ten requests per hour from one IP and is not an application-capacity
  benchmark.
- A failed or contaminated run is retained as diagnostic evidence but is not used
  to relax a target or support a performance claim.
- The pre-PERF manual staging accounts and sessions are evidence inputs only through
  the already recorded A4/A5 documentation. After the staging-target gate passes,
  PERF-P1 removes those rows so the global leaderboard contains only deterministic
  synthetic users.

### PERF-P1 write gate and rollback rehearsal

Before any PERF-P1 write transaction, the AWS staging service is scaled to zero
desired tasks and both running and pending task counts are confirmed as zero. This
prevents API requests from racing the fixture replacement or triggering provider
work while stories are being normalized. Production services are not changed.

The first execution is a full rollback rehearsal. It generates the one-time bcrypt
hash locally, opens one staging read-write transaction, rechecks the target, UTC
window, permissions, schema, and approved initial dataset under locks, then runs
the complete cleanup, seed, `ANALYZE`, and verification sequence. All table rows,
story updates, and temporary mapping-table DDL are rolled back at the end, followed
by a read-only check that the approved 2-user/2-session snapshot was restored.

PostgreSQL sequence allocation is deliberately documented as the exception:
`nextval()` is not rolled back. The rehearsal therefore creates permanent gaps in
the physical `users.id` and `study_sessions.id` sequences even though it retains no
fixture rows. This does not affect reproducibility because pool membership and all
generated content use stable PERF sequence values rather than physical IDs. The
script must report `sequenceValuesMayAdvance: true`; it must not call `setval()` to
hide those gaps.

The committed seed is a separate, explicitly confirmed operation after the
rollback rehearsal succeeds. Cleanup, replacement inserts, synthetic-story
updates, `ANALYZE`, and pre-commit verification remain inside one atomic
transaction; cleanup is never committed on its own. A failure before `COMMIT`
causes a rollback and leaves staging drained. If `COMMIT` itself returns an
ambiguous result, the script does not retry or claim a rollback: staging remains
drained while a fresh guarded connection compares the visible database with the
recorded source and intended target identities and core-data snapshots. It accepts
only an exact source restoration or exact committed target; any other state remains
unknown. A verification failure after a confirmed commit is reported as committed
but unverified. The API is not restarted against an empty, partial, ambiguous, or
unverified fixture.

## Reproducible data shape

The synthetic dataset is intentionally overprovisioned. A study session is unique
per `(user_id, studied_on)`, so a user can contribute one successful `201` response
per database date. Provisioning both baseline and PERF-P6 users up front decouples
the test schedule from calendar dates and avoids relying on next-day reuse.

| Pool | Users | Purpose |
| --- | ---: | --- |
| Pool R | 900 | Isolated reads for `/api/me` and `/api/characters/today` |
| Pool A | 7,000 | Successful `POST /api/sessions` responses |
| Pool B | 200 | Repeatable expected-`409` session conflicts |
| Total | 8,100 | All identities are synthetic |

The pool ranges are fixed by stable synthetic sequence rather than physical IDs:

```text
1-900       Pool R
901-7900    Pool A
7901-8100   Pool B
```

Every user receives 180 historical sessions dated before the seed date. This
produces approximately 1,458,000 historical rows. Pool B receives one additional
current-date session per user, for the actual daily character, so the request
passes the today's-character validation and reaches the unique-conflict path.

Pool A is budgeted as follows:

| Use | Stable sequence range | Users |
| --- | --- | ---: |
| Baseline isolated `201` ladder | 901-3900 | 3,000 |
| PERF-P6 isolated `201` ladder | 3901-6900 | 3,000 |
| Baseline mixed run | 6901-7100 | 200 |
| PERF-P6 mixed run | 7101-7300 | 200 |
| Operational reserve | 7301-7900 | 600 |

PERF-P2 uses sequence 7301-7630, the first 330 operational-reserve users, for its
bounded S5 measurements. The remaining 270 reserve identities stay unused unless
an invalid run is explicitly retained and reset under the rule below.

A complete invalid comparison round may require more than the 600-user reserve.
After preserving its results as invalid evidence, only that round's tagged,
synthetic current-date Pool A rows may be removed and the users reused. This is a
fixture reset, not permission to delete any untagged or production-like data.

### Date anchoring and deterministic content

The repeatable seed procedure, not a static database snapshot, is the template.
Before each formal comparison round it recreates the tagged synthetic dataset with
the 180 historical dates anchored to that round's recorded database date. This
keeps the latest streak island touching yesterday in both baseline and PERF-P6,
even when the two versions run on different dates.

The seed must not derive behavior from newly allocated PostgreSQL serial IDs. User
accuracy and session content are derived from a stable synthetic ordinal, such as
the fixed-width numeric suffix in `player_00042`. This preserves the same logical
distribution after delete-and-reseed cycles even if database IDs change.

Each stable user ordinal receives an accuracy band from 40% through 89%, with a
deterministic correct/incorrect pattern. The distribution should produce varied
scores plus repeatable tied groups. PERF-P1 verifies both the range and the largest
tie groups after seeding; it does not use `RANDOM()`.

Character assignment uses the actual ordered set of 365 staging character IDs. It
must not assume that IDs are contiguous or start at one.

PERF-P1 creates two temporary mapping tables directly in `aws-staging`:

```sql
CREATE TABLE perf_users (
  seq     INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE perf_characters (
  seq          INTEGER PRIMARY KEY,
  character_id INTEGER NOT NULL UNIQUE REFERENCES characters(id)
);
```

`perf_users.seq` is the stable input for pool membership, names, emails, accuracy,
and session generation. `perf_characters.seq` is assigned from the actual character
rows in stable `ORDER BY id` order. All generated sessions join through these maps;
they never calculate a physical ID with arithmetic. Synthetic users set
`leaderboard_name_public = TRUE`, so leaderboard responses use their fixed-width
synthetic names rather than a fallback derived from the physical user ID.

On a reseed, cleanup first uses `perf_users` to delete the mapped `users`; the
foreign keys remove their sessions and mapping rows. Only then may the mapping
tables be dropped and recreated. The synthetic email domain is a secondary orphan
guard, not the primary deletion selector.

All 365 characters, including the two rows previously generated during the A5 live
provider acceptance, receive the exact same canonical synthetic story value and are
set to `story_status = 'ready'`, `story_attempts = 0`, and no active start time. The
A5 provider evidence remains in the documentation; the staging rows themselves are
not retained as benchmark fixtures. This stabilizes the largest variable response
field across calendar dates. Pinyin, meaning, and random quiz-option text can still
vary, so the report also records response byte sizes and does not claim that every
`/today` response is byte-identical.

After the bulk seed, PERF-P1 runs:

```sql
ANALYZE study_sessions;
ANALYZE characters;
ANALYZE users;
```

The completed `ANALYZE` step is recorded in the environment fingerprint. This
prevents a later automatic statistics refresh from being mistaken for a PERF-P6
optimization gain.

The post-seed normalization gate includes these exact row-count invariants:

```sql
SELECT COUNT(*) FROM users;          -- exactly 8100
SELECT COUNT(*) FROM perf_users;     -- exactly 8100
SELECT COUNT(*) FROM study_sessions
 WHERE user_id NOT IN (SELECT user_id FROM perf_users); -- exactly 0
```

It also verifies the three pool counts, 180 historical dates per user, the 200
current-date Pool B rows, deterministic score variation, real tied score groups,
all 365 synthetic `ready` stories, unchanged attempt invariants, and the current
daily character selected by the database date.

## Authentication fixture

Login is not used to prepare authentication for the protected read and write
benchmarks. A dedicated Fargate load-generator task signs the required JWTs locally
before k6 starts:

```text
ECS injects the scoped runtime secrets
  -> the entrypoint reads perf_users from Neon
  -> the existing application signer creates 4-hour JWTs
  -> /tmp/tokens.json is written
  -> k6 starts and reads the file during init
  -> the task exits and its temporary filesystem disappears
```

The load-generator task definition uses ECS secret injection through its execution
role. The container does not call the Secrets Manager API at runtime, so this does
not require a new application task-role permission. The image, repository, logs,
and test artifacts never contain `JWT_SECRET`, `DATABASE_URL`, or bearer tokens.

The entrypoint reuses the built application's `signToken()` implementation instead
of reimplementing JWT claims or algorithms. It sets `JWT_EXPIRES_IN=4h` only for the
load-generator process. The environment fingerprint records token count, issue
time, and expiry time, but no token value. A new task signs a new set for every
formal round.

The mint helper imports `dist/auth.js` directly and must not import `dist/index.js`.
In the current build, `dist/auth.js` has no direct or transitive dependency on
`dist/config.js`; `signToken()` reads only `JWT_SECRET` and `JWT_EXPIRES_IN` when it
is called. The helper separately needs `DATABASE_URL` to read `perf_users`, but it
does not need `PORT` or the provider secret. `JWT_EXPIRES_IN` is not part of the
startup Zod schema and the string `4h` is passed directly to `jsonwebtoken`.

This path was verified locally on 2026-09-16 using the existing built signer and
an in-memory dummy secret. The resulting token used HS256, preserved the numeric
user ID, and had an exact 14,400-second lifetime. Neither the token nor the dummy
secret was printed or persisted.

k6 loads the JSON file in its init context through one `SharedArray`, so all VUs
share the 8,100-record fixture instead of creating one JavaScript copy per VU. The
file lives outside the repository at `/tmp/tokens.json`; no `.gitignore` change is
needed. The entrypoint must finish writing and close the file before it executes
`k6 run`.

## Database date and timezone gate

`CURRENT_DATE` is evaluated in the database session timezone. Before the first
seed, PERF-P1 records `SHOW timezone;` using the staging connection identity and
requires a fixed zero-offset timezone before proceeding. `UTC` and `GMT` are both
accepted because they produce the same date boundary and do not observe daylight
saving time; any other value stops the seed until its effect is understood.

Every formal measurement round records the staging database `CURRENT_DATE` at the
start and end. If the values differ, the entire round is invalid. Formal runs are
also prohibited during the 30 minutes before or after UTC midnight. The local-time
translation is recalculated on the run date rather than assuming a permanent UTC
offset.

At the start of each core round, the selected daily character must have the
canonical synthetic story and `ready` status. At the end, its story attempt count
must be unchanged. Provider usage for the core interval must remain zero.

## Scenarios

| ID | Request | Pool | Expected result | Purpose |
| --- | --- | --- | --- | --- |
| S0 | `GET /api/health` | None | `200` | Separate basic ECS, network, and database reachability |
| S1 | `POST /api/auth/login` | R | `200` | Measure successful login and bcrypt work within limiter constraints |
| S2 | `GET /api/characters/today` | R | `200` | Measure the daily read, full profile dependency, and quiz options |
| S3 | `GET /api/me` | R | `200` | Measure per-user profile, streak, and badge aggregation |
| S4 | `GET /api/leaderboard` | R | `200` | Measure global aggregation and ranking |
| S5 | `POST /api/sessions` | A | `201` | Measure one current-date first write and returned profile |
| S6 | `POST /api/sessions` | B | `409 ALREADY_STUDIED_TODAY` | Measure the expected unique-conflict path |
| S7 | Read/write mixture | R and A | Expected per subrequest | Observe connection-pool contention after isolated attribution |

The `/today` checks include the absence of `meaning`, exactly three distinct quiz
options, and comparison with the known staging answer to confirm that one option is
correct. The current automated suite checks only the endpoint status and numeric
ID indirectly; adding a dedicated regression test remains a separate manual code
change and is not silently bundled into PERF.

Pool R users have 180 learned character IDs. `/today` therefore measures the
current implementation as it exists: the route computes the complete profile to
obtain that array and passes it into the options query. A slower result than `/me`
is not treated as a setup error without further evidence.

## Latency targets derived before measurement

PERF-P2 runs three single-VU repetitions per endpoint after a 30-second warm-up.
Let `B50` and `B95` be the medians of the three run-level p50 and p95 results. The
numeric thresholds are then derived once with these already-frozen formulas:

```text
p50 threshold = ceil((B50 * 2) / 50 ms) * 50 ms
p95 threshold = ceil((B95 * 3) / 50 ms) * 50 ms
```

The formulas cannot be changed after seeing the measurements. A baseline affected
by a deployment, invalid response, provider call, or database-date transition is
discarded and repeated; it is not used to enlarge the threshold.

Latency is reported from k6 `http_req_duration` on reused connections. DNS, TCP,
TLS, blocked time, response bytes, iteration duration, and server/database metrics
are recorded separately. Latency percentiles include only responses that pass the
scenario's expected-status classification; error rates use all attempted requests.

### Pre-measurement PERF-P2 clarification

This clarification was recorded on 2026-09-17 before any PERF-P2 request or
measurement. It closes two ambiguities in the frozen protocol without using
observed performance data.

For S0-S4 and S6, each formal PERF-P2 repetition has a 30-second unmeasured
warm-up followed by a 60-second measured interval. Each endpoint runs three
repetitions at 1 VU and then three repetitions at 5 VUs. Every VU waits for its
current request to finish before issuing another request. The 1-VU repetitions
alone define `B50`, `B95`, and the derived latency thresholds. The 5-VU
repetitions are the frozen low-concurrency comparison and do not redefine those
thresholds.

S5 remains bounded by distinct Pool A identities. At both 1 VU and 5 VUs, each
repetition uses five unmeasured first-write iterations followed by exactly 50
measured first-write iterations, all with distinct users. Each level runs three
repetitions, consuming exactly 330 Pool A reserve users across PERF-P2. This is an
explicit exception to the time-based warm-up used by the read, login, and
expected-conflict scenarios. The harness must allocate these users from the
operational-reserve range and must fail before a request if a sequence would be
reused.

S1 uses one designated Pool R identity and a temporary high-entropy
`PERF_LOGIN_PASSWORD`. The password is supplied out of band to both the repeat
seed process and the load-generator runtime. The seed hashes it once with the
frozen bcrypt cost and applies the resulting hash to all synthetic users, which
preserves the existing one-distinct-hash fixture invariant. The benchmark uses
only the designated identity. The plaintext value must never enter Git, an image,
logs, result artifacts, or command output. A formal run is blocked if the value is
missing, shorter than 32 UTF-8 bytes, longer than bcrypt's 72-byte input limit, or
if the successful-login pre-flight fails. The temporary credential is removed at
PERF-P7 cleanup.

S7 is not part of PERF-P2. It remains deferred until the isolated PERF-P3 results
select and freeze a mixed-load level.

## Concurrency protocols

### Sustainable read and conflict ladders

S0, S2, S3, S4, and S6 use `5 -> 10 -> 20 -> 40 -> 80` VUs. Each level has a
separate warm-up transition followed by two measured minutes. Expected `409`
responses in S6 count as successful scenario outcomes; any other status is an
error.

For each level, report completed expected responses per second, p50, p95, response
bytes, checks, and errors. The first level meeting any of these conditions is the
capacity knee:

- error rate is at least 1%;
- p95 exceeds the derived endpoint threshold;
- doubling VUs improves completed throughput by less than 20%; or
- the ECS task restarts or another resource limit causes instability.

The highest preceding level is the measured sustainable point for this staging
configuration. The test records later levels as evidence instead of stopping at
the first threshold failure.

### Login ladder

The load generator has one source IP. `express-rate-limit` 8.6.2 increments the
login counter when a request begins and, with `skipSuccessfulRequests`, decrements
it only after a successful response finishes. Concurrent in-flight successes
therefore still consume the ten-request allowance temporarily.

S1 is limited to `1 -> 2 -> 5 -> 8` VUs, with each VU issuing its next request only
after its current response completes. A successful credential pre-flight is
required. Any unexpected login failure stops the scenario and contaminates that
IP's 15-minute limiter window; the formal run cannot resume until the window is
clean. Login is graphed separately because bcrypt is intentionally CPU-heavy and
its limiter prevents this single-IP experiment from claiming unlimited endpoint
capacity.

### Successful `201` write envelope

S5 is a finite first-write experiment rather than a sustained-throughput claim.
For each `5 -> 10 -> 20 -> 40 -> 80` concurrency level, run 200 total iterations
with a distinct Pool A user per iteration. Repeat the complete five-level ladder
three times. Report p50, p95, completion time, finite-batch completion rate, and
error rate under the label:

> Current-date first-write latency envelope at the stated concurrency

### Mixed read/write run

S7 runs only after the isolated baselines so endpoint attribution remains possible.
It uses Pool R for reads and exactly 200 distinct Pool A users for successful writes.
The baseline selects and records a fixed mixed-load level from the isolated results;
PERF-P6 must reuse that numeric level rather than recalculating a more favorable
one. Login and registration are excluded from the mixture so the experiment focuses
on database-pool contention rather than bcrypt or IP limiting.

## Error budget and k6 behavior

- Unexpected results must remain below 1% for each scenario and concurrency level.
- Data-integrity violations, false successful statuses, and core Anthropic calls
  have a zero-error budget.
- A correct `409 ALREADY_STUDIED_TODAY` is success only in S6.
- `401`, unexpected `409`, `429`, transport errors, and `5xx` are broken out rather
  than hidden in one aggregate.
- k6 thresholds are declared but never use `abortOnFail` for the capacity ladders.
- A final k6 exit code of 99 is a threshold result, not automatically a harness
  failure. The wrapper must preserve artifacts and allow the complete ladder to
  finish before classifying the capacity knee.

## Soak and external-provider separation

PERF-P4 uses the frozen core dataset for a 30-minute bounded soak while observing
ECS task count, CPU and memory, CloudWatch errors, Neon connections and utilization,
latency drift, and provider usage. The exact load is selected from the valid P3
sustainable point and then frozen for any PERF-P6 comparison.

PERF-P5 is separate. It uses one dedicated staging character, one concurrent cold
request batch, and no load-tool retry. The planned provider budget is one claimed
generation and no more than $0.01, with automatic recharge remaining disabled.
Provider usage is checked before any additional action. Cache-hit requests must not
increase attempts or provider use. Timeout, provider-error, and provider-rate-limit
cases use an existing controllable test mechanism; if staging cannot safely induce
them without a code or configuration change, the report records that limitation
instead of presenting simulated behavior as a live staging result.

## Optimization and reporting rule

PERF-P6 changes at most one independently attributable variable at a time. A query,
pool, index, or cache change requires evidence from the frozen baseline, query plans,
CloudWatch, Neon, or connection-wait observations. It is retested with the same
scenario, logical data distribution, threshold formula, and frozen numeric load.

PERF-P7 publishes valid and invalid runs, raw environment fingerprints, derived
thresholds, achieved throughput, error classifications, resource observations,
provider usage and cost, and any limitations. Staging cleanup occurs only after the
final acceptance gate and never targets production resources.
