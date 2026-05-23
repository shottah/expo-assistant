/**
 * Schema-conformant AppIntent codegen.
 *
 * Generates a Swift struct with `@AppIntent(schema: ...)` macro
 * applied. This is the additive extension to TypedIntentSwift for
 * schema-bound intents (issue #30) — most of the structure mirrors the
 * vanilla `generateTypedIntentStruct`, but with these differences:
 *
 *   1. Wrapped with `@available(iOS 18.0, *)` (catalog-driven)
 *   2. Prefixed with `@AppIntent(schema: .x.y)` macro line
 *   3. OMITS `static var title` / `static var description` — schema
 *      OWNS those (Apple's stated guidance, verified in spike A1)
 *   4. Conforms to the schema's required protocol (e.g.
 *      `ShowInAppSearchResultsIntent`) instead of bare `AppIntent`
 *   5. Required parameters AUTO-INJECTED from the catalog with the
 *      exact Apple Swift type (e.g. `StringSearchCriteria`) — developer
 *      cannot override per spike finding (would conflict)
 *   6. Emits the catalog's static declarations (e.g. `searchScopes`)
 *   7. Emits `static let isAssistantOnly: Bool = true` when configured
 *   8. perform() routes to JS via the same emitIntent bridge as vanilla
 *      intents — the JS handler receives the schema's parameter values
 *      under their canonical names
 *
 * Uses the new `@AppIntent(schema:)` macro spelling, NOT the deprecated
 * `@AssistantIntent(schema:)` (spike D — Xcode emits a deprecation
 * warning if you use the old one).
 */

import type { AppShortcutParameter } from "../../../types";
import { capitalize, escapeSwift, marshalExpr, swiftTypeFor } from "../types";
import { SchemaIntentSpec } from "./catalog";

/**
 * Generates the Swift source for a single schema-bound AppIntent struct.
 *
 * @param structName Swift type name to generate (e.g. "SearchProductsIntent")
 * @param id Intent ID — the routing key passed to emitIntent
 * @param spec The catalog entry describing the schema's Swift shape
 * @param extraParams Developer-declared parameters BEYOND the schema's
 *                    required set. These pass through to @Parameter
 *                    declarations and into the JS handler payload.
 * @param assistantOnly Whether to emit `static let isAssistantOnly = true`
 */
export function generateSchemaIntentStruct(
  structName: string,
  id: string,
  spec: SchemaIntentSpec,
  extraParams: AppShortcutParameter[],
  assistantOnly: boolean
): string {
  // Required params auto-injected from the catalog — declared as
  // bare `var name: Type` (NOT @Parameter-wrapped) because the
  // @AppIntent(schema:) macro applies @Parameter automatically based
  // on the schema's contract. Manually adding @Parameter here would
  // conflict with the macro's expansion.
  const requiredDecls = spec.requiredParams
    .map((p) => {
      const defaultClause = p.defaultValue ? ` = ${p.defaultValue}` : "";
      return `    public var ${p.name}: ${p.swiftType}${defaultClause}`;
    })
    .join("\n");

  // Extra developer params — these DO get @Parameter wrappers because
  // they're not in the schema's contract. Apple's docs explicitly
  // permit "additional metadata as needed" on schema intents (verified
  // in spike E — compiles cleanly with extra params).
  const extraParamDecls = extraParams
    .map((p) => {
      const paramTitleEsc = escapeSwift(p.title ?? capitalize(p.name));
      const dialog = p.prompt
        ? `,\n        requestValueDialog: "${escapeSwift(p.prompt)}"`
        : "";
      return `    @Parameter(\n        title: "${paramTitleEsc}"${dialog}\n    )\n    public var ${p.name}: ${swiftTypeFor(p.type)}`;
    })
    .join("\n\n");

  // Catalog-defined static declarations (e.g. `searchScopes`).
  const staticDecls = (spec.staticDeclarations ?? [])
    .map((d) => `    ${d.declaration}`)
    .join("\n");

  // isAssistantOnly opt-in.
  const assistantOnlyDecl = assistantOnly
    ? `    public static let isAssistantOnly: Bool = true\n`
    : "";

  // perform() body — marshals every parameter (required + extras) back
  // through the JS bridge. Required params use the catalog's Swift type;
  // extra params use our existing marshalExpr mapping.
  const requiredMarshals = spec.requiredParams.map(
    (p) => `                    "${p.name}": ${marshalRequiredParam(p.name, p.swiftType)}`
  );
  const extraMarshals = extraParams.map(
    (p) => `                    "${p.name}": ${marshalExpr(p)}`
  );
  const allMarshals = [...requiredMarshals, ...extraMarshals].join(",\n");

  // Compose the body sections. Order: assistantOnly, staticDecls,
  // requiredDecls, extraParamDecls, init, perform.
  const bodySections: string[] = [];
  if (assistantOnlyDecl) bodySections.push(assistantOnlyDecl.trimEnd());
  if (staticDecls) bodySections.push(staticDecls);
  if (requiredDecls) bodySections.push(requiredDecls);
  if (extraParamDecls) bodySections.push(extraParamDecls);
  bodySections.push(`    public init() {}`);
  bodySections.push(
    `    public func perform() async throws -> ${returnTypeFor(spec)} {
        await MainActor.run {
            ExpoAssistantModule.shared?.emitIntent(
                id: "${escapeSwift(id)}",
                parameters: [${allMarshals ? `\n${allMarshals}\n                ` : ":"}]
            )
        }
        return .result()
    }`
  );

  return `@available(iOS ${spec.minIOS}, *)
@AppIntent(schema: ${spec.schemaDotPath})
public struct ${structName}: ${spec.conformingProtocol} {
${bodySections.join("\n\n")}
}`;
}

/**
 * Returns the Swift return-type clause for perform() based on the
 * schema's catalog entry.
 */
function returnTypeFor(spec: SchemaIntentSpec): string {
  switch (spec.returnType.kind) {
    case "intentResult":
      return "some IntentResult";
    case "intentResultAndReturnsValue":
      return `some IntentResult & ReturnsValue<${spec.returnType.swiftValueType}>`;
  }
}

/**
 * Marshal a schema-required parameter into the JS-bound dict. Handles
 * Apple framework types that our generic `marshalExpr` doesn't know
 * about (e.g. `StringSearchCriteria.term`).
 *
 * Falls back to direct passthrough for types we haven't mapped — the
 * JS side will see whatever Swift's default JSON encoding produces.
 * Add cases here as new schemas land that need custom unwrapping.
 */
function marshalRequiredParam(name: string, swiftType: string): string {
  switch (swiftType) {
    case "StringSearchCriteria":
      // StringSearchCriteria wraps a `term: String`. JS handlers
      // expect a plain string, so unwrap before sending across the
      // bridge.
      return `${name}.term`;
    default:
      return name;
  }
}
