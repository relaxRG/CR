#!/usr/bin/env bash
set -euo pipefail

: "${ANDROID_BENCHMARK_MODULE:=:macrobenchmark}"
: "${ANDROID_BENCHMARK_TASK:=connectedCheck}"
: "${PERFORMANCE_BASELINE:?必须提供 PERFORMANCE_BASELINE}"
: "${ANDROID_METRICS_NORMALIZER:?必须提供 ANDROID_METRICS_NORMALIZER，用于将 Macrobenchmark JSON 归一化}"

if ! command -v adb >/dev/null 2>&1; then
  echo "未找到 adb；Android 性能 CI 必须连接受控物理设备。" >&2
  exit 2
fi

DEVICE_COUNT="$(adb devices | awk 'NR > 1 && $2 == "device" { count += 1 } END { print count + 0 }')"
if [[ "$DEVICE_COUNT" -ne 1 ]]; then
  echo "Android 性能 CI 必须恰好连接一台受控物理设备，当前为 ${DEVICE_COUNT} 台。" >&2
  exit 2
fi

mkdir -p artifacts
set +e
./gradlew "${ANDROID_BENCHMARK_MODULE}:${ANDROID_BENCHMARK_TASK}"
BENCHMARK_STATUS=$?
set -e

RAW_DIR="${ANDROID_BENCHMARK_OUTPUT_DIR:-macrobenchmark/build/outputs/connected_android_test_additional_output}"
CANDIDATE_REPORT="artifacts/android-performance-report.json"
"${ANDROID_METRICS_NORMALIZER}" "$RAW_DIR" "$CANDIDATE_REPORT"

set +e
node scripts/ci/assert-mobile-performance.mjs \
  "$CANDIDATE_REPORT" \
  "$PERFORMANCE_BASELINE" \
  scripts/ci/android-performance-thresholds.json \
  > artifacts/android-performance-comparison.json
ASSERT_STATUS=$?
set -e

if [[ "$BENCHMARK_STATUS" -ne 0 || "$ASSERT_STATUS" -ne 0 ]]; then
  node scripts/ci/notify-ios-performance.mjs artifacts/android-performance-comparison.json || true
  exit 1
fi
