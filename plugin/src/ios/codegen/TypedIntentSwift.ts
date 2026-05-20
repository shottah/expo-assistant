/**
 * Per-shortcut typed AppIntent codegen.
 *
 * For each AppShortcut entry that declares `parameters`, generates a
 * dedicated `AppIntent`-conforming Swift struct named via
 * `intentStructName(id)`. Each parameter becomes an `@Parameter` with
 * `requestValueDialog` sourced from `prompt`; `parameterSummary`
 * references every parameter so iOS's tap-from-Library flow walks the
 * user through each unbound value via the needs-value prompt path.
 *
 * `perform()` marshals the full parameter dict back through
 * `ExpoAssistantModule.shared?.emitIntent(id:parameters:)` — the same
 * bridge GenericVoiceIntent uses, so the JS handler routing surface
 * doesn't have to know which intent flavor fired.
 */

import type { AppShortcutParameter } from "../../types";
import {
  capitalize,
  escapeSwift,
  marshalExpr,
  swiftTypeFor,
} from "./types";

export function generateTypedIntentStruct(
  structName: string,
  id: string,
  title: string,
  params: AppShortcutParameter[]
): string {
  const titleEsc = escapeSwift(title);

  const paramDecls = params
    .map((p) => {
      const paramTitleEsc = escapeSwift(p.title ?? capitalize(p.name));
      const dialog = p.prompt
        ? `,\n        requestValueDialog: "${escapeSwift(p.prompt)}"`
        : "";
      return `    @Parameter(\n        title: "${paramTitleEsc}"${dialog}\n    )\n    public var ${p.name}: ${swiftTypeFor(p.type)}`;
    })
    .join("\n\n");

  const summaryInterpolations = params
    .map((p) => `\\(\\.$${p.name})`)
    .join(" ");
  const summaryBody = `${titleEsc} ${summaryInterpolations}`;

  const dictEntries = params
    .map((p) => `                    "${p.name}": ${marshalExpr(p)}`)
    .join(",\n");

  return `@available(iOS 16.0, *)
public struct ${structName}: AppIntent {
    public static var title: LocalizedStringResource = "${titleEsc}"

    public static var parameterSummary: some ParameterSummary {
        Summary("${summaryBody}")
    }

${paramDecls}

    public init() {}

    public func perform() async throws -> some IntentResult {
        await MainActor.run {
            ExpoAssistantModule.shared?.emitIntent(
                id: "${escapeSwift(id)}",
                parameters: [
${dictEntries}
                ]
            )
        }
        return .result()
    }
}`;
}
