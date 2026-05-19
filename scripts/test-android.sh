#!/usr/bin/env bash
# Local Android JUnit + JaCoCo runner.
#
# Requires:
#   - JDK 17 on JAVA_HOME (`brew install openjdk@17`)
#   - Android SDK with platforms;android-36 + build-tools;36.0.0 + ndk;27.1.12297006
#     on ANDROID_HOME (`brew install --cask android-commandlinetools` then sdkmanager)
#   - bun + repo deps installed
#
# What it does:
#   1. `bunx expo prebuild --platform android` generates example/android
#   2. `./gradlew :expo-assistant:jacocoTestReport` runs 28 tests + emits XML coverage
#
# Open the HTML report after the run:
#   open example/android/expo-assistant/build/reports/tests/testDebugUnitTest/index.html

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

: "${JAVA_HOME:?JAVA_HOME not set — try: export JAVA_HOME=/opt/homebrew/opt/openjdk@17}"
: "${ANDROID_HOME:?ANDROID_HOME not set — try: export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools}"

cd "$REPO_ROOT/example"
echo "→ generating android project"
bunx expo prebuild --platform android --clean --no-install

cd "$REPO_ROOT/example/android"
echo "→ running ./gradlew :expo-assistant:jacocoTestReport"
./gradlew :expo-assistant:jacocoTestReport --console=plain
