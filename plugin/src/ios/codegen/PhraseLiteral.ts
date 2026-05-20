/**
 * AppShortcutPhrase literal generator.
 *
 * Converts an app.json phrase string (with `${applicationName}` /
 * `${enumParam}` / `${entityParam}` tokens) into the Swift double-
 * quoted literal that `AppShortcutPhrase` accepts. Enforces two
 * non-negotiable rules iOS imposes:
 *
 * 1. Every phrase MUST contain `${applicationName}`. Apple's `linkd`
 *    silently drops phrases missing it — the shortcut becomes
 *    invisible. We throw at prebuild with a clear error pointing at
 *    the linkd log message, so the failure surfaces to the developer
 *    rather than at install scan.
 *
 * 2. `${paramName}` slots in phrases only work when the parameter
 *    type resolves to an `AppEntity` or `AppEnum` — never a primitive
 *    (`String`, `Int`, `Double`, `Date`, `URL`, `Measurement`). Per
 *    Apple DTS engineer Ed Ford: *"Invalid parameter type. AppEntity
 *    and AppEnum are the only allowed types"*
 *    (https://developer.apple.com/forums/thread/770037). We throw at
 *    prebuild on any primitive slot — see issue #37.
 *
 * Slots referencing enum-typed or entity-typed parameters are emitted
 * as the raw Swift parameter interpolation `\(\.$paramName)` so iOS
 * extracts the spoken value into the bound parameter at scan/voice
 * time.
 *
 * `${applicationName}` is emitted as `\(.applicationName)` — Swift
 * compile-time syntax, not runtime characters; the backslash must NOT
 * pass through escapeSwift.
 */

import type { AppShortcutParameter } from "../../types";
import { pluginError } from "../../utils/errors";
import { escapeSwift, isEnumType, isEntityType } from "./types";

const APP_NAME_TOKEN = "${applicationName}";
const TOKEN_RE = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export function buildPhraseLiteral(
  phrase: string,
  intentId: string,
  declaredParams: AppShortcutParameter[]
): string {
  if (!phrase.includes(APP_NAME_TOKEN)) {
    throw pluginError({
      what: `iOS AppShortcut phrase for "${intentId}" must contain "${APP_NAME_TOKEN}" — got: ${JSON.stringify(phrase)}.`,
      why: "Apple's linkd silently drops phrase templates missing the ${applicationName} token. Without it, the shortcut becomes invisible to Spotlight / Siri.",
      how: "Add ${applicationName} somewhere in the phrase (e.g. \"Open project in ${applicationName}\"). The token is replaced with your app's name at runtime.",
    });
  }

  const declaredByName = new Map(declaredParams.map((p) => [p.name, p]));
  const parts: string[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = TOKEN_RE.exec(phrase)) !== null) {
    const token = m[1];
    parts.push(escapeSwift(phrase.slice(cursor, m.index)));

    if (token === "applicationName") {
      parts.push("\\(.applicationName)");
    } else {
      const param = declaredByName.get(token);
      if (!param) {
        throw pluginError({
          what: `Phrase for "${intentId}" references undeclared parameter "\${${token}}".`,
          why: "voice slots only work for AppEnum / AppEntity types (#37), not primitives, and the slot name must match a declared parameter.",
          how: `Either declare "${token}" in ios.appShortcuts[].parameters with an enum:<Name> or entity:<Name> type, or remove the slot from the phrase and rely on requestValueDialog to prompt for the value.`,
        });
      }
      if (!isEnumType(param.type) && !isEntityType(param.type)) {
        throw pluginError({
          what: `Phrase for "${intentId}" references "\${${token}}" as a voice slot, but "${token}" is type "${param.type}".`,
          why: "Apple's AppShortcutPhrase only accepts AppEntity / AppEnum types as voice slots (https://developer.apple.com/forums/thread/770037) — primitives are silently dropped by linkd.",
          how: `Either change "${token}" to an enum/entity (declare under ios.enums[] / ios.entities[] and set type: "enum:<Name>" or "entity:<Name>") OR remove the slot and rely on requestValueDialog to prompt for "${token}". Tracked in #37.`,
        });
      }
      // Legal enum- or entity-typed slot: emit raw Swift parameter interpolation.
      parts.push(`\\(\\.$${token})`);
    }

    cursor = m.index + m[0].length;
  }
  parts.push(escapeSwift(phrase.slice(cursor)));
  return `"${parts.join("")}"`;
}
