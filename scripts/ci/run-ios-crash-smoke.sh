#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ARTIFACT_DIR="${ARTIFACT_DIR:-artifacts/ios-crash-smoke}"
DERIVED_DATA="${DERIVED_DATA:-$PWD/.ci-derived-data-ios-smoke}"
BUNDLE_ID="${IOS_BUNDLE_ID:-com.app.cocktailrecipes}"
SIMULATOR_NAME="${IOS_SIMULATOR_NAME:-iPhone 16}"
RUN_COUNT="${IOS_SMOKE_RUN_COUNT:-5}"

mkdir -p "$ARTIFACT_DIR"
rm -rf "$DERIVED_DATA"

cleanup() {
  if [[ -n "${SIMULATOR_UDID:-}" ]]; then
    xcrun simctl shutdown "$SIMULATOR_UDID" >/dev/null 2>&1 || true
    xcrun simctl delete "$SIMULATOR_UDID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "Preparing iOS native project for simulator smoke test"
EXPO_NO_TELEMETRY=1 pnpm exec expo prebuild --platform ios --clean --no-install
(cd ios && pod install)

WORKSPACE="$(find ios -maxdepth 1 -name '*.xcworkspace' -print -quit)"
if [[ -z "$WORKSPACE" ]]; then
  echo "No generated iOS workspace found" >&2
  exit 1
fi

SCHEME="$(xcodebuild -list -json -workspace "$WORKSPACE" | node -e '
let text = "";
process.stdin.on("data", (chunk) => { text += chunk; });
process.stdin.on("end", () => {
  const projects = JSON.parse(text).workspace?.schemes ?? [];
  if (projects.length === 0) process.exit(1);
  process.stdout.write(projects[0]);
});
')"
if [[ -z "$SCHEME" ]]; then
  echo "No build scheme found in $WORKSPACE" >&2
  exit 1
fi

RUNTIME_ID="$(xcrun simctl list runtimes -j | node -e '
let text = "";
process.stdin.on("data", (chunk) => { text += chunk; });
process.stdin.on("end", () => {
  const runtimes = JSON.parse(text).runtimes
    .filter((runtime) => runtime.isAvailable && runtime.platform === "iOS")
    .sort((left, right) => String(right.version).localeCompare(String(left.version), undefined, { numeric: true }));
  if (runtimes.length === 0) process.exit(1);
  process.stdout.write(runtimes[0].identifier);
});
')"

DEVICE_TYPE_ID="$(xcrun simctl list devicetypes -j | node -e '
const wanted = process.argv[1];
let text = "";
process.stdin.on("data", (chunk) => { text += chunk; });
process.stdin.on("end", () => {
  const types = JSON.parse(text).devicetypes;
  const selected = types.find((type) => type.name === wanted) ?? types.find((type) => type.name.startsWith("iPhone"));
  if (!selected) process.exit(1);
  process.stdout.write(selected.identifier);
});
' "$SIMULATOR_NAME")"

SIMULATOR_UDID="$(xcrun simctl create "cocktail-r-crash-smoke" "$DEVICE_TYPE_ID" "$RUNTIME_ID")"
xcrun simctl boot "$SIMULATOR_UDID" || true
xcrun simctl bootstatus "$SIMULATOR_UDID" -b

echo "Building $SCHEME for $SIMULATOR_UDID"
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=$SIMULATOR_UDID" \
  -derivedDataPath "$DERIVED_DATA" \
  build | tee "$ARTIFACT_DIR/xcodebuild.log"

APP_PATH="$(find "$DERIVED_DATA/Build/Products/Release-iphonesimulator" -maxdepth 1 -name '*.app' -print -quit)"
if [[ -z "$APP_PATH" ]]; then
  echo "Release simulator app bundle was not produced" >&2
  exit 1
fi

EXECUTABLE_NAME="$(plutil -extract CFBundleExecutable raw "$APP_PATH/Info.plist")"
xcrun simctl install "$SIMULATOR_UDID" "$APP_PATH"

LOG_FILE="$ARTIFACT_DIR/simulator-console.log"
: > "$LOG_FILE"
for run in $(seq 1 "$RUN_COUNT"); do
  echo "=== cold launch $run of $RUN_COUNT ===" | tee -a "$LOG_FILE"
  xcrun simctl terminate "$SIMULATOR_UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl launch "$SIMULATOR_UDID" "$BUNDLE_ID" | tee -a "$LOG_FILE"
  sleep 8

  xcrun simctl spawn "$SIMULATOR_UDID" log show --style compact --last 15s \
    --predicate "process == '$EXECUTABLE_NAME' OR eventMessage CONTAINS[c] '$BUNDLE_ID'" \
    >> "$LOG_FILE" 2>&1 || true

  if grep -Eqi 'EXC_CRASH|SIGABRT|terminating app due to uncaught|uncaught exception|RCTFatal|fatal exception' "$LOG_FILE"; then
    echo "Detected a simulator crash signature during cold launch $run" >&2
    exit 1
  fi

  if ! xcrun simctl spawn "$SIMULATOR_UDID" ps -ax | grep -F "$EXECUTABLE_NAME" | grep -vq grep; then
    echo "App process was not alive after cold launch $run" >&2
    exit 1
  fi
done

echo "Simulator cold-start smoke test passed: $RUN_COUNT consecutive launches" | tee -a "$LOG_FILE"
