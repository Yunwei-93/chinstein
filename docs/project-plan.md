# Chinstein Project Plan

Last updated: 2026-09-11

This plan separates the production application from the AWS staging environment.
Production remains on Vercel, Render, and Neon. New infrastructure, resilience,
and performance work is verified in staging before any production merge or
deployment decision.

## Current status

| Stage | Scope | Status |
| --- | --- | --- |
| M0-M1.5 | Core application, JWT authentication, concurrent submission safety, and leaderboard | Complete |
| AWS-A0 | Docker/ECR deployment preparation (PR #9) | Complete |
| A1 | AWS IAM, Secrets Manager, and ECR | Complete |
| A2 | ECS Express Mode HTTPS deployment | Complete |
| A3 | Isolated Neon staging branch, schema migration, and 365-character seed | Complete |
| A4 | Vercel Preview to AWS ECS to Neon browser integration | Complete |
| A4.1 | Story-generation resilience | Designed; implementation not started |
| A5 | Logs, rollback drill, runbook, and cleanup | In progress; about 50% |
| PERF | Reproducible performance baseline and measured optimization | Not started |

## Evidence collected for A4

The manual staging walkthrough has verified all of the following:

- the ECS health endpoint returns `200` and reaches PostgreSQL;
- the allowed Vercel Preview origin receives the expected CORS header;
- browser registration creates an isolated staging user;
- login and re-login issue and validate JWTs;
- authenticated profile, leaderboard, and daily-character reads succeed;
- a study-session submission is graded by the server;
- points, streak, learned-character count, badge, and leaderboard rank persist;
- CloudWatch receives container startup, shutdown, and application error logs;
- a missing Anthropic key degrades the story only and does not break the quiz.

No production account or production database row was used for this walkthrough.

## A4.1 - story-generation resilience

Target branch: `improve/story-generation-resilience`

Estimated focused time: 6-8 hours.

| ID | Change | Acceptance condition |
| --- | --- | --- |
| A4.1-1 | Add `isGenerationEnabled()` in the Claude module | A missing or whitespace-only key disables generation before any database claim |
| A4.1-2 | Emit one startup warning when generation is disabled | CloudWatch shows configuration state once per container start, not once per request |
| A4.1-3 | Add `story_attempts` and the `failed` state | Migration is repeatable and the status CHECK constraint accepts the new terminal state |
| A4.1-4 | Increment attempts in the atomic claim | Receiving permission to call the provider consumes one attempt, including a later task crash |
| A4.1-5 | Cap a generation cycle at three claims | A fourth request does not call Anthropic |
| A4.1-6 | Finalize normal failures as `pending` or `failed` | Failed rows have an explicit operational meaning instead of remaining permanently `generating` |
| A4.1-7 | Reconcile stale claims | A stale claim below budget can be reclaimed; an exhausted stale claim becomes `failed` |
| A4.1-8 | Pair claim finalization structurally | An unexpected exception cannot silently abandon a claim until the stale timeout |
| A4.1-9 | Add an overall generation deadline | SDK retries cannot make the request wait beyond the application deadline |
| A4.1-10 | Validate words rather than character count | Validation matches the 40-70-word prompt, with a documented tolerance |
| A4.1-11 | Document targeted manual recovery | Operators can inspect and reset a confirmed failed character without adding an admin endpoint |

### A4.1 test protocol

All automated tests use mocks and must make zero real Anthropic API calls.

- With generation disabled, claim count and attempt count remain unchanged.
- A controlled deferred generation owns the first claim.
- Later concurrent requests return the fallback before the deferred result is released.
- A concurrent cold-miss wave invokes the generator exactly once.
- A usable result becomes `ready` and remains cached.
- A `null` result releases the claim and consumes exactly one attempt.
- Three failed claims produce `failed`; a fourth request does not invoke the generator.
- A stale claim below budget is reclaimed exactly once.
- A stale claim at the budget limit becomes `failed` without another provider call.
- SDK rejection, overall abort, unusable output, and an unexpected generator rejection have explicit tests.

Wall-clock comparisons are not used for the concurrent fast-path test. The test
holds the winning mock promise open, proves that the losing requests have already
returned, and only then resolves the winner.

### Recovery runbook requirement

The runbook must first list failed rows and then reset only a confirmed target.
A bulk reset may be documented separately.

The reset clears `story_started_at`, sets `story_status` to `pending`, and starts a
new attempt cycle at zero. It must only be used after the key, prompt, provider,
or application failure has been corrected.

## Staging delivery gate for A4.1

1. Start the branch from the latest `main` after PR #9.
2. Run unit, integration, type-check, and build checks locally.
3. Build an image tagged with the exact commit SHA.
4. Deploy that immutable image to AWS staging without merging to `main`.
5. Keep story generation disabled for the first smoke test.
6. Add the staging-only Anthropic secret through AWS Secrets Manager.
7. Make only a small number of live cold-generation requests.
8. Verify the cached follow-up path, CloudWatch logs, and Anthropic usage report.
9. Complete the rollback drill before considering a production merge.

Merging to `main` is a separate approval gate because it can trigger the existing
Render production deployment. A successful staging test does not authorize that
merge by itself.

## A5 - operations and closeout

| Work item | Status |
| --- | --- |
| CloudWatch log delivery | Complete |
| Staging browser-flow log review | Complete |
| Missing story-generation configuration identified | Complete |
| Roll back the A4.1 ECS revision to the known-good revision | Pending A4.1 deployment |
| Roll forward again and repeat the health check | Pending |
| Record rollback and failed-story recovery procedures | Pending |
| Delete staging resources | Deferred until all performance work is complete |

Estimated remaining A5 time: 1-2 hours, excluding resource-retention time.

## PERF - performance work

The core service benchmark and the external-AI benchmark are separate experiments.
Mixing cold LLM generation into a sub-second API latency target would measure a
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

Estimated time:

- baseline only: 2-4 hours;
- complete performance phase with analysis and retesting: 12-20 hours;
- A4.1, remaining A5, and complete performance phase: approximately 19-30 hours.

## Safety and cost boundaries

- Do not put secrets, account IDs, database URLs, or secret ARNs in the repository.
- Do not use production users or production data in staging tests.
- Do not change Vercel Production or Render Production while testing staging.
- Keep the Anthropic test small and controlled; use cached stories for the main load test.
- Keep automatic API credit reload disabled unless a deliberate budget is approved.
- Do not delete the staging service or database branch until performance work and rollback evidence are complete.
