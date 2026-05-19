/**
 * Pins the set of native `AsyncFunction` registrations across iOS Swift and
 * Android Kotlin against the TS-declared contract. If a method exists on
 * one platform but not the other (or has been renamed silently), this
 * test fails at PR time instead of on-device.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

function extractAsyncFunctions(relativePath: string): string[] {
  const absolute = resolve(__dirname, "..", "..", relativePath);
  const src = readFileSync(absolute, "utf8");
  // Both Swift and Kotlin use `AsyncFunction("name")` — same syntax.
  const re = /AsyncFunction\(\s*"([^"]+)"/g;
  const names = new Set<string>();
  for (const m of src.matchAll(re)) {
    names.add(m[1]);
  }
  return [...names].sort();
}

const expected = [
  "checkCapabilities",
  "donateIntent",
  "enableAppActions",
  "enableBackgroundProcessing",
  "enableCustomUI",
  "enableSiriKit",
  "getLocale",
  "getPlatform",
  "initialize",
  "registerIntent",
  "requestMicrophonePermission",
  "requestSpeechRecognitionPermission",
  "setDebugMode",
  "unregisterIntent",
].sort();

describe("Cross-platform AsyncFunction contract", () => {
  it("iOS Swift module exposes exactly the expected AsyncFunctions", () => {
    expect(extractAsyncFunctions("ios/ExpoAssistantModule.swift")).toEqual(
      expected
    );
  });

  it("Android Kotlin module exposes exactly the expected AsyncFunctions", () => {
    expect(
      extractAsyncFunctions(
        "android/src/main/java/expo/modules/assistant/ExpoAssistantModule.kt"
      )
    ).toEqual(expected);
  });

  it("iOS and Android expose the same set of AsyncFunctions", () => {
    const ios = extractAsyncFunctions("ios/ExpoAssistantModule.swift");
    const android = extractAsyncFunctions(
      "android/src/main/java/expo/modules/assistant/ExpoAssistantModule.kt"
    );
    expect(ios).toEqual(android);
  });
});
