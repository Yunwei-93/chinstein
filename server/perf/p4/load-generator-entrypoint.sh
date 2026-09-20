#!/bin/sh

set -eu
set -f

umask 077

log_soak_end() {
  exit_code="$1"
  trap - 0 INT TERM
  echo "PERF_P4_SOAK_FINISHED $(date -u +%Y-%m-%dT%H:%M:%SZ) exit_code=${exit_code}"
  exit "$exit_code"
}

trap 'log_soak_end "$?"' 0
trap 'log_soak_end 130' INT
trap 'log_soak_end 143' TERM

echo "PERF_P4_SOAK_STARTED $(date -u +%Y-%m-%dT%H:%M:%SZ) scenario=S4 vus=5 measured_seconds=1800"

node /app/perf/p2/token-fixture-cli.mjs \
  --generate-token-fixture \
  --confirm-aws-staging \
  --confirm-private-output

if k6 run /app/perf/p4/k6/soak-run-runtime.js; then
  exit 0
else
  run_exit_code="$?"
fi

if [ "$run_exit_code" -eq 99 ]; then
  echo 'PERF_P4_SOAK_THRESHOLD S4 vu5'
  exit 0
fi

echo "PERF_RUN_FAILED P4 S4 vu5 exit_code=${run_exit_code}"
exit "$run_exit_code"
