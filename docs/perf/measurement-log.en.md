# Performance Measurement Log

This log preserves measurement-time evidence that cannot be reconstructed reliably after the staging environment changes. Secrets, full AWS ARNs, database URLs, tokens, and endpoint hostnames must never be recorded here.

## 2026-09-19 — P2 Fargate smoke run

### Purpose

Validate the real measurement path before the P2 baseline sweep:

- Fargate load generator starts with the approved task definition.
- The container can mint the private token fixture from staging data.
- Traffic reaches the staging ECS API over HTTPS.
- Health, credential login, and bearer-token authentication work end to end.
- Each k6 run emits one compact, machine-readable `PERF_RESULT` event to CloudWatch Logs.

This was an infrastructure smoke test, not a baseline result.

### Environment

- UTC interval: `2026-09-19T14:22:22Z` to `2026-09-19T14:27:20Z`
- Load-generator task ID: `64057b368eb64a40b198ca7489f11ae6`
- Load-generator task definition: `chinstein-p2-loadgen:1`
- Load-generator source commit: `9665522c186473914412c4bdaa692fc44903225c`
- Load-generator image digest: `sha256:500f38baf67b82d1df72311dbc3f2d5b91b4ce46f4a14305e05b4bd2346eaaa2`
- API task definition: `default-chinstein-api-staging:7`
- API service state before the run: desired `1`, running `1`, pending `0`
- Fargate platform version: `1.4.0`
- Load-generator allocation: `0.5 vCPU`, `1 GiB`
- Database: approved staging PERF dataset, reseeded and verified on database date `2026-09-19`
- Dataset size: 8,100 users, 1,458,200 study sessions, 365 characters
- API image digest: `sha256:3136ff4c5a3dae72ef852d3fdb707ac6e64022432c2578c95e6de95ff6c89349`
- API source commit: `b33785f19178`
- Post-smoke database date: `2026-09-19`, verified read-only at `2026-09-19T14:35:00Z`

### Run configuration

- Scenarios: `S0`, `S1`, `S3`
- Virtual users: `1`
- Repetitions: `1`
- Failure policy: fail fast
- Each scenario: 30-second warm-up followed by a 60-second measured window

### Results

| Scenario | Meaning | Measured requests | p50 | p95 | Unexpected rate |
| --- | --- | ---: | ---: | ---: | ---: |
| S0 | Health | 12,737 | 3.476 ms | 4.519 ms | 0% |
| S1 | Login | 451 | 118.006 ms | 169.762 ms | 0% |
| S3 | Current user with bearer token | 7,113 | 5.620 ms | 8.437 ms | 0% |

Operational outcome:

- Three complete `PERF_RESULT` events were emitted.
- No `PERF_RUN_FAILED` event was emitted.
- The sweep emitted one successful finish event with exit code `0`.
- The Fargate task stopped normally with container exit code `0`.

### Interpretation

The production-shaped measurement path works end to end. The results include the network path from the Fargate load generator to the public staging ECS endpoint and the API's downstream access to Neon. Login is materially slower than the read-only endpoints, consistent with password-hash verification being part of the request path. This observation is directional only; one repetition is insufficient for a baseline or an optimization decision.

### Main confounders

- Only one repetition was run, so run-to-run variance is unknown.
- Only the 1-VU level was exercised.
- Scenarios ran sequentially in one task, so API and database warmness changed during the run.
- No synchronized API CPU, memory, connection-pool, or Neon metrics were captured for this smoke test.
- API and load-generator fingerprints were captured after the smoke run rather than atomically at task start; the immutable task definitions and image digests provide the join evidence.

### Deliberately deferred

- No full 42-combination sweep was started.
- Scenarios `S2`, `S4`, `S5`, and `S6` were not exercised.
- The 5-VU level and three-repetition median calculation were not exercised.
- No code optimization was selected from smoke-test data.

### Next decision

Capture the complete API deployment fingerprint and database date, then run the formal P2 sweep. Use three repetitions per scenario and load level, calculate medians, and select optimization work only from those baseline measurements.

## 2026-09-19 — P2 formal baseline sweep

