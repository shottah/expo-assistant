#!/usr/bin/env node
/**
 * Test gate — runs the JS test suite only if the diff between two
 * commits touches files the tests could conceivably observe. Otherwise
 * exits 0 with no work, so CI reports the job green without spending
 * ~30s booting bun + Node + jest for nothing.
 *
 * Usage
 *   bun run test:gated                              # base = HEAD~1
 *   bun run test:gated --                           # same, with pass-through args
 *   bun run test:gated -- --ci --coverage           # pass-through to jest
 *   bun run test:gated -- --base=abc123             # explicit base ref
 *   GATE_BASE_REF=<sha> bun run test:gated          # base via env (used by CI)
 *
 * Resolution order for the base ref:
 *   1. --base=<ref> CLI arg
 *   2. GATE_BASE_REF env var (set by .github/workflows/ci.yml)
 *   3. HEAD~1 default
 *
 * The gate considers a change "test-relevant" if its path matches any
 * of TEST_RELEVANT below. The list deliberately mirrors what the JS
 * test suite actually consumes:
 *
 *   - src/** and plugin/** — direct module-under-test surfaces
 *   - ios/ExpoAssistantModule.swift + the Kotlin twin —
 *     CrossPlatformContract.test.ts reads them at runtime via
 *     fs.readFileSync; jest's static dep graph is blind to this so the
 *     gate has to know about it explicitly
 *   - jest config + setup, TS config, eslint config, lockfile, the
 *     module manifest — any of these can change test behaviour
 *   - the CI workflow itself — if you change how tests are invoked,
 *     re-run them
 *
 * Native tests (XCTest, JaCoCo) deliberately do NOT use this gate. They
 * have their own skip behaviour in .github/workflows/ci.yml (`if:
 * false` today). Per the design conversation: the gate is JS-only.
 *
 * Failure mode: if the git diff lookup fails for any reason (missing
 * base ref, shallow clone, etc.), the script logs a warning and runs
 * the tests anyway. Safe-by-default: we'd rather waste a CI minute
 * than silently skip a real regression.
 */

import { execSync, spawnSync } from "node:child_process";

const TEST_RELEVANT = [
  /^src\//,
  /^plugin\//,
  /^ios\/ExpoAssistantModule\.swift$/,
  /^android\/src\/main\/java\/expo\/modules\/assistant\/ExpoAssistantModule\.kt$/,
  /^app\.plugin\.js$/,
  /^expo-module\.config\.json$/,
  /^jest\.config\.js$/,
  /^jest\.setup\.js$/,
  /^tsconfig\.json$/,
  /^plugin\/tsconfig\.json$/,
  /^eslint\.config\.js$/,
  /^\.eslintrc\.js$/,
  /^package\.json$/,
  /^bun\.lock$/,
  /^\.github\/workflows\/ci\.yml$/,
];

function resolveBaseRef(args) {
  const cliFlag = args.find((a) => a.startsWith("--base="));
  if (cliFlag) return cliFlag.split("=")[1];
  if (process.env.GATE_BASE_REF) return process.env.GATE_BASE_REF;
  return "HEAD~1";
}

function getChangedFiles(baseRef) {
  try {
    const out = execSync(`git diff --name-only ${baseRef}..HEAD`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.split("\n").filter(Boolean);
  } catch (err) {
    process.stderr.write(
      `[test-gate] git diff against "${baseRef}" failed: ${err.message}\n` +
        `[test-gate] running tests anyway (safe fallback — we don't trust\n` +
        `            a missing base ref to mean "no relevant changes").\n`
    );
    return null;
  }
}

function isRelevant(file) {
  return TEST_RELEVANT.some((re) => re.test(file));
}

function runJest(jestArgs) {
  const result = spawnSync("bun", ["run", "test:jest", ...jestArgs], {
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

const rawArgs = process.argv.slice(2);
const baseRef = resolveBaseRef(rawArgs);
const jestArgs = rawArgs.filter((a) => !a.startsWith("--base="));

const changed = getChangedFiles(baseRef);
if (changed === null) {
  runJest(jestArgs);
}

if (changed.length === 0) {
  console.log(`[test-gate] no files changed since ${baseRef} — skipping.`);
  process.exit(0);
}

const relevant = changed.filter(isRelevant);
const irrelevant = changed.filter((f) => !isRelevant(f));

if (relevant.length === 0) {
  console.log(
    `[test-gate] ${changed.length} file(s) changed since ${baseRef}, none test-relevant — skipping.`
  );
  for (const f of irrelevant) console.log(`  · ${f}`);
  process.exit(0);
}

console.log(
  `[test-gate] ${relevant.length} test-relevant file(s) changed since ${baseRef} — running suite.`
);
for (const f of relevant) console.log(`  · ${f}`);
if (irrelevant.length > 0) {
  console.log(
    `[test-gate] (${irrelevant.length} other file(s) changed but didn't trigger.)`
  );
}

runJest(jestArgs);
