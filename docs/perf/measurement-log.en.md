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
- API image digest and source commit: capture before the formal baseline sweep
- Post-run database date: verify before treating any formal sweep as valid

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
- The API image digest and source commit were not yet joined to this run record.

### Deliberately deferred

- No full 42-combination sweep was started.
- Scenarios `S2`, `S4`, `S5`, and `S6` were not exercised.
- The 5-VU level and three-repetition median calculation were not exercised.
- No code optimization was selected from smoke-test data.

### Next decision

Capture the complete API deployment fingerprint and database date, then run the formal P2 sweep. Use three repetitions per scenario and load level, calculate medians, and select optimization work only from those baseline measurements.
