/**
 * AppEntity codegen.
 *
 * For each declared `ios.entities[]` entry, generates two Swift structs:
 *
 *   1. `<Name>Entity: AppEntity, IndexedEntity, Identifiable` — the
 *      queryable type itself. Properties become @Property-wrapped vars
 *      (bare `let`s extract into the actionsdata bundle as
 *      `properties: []` — the entity exists but has no surface for
 *      filters / pickers / phrase resolution). `init(from dict:)` reads
 *      a JS-supplied dict; `asDictionary()` reflects back out for
 *      emitIntent marshaling. id-based ==/hash since @Property doesn't
 *      synthesize Hashable.
 *
 *   2. `<Name>Query: EntityStringQuery` — Apple's protocol that iOS
 *      calls at scan time for matching / id-resolution / suggestions.
 *      Each method round-trips through
 *      `ExpoAssistantModule.shared?.entityResolver.resolve(...)` to
 *      reach the JS-registered resolver. Returns [] if the module
 *      isn't live (backgrounded scans) — see #41 for the snapshot-store
 *      enhancement that lifts that limitation.
 *
 * Validates that the entity has a usable `displayProperty` (must
 * reference a declared string property) and rejects invalid Swift
 * identifiers at prebuild time.
 */

import type { AppEntityDeclaration, AppEntityProperty } from "../../types";
import { pluginError } from "../../utils/errors";
import { capitalize, escapeSwift } from "./types";

const SWIFT_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function generateAppEntityStructs(decl: AppEntityDeclaration): string[] {
  validate(decl);

  const displayProperty = resolveDisplayProperty(decl);

  const structName = `${decl.name}Entity`;
  const queryName = `${decl.name}Query`;
  const displayNameEsc = escapeSwift(decl.displayName ?? decl.name);

  // Property declarations on the Entity struct. iOS only treats
  // properties as discoverable / queryable / slottable when they're
  // tagged with `@Property(title:)` — bare `let`s extract into the
  // actionsdata bundle as `properties: []` (the entity exists but has
  // no surface for filters / pickers / phrase resolution). The DTS
  // ruling in #37 said "AppEntity and AppEnum are the only allowed
  // types"; the empirical follow-up here is "and the AppEntity must
  // have @Property-tagged fields for its slot story to light up".
  // id stays bare — it's the identifier, not a queryable property.
  const propDecls = decl.properties
    .map((p) => {
      const titleEsc = escapeSwift(capitalize(p.name));
      return `    @Property(title: "${titleEsc}")\n    public var ${p.name}: ${entityPropSwiftType(p)}`;
    })
    .join("\n\n");

  // init(from dict:) reads each property out of the JS-supplied dict
  // with a sensible default if the resolver omitted it (defensive —
  // iOS may surface partial entity data from cache replays).
  const initLines = decl.properties
    .map((p) => `        self.${p.name} = ${entityReadExpr(p, "dict")}`)
    .join("\n");

  // asDictionary() reconstructs the JS-shape so emitIntent passes the
  // entity through to the JS handler verbatim.
  const asDictEntries = [
    `            "id": id`,
    ...decl.properties.map((p) => `            "${p.name}": ${p.name}`),
  ].join(",\n");

  const entitySwift = `@available(iOS 16.0, *)
public struct ${structName}: AppEntity, IndexedEntity, Identifiable {
    public let id: String
${propDecls}

    public static var typeDisplayRepresentation: TypeDisplayRepresentation = "${displayNameEsc}"
    public static var defaultQuery = ${queryName}()

    public var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\\(${displayProperty})")
    }

    public init(from dict: [String: Any]) {
        self.id = (dict["id"] as? String) ?? ""
${initLines}
    }

    public func asDictionary() -> [String: Any] {
        return [
${asDictEntries}
        ]
    }

    // AppEntity requires Hashable. @Property-wrapped fields don't
    // synthesize Equatable / Hashable automatically, so we provide
    // id-based conformance — every entity is uniquely identified by
    // its id per Apple's AppEntity protocol.
    public static func == (lhs: ${structName}, rhs: ${structName}) -> Bool {
        return lhs.id == rhs.id
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}`;

  // EntityStringQuery: bridges Apple's three required hooks (matching,
  // for ids, suggested) through the pod's EntityResolver into JS.
  const querySwift = `@available(iOS 16.0, *)
public struct ${queryName}: EntityStringQuery {
    public init() {}

    public func entities(for identifiers: [${structName}.ID]) async throws -> [${structName}] {
        let raw = await (ExpoAssistantModule.shared?.entityResolver.resolve(
            typeName: "${escapeSwift(decl.name)}",
            kind: "for",
            payload: ["ids": identifiers]
        ) ?? [])
        return raw.map { ${structName}(from: $0) }
    }

    public func entities(matching string: String) async throws -> [${structName}] {
        let raw = await (ExpoAssistantModule.shared?.entityResolver.resolve(
            typeName: "${escapeSwift(decl.name)}",
            kind: "matching",
            payload: ["search": string]
        ) ?? [])
        return raw.map { ${structName}(from: $0) }
    }

    public func suggestedEntities() async throws -> [${structName}] {
        let raw = await (ExpoAssistantModule.shared?.entityResolver.resolve(
            typeName: "${escapeSwift(decl.name)}",
            kind: "suggested",
            payload: [:]
        ) ?? [])
        return raw.map { ${structName}(from: $0) }
    }
}`;

  return [entitySwift, querySwift];
}

