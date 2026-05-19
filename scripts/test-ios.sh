#!/usr/bin/env bash
# Local iOS XCTest runner.
#
# Requires:
#   - Xcode 16.1+ + an iOS Simulator runtime
#   - CocoaPods + the bundled `xcodeproj` ruby gem
#   - bun + repo deps installed (`bun install` at repo root, `bun install` in example/)
#
# What it does:
#   1. `bunx expo prebuild --platform ios` generates example/ios
#   2. `ruby scripts/add-ios-test-target.rb` wires the ExpoAssistantTests target
#   3. `pod install` brings in the s.test_spec
#   4. `xcodebuild test` runs the suite against an iPhone simulator
#
# Override the simulator name with the SIM env var, e.g.:
#   SIM='iPhone 16' bun run test:ios

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIM="${SIM:-iPhone 17}"

cd "$REPO_ROOT/example"
echo "→ generating ios project"
bunx expo prebuild --platform ios --clean --no-install

cd "$REPO_ROOT"
echo "→ wiring test target"
# xcodeproj gem ships bundled inside the CocoaPods install (its own
# isolated GEM_HOME) — point system ruby at it for THIS invocation only,
# so `require 'xcodeproj'` works. Don't export, or it'll leak into
# pod install's own gem resolution and break it.
COCOAPODS_LIBEXEC="$(brew --prefix cocoapods 2>/dev/null || true)/libexec"
GEM_PATH="$COCOAPODS_LIBEXEC" ruby scripts/add-ios-test-target.rb

cd "$REPO_ROOT/example/ios"
echo "→ installing pods"
pod install --repo-update

echo "→ running XCTest"
xcodebuild test \
  -workspace expoassistantexample.xcworkspace \
  -scheme ExpoAssistant-Unit-Tests \
  -destination "platform=iOS Simulator,name=$SIM" \
  -sdk iphonesimulator \
  -resultBundlePath test-results.xcresult \
  -enableCodeCoverage YES \
  CODE_SIGNING_ALLOWED=NO \
  | (xcpretty 2>/dev/null || cat)

echo "→ coverage in example/ios/test-results.xcresult"
echo "  inspect with: xcrun xccov view --report example/ios/test-results.xcresult"
