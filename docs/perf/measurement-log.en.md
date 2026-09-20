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

## 2026-09-19 — P3 pre-measurement fixture reset

- The staging API service was desired `0`, running `0`, pending `0` before the
  reset.
- The approved source contained 8,100 users, 365 characters, and 1,458,530 study
  sessions. The extra 330 current-date rows belonged to 330 Pool A users consumed
  by the accepted P2 run.
- The rollback rehearsal rebuilt and verified the target, then restored the exact
  source counts and fingerprint before the committed run.
- The committed repeat-seed completed as one atomic replacement transaction with
  `commitOutcome: confirmed` and fresh-connection post-commit verification.
- The recorded seed and database date remained `2026-09-19`; the database was
  `neondb`, host fingerprint `777c6ca41572`, PostgreSQL `18.6`, and not in recovery.
- The accepted P3 source contains 8,100 users, 365 characters, 1,458,000 historical
  sessions, 200 current-date Pool B conflict rows, and zero current-date Pool A
  rows, for 1,458,200 study sessions in total.
- Mapping, uniqueness, date-range, story, distribution, and session-quality checks
  passed with no invalid or unmapped rows. Sequence values may advance, while all
  workload derivation continues to use stable PERF mapping sequences.

## 2026-09-19 — P3 Fargate smoke

- Purpose: validate the P3 image, Fargate entrypoint, token-fixture generation,
  k6 runtime, CloudWatch result transport, and compact result contract before the
  formal capacity ladder. This run is setup evidence and is excluded from formal
  P3 capacity classification.
- Load-generator source commit: `3444a88f6630fe6083d30b661afda0643e690054`
- Load-generator image digest: `sha256:e7160971eb6097c57f158c5c9f89a9c4b778244a521cac35ed6d27df0ae115b6`
- Task definition: `chinstein-p3-loadgen:1`
- Task ID: `d2849097ae9b45149004f9d03aa159fd`
- UTC interval: `2026-09-19T17:40:15Z` to `2026-09-19T17:42:55Z`
- Scenario: S0, 1 VU, 30-second warm-up plus 120 measured seconds
- Measured expected requests: 25,131; unexpected responses: 0; checks: 100%
- Measured throughput: 209.425 expected responses per second
- Measured latency: p50 3.612 ms, p95 4.827 ms, maximum 467.284 ms
- Container exit code: `0`; failed runs: 0; threshold events: 0; compact result
  contract valid: true

## 2026-09-19 — P3 formal initial capacity ladder

### Start evidence

- Status: running unattended in AWS Fargate
- UTC start: `2026-09-19T17:51:18Z`
- Task ID: `aca61d93b06e4455b5754b55cd024c26`
- Task definition: `chinstein-p3-loadgen:2`
- ECS `startedBy`: `p3-initial-20260919`
- Load-generator source commit: `3444a88f6630fe6083d30b661afda0643e690054`
- Load-generator image digest: `sha256:e7160971eb6097c57f158c5c9f89a9c4b778244a521cac35ed6d27df0ae115b6`
- Suite and run kind: `timed`, `initial`
- Planned combinations: 33 across the six pre-registered timed scenarios
- Pre-run gates: API stable at desired/running/pending `1/1/0`; approved P3
  source contained 1,458,200 sessions with zero current-date Pool A rows
- Local computer required after confirmed start: no

### Completion evidence

- UTC sweep finish: `2026-09-19T19:15:56Z`; ECS stopped the one-shot task at
  `2026-09-19T19:16:21.605Z`
- Task outcome: `STOPPED`, `EssentialContainerExited`, container exit code `0`
- Completed results: 33 of 33; failed-run events: 0
- Measured requests: 728,078 expected of 728,078 attempted; unexpected: 0
- Threshold-exceeded results: 24. Threshold events are capacity observations,
  not execution failures; the ladder intentionally continued after each event.
- Read-only post-check: the approved source remained at 1,458,200 sessions,
  including zero current-date Pool A rows and 200 Pool B rows. Database date and
  source seed date both remained `2026-09-19`.

| Scenario | Threshold | Highest preceding pass | First failure | Initial capacity statement |
| --- | ---: | ---: | ---: | --- |
| S0 health | 50 ms p95 | 2 VU: 5.660 ms | 5 VU: 58.515 ms | between 2 and 5 VUs |
| S2 today character | 100 ms p95 | 10 VU: 80.762 ms | 20 VU: 107.767 ms | between 10 and 20 VUs |
| S3 current user | 50 ms p95 | not sampled below 5 | 5 VU: 77.532 ms | below 5 VUs; not localized |
| S4 leaderboard | 350 ms p95 | 5 VU: 279.526 ms | 10 VU: 533.069 ms | between 5 and 10 VUs |
| S6 existing conflict | 150 ms p95 | not sampled below 5 | 5 VU: 172.834 ms | below 5 VUs; not localized |
| S1 login | 550 ms p95 | 2 VU: 310.021 ms | 5 VU: 1,002.680 ms | between 2 and 5 VUs |

