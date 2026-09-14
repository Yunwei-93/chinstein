# Chinstein Project Plan

Last updated: 2026-09-14

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
| A4.1 | Story-generation resilience | Implementation merged; disabled-mode staging acceptance complete |
| A5 | Logs, recovery runbook, rollback drill, and cleanup | In progress; rollback and roll-forward drill remain |
| PERF | Reproducible performance baseline and measured optimization | Not started |

## Evidence collected through A4.1

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
  that browser request, proving the disabled path did not claim the row.

No production account or production database row was used for these checks. No
real Anthropic request has been made as part of A4.1 acceptance yet.

## A4.1 - story-generation resilience

Implementation branch: `improve/story-generation-resilience`

Merged in PR #10. The implementation and disabled-mode staging checks are complete.
Live provider and cache behavior remain a small, separate staging acceptance step.

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

## Remaining staging acceptance and A5 closeout

Completed:

- [x] synchronize with the latest `main` and run local unit, integration,
  type-check, and build checks;
- [x] migrate the isolated Neon staging branch after verifying the sanitized target;
- [x] build and push a commit-tagged `linux/amd64` image;
- [x] deploy the immutable image as ECS task definition revision 6;
- [x] verify deployment completion, task count, image identity, health, and CORS;
- [x] verify disabled-mode startup logging and graceful shutdown logging;
- [x] verify the real browser fallback and the no-claim/no-attempt database invariant; and
- [x] record the failed-story recovery procedure.

Remaining:

- [ ] create and attach a staging-only Anthropic secret without changing production;
- [ ] make only a few live cold-generation requests;
- [ ] verify the saved `ready` story, cache-hit path, CloudWatch output, and provider usage;
- [ ] remove or disable the staging-only provider secret after the bounded experiment if desired;
- [ ] roll revision 6 back to the known-good revision 5 and repeat health/CORS checks;
- [ ] roll forward to revision 6 and repeat the same checks; and
- [ ] retain staging resources until performance evidence is complete, then clean them up.

PR #10 was merged before the final disabled-mode AWS acceptance was finished. The
acceptance passed, but future staging changes should restore the intended order:
deploy and verify the immutable candidate first, then approve a production-impacting
merge separately. A healthy staging task alone is not production authorization.

Estimated remaining A5 time: about 1-2 focused hours, excluding resource-retention time.

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
- complete performance phase with analysis and retesting: 12-20 hours; and
- remaining A5 plus complete performance work: approximately 13-22 hours.

## Safety and cost boundaries

- Do not put secrets, account IDs, database URLs, secret ARNs, or private hostnames in the repository.
- Verify a sanitized hostname and database branch before every staging migration.
- Do not use production users or production data in staging tests.
- Do not change Vercel Production or Render Production while testing staging.
- Keep live Anthropic testing small and controlled; use cached synthetic stories for the main load test.
- Keep automatic API credit reload disabled unless a deliberate budget is approved.
- Do not delete the staging service or database branch until performance work and rollback evidence are complete.
