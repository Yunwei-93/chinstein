#!/bin/sh

set -eu
set -f

umask 077

SCENARIOS="${PERF_P2_SCENARIOS:-S0 S1 S2 S3 S4 S6 S5}"
LEVELS="${PERF_P2_LEVELS:-1 5}"
REPETITIONS="${PERF_P2_REPETITIONS:-1 2 3}"
RUN_FAILED=0

log_sweep_end() {
  exit_code="$1"
  trap - 0 INT TERM
  echo "PERF_SWEEP_FINISHED $(date -u +%Y-%m-%dT%H:%M:%SZ) exit_code=${exit_code}"
  exit "$exit_code"
}

trap 'log_sweep_end "$?"' 0
trap 'log_sweep_end 130' INT
trap 'log_sweep_end 143' TERM

echo "PERF_SWEEP_STARTED $(date -u +%Y-%m-%dT%H:%M:%SZ)"

for scenario in $SCENARIOS; do
  # Refresh once per scenario so every run starts with at least three hours of token life.
  node /app/perf/p2/token-fixture-cli.mjs \
    --generate-token-fixture \
    --confirm-aws-staging \
    --confirm-private-output

  for vus in $LEVELS; do
    for repetition in $REPETITIONS; do
      if PERF_P2_SCENARIO_ID="$scenario" \
        PERF_P2_VUS="$vus" \
        PERF_P2_REPETITION="$repetition" \
        k6 run /app/perf/p2/k6/scenario-run-runtime.js
      then
        :
      else
        echo "PERF_RUN_FAILED ${scenario} vu${vus} rep${repetition}"
        RUN_FAILED=1

        # Stop immediately during smoke so failed logins cannot contaminate the limiter window.
        if [ "${PERF_P2_FAIL_FAST:-0}" = "1" ]; then
          exit 1
        fi
      fi
    done
  done
done

exit "$RUN_FAILED"