### Frozen confirmation plan

The pre-registered rule produced ten confirmation combinations: S0 at 2/5 VUs,
S2 at 10/20, S3 at 5, S4 at 5/10, S6 at 5, and S1 at 2/5. They will run
sequentially so concurrent load generators cannot contaminate one another. All
initial and confirmation results remain in the report; disagreement is resolved
to the earlier, more conservative failing boundary.

### Preserved artifacts

- [Raw initial results](results/p3-initial-2026-09-19.raw.json)
- [Derived initial summary](results/p3-initial-2026-09-19.summary.json)
- [Database post-check](results/p3-initial-2026-09-19.postcheck.json)
- [Initial run manifest](results/p3-initial-2026-09-19.manifest.json)

### Pre-confirmation classification correction

Before using any confirmation result, a review of the frozen knee rules found
that the first derived confirmation plan considered the p95 threshold and error
budget but omitted the separate rule that an exact doubling of VUs fails when
completed throughput improves by less than 20%. The raw initial results were not
changed or discarded.

- S2 throughput rose only from 280.500 req/s at 5 VUs to 284.408 req/s at 10
  VUs, an increase of approximately 1.39%. Its first initial failure is therefore
  10 VUs, not 20, and its required pair is 5/10 VUs.
- S1 throughput fell from 7.758 req/s at 1 VU to 7.008 req/s at 2 VUs. Its first
  initial failure is therefore 2 VUs, not 5, and its required pair is 1/2 VUs.
- The already completed S2/20 and S1/5 confirmation observations remain valid
  extra evidence. A two-combination addendum will measure the missing S2/5 and
  S1/1 levels before final classification.

This correction applies an existing pre-registered rule before the final capacity
claim; it does not change a threshold, delete a result, or add a favorable retry.

### Confirmation completion and final timed-capacity classification

- The main confirmation task ran from `2026-09-19T20:02:10Z` to
  `2026-09-19T20:28:15Z`; the two-result addendum finished at
  `2026-09-19T21:14:43Z`.
- Both Fargate tasks stopped normally with container exit code `0`.
- Twelve confirmation results produced 234,315 expected responses and zero
  unexpected responses. Initial plus confirmation evidence contains 962,393
  measured requests and zero unexpected responses.
- The post-check remained on database date `2026-09-19`, with the approved
  1,458,200-session source, zero current-date Pool A rows, and 200 Pool B rows.

| Scenario | Confirmed capacity interval | Confirmation evidence | Decisive rule |
| --- | --- | --- | --- |
| S0 health | 2-5 VUs | p95 6.539 ms at 2; 55.361 ms at 5 | p95 over 50 ms at 5 |
| S2 today character | 5-10 VUs | 270.475 to 268.408 req/s | doubled VUs did not improve throughput by 20% |
| S3 current user | below 5 VUs; not localized | p95 76.133 ms at 5 | first tested level over 50 ms |
| S4 leaderboard | 5-10 VUs | p95 284.895 to 525.197 ms; throughput +8.0% | p95 and throughput rules both fail at 10 |
| S6 existing conflict | below 5 VUs; not localized | p95 167.510 ms at 5 | first tested level over 150 ms |
| S1 login | 1-2 VUs | 7.717 to 6.967 req/s | doubled VUs reduced throughput |

The confirmation evidence agreed with every conservative boundary. S2/20 and
S1/5 remain in the raw artifact as additional observations even though the full
throughput rule established earlier knees. No timed-capacity result was removed.

- [Final timed-capacity classification](results/p3-capacity-2026-09-19.summary.json)
- [Confirmation raw results](results/p3-confirmation-2026-09-19.raw.json)
- [Confirmation database post-check](results/p3-confirmation-2026-09-19.postcheck.json)
- [Confirmation manifest](results/p3-confirmation-2026-09-19.manifest.json)

### Pre-registered P3 mixed and write workload

The remaining P3 workload was frozen after the timed-capacity classification and
before sending any S7 request. The purpose is to finish the assessment with the
smallest attributable experiment rather than add more harness infrastructure.

- S7 uses S4 leaderboard reads at 5 constant VUs: the highest confirmed passing
  S4 level. It has 30 seconds of warm-up and 120 measured seconds.
- The measured interval schedules exactly 200 S5 first writes at 100 per 60 seconds,
  using only Pool A sequences 6901-7100. Five write VUs are preallocated and capped;
  dropped iterations invalidate the mixed run.
