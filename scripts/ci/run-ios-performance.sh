#!/usr/bin/env bash
set -euo pipefail

: "${IOS_WORKSPACE:?Set IOS_WORKSPACE to the generated .xcworkspace path}"
: "${IOS_SCHEME:?Set IOS_SCHEME to the performance test scheme}"
: "${IOS_DESTINATION:?Set IOS_DESTINATION, for example platform=iOS,name=CI iPhone}"
: "${PERFORMANCE_BASELINE:?Set PERFORMANCE_BASELINE to the committed baseline JSON path}"

RESULT_BUNDLE="${RESULT_BUNDLE:-artifacts/ios-performance.xcresult}"
METRICS_JSON="${METRICS_JSON:-artifacts/ios-performance-candidate.json}"
mkdir -p "$(dirname "$RESULT_BUNDLE")" "$(dirname "$METRICS_JSON")"

# 性能用例必须使用独立的 perf-only scheme 与无业务数据测试账户。
xcodebuild test \
  -workspace "$IOS_WORKSPACE" \
  -scheme "$IOS_SCHEME" \
  -destination "$IOS_DESTINATION" \
  -only-testing:CocktailRPerformanceTests \
  -resultBundlePath "$RESULT_BUNDLE"

# CI 项目需将 XCTest 指标导出为约定 JSON。这个导出步骤不读取或上传业务数据。
xcrun xcresulttool get test-results metrics --path "$RESULT_BUNDLE" --format json > "$METRICS_JSON"
node scripts/ci/assert-ios-performance.mjs "$METRICS_JSON" "$PERFORMANCE_BASELINE"
