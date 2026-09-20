# Chinstein Performance Evaluation Report

Date: 2026-09-20
Environment: isolated AWS staging in `us-east-2` with Neon PostgreSQL
Status: accepted measurement, optimization, reporting, and safe staging cleanup complete

## Executive conclusion

The evaluation completed the frozen baseline, capacity, mixed-load, write,
stability, external-provider, and optimization experiments. Across the accepted
k6 result sets, 1,501,789 measured requests completed with zero unexpected
responses. The workload used 8,100 synthetic users, 365 synthetic-ready stories,
and 1,458,200 canonical study sessions on a 512-CPU-unit, 1,024-MiB ECS API task.

The original performance hypothesis was wrong in a useful way. Per-user profile
queries were inexpensive; the dominant read bottleneck was the leaderboard's
request-time aggregation of all 1.46 million session rows. A reversible covering
index experiment did not change the PostgreSQL plan and improved median execution
time by only 1.82%, so it was rejected. Replacing the full-session aggregate with
an 8,100-row transactionally maintained rollup produced the attributable result:

| S4 leaderboard at 5 VUs | Baseline | Optimized | Change |
| --- | ---: | ---: | ---: |
| p50 | 152.417 ms | 19.972 ms | -86.90% |
| p95 | 284.895 ms | 37.217 ms | -86.94% |
| completed throughput | 28.975/s | 195.850/s | +575.93% |

The same improvement survived mixed load: S4 p95 changed from 281.768 ms to
39.005 ms while the fixed window completed 22,714 reads instead of 3,497. The
optimization is accepted because the benefit is repeatable, order-of-magnitude,
and paired with zero rollup drift before and after measurement.

The result is not presented as cost-free. S6 conflict p95 increased 7.81%, mixed
S5 write p95 increased 39.41%, and one optimized isolated 5-VU write repetition
was a 197.384 ms outlier. Isolated S5 medians did not show a consistent regression,
but every adverse observation remains part of the accepted record.

## Method and validity controls

- Scenario contracts, expected statuses, p95 thresholds, error budget, warm-up,
  measured windows, load ladders, and confirmation rules were frozen before the
  corresponding traffic.
- Read/login/conflict capacity used constant-VU, closed-loop traffic. Finite first
  writes used distinct users so the uniqueness constraint was not bypassed.
- Warm-up and measured samples were separated with metric tags. Machine-readable
  summaries were emitted as bounded CloudWatch log events.
- Immutable API and load-generator image digests, task definitions, database date,
  task IDs, and source commits were retained in phase manifests without secrets,
  account IDs, database URLs, or private hostnames.
- Database post-checks ran read-only. Write experiments verified exact user
  allocations; the optimized runs additionally compared every rollup user, total,
  and session count with the authoritative session aggregate.
- Capacity boundaries are intervals. A level failed on p95, at least 1% unexpected
  responses, instability, or less than 20% throughput improvement on an exact VU
  doubling. Confirmation disagreement was resolved conservatively.

## P2 low-concurrency baseline

P2 completed 42 scenario/load/repetition combinations. Its 222,689 measured
requests and 332,464 total attempted requests contained zero unexpected responses.
The table reports the median of three repetitions.

| Scenario | Endpoint behavior | p50 @ 1 VU | p95 @ 1 VU | p50 @ 5 VUs | p95 @ 5 VUs |
| --- | --- | ---: | ---: | ---: | ---: |
| S0 | health plus database clock | 4.628 ms | 6.316 ms | 4.169 ms | 66.798 ms |
| S1 | password login | 118.162 ms | 169.258 ms | 698.318 ms | 991.518 ms |
| S2 | daily character | 11.346 ms | 18.300 ms | 12.339 ms | 55.386 ms |
| S3 | current user/profile | 5.503 ms | 7.580 ms | 7.279 ms | 79.990 ms |
| S4 | leaderboard | 99.272 ms | 108.856 ms | 150.230 ms | 281.619 ms |
| S5 | first successful session write | 13.302 ms | 15.360 ms | 23.741 ms | 34.660 ms |
| S6 | expected duplicate conflict | 28.624 ms | 48.211 ms | 98.121 ms | 170.120 ms |

The 4.628 ms S0 median showed that regional HTTP and database reachability did not
dominate endpoint differences. S3 was also inexpensive, falsifying the expectation
that the per-user profile query would be the main bottleneck. S4 and the bcrypt
login path were the clear expensive operations; login cost was retained as a
security tradeoff rather than "optimized" by lowering bcrypt work.

## P3 capacity and mixed/write behavior

The initial and confirmation ladders produced 45 timed results, 962,393 measured
requests, and zero unexpected responses.

