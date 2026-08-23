#!/usr/bin/env bash
set -euo pipefail

: "${IOS_WORKSPACE:?Set IOS_WORKSPACE to the generated .xcworkspace path}"
: "${IOS_SCHEME:?Set IOS_SCHEME to the performance test scheme}"
: "${IOS_DESTINATION:?Set IOS_DESTINATION, for example platform=iOS,name=CI iPhone}"
: "${PERFORMANCE_BASELINE:?Set PERFORMANCE_BASELINE to the committed baseline JSON path}"
: "${IOS_METRICS_NORMALIZER:?Set IOS_METRICS_NORMALIZER to the XCTest/xcresult metrics normalizer command}"

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

# 原始 xcresult 结构会随 Xcode 版本变化。由受版本控制的 normalizer 读取原始指标，
# 输出 assert-ios-performance.mjs 所需的 scenario/samples JSON；过程不读取或上传业务数据。
"$IOS_METRICS_NORMALIZER" "$RESULT_BUNDLE" "$METRICS_JSON"
node scripts/ci/assert-ios-performance.mjs "$METRICS_JSON" "$PERFORMANCE_BASELINE"
