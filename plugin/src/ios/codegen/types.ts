/**
 * Shared low-level Swift-emit helpers for the iOS codegen modules.
 *
 * Pure functions only — no side effects, no fs, no mod plumbing. The
 * `withIOSAppShortcutsCodegen` mod composes the higher-level generators
 * (`AppEnumSwift`, `AppEntitySwift`, `TypedIntentSwift`, etc.) into a
 * full provider file; this module is the layer those generators reach
 * for primitives like "what Swift type does this parameter map to" and
 * "how do I marshal it back across the JS bridge".
 *
 * If you're looking for the file orchestration, see
 * `../withIOSAppShortcutsCodegen.ts`.
 *
 * If you're about to add a new helper or extend the parameter type
 * vocabulary, read `plugin/AGENTS.md` first — it covers the
 * conventions (when to extend this file vs add a new codegen file,
 * Swift identifier validation pattern, `pluginError` error structure,
 * first-party precedents). The audit at `.plan/07-plugin-audit.md`
 * has the historical rationale.
 */

import type { AppShortcutParameter } from "../../types";
import { pluginError } from "../../utils/errors";

/** Escapes a string for embedding inside a Swift double-quoted literal. */
export function escapeSwift(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Capitalizes the first character. Safe on empty strings. */
export function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** True if this parameter type references a declared `ios.enums[]` entry via `enum:<Name>` syntax. */
export function isEnumType(type: AppShortcutParameter["type"]): boolean {
  return typeof type === "string" && type.startsWith("enum:");
}

/** True if this parameter type references a declared `ios.entities[]` entry via `entity:<Name>` syntax. */
export function isEntityType(type: AppShortcutParameter["type"]): boolean {
  return typeof type === "string" && type.startsWith("entity:");
}

/** Extracts the `<Name>` portion from an `enum:<Name>` parameter type. Throws if called on a non-enum type. */
export function enumNameFromType(type: AppShortcutParameter["type"]): string {
  if (!isEnumType(type)) {
    throw pluginError({
      what: `enumNameFromType called with non-enum type: ${type}`,
      why: "Internal precondition violated — caller should isEnumType-check first.",
      how: "This is a programming error in the plugin codegen; please report it via the expo-assistant issue tracker.",
    });
  }
  return (type as string).slice("enum:".length);
}

/** Extracts the `<Name>` portion from an `entity:<Name>` parameter type. Throws if called on a non-entity type. */
export function entityNameFromType(type: AppShortcutParameter["type"]): string {
  if (!isEntityType(type)) {
    throw pluginError({
      what: `entityNameFromType called with non-entity type: ${type}`,
      why: "Internal precondition violated — caller should isEntityType-check first.",
      how: "This is a programming error in the plugin codegen; please report it via the expo-assistant issue tracker.",
    });
  }
  return (type as string).slice("entity:".length);
}

/**
 * Translates an app.json shortcut `id` to the Swift type name used for
 * its generated AppIntent struct. Suffixes `Intent` and PascalCases
 * the id so kebab/snake/camel/spaced forms all converge:
 *
 *   "create-event"  → "CreateEventIntent"
 *   "create_event"  → "CreateEventIntent"
 *   "createEvent"   → "CreateEventIntent"
 *   "create event"  → "CreateEventIntent"
 */
export function intentStructName(id: string): string {
  const segments = id
    .split(/[-_\s]+/)
    .flatMap((s) => s.split(/(?=[A-Z])/))
    .filter((s) => s.length > 0)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  if (segments.length === 0) {
    throw pluginError({
      what: "cannot derive a Swift type name from empty shortcut id",
      why: "Every appShortcuts[].id must contain at least one identifier-character segment.",
      how: "Set a non-empty `id` on the offending shortcut in your app.json.",
    });
  }
  return `${segments.join("")}Intent`;
}

/**
 * Maps an `AppShortcutParameter.type` to its Swift type for the
 * generated `@Parameter`/`@Property` declarations. Entity types become
 * `<Name>Entity` (the codegen-generated AppEntity struct); enum types
 * become `<Name>` (the codegen-generated AppEnum); primitives map to
 * Foundation / stdlib types.
 */
export function swiftTypeFor(type: AppShortcutParameter["type"]): string {
  if (isEnumType(type)) {
    return enumNameFromType(type);
  }
  if (isEntityType(type)) {
    return `${entityNameFromType(type)}Entity`;
  }
  switch (type) {
    case "string":
      return "String";
    case "number":
      return "Double";
    case "boolean":
      return "Bool";
    case "date":
      return "Date";
    case "duration":
      return "Measurement<UnitDuration>";
    case "length":
      return "Measurement<UnitLength>";
    case "url":
      return "URL";
    default: {
      // Exhaustiveness assertion — the union is closed; this branch is
      // unreachable but TS needs help inferring that with the template
      // literal type in play.
      const exhaustive: never = type as never;
      throw pluginError({
        what: `unknown parameter type: ${String(exhaustive)}`,
        why: "The parameter type didn't match any known primitive, enum, or entity shape.",
        how: "Set `type` to one of: string, number, boolean, date, duration, length, url, enum:<Name>, entity:<Name>. See runbook/integrate-app-shortcut.md § Parameter type vocabulary.",
      });
    }
  }
}

/**
 * Swift expression that marshals a typed parameter into a JS-friendly
 * value for `emitIntent`'s `[String: Any]` dict. Each rich type lands
 * with a documented shape on the JS side:
 *
 *   Date            → ISO 8601 string (via `_expoAssistantISO8601Formatter`)
 *   Measurement<T>  → `["value": Double, "unit": String]` (unit is `.symbol`, e.g. `"s"`, `"km"`)
 *   URL             → `.absoluteString`
 *   AppEntity       → `.asDictionary()` (the entity's `{id, ...properties}` dict)
 *   AppEnum         → `.rawValue` (the case's id string)
 *   Primitives      → passed through unchanged
 */
export function marshalExpr(p: AppShortcutParameter): string {
  if (isEnumType(p.type)) return `${p.name}.rawValue`;
  if (isEntityType(p.type)) return `${p.name}.asDictionary()`;
  switch (p.type) {
    case "string":
    case "number":
    case "boolean":
      return p.name;
    case "date":
      return `_expoAssistantISO8601Formatter.string(from: ${p.name})`;
    case "duration":
    case "length":
      return `["value": ${p.name}.value, "unit": ${p.name}.unit.symbol] as [String: Any]`;
    case "url":
      return `${p.name}.absoluteString`;
    default: {
      const exhaustive: never = p.type as never;
      throw pluginError({
        what: `no marshal expression for type: ${String(exhaustive)}`,
        why: "Internal precondition violated — swiftTypeFor would have rejected this first.",
        how: "This is a programming error in the plugin codegen; please report it via the expo-assistant issue tracker.",
      });
    }
  }
}