- The frozen p95 thresholds remain 350 ms for S4 and 50 ms for S5, with the existing
  below-1% unexpected-response budget.
- After S7, the existing isolated S5 ladder runs last at 5/10/20/40/80 VUs, three
  200-write repetitions per level, using the disjoint 3000-user isolated allocation.
- One token fixture and one Fargate task cover both workloads. A fresh repeat seed
  is required first because successful-write users must have no current-date session.
- PERF-P6 must reuse this exact S7 mixture and S5 ladder so baseline and retest remain
  directly comparable.

### Final P3 fixture reset

- Database date: `2026-09-20`; all write work began outside the frozen UTC-midnight
  exclusion window.
- The staging API was drained to zero desired, running, and pending tasks before
  either write transaction.
- The rollback rehearsal accepted only `approved-perf-source`, rebuilt and verified
  the complete fixture, then reported `committed: false`, `rolledBack: true`, and
  `restorationVerified: true`.
- The committed repeat seed reported `committed: true`, `commitOutcome: confirmed`,
  and `postCommitVerified: true`. A fresh read-only connection verified both the
  target identity and snapshot.
- The new approved source contains 8,100 users, 365 characters, and 1,458,200
  sessions: 1,458,000 historical rows, zero current-date Pool A rows, and 200
  current-date Pool B rows. The current daily character is sequence 277.
- The final load-generator image is source commit
  `b970014477a6e861530c26e9c91aebf24b62e7ef` at immutable digest
  `sha256:7d85d80ed4a3e19bc8c184aef9a8e1b230d9433c83cad5dc8c79975648d12d4f`.

### P3 mixed and finite-write completion

- The final task ran from `2026-09-20T02:06:35Z` through `02:10:09Z`, returned
  all 16 expected results, produced no failed-run event, and exited with code 0.
- S7 produced 3,497 measured S4 reads plus 200 successful S5 writes. Both paths
  had zero unexpected responses, and the write executor dropped zero iterations.
- Mixed S4 p50/p95 were 153.990/281.768 ms. Its isolated confirmed 5-VU p95 was
  284.895 ms, so the pre-registered write mixture changed read p95 by -1.10% and
  did not push S4 past its 350 ms limit.
- Mixed S5 p50/p95 were 24.814/52.440 ms. All 200 writes succeeded, but its p95
  was 2.440 ms above the frozen 50 ms target. The one mixed threshold event is
  therefore a measured write-tail result, not a harness or integrity failure.

| S5 VUs | Median p50 | Median p95 | Median batch time | Runs over 50 ms p95 |
| ---: | ---: | ---: | ---: | ---: |
| 5 | 18.440 ms | 46.526 ms | 922.552 ms | 0/3 |
| 10 | 25.624 ms | 74.787 ms | 834.992 ms | 3/3 |
| 20 | 80.389 ms | 170.847 ms | 843.954 ms | 3/3 |
| 40 | 182.628 ms | 242.590 ms | 1,047.558 ms | 3/3 |
| 80 | 197.045 ms | 396.281 ms | 934.105 ms | 3/3 |

The isolated write envelope therefore passes at 5 VUs and crosses the frozen p95
target between 5 and 10 VUs. Across S7 and all fifteen isolated write runs, 3,200
distinct Pool A users wrote successfully and no unexpected response occurred.

The read-only post-check found exactly 200 mixed-allocation rows, 3,000 isolated-
allocation rows, zero other Pool A rows, and 200 Pool B rows on database date
`2026-09-20`. Total sessions were exactly 1,461,400; uniqueness, fixture dates,
and canonical-row checks all passed.

- [Final P3 raw results](results/p3-final-2026-09-20.raw.json)
- [Final P3 summary](results/p3-final-2026-09-20.summary.json)
- [Final P3 database post-check](results/p3-final-2026-09-20.postcheck.json)
- [Final P3 manifest](results/p3-final-2026-09-20.manifest.json)

## 2026-09-20 — Pre-registered P4 bounded soak

Recorded after PERF-P3 acceptance and before any PERF-P4 request:

- Purpose: test whether the confirmed S4 sustainable point remains stable over time,
  without adding another broad capacity sweep.
- Workload: S4 leaderboard only, 5 constant VUs, 30 seconds of excluded warm-up,
  followed by 30 measured minutes.
- Windows: the measured interval is frozen as three consecutive 10-minute windows:
  opening, middle, and closing.
- Latency and errors: S4 p95 must remain at or below the existing 350 ms limit in
  every window and overall; unexpected responses must remain below 1%.
- Drift: closing p95 may be at most 1.25 times opening p95, and closing throughput
  must retain at least 80% of opening throughput.
- Environment evidence: retain task ARN, task definitions, immutable API and
  load-generator image digests, source commits, database date, and UTC start/end.