| Scenario | Confirmed capacity interval | Decisive observation |
| --- | --- | --- |
| S0 health | 2-5 VUs | p95 exceeded 50 ms at 5 VUs |
| S1 login | 1-2 VUs | doubling reduced rather than increased throughput |
| S2 daily character | 5-10 VUs | 5-to-10 throughput growth stayed below 20% |
| S3 current user | below 5 VUs, not localized | first configured level exceeded p95 limit |
| S4 leaderboard | 5-10 VUs | p95 and throughput rules failed at 10 VUs |
| S6 expected conflict | below 5 VUs, not localized | first configured level exceeded p95 limit |

The separate S7 mixture completed 3,497 S4 reads and 200 successful writes with
zero unexpected responses and no dropped write iteration. Read p95 was 281.768 ms,
essentially unchanged from the isolated 5-VU value. Write p95 was 52.440 ms, 2.440
ms above its 50 ms target; this is a measured tail result, not a failed harness.

The finite S5 envelope completed 3,000 additional successful writes. Median p95 was
46.526, 74.787, 170.847, 242.590, and 396.281 ms at 5/10/20/40/80 VUs. Only the
5-VU level remained below the 50 ms target.

## P4 bounded stability

The accepted soak ran S4 at 5 VUs for 30 measured minutes after a 30-second warm-up.
All 54,554 measured requests were expected. Overall p50/p95 were 148.762/274.209 ms.

| Window | p50 | p95 | completed/s |
| --- | ---: | ---: | ---: |
| opening | 148.816 ms | 271.216 ms | 30.358 |
| middle | 148.311 ms | 274.725 ms | 30.443 |
| closing | 149.148 ms | 276.476 ms | 30.122 |

Closing p95 grew only 1.94% and throughput retained 99.22% of its opening value.
ECS CPU averaged 7.78% and peaked at 13.07%; memory averaged 4.47% and peaked at
4.59%. No application-error event was found. The soak is classified `stable`.

## P5 external-provider boundary

Five simultaneous authenticated requests produced one generation winner and four
approved fallback responses, all with HTTP 200. The winner completed in 1,623.151
ms; fallbacks completed in 245.405-330.580 ms. The database recorded exactly one
claim and one attempt. A subsequent cache hit completed in 37.745 ms without
increasing attempts.

The provider console recorded one successful call, 342 input tokens, 69 output
tokens, 1.17 seconds of provider latency, and an estimated cost of $0.000687.
Automatic recharge remained disabled. This establishes bounded correctness and
cost, not a provider-capacity or provider-availability claim.

## P6 diagnosis and optimization

The baseline `EXPLAIN (ANALYZE, BUFFERS)` attributed nearly all S4 query time to
the parallel scan and aggregation of 1,458,200 `study_sessions` rows; ranking and
sorting 8,100 users took only milliseconds. The temporary covering index on
`(user_id) INCLUDE (points)` was not selected by PostgreSQL. Median execution moved
from 451.352 ms to 443.119 ms, the same O(session rows) plan remained, and the
transaction was rolled back.

The selected change introduced `leaderboard_scores`, keyed by user with total points
and session count. Session creation inserts the authoritative session and upserts
the rollup in one data-modifying SQL statement. Bulk seeding rebuilds and analyzes
the rollup once. A full-outer-join verification detects missing users or mismatched
points/session counts.

The formal optimized retest completed 54,807 measured requests with zero unexpected
responses. Besides the primary S4 result:

- Mixed S4 p95 improved 86.16%, from 281.768 ms to 39.005 ms.
- S6 p95 changed from 167.510 ms to 180.597 ms (+7.81%) and throughput changed
  from 50.083/s to 44.925/s (-10.30%).
- Mixed S5 p50 changed only +1.47%, while p95 changed from 52.440 ms to 73.108 ms
  (+39.41%) under much higher realized read throughput.
- Isolated S5 median-p95 changes were -2.88%, -7.69%, -20.07%, -15.13%, and
  +0.21% across 5/10/20/40/80 VUs, showing no consistent isolated-write regression.
- Exactly 3,200 optimized writes were observed. Authoritative and rollup session
  counts both ended at 1,461,400 with zero drift.

## Optimized S4 capacity extension

The separately pre-registered extension ran only S4 through
`1 -> 2 -> 5 -> 10 -> 20 -> 40 -> 80` VUs and confirmed 5/10 VUs once. It contains
200,649 measured requests and zero unexpected responses.

