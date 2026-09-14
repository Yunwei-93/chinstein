# AWS Staging Learning Notes

Last updated: 2026-09-14

These notes explain the purpose of the staging deployment and the commands used
to inspect it. They intentionally omit secrets, account IDs, secret ARNs, and
temporary database credentials.

## 1. Current architecture

Production and staging are separate:

```text
Production
Browser -> Vercel Production -> Render API -> Neon production branch

AWS staging
Browser -> Vercel Preview -> ECS Express API -> Neon staging branch
```

Neon is the database in both diagrams. It is not where the Express server runs.
The staging application feels faster mainly because ECS keeps one task running,
whereas the Render free-tier production API may sleep when idle.

## 2. What each AWS service does

| Service | Role in this project |
| --- | --- |
| ECR | Stores immutable Docker images for the API |
| ECS Express Mode | Runs the API container on Fargate and provides an HTTPS application URL |
| IAM execution role | Lets ECS pull the image, write logs, and read only the approved runtime secret |
| Secrets Manager | Stores `DATABASE_URL`, `JWT_SECRET`, and later the staging-only Anthropic key |
| CloudWatch | Stores container logs and exposes operational metrics |
| Application Load Balancer | Terminates HTTPS and routes traffic to the running ECS task |
| Neon staging branch | Isolates schema and test data from production |

The task role is intentionally empty because the application does not call AWS
APIs after startup. The execution role is used by ECS infrastructure, not by
normal application code.

## 3. Docker image, task definition, and service

These terms describe different layers:

- A Docker image is the packaged API program.
- ECR is the image registry.
- A task definition revision records the image, port, environment variables,
  secrets, logging, CPU, and memory.
- A task is one running copy of that definition.
- A service keeps the desired number of tasks running and replaces them during a deployment.

An image tag should identify the Git commit used to build it. ECS also resolves
the image to a digest, which prevents the same deployment from silently changing
when a tag is reused.

Current verified checkpoint:

- commit `b33785f19178` was built for `linux/amd64` and pushed with the commit as its tag;
- ECS task definition revision 6 references the resulting immutable image digest;
- the service rollout reached `COMPLETED` with 1 running task and 0 pending tasks; and
- the task definition exposes only `PORT` and `CORS_ORIGIN` as plain configuration,
  while `DATABASE_URL` and `JWT_SECRET` are injected as runtime secrets.

ECR storing a new image does not update a running service by itself. The deployment
changes only when a new task-definition revision selects the image and ECS replaces
the task.

## 4. Health checks

`GET /api/health` performs a small `SELECT NOW()` query. A `200` response therefore
confirms both of these components:

1. the Express process is accepting requests;
2. the process can connect to PostgreSQL.

It does not prove that registration, JWT, protected endpoints, or writes work.
Those require the separate browser integration walkthrough recorded in the
project plan.

## 5. CORS

CORS is a browser security rule based on origins, not AWS geographic regions.
An origin consists of the scheme, hostname, and port.

For staging, the API permits the selected Vercel Preview origin. The response:

```text
access-control-allow-origin: https://preview.example.com
vary: Origin
```

means the API recognized that browser origin. It does not redirect traffic or
connect Vercel to AWS by itself. `VITE_API_URL` tells the frontend where the API
is; `CORS_ORIGIN` tells the API which frontend origin a browser may use.

## 6. Vercel environment scopes

`VITE_API_URL` is a build-time Vite variable.

- Preview points to the AWS staging API.
- Production remains pointed to the production API.
- Changing a Vercel variable requires a new deployment before the compiled
  frontend contains the new value.

Keeping separate Preview and Production values prevents a staging experiment
from silently redirecting real users.

## 7. CloudWatch

Application code writes to standard output with calls such as `console.log()`
and `console.error()`. ECS collects that output and sends it to CloudWatch:

```text
application log -> container output -> ECS log driver -> CloudWatch log group
```

CloudWatch does not automatically invent HTTP request logs. If the application
only logs startup and errors, a quiet period can legitimately produce no output.

The following command reads recent logs. It is read-only and does not restart or
modify the service:

```bash
aws logs tail "/aws/ecs/default/<service-log-group>" \
  --since 30m \
  --format short \
  --region us-east-2 \
  --profile chinstein \
  --no-cli-pager
```

Parameter meanings:

- `aws logs tail` reads events from a CloudWatch log group.
- the quoted path identifies the service log group;
- `--since 30m` limits the time window;
- `--format short` removes verbose metadata;
- `--region us-east-2` selects the Ohio AWS region;
- `--profile chinstein` selects the local AWS CLI identity;
- `--no-cli-pager` prints directly instead of opening a pager;
- a trailing `\` means the same shell command continues on the next line.

An empty result means no event was written in that window. It is not itself an error.

Revision 6 produced the expected disabled-mode startup event:

```text
[startup] story generation disabled — ANTHROPIC_API_KEY not set
```

It was emitted once when the container started. A later rolling replacement also
showed `SIGTERM received, shutting down` followed by `closed cleanly`, confirming
that ECS termination reached the application's graceful-shutdown path.

## 8. Inspecting an ECS deployment

The following read-only command checks whether the service has one completed
primary deployment and no pending replacement task:

```bash
aws ecs describe-services \
  --cluster default \
  --services chinstein-api-staging \
  --query 'services[0].{Status:status,Running:runningCount,Pending:pendingCount,Deployments:deployments[].{Status:status,TaskDefinition:taskDefinition,Running:runningCount,Pending:pendingCount,RolloutState:rolloutState}}' \
  --output json \
  --region us-east-2 \
  --profile chinstein \
  --no-cli-pager
