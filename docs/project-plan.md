# Chinstein Project Plan

Last updated: 2026-09-17

This plan separates the production application from the AWS staging environment.
Production remains on Vercel, Render, and Neon. Infrastructure, resilience, and
performance work is verified in staging before a separate production decision.

## Current status

| Stage | Scope | Status |
| --- | --- | --- |
| M0-M1.5 | Core application, JWT authentication, concurrent submission safety, and leaderboard | Complete |
| AWS-A0 | Docker/ECR deployment preparation (PR #9) | Complete |
| A1 | AWS IAM, Secrets Manager, and ECR | Complete |
| A2 | ECS Express Mode HTTPS deployment | Complete |
| A3 | Isolated Neon staging branch, schema migration, and 365-character seed | Complete |
| A4 | Vercel Preview to AWS ECS to Neon browser integration | Complete |
| A4.1 | Story-generation resilience | Complete, including disabled and live-provider staging acceptance |
| A5 | Logs, recovery runbook, rollback drill, and provider-cost review | Complete; resource cleanup is deferred until PERF finishes |
| PERF | Reproducible performance baseline and measured optimization | PERF-P0 frozen; PERF-P1 complete. The approved 8,100-user, 1,458,200-session, 365-character fixture passed the initial rollback/commit and the real repeat-seed rollback/confirmed commit, including fresh read-only post-commit verification. The first two local-only PERF-P2 checkpoints now freeze scenario, user-allocation, latency-threshold, response-classification, and secret-free token-fixture contracts with 21 passing offline tests. No PERF-P2 HTTP measurement has run, and ECS remains intentionally drained at 0/0/0. |

## Evidence collected through A5

The manual staging walkthrough and deployment checks have verified all of the following:

- the ECS health endpoint returns `200` and reaches PostgreSQL;
- the allowed Vercel Preview origin receives the expected CORS header;
- browser registration, login, authenticated reads, server-side grading, and
  persisted profile and leaderboard updates work through the staging stack;
- CloudWatch receives startup, graceful shutdown, and application error logs;
- the story-resilience implementation passed 56 automated tests across 8 files,
  followed by test type-checking and a production build;
- the repeatable schema migration added the attempt counter and terminal `failed` state;
- the commit-tagged `linux/amd64` image was stored in ECR and deployed as ECS task
  definition revision 6;
- revision 6 reached `COMPLETED` with 1 running task and 0 pending tasks;
- the task definition uses the expected immutable image and keeps runtime secrets
  separate from plain environment variables;
- with no Anthropic key, CloudWatch emits one startup warning rather than a new
  error for every request;
- opening an uncached character shows the fallback while the stroke order and quiz
  remain usable; and
- the same character remained `pending` with 0 attempts and no start time after
  that browser request, proving the disabled path did not claim the row;
- revision 6 was rolled back to the known-good revision 5 and then rolled forward
  to revision 6, with each rollout reaching `COMPLETED`, 1 running task, and 0 pending;
- health and exact-origin CORS checks passed on both sides of that drill;
- CloudWatch captured graceful `SIGTERM` handling during task replacement;
- revision 7 added the staging-only Anthropic secret without changing production;
- two live cold generations became `ready`, retained one attempt each, and recorded
  `story_source = 'claude'`;
- a repeated read left the current character at one attempt, proving a cache hit;
- the provider report recorded 679 input and 148 output tokens for the selected key
  and date range, an estimated cost of about $0.001419 at the then-current Haiku 4.5
  list price; and
- the experiment exposed the GMT date boundary when the daily character changed
  between the two controlled requests.

No production account or production database row was used for these checks. No
production endpoint or production secret was changed.

## A4.1 - story-generation resilience

Implementation branch: `improve/story-generation-resilience`

Merged in PR #10. The implementation and disabled-mode staging checks are complete.
The later A5 check also verified live provider generation and cache persistence.

| ID | Change | Verified result |
| --- | --- | --- |
| A4.1-1 | Add `isGenerationEnabled()` in the Claude module | A missing, empty, or whitespace-only key disables generation before any database claim |
| A4.1-2 | Emit one startup warning when generation is disabled | CloudWatch shows configuration state once per container start, not once per request |
| A4.1-3 | Add `story_attempts` and the `failed` state | The repeatable migration and database constraint test accept the new terminal state |
| A4.1-4 | Increment attempts in the atomic claim | Permission to call the provider consumes one attempt, including a later task crash |
| A4.1-5 | Cap a generation cycle at three claims | After three failed claims, later requests do not invoke the generator |
| A4.1-6 | Finalize normal failures as `pending` or `failed` | Rows below budget may retry; an exhausted row has an explicit terminal state |
| A4.1-7 | Reconcile stale claims | A stale claim below budget is reclaimed; an exhausted stale claim becomes `failed` |
| A4.1-8 | Pair claim finalization structurally | Unexpected generator rejection releases the claim instead of abandoning it |
| A4.1-9 | Add an overall generation deadline | The SDK request receives a 35-second abort signal; this bounds client waiting and retries, not necessarily provider billing already in progress |
| A4.1-10 | Validate words rather than character count | Accepted output is 35-80 words, no more than 600 characters, and not a refusal |
| A4.1-11 | Document targeted manual recovery | Operators can inspect and reset a confirmed failed character without an admin endpoint |

### A4.1 automated test evidence

All automated tests use mocks and make zero real Anthropic API calls.

- disabled generation leaves the state and attempt count unchanged;
- a controlled deferred generation allows only one concurrent request to generate;
- losing concurrent requests return the fallback before the winner is released;
- a usable result becomes `ready` and remains cached;
- a `null` result releases the claim and consumes exactly one attempt;
- three failed claims produce `failed`, and a fourth request does not invoke the generator;
- a stale claim below budget is reclaimed;
- a stale claim at the budget limit becomes `failed` without another provider call;
- SDK rejection, an overall deadline signal, unusable output, and unexpected
  generator rejection have explicit coverage; and
- PostgreSQL defaults and the story-status CHECK constraint have database-level coverage.

The concurrent fast-path test does not depend on wall-clock timing. It holds the
winning mock promise open, proves that the losing request has already returned,
and only then resolves the winner.

### Failed-story recovery runbook

First inspect failed rows:

```sql
SELECT id, character, story_status, story_attempts, story_started_at
  FROM characters
 WHERE story_status = 'failed'
 ORDER BY id;
```

After correcting the underlying key, provider, prompt, validation, or application
problem, reset one confirmed character by ID:

```sql
UPDATE characters
   SET story_status = 'pending',
       story_attempts = 0,
       story_started_at = NULL
 WHERE id = $1
   AND story_status = 'failed';
```

Use the affected-row count to confirm that exactly one intended row was changed.
There is deliberately no public recovery endpoint because the application does
not yet have an administrator authorization model.

## A5 closeout

Completed:

- [x] synchronize with the latest `main` and run local unit, integration,
  type-check, and build checks;
- [x] migrate the isolated Neon staging branch after verifying the sanitized target;
- [x] build and push a commit-tagged `linux/amd64` image;
- [x] deploy the immutable image as ECS task definition revision 6;
- [x] verify deployment completion, task count, image identity, health, and CORS;
- [x] verify disabled-mode startup logging and graceful shutdown logging;
- [x] verify the real browser fallback and the no-claim/no-attempt database invariant;
- [x] record the failed-story recovery procedure;
- [x] roll revision 6 back to revision 5 and verify deployment, health, and CORS;
- [x] roll forward to revision 6 and repeat the same checks;
- [x] add the staging-only Anthropic secret through revision 7;
- [x] make two bounded cold generations across the observed GMT date boundary;
- [x] verify `ready` rows, one attempt per character, cache persistence, CloudWatch,
  and provider token usage; and
- [x] keep automatic API credit reload disabled and retain staging resources only
  for the remaining performance phases.

The staging-only provider secret may remain attached for the separate low-volume
PERF-P5 experiment. The core benchmark must use synthetic `ready` stories and make
zero Anthropic calls. Remove the secret and clean up staging resources at PERF-P7.

PR #10 was merged before the final disabled-mode AWS acceptance was finished. The
acceptance passed, but future staging changes should restore the intended order:
deploy and verify the immutable candidate first, then approve a production-impacting
merge separately. A healthy staging task alone is not production authorization.

## PERF - performance work

The core service benchmark and the external-AI benchmark are separate experiments.
Mixing cold model generation into a sub-second API latency target would measure a
different system and make the result difficult to explain.

| Phase | Scope |
| --- | --- |
| PERF-P0 | Freeze scenarios, data volume, concurrency, p50/p95 targets, throughput, and error budget |
| PERF-P1 | Seed synthetic users and fixed-size synthetic stories; mark benchmark stories `ready` |
| PERF-P2 | Measure single-request and low-concurrency baselines |
| PERF-P3 | Load-test login, authenticated reads, leaderboard aggregation, and session writes |
| PERF-P4 | Run a bounded stability/soak test while observing ECS, CloudWatch, and Neon |
| PERF-P5 | Separately test one cold generation, concurrent claim suppression, timeout, rate limiting, and fallback |
| PERF-P6 | Choose optimizations only from measured evidence and then repeat the same scenarios |
| PERF-P7 | Publish the report and clean up staging resources after the final acceptance gate |

Main benchmark invariant:

> When all benchmark stories are `ready`, Anthropic call count is zero.

Estimated remaining time:

- baseline only: 2-4 hours;
- remaining PERF-P2 through PERF-P7 work with analysis and retesting: 9-20 hours.

## Safety and cost boundaries

- Do not put secrets, account IDs, database URLs, secret ARNs, or private hostnames in the repository.
- Verify a sanitized hostname and database branch before every staging migration.
- Do not use production users or production data in staging tests.
- Do not change Vercel Production or Render Production while testing staging.
- Keep live Anthropic testing small and controlled; use cached synthetic stories for the main load test.
- Keep automatic API credit reload disabled unless a deliberate budget is approved.
- Do not delete the staging service or database branch until performance work and final cleanup are complete.