The conservative composite boundary remained `5-10 VUs`: initial 5-to-10 throughput
grew only 0.90%, and confirmation grew 14.19%, both below the frozen 20% rule.
This does not mean the optimization lacked capacity benefit. Initial 5-VU throughput
rose from 30.000/s to 222.675/s, and confirmation throughput rose from 28.975/s to
189.083/s. Optimized 10-VU p95 was 80.581/83.790 ms instead of the baseline
533.069/525.197 ms. In the initial optimized ladder, p95 stayed below 350 ms through
40 VUs and first crossed it at 80 VUs. Thus the composite interval stayed fixed
because throughput saturated, while useful throughput increased sharply and the
latency-threshold crossing moved from 5-10 to an initial observation of 40-80 VUs.

## Rejected and non-result executions

- The first P4 task exited before k6 and produced zero result/request because the
  token-source guard found Pool A writes left by P3. It is retained as a successful
  fail-closed precondition check, not a performance result. The fixture was reset
  and the unchanged soak was rerun.
- A P6 migration client timed out locally after five seconds. Fresh read-only
  verification proved the server transaction had committed completely with 8,100
  rollup rows and zero drift, so the migration was not retried and the timeout was
  not classified as a database rollback.
- A deployment wrapper rejected its final expected service state after the new API
  was already healthy because it expected staging to be drained. Independent ECS,
  image, and HTTPS checks verified the deployment; no measurement used an uncertain
  deployment.
- The first generic post-P5 reseed stopped before writing because the live-generated
  row correctly violated synthetic ownership. One guarded row restoration preceded
  the full verified reseed. Neither stopped operation is treated as load evidence.

## Limitations and deferred work

- Results apply to one staging topology, one region, one 0.5-vCPU/1-GiB API task,
  one Neon branch, this fixed dataset, and the recorded closed-loop workloads. They
  are not a universal production-capacity claim.
- S3 and S6 crossed their p95 limits at the first configured 5-VU P3 level, so their
  capacity knees are known only to be below 5 VUs.
- S1 measures intentional bcrypt work. Lowering its cost factor would trade security
  for latency and was not selected.
- Historical Neon utilization telemetry was unavailable for P4. The retained
  post-run connection snapshot is not represented as a historical time series.
- The P5 live experiment used one provider call. Deadline, rate-limit, provider
  error, and stale-claim behavior are supported by controlled tests, not claimed as
  observed live-provider incidents.
- S6 conflict cost and mixed S5 tail behavior merit separate diagnosis if future
  traffic makes them important. They do not justify changing the accepted S4
  rollup result.
- The S3 payload still returns a learned-character ID array when the current client
  uses its length. Replacing it with a count is a valid payload optimization but was
  intentionally kept outside the one-variable P6 experiment.

## Acceptance decision

The measurement is accepted and the leaderboard rollup is retained. It changes the
dominant algorithmic work, preserves leaderboard semantics, keeps session and score
updates atomic, passes the application regression suite, and maintains zero database
drift. The report does not claim that every endpoint meets every target or that the
composite S4 knee moved; it claims the measured latency and throughput improvement,
the preserved correctness invariants, and the recorded costs above.

PERF-P7 completed on 2026-09-20. The staging API was drained to zero desired,
running, and pending tasks, with zero running tasks left in the cluster. The current
runtime-secret version now retains only the database URL and JWT secret; the
temporary performance login password and Anthropic key are absent. The database
branch, ECR images, CloudWatch logs, ECS service definition, and task definitions
were intentionally retained as evidence and recovery resources. No production
resource changed.

This operational cleanup does not claim provider-account revocation or destruction
of historical Secrets Manager versions. The Anthropic key must be revoked separately
in the provider console if permanent credential invalidation is required. Likewise,
the retained historical task definition is evidence, not a restart-ready deployment,
because it still describes the former provider-secret reference.

## Evidence index

- [Frozen protocol](performance-test-protocol.md)
- [Chronological measurement log](measurement-log.en.md)
- [P2 baseline summary](results/p2-baseline-2026-09-19.summary.json)
- [P3 confirmed capacity summary](results/p3-capacity-2026-09-19.summary.json)
- [P3 mixed/write summary](results/p3-final-2026-09-20.summary.json)
- [P4 soak summary](results/p4-soak-2026-09-20.summary.json)
- [P5 provider summary](results/p5-provider-2026-09-20.summary.json)
- [P6 covering-index diagnostic](results/p6-covering-index-diagnostic-2026-09-20.summary.json)
- [P6 optimized comparison](results/p6-leaderboard-2026-09-20.summary.json)
- [Optimized S4 capacity extension](results/p6-s4-capacity-extension-2026-09-20.summary.json)
- [P7 sanitized cleanup state](results/p7-cleanup-2026-09-20.json)

Each accepted cloud phase also retains its raw result, post-check, and sanitized
environment manifest under [`docs/perf/results`](results/).