```

Expected meanings:

- `Status: ACTIVE`: ECS still manages the service;
- `Running: 1`: the desired API task is running;
- `Pending: 0`: no replacement task is waiting to start;
- `Status: PRIMARY`: this is the active deployment;
- `RolloutState: COMPLETED`: ECS finished replacing the task successfully.

ECS Express Mode may leave the top-level task-definition field empty while the
deployment entry contains the concrete revision. The deployment entry is the
useful value for this check.

## 9. AWS CLI login sessions

The AWS CLI uses temporary credentials for this profile. Letting the session
expire is safe and does not stop ECS. Reauthentication changes only the local
CLI session; it does not redeploy the application.

If a read command reports that the session expired, authenticate again:

```bash
aws login --profile chinstein
```

The command opens the AWS login flow for the named profile. Do not paste AWS
credentials, database URLs, JWT secrets, or API keys into documentation or chat.

## 10. Staging database migration safety

An environment filename is a label, not proof of which database it contains. Before
applying the A4.1 schema, the existing production-named file was inspected without
printing credentials and was found to point at a different Neon host. A separate,
Git-ignored staging environment file was then created from the Neon `aws-staging`
branch connection string.

The safe sequence is:

1. parse the connection URL locally and print only the hostname and database name;
2. compare the hostname with the selected Neon branch in the dashboard;
3. keep the full connection string out of terminal history, screenshots, chat, and Git;
4. run the migration with the staging environment file named explicitly; and
5. verify the resulting columns and CHECK constraint before deploying application code.

The migration completed with `Schema applied.` and the schema was verified before
the revision 6 deployment. The PostgreSQL driver also emitted a forward-looking SSL
compatibility warning: the current dependency treats `sslmode=require` as strict
certificate verification, while a future major version will change that behavior.
Using an explicit `sslmode=verify-full` is a future configuration cleanup, not a
failure of this migration.

## 11. Story-generation state machine

A4.1 now implements this state machine:

```text
generation disabled -> fallback without a claim
pending -> atomic claim and attempts + 1 -> generating
usable result -> ready, preserving attempts for operations
failure below budget -> pending
failure at budget -> failed
stale generating below budget -> eligible for one new claim
stale generating at budget -> failed
```

Cached stories are checked first, so they remain available even when generation is
disabled. When the key is absent, the capability guard returns the fallback before
the database claim. When generation is enabled, receiving the atomic claim increments
`story_attempts`; this means even a later process crash consumes one attempt. The
maximum is three claims per generation cycle.

The claim and release paths are structurally paired so an unexpected generator
exception does not leave a fresh orphaned claim. A normal failure returns to `pending`
while budget remains and becomes `failed` after the third attempt. A stale
`generating` row below budget can be reclaimed, while an exhausted stale row is
reconciled to `failed` without another provider call.

The overall abort limits how long the application waits and whether it performs
another retry. It cannot guarantee that provider work already started will not
be billed.

Generated text is accepted only when it contains 35-80 words, is no more than 600
characters, and is not a refusal. This aligns the validator with the 40-70-word
prompt while allowing a small tolerance.

### Disabled-mode staging evidence

The staging task intentionally had no Anthropic key for the first smoke test. The
browser opened an uncached daily character and displayed the fallback message while
the stroke animation and quiz remained usable. Database inspection before and after
the request showed the row still had:

```text
story present: no
status: pending
attempts: 0
started at: null
```

This is direct evidence that the missing-key path did not claim the row or consume
the retry budget. It is not evidence of a live provider call: no real Anthropic
generation or cache-write acceptance test has been run yet.

### Manual recovery

First inspect failed rows:

```sql
SELECT id, character, story_status, story_attempts, story_started_at
  FROM characters
 WHERE story_status = 'failed'
 ORDER BY id;
```

Only after correcting the root cause, reset one confirmed target:

```sql
UPDATE characters
   SET story_status = 'pending',
       story_attempts = 0,
       story_started_at = NULL
 WHERE id = $1
   AND story_status = 'failed';
```

Confirm that exactly one intended row changed. Recovery remains a direct operator
action rather than a public API because there is no administrator authorization
model yet.

## 12. Performance-test separation

The core benchmark uses fixed-size synthetic stories already marked `ready`.
This stabilizes response size and requires zero Anthropic calls.

The external-AI experiment is deliberately small and separately reports:

- cold-generation latency;
- one-winner behavior during a concurrent cache miss;
- fallback latency for the losing requests;
- overall timeout behavior;
- rate-limit and provider-error behavior;
- number of provider calls and estimated cost.

This separation keeps an external seconds-scale dependency out of the core
sub-second API latency target.

## 13. Safety checklist

- Confirm the AWS region and profile before any write command.
- Distinguish read-only inspection from deployment or deletion.
- Use only staging users and synthetic data.
- Keep secrets in Secrets Manager and out of screenshots, commands, and Git.
- Use immutable commit-tagged images.
- Verify health, deployment state, logs, and browser behavior after every update.
- Treat a production-impacting merge as a separate decision from a healthy staging rollout.
- PR #10 was merged before final disabled-mode staging acceptance; that acceptance
  passed, but future changes should restore the intended verify-before-merge order.
- Do not delete staging resources until rollback and performance evidence are complete.
