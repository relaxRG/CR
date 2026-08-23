#!/usr/bin/env bash
set -euo pipefail

: "${PERFORMANCE_BASELINE:?必须提供 PERFORMANCE_BASELINE}"
PERFORMANCE_MODE="${PERFORMANCE_MODE:-compare}"
if [[ "$PERFORMANCE_MODE" != "capture" && "$PERFORMANCE_MODE" != "compare" ]]; then
  echo "PERFORMANCE_MODE 必须为 capture 或 compare" >&2
  exit 2
fi
: "${ANDROID_METRICS_NORMALIZER:?必须提供 ANDROID_METRICS_NORMALIZER}"
: "${ANDROID_BENCHMARK_MODULE:=:macrobenchmark}"
: "${ANDROID_BENCHMARK_TASK:=connectedCheck}"
: "${LOW_END_DEVICE_SERIAL:?必须提供 LOW_END_DEVICE_SERIAL，防止错误使用任意设备作为低端基线}"
: "${LOW_END_DEVICE_MODEL:?必须提供 LOW_END_DEVICE_MODEL}"

ADB=(adb -s "$LOW_END_DEVICE_SERIAL")
ARTIFACT_DIR="artifacts/android-low-end"
RAW_DIR="${ANDROID_BENCHMARK_OUTPUT_DIR:-macrobenchmark/build/outputs/connected_android_test_additional_output}"
mkdir -p "$ARTIFACT_DIR"

cleanup() {
  "${ADB[@]}" logcat -d -t 2000 > "$ARTIFACT_DIR/logcat.txt" 2>&1 || true
  "${ADB[@]}" shell dumpsys meminfo com.app.cocktailrecipes > "$ARTIFACT_DIR/final-meminfo.txt" 2>&1 || true
}
trap cleanup EXIT

DEVICE_MODEL="$("${ADB[@]}" shell getprop ro.product.model | tr -d '\r')"
API_LEVEL="$("${ADB[@]}" shell getprop ro.build.version.sdk | tr -d '\r')"
if [[ "$DEVICE_MODEL" != "$LOW_END_DEVICE_MODEL" ]]; then
  echo "设备型号不匹配：期望 ${LOW_END_DEVICE_MODEL}，实际 ${DEVICE_MODEL}" >&2
  exit 2
fi
if [[ "$API_LEVEL" -lt 31 ]]; then
  echo "低端 Android 性能基准要求 API 31+，以获取 FrameTimingMetric frameOverrun 数据。" >&2
  exit 2
fi

"${ADB[@]}" shell settings put system screen_brightness 96 || true
"${ADB[@]}" shell svc wifi enable || true
"${ADB[@]}" shell dumpsys meminfo com.app.cocktailrecipes > "$ARTIFACT_DIR/before-meminfo.txt" 2>&1 || true

set +e
./gradlew "${ANDROID_BENCHMARK_MODULE}:${ANDROID_BENCHMARK_TASK}"
BENCHMARK_STATUS=$?
set -e

find "$RAW_DIR" -type f \( -name '*.json' -o -name '*.trace' -o -name '*.perfetto-trace' \) -print0 2>/dev/null |
  xargs -0 -r -I{} cp --parents "{}" "$ARTIFACT_DIR" || true

CANDIDATE_REPORT="$ARTIFACT_DIR/candidate.json"
"${ANDROID_METRICS_NORMALIZER}" "$RAW_DIR" "$CANDIDATE_REPORT" \
  --platform android \
  --model "$DEVICE_MODEL" \
  --api-level "$API_LEVEL" \
  --low-end-device true

set +e
if [[ "$PERFORMANCE_MODE" == "capture" ]]; then
  node scripts/ci/capture-mobile-performance-baseline.mjs \
    "$CANDIDATE_REPORT" \
    "$PERFORMANCE_BASELINE" \
    scripts/ci/android-performance-thresholds.json \
    > "$ARTIFACT_DIR/comparison.json"
else
  node scripts/ci/assert-mobile-performance.mjs \
    "$CANDIDATE_REPORT" \
    "$PERFORMANCE_BASELINE" \
    scripts/ci/android-performance-thresholds.json \
    > "$ARTIFACT_DIR/comparison.json"
fi
ASSERT_STATUS=$?
set -e

if [[ "$BENCHMARK_STATUS" -ne 0 || "$ASSERT_STATUS" -ne 0 ]]; then
  "${ADB[@]}" bugreport "$ARTIFACT_DIR/bugreport.zip" || true
  node scripts/ci/notify-ios-performance.mjs "$ARTIFACT_DIR/comparison.json" || true
  exit 1
fi