### Start evidence

- Status: running in AWS Fargate
- UTC start: `2026-09-19T14:39:35Z`
- Load-generator task ID: `f458e8882aaf40baa9c2486ebea15cbb`
- Load-generator task definition: `chinstein-p2-loadgen:2`
- ECS `startedBy`: `p2-baseline-20260919`
- Load-generator source commit: `9665522c186473914412c4bdaa692fc44903225c`
- Load-generator image digest: `sha256:500f38baf67b82d1df72311dbc3f2d5b91b4ce46f4a14305e05b4bd2346eaaa2`
- API task definition: `default-chinstein-api-staging:7`
- API source commit: `b33785f19178`
- API image digest: `sha256:3136ff4c5a3dae72ef852d3fdb707ac6e64022432c2578c95e6de95ff6c89349`
- API service state: desired `1`, running `1`, pending `0`
- Pre-run database date: `2026-09-19`
- Database identity: `neondb`, host fingerprint `777c6ca41572`, timezone `GMT`, not in recovery
- Dataset: 8,100 users, 1,458,200 study sessions, 365 characters
- Execution plan: 7 scenarios × 2 load levels × 3 repetitions = 42 combinations
- Scenario order: `S0 S1 S2 S3 S4 S6 S5`
- Load levels: 1 VU and 5 VU
- Failure policy: complete the sweep and record individual failed combinations
- Local computer required after confirmed start: no

### Completion evidence

- UTC finish: `2026-09-19T15:36:03Z`
- Elapsed wall time: 56 minutes 28 seconds
- Fargate task state: `STOPPED`
- Container exit code: `0`
- Complete `PERF_RESULT` events: 42 of 42
- Duplicate or missing combinations: 0
- Failed combinations: 0
- Attempted requests, including warm-up: 332,464
- Expected responses: 332,464
- Unexpected responses: 0
- Formally measured requests: 222,689
- Post-run database date: `2026-09-19`
- S5 post-check: 330 sessions from exactly 330 distinct reserved Pool A users, with no reused user
- Final study-session count: 1,458,530

### Accepted baseline

`B50` and `B95` are the medians of the three run-level percentiles. The frozen latency thresholds use only the 1-VU baseline. The 5-VU figures are comparison evidence and do not redefine the thresholds.

| Scenario | 1 VU B50 | 1 VU B95 | p50 threshold | p95 threshold | 5 VU median p50 | 5 VU median p95 | Unexpected |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| S0 health | 4.628 ms | 6.316 ms | 50 ms | 50 ms | 4.169 ms | 66.798 ms | 0% |
| S1 login | 118.162 ms | 169.258 ms | 250 ms | 550 ms | 698.318 ms | 991.518 ms | 0% |
| S2 today character | 11.346 ms | 18.300 ms | 50 ms | 100 ms | 12.339 ms | 55.386 ms | 0% |
| S3 current user | 5.503 ms | 7.580 ms | 50 ms | 50 ms | 7.279 ms | 79.990 ms | 0% |
| S4 leaderboard | 99.272 ms | 108.856 ms | 200 ms | 350 ms | 150.230 ms | 281.619 ms | 0% |
| S5 first session write | 13.302 ms | 15.360 ms | 50 ms | 50 ms | 23.741 ms | 34.660 ms | 0% |
| S6 existing-session conflict | 28.624 ms | 48.211 ms | 100 ms | 150 ms | 98.121 ms | 170.120 ms | 0% |

### Interpretation and P3 priorities

- S1 is the clearest low-concurrency saturation signal. At 5 VUs, median p50 and p95 were approximately 5.91× and 5.86× their 1-VU values. Password-hash verification is a plausible contributor, but CPU evidence is required before assigning cause.
- S4 has the highest non-login 1-VU median latency and rises to 150.230/281.619 ms at 5 VUs. The leaderboard query and aggregation path are the leading P3 investigation target, not a proven root cause.
- S6 rises by approximately 3.43× at p50 and 3.53× at p95. P3 should determine how much work occurs before the expected conflict is returned.
- S0 and S3 retain low 5-VU medians but develop p95 tails around 10.6× their 1-VU p95 values. This points to intermittent shared contention that must be correlated with ECS and Neon observations rather than inferred from latency alone.
- S2 has a stable median and a roughly 3.03× p95 increase at 5 VUs.
- S5 remains fast at the three-run median, but its third 5-VU repetition was visibly slower than the first two. The bounded P3 write ladder must retain the individual-run evidence instead of hiding this variance.

