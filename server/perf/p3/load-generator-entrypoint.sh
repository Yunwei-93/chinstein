#!/bin/sh

set -eu
set -f

umask 077

SCENARIOS="${PERF_P3_SCENARIOS:-S0 S2 S3 S4 S6 S1}"
LEVELS_OVERRIDE="${PERF_P3_LEVELS:-}"
RUN_KIND="${PERF_P3_RUN_KIND:-initial}"
RUN_FAILED=0

case "$RUN_KIND" in
  initial | confirmation) ;;
  *)
    echo "PERF_P3_INVALID_RUN_KIND"
    exit 1
    ;;
esac

if [ "$RUN_KIND" = "confirmation" ] && [ -z "$LEVELS_OVERRIDE" ]; then
  echo "PERF_P3_CONFIRMATION_LEVELS_REQUIRED"
  exit 1
fi

levels_for_scenario() {
  if [ -n "$LEVELS_OVERRIDE" ]; then
    printf '%s\n' "$LEVELS_OVERRIDE"
    return
  fi

  case "$1" in
    S0 | S4) printf '%s\n' '1 2 5 10 20 40 80' ;;
    S1) printf '%s\n' '1 2 5 8' ;;
    S2 | S3 | S6) printf '%s\n' '5 10 20 40 80' ;;
    *)
      echo "PERF_P3_INVALID_SCENARIO $1"
      return 1
      ;;
  esac
}

log_sweep_end() {
  exit_code="$1"
  trap - 0 INT TERM
  echo "PERF_P3_SWEEP_FINISHED $(date -u +%Y-%m-%dT%H:%M:%SZ) exit_code=${exit_code}"
  exit "$exit_code"
}

trap 'log_sweep_end "$?"' 0
trap 'log_sweep_end 130' INT
trap 'log_sweep_end 143' TERM

echo "PERF_P3_SWEEP_STARTED $(date -u +%Y-%m-%dT%H:%M:%SZ) run_kind=${RUN_KIND}"

for scenario in $SCENARIOS; do
  node /app/perf/p2/token-fixture-cli.mjs \
    --generate-token-fixture \
    --confirm-aws-staging \
    --confirm-private-output

  levels=$(levels_for_scenario "$scenario")

  for vus in $levels; do
    if PERF_P3_SCENARIO_ID="$scenario" \
      PERF_P3_VUS="$vus" \
      PERF_P3_RUN_KIND="$RUN_KIND" \
      k6 run /app/perf/p3/k6/capacity-run-runtime.js
    then
      :
    else
      run_exit_code="$?"

      if [ "$run_exit_code" -eq 99 ]; then
        echo "PERF_P3_CAPACITY_THRESHOLD ${scenario} vu${vus} ${RUN_KIND}"
      else
        echo "PERF_RUN_FAILED ${scenario} vu${vus} ${RUN_KIND} exit_code=${run_exit_code}"
        RUN_FAILED=1

        if [ "${PERF_P3_FAIL_FAST:-0}" = "1" ]; then
          exit 1
        fi
      fi
    fi
  done
done

exit "$RUN_FAILED"