- Operational evidence: record task replacement or restart, CloudWatch application
  errors, ECS CPU and memory, plus Neon connection/utilization telemetry when
  available. Sustained CPU or memory at or above 80% is diagnostic, not a new
  pass/fail rule.
- Data/provider invariant: the soak is read-only, core row counts must remain
  unchanged, provider attempts and Anthropic calls must remain zero, and unavailable
  historical telemetry must be reported as a limitation rather than inferred.
- Source reset: the P3 write evidence is already preserved, and a verified repeat
  seed must restore zero current-date Pool A sessions before P4 token generation.
  This is required by the existing token-source safety contract and does not change
  the workload, thresholds, duration, or interpretation rules.

This is the complete formal P4 workload. No additional scenario, repetition, or
soak duration will be selected after seeing its result.

### Rejected pre-measurement task

The first P4 task exited before k6 started. It produced zero `PERF_RESULT` records
and no benchmark request. The token-fixture generator correctly rejected the
3,200 current-date Pool A sessions left by the completed P3 write experiment. This
is retained as a harness/precondition rejection, not a performance result. The retry
uses the same image, S4/5-VU load, 30-minute duration, and frozen acceptance rules
after the required verified repeat seed.

### P4 bounded soak completion

- The verified repeat seed restored the approved source before the retry: 8,100
  users, 365 ready characters, 1,458,200 sessions, zero current-date Pool A rows,
  200 current-date Pool B rows, and zero story attempts.
- The accepted Fargate task `0e466d7301274f03bc52bfc5fa86214f` used task
  definition `chinstein-p4-loadgen:1`, ran from `2026-09-20T12:35:52Z` through
  `13:06:56Z`, returned its single expected result, and exited with code `0`.
- The 30 measured minutes completed 54,554 expected S4 responses with zero
  unexpected responses, zero threshold events, and zero API application-error
  log events. Overall p50/p95 were 148.762/274.209 ms.

| Window | p50 | p95 | Completed expected requests/s |
| --- | ---: | ---: | ---: |
| Opening | 148.816 ms | 271.216 ms | 30.358 |
| Middle | 148.311 ms | 274.725 ms | 30.443 |
| Closing | 149.148 ms | 276.476 ms | 30.122 |

- Closing p95 grew 1.94% from opening, well inside the pre-registered 25% limit.
  Closing throughput retained 99.22% of opening, above the required 80%.
- Across 31 datapoints, ECS CPU averaged 7.78% and peaked at 13.07%; memory
  averaged 4.47% and peaked at 4.59%. No average datapoint reached 80%.
- The post-check found the database unchanged: date `2026-09-20`, 1,458,200
  sessions, zero current-date Pool A rows, 200 Pool B rows, 365 ready stories, and
  zero provider attempts.
- Historical Neon connection/utilization time series was unavailable through the
  staging CLI. The retained post-run snapshot showed five database connections,
  one active connection, and a configured maximum of 901; this snapshot is not
  presented as historical evidence.
- Classification: `stable`. The 5-VU S4 workload showed no meaningful latency or
  throughput degradation over the bounded 30-minute interval.
- After evidence collection, the staging API was intentionally returned to zero
  desired, zero running, and zero pending tasks.

Artifacts:

- [Raw P4 result](results/p4-soak-2026-09-20.raw.json)
- [Derived P4 summary](results/p4-soak-2026-09-20.summary.json)
- [P4 database post-check](results/p4-soak-2026-09-20.postcheck.json)
- [P4 environment manifest](results/p4-soak-2026-09-20.manifest.json)

## 2026-09-20 — Pre-registered P5 external-provider experiment

Recorded before changing the dedicated staging character or sending a P5 request:

- Live scope: one database-selected daily character, one synthetic Pool R identity,
  and one batch of five concurrent authenticated daily-character requests.
- Client behavior: all five requests are released together, use a 50-second timeout,
  and are never retried. One later request measures the persisted cache-hit path.
- Cost boundary: no more than one provider claim and $0.01 of measured provider
  usage; automatic recharge remains disabled. Usage is checked before any further
  live-provider action.
- Acceptance: all live responses are `200`; the database records exactly one
  attempt; the character finishes `ready` with source `claude`; the cache request
  does not change the attempt count; and matching CloudWatch logs contain no
  generation-failure or unusable-response event.
- Concurrency interpretation: null-story responses are valid losing-request
  fallbacks. Requests scheduled after persistence may see the saved story, so the
  database attempt count is the authoritative one-winner result.
- Controlled-only cases: concurrent fallback ordering, the 35-second application
  deadline, provider rejection, and provider rate limiting are exercised with
  injected dependencies. They will not be described as live staging failures.
- Cleanup: after evidence collection, drain the API and restore the approved
  synthetic fixture through the verified repeat-seed path.
