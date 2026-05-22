/**
 * Prebuild validation for AssistantSchemas declarations.
 *
 * Schema-required parameters come from the catalog automatically — the
 * developer's `app.json` only declares OPTIONAL extras (or nothing for
 * pure-schema intents). This is the friendlier UX: developers don't need
 * to know about Apple framework types like `StringSearchCriteria` —
 * they just say `schema: "system.search"` and the plugin handles the
 * Swift surface from there.
 *
 * Catches three classes of errors before xcodebuild surfaces them:
 *
 *   1. Unknown schema name (typo, wrong domain, schema not in our catalog)
 *   2. Developer redeclared a schema-required parameter — would conflict
 *      with auto-injection from the catalog
 *   3. Duplicate schema across `appShortcuts[]` — Apple enforces per-app
 *      per-schema-id uniqueness at the binary linker level (spike finding
 *      H, .plan/08-assistant-schemas-research.md). The xcodebuild error
 *      is cryptic; ours is actionable.
 *
 * All errors flow through `pluginError({what, why, how})` per repo
 * convention.
 */

import type { AppShortcutParameter } from "../../../types";
import { pluginError } from "../../../utils/errors";
import {
  getSchemaSpec,
  isKnownSchemaId,
  knownSchemaIds,
  SchemaIntentSpec,
} from "./catalog";

/**
 * The minimum shape from an `appShortcuts[]` entry that the validator
 * needs. Decoupled from the full `AppShortcutDeclaration` so this
 * module can be unit-tested without dragging in the full app.json
 * schema.
 */
export interface ShortcutWithSchema {
  id: string;
  schema?: string;
  parameters?: AppShortcutParameter[];
}

/**
 * Validates every shortcut's schema declaration against the catalog and
 * checks for per-app per-schema-id uniqueness. Throws on the first
 * violation it finds — fail-fast since one error usually surfaces
 * follow-ons.
 */
export function validateSchemaDeclarations(
  shortcuts: ShortcutWithSchema[]
): void {
  // 1. Per-schema-id uniqueness — Apple's binary linker constraint.
  // Two intents conforming to the same schema in one app produces the
  // error: "Only 1 type per app allowed to conform to Assistant schema
  // identifier '<protocol>' with version '<version>'". We catch it here
  // because the xcodebuild error names the protocol (not the schema),
  // which is hard for developers to map back to their app.json.
  const schemaIdToShortcutId = new Map<string, string>();
  for (const s of shortcuts) {
    if (!s.schema) continue;
    const prior = schemaIdToShortcutId.get(s.schema);
    if (prior) {
      throw pluginError({
        what: `Schema "${s.schema}" declared on multiple shortcuts: "${prior}" and "${s.id}".`,
        why: "Apple enforces per-app per-schema-id uniqueness at the binary linker level. Two intents conforming to the same schema produces a build failure with a cryptic error pointing at the protocol name rather than the schema.",
        how: `Pick one shortcut to bind to "${s.schema}" and either remove the schema field from the other OR bind it to a different schema. Each schema can have exactly one implementing intent per app.`,
      });
    }
    schemaIdToShortcutId.set(s.schema, s.id);
  }

  // 2. Per-shortcut: known schema + no conflicts with auto-injected
  // required parameters.
  for (const s of shortcuts) {
    if (!s.schema) continue;

    if (!isKnownSchemaId(s.schema)) {
      throw pluginError({
        what: `Shortcut "${s.id}" declares schema "${s.schema}" which is not in the AssistantSchemas catalog.`,
        why: "Schemas must be declared via Apple's `AssistantSchemas` enum; only schemas that the plugin's catalog knows about are validatable at prebuild. Unknown schemas would compile to Swift that references undeclared enum cases.",
        how: `Use one of the known schema ids: ${knownSchemaIds().join(", ")}. If you need a schema that's not yet in the catalog, add it to plugin/src/ios/codegen/schemas/catalog.ts (see Apple's docs at https://developer.apple.com/documentation/appintents/assistantschemas) and re-run prebuild.`,
      });
    }

    const spec = getSchemaSpec(s.schema)!;
    validateNoRedeclaredRequired(s, spec);
  }
}

/**
 * Schema-required parameters come from the catalog at codegen time.
 * If the developer ALSO declares one with the same name in `app.json`,
 * we'd end up with a duplicate @Parameter declaration. Reject so the
 * developer either removes their declaration (and the schema-required
 * one ships automatically) or renames their extra parameter to avoid
 * the collision.
 */
function validateNoRedeclaredRequired(
  shortcut: ShortcutWithSchema,
  spec: SchemaIntentSpec
): void {
  const requiredNames = new Set(spec.requiredParams.map((p) => p.name));
  const declared = shortcut.parameters ?? [];
  for (const p of declared) {
    if (requiredNames.has(p.name)) {
      throw pluginError({
        what: `Shortcut "${shortcut.id}" (schema "${spec.schemaId}") declares parameter "${p.name}" which is auto-injected by the schema.`,
        why: `The "${spec.schemaId}" schema requires parameter "${p.name}" with a specific Swift type. The plugin emits this parameter automatically from the catalog; declaring it again in your app.json would produce a duplicate @Parameter at codegen time.`,
        how: `Remove "${p.name}" from this shortcut's parameters array — the schema-required version is generated for you. Add extra parameters with different names if you need additional fields.`,
      });
    }
  }
}