No optimization is selected from P2 alone. PERF-P3 will measure the frozen capacity ladders and collect resource or query evidence before PERF-P6 changes one attributable variable.

### Preserved artifacts

- [Raw run results](results/p2-baseline-2026-09-19.raw.json)
- [Derived summary](results/p2-baseline-2026-09-19.summary.json)
- [Database post-check](results/p2-baseline-2026-09-19.postcheck.json)
- [Run manifest](results/p2-baseline-2026-09-19.manifest.json)

### Measurement-time conclusions and limits

These statements separate direct observations from hypotheses that still require
P3 evidence:

- S0 provides an end-to-end shared-path floor, not an isolated network-latency
  measurement. Its 1-VU median was 4.628 ms, so a claim that ECS-to-Neon network
  time alone is 2-4 ms is not supported by this run.
- S4 was the slowest non-login scenario at 1 VU and remains the leading query-path
  investigation target. P2 does not yet prove whether the cause is full-table
  aggregation, CPU, connection waiting, or another shared limit.
- S3 remained fast at 1 VU. This weakens the prior expectation that its profile
  work would dominate the baseline, but it does not assign a millisecond cost to
  an individual SQL statement without query timing or a plan.
- S1 is intentionally separated from optimization selection because bcrypt cost
  is a security control. Its 5-VU saturation is still valid capacity evidence and
  should be correlated with CPU observations.
- S6 was slower than S5 despite returning an expected conflict and doing less
  apparent application work. Transaction, exception, and rollback cost are
  hypotheses only until measured directly.
- S3 returned the largest measured response body, approximately 1,042-1,065 bytes.
  Replacing the learned-character ID array with a count is a candidate API change,
  not an approved optimization.
- S5's third 5-VU run recorded p50 50.435 ms and p95 107.156 ms, versus p50
  21.195/23.741 ms and p95 29.075/34.660 ms in the first two runs. All three runs
  remain preserved; this variation motivated a non-discretionary P3 confirmation
  rule rather than deletion of an inconvenient run.

### Pre-registered P3 design decision

Recorded on 2026-09-19 after P2 acceptance and before any P3 request:

- The accepted P2 run left 330 current-date Pool A sessions. Before P3, the
  verified repeat-seed workflow must restore the approved fixture with zero
  current-date Pool A sessions and record the new database date.
- All timed ladders run before S5. S5 then runs last and consumes exactly the
  3,000-user baseline-isolated Pool A range (`901-3900`).
- S0 and S4 use `1 -> 2 -> 5 -> 10 -> 20 -> 40 -> 80` VUs so the low-work shared
  path and the leaderboard path can distinguish an early shared-system boundary
  from a query-specific boundary.
- S2, S3, and S6 retain `5 -> 10 -> 20 -> 40 -> 80`; all original levels remain.
- The added points increase resolution only. P2-derived thresholds, the 1% error
  budget, 30-second warm-ups, two-minute measured windows, and all capacity-knee
  conditions remain unchanged.
- P3 uses one formal measurement per read/conflict level. The P2 three-repetition
  rule is not copied into P3.
- After the first ladder, the first failing level and its preceding level are each
  repeated once unconditionally. Every result is retained. A disagreement is
  resolved to the earlier, more conservative failing boundary and disclosed.
- Capacity is reported as an interval between the highest confirmed preceding
  level and the first failing level. A first-level failure is reported as below
  that level and not localized; no failure through 80 VUs is reported as above
  80 VUs and not localized.
- P2 suggests S3 and S6 may already exceed their p95 thresholds at 5 VUs. They are
  reported as below 5 VUs only if the formal P3 5-VU result confirms a frozen
  failure condition.
