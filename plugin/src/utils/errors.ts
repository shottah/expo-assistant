/**
 * Plugin error helpers.
 *
 * Convention adopted from the audit (§4 — `.plan/07-plugin-audit.md`)
 * and our own phrase-validation errors that already followed it: every
 * developer-facing throw from the plugin should explain
 *
 *   1. WHAT failed (state the violated invariant in plain terms)
 *   2. WHY (the underlying constraint at the developer's abstraction —
 *      iOS framework rule, Apple DTS ruling, missing declaration, etc.)
 *   3. HOW to fix it (concrete next step + a doc / issue link if the
 *      constraint is non-obvious)
 *
 * `pluginError(...)` formats those three parts consistently and applies
 * the `[expo-assistant]` prefix the test harness uses to distinguish
 * deliberate validation throws from stub-incompatibility noise (see
 * plugin/__tests__/withExpoAssistant.test.ts:116-118).
 */

export interface PluginErrorParts {
  /** Brief noun phrase describing what's wrong. e.g. `iOS AppShortcut phrase missing required token`. */
  what: string;
  /** One or two sentences explaining the underlying constraint. */
  why: string;
  /** Concrete fix or next step. Include a URL if the constraint is non-obvious. */
  how: string;
}

/**
 * Builds a multi-line, well-structured Error consumers can grep. The
 * `[expo-assistant]` prefix is mandatory — the test harness keys off
 * it to decide which throws to propagate vs swallow.
 */
export function pluginError(parts: PluginErrorParts): Error {
  const message =
    `[expo-assistant] ${parts.what}\n` +
    `  why: ${parts.why}\n` +
    `  fix: ${parts.how}`;
  return new Error(message);
}