function validate(decl: AppEntityDeclaration): void {
  if (!SWIFT_IDENT.test(decl.name)) {
    throw pluginError({
      what: `entity name "${decl.name}" is not a valid Swift identifier`,
      why: "Swift type names must start with a letter or underscore and contain only letters, digits, and underscores.",
      how: `Rename the entity to a valid Swift identifier (PascalCase by convention, e.g. "Project").`,
    });
  }
  if (decl.properties.length === 0) {
    throw pluginError({
      what: `entity "${decl.name}" must declare at least one property`,
      why: "An empty entity has no queryable fields, so iOS can't render it in pickers or surface it via Spotlight.",
      how: `Add at least one { name, type } property to the "${decl.name}" entity's properties array.`,
    });
  }
  for (const p of decl.properties) {
    if (!SWIFT_IDENT.test(p.name)) {
      throw pluginError({
        what: `entity "${decl.name}" property "${p.name}" is not a valid Swift identifier`,
        why: "Each property becomes a Swift stored property, so the name must be a valid Swift identifier.",
        how: `Rename the property to a valid Swift identifier (camelCase by convention, e.g. "title" or "createdAt").`,
      });
    }
  }
}

/**
 * Resolves the `displayProperty` to use for DisplayRepresentation:
 *   1. Explicit `displayProperty` if declared (must reference a string property)
 *   2. A declared string property named "title" if present
 *   3. The first declared string property otherwise
 *
 * Throws if no valid candidate exists.
 */
function resolveDisplayProperty(decl: AppEntityDeclaration): string {
  if (decl.displayProperty) {
    const found = decl.properties.find((p) => p.name === decl.displayProperty);
    if (!found) {
      throw pluginError({
        what: `entity "${decl.name}" displayProperty "${decl.displayProperty}" does not match any declared property`,
        why: "DisplayRepresentation must read from one of the entity's own properties.",
        how: `Either rename displayProperty to match an existing property, or declare a property named "${decl.displayProperty}" in the entity's properties array.`,
      });
    }
    if (found.type !== "string") {
      throw pluginError({
        what: `entity "${decl.name}" displayProperty "${decl.displayProperty}" must reference a string property (got "${found.type}")`,
        why: "DisplayRepresentation.title accepts a string interpolation; non-string properties can't be rendered as the entity's display title.",
        how: `Either point displayProperty at a string-typed property, or change "${decl.displayProperty}" to type: "string".`,
      });
    }
    return decl.displayProperty;
  }

  const titleProp = decl.properties.find(
    (p) => p.name === "title" && p.type === "string"
  );
  const stringProps = decl.properties.filter((p) => p.type === "string");
  const fallback = titleProp?.name ?? stringProps[0]?.name;
  if (!fallback) {
    throw pluginError({
      what: `entity "${decl.name}" must declare at least one string property OR specify displayProperty so DisplayRepresentation has a title source`,
      why: "DisplayRepresentation.title needs SOME string property to render as the entity's display name in pickers / Spotlight / Siri.",
      how: `Add at least one { name, type: "string" } property to the "${decl.name}" entity, or set displayProperty to a custom rendering source.`,
    });
  }
  return fallback;
}

/** Maps an entity property type to its Swift stored-property type. */
export function entityPropSwiftType(p: AppEntityProperty): string {
  switch (p.type) {
    case "string":
      return "String";
    case "number":
      return "Double";
    case "boolean":
      return "Bool";
  }
}

/**
 * Swift expression that reads a property out of a `[String: Any]` dict
 * with a defensive default. Used by `init(from dict:)`.
 */
export function entityReadExpr(p: AppEntityProperty, dictVar: string): string {
  switch (p.type) {
    case "string":
      return `(${dictVar}["${p.name}"] as? String) ?? ""`;
    case "number":
      return `(${dictVar}["${p.name}"] as? Double) ?? 0`;
    case "boolean":
      return `(${dictVar}["${p.name}"] as? Bool) ?? false`;
  }
}
