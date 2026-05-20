/**
 * AppEnum codegen.
 *
 * Generates the Swift `AppEnum`-conforming enum for a declared
 * `ios.enums[]` entry. Each case becomes `case <id>` with a matching
 * entry in `caseDisplayRepresentations` so iOS can render the case
 * names in pickers and speak them via Siri.
 *
 * AppEnum is one of two types Apple's `AppShortcutPhrase` accepts as
 * voice slots (the other is `AppEntity`), so enum-typed parameters
 * can appear in phrase templates via `${paramName}`.
 *
 * Pure: takes a declaration in, returns Swift source text out. The
 * `withIOSAppShortcutsCodegen` mod composes this with the other
 * generators to assemble the full provider file.
 */

import type { AppEnumDeclaration } from "../../types";
import { pluginError } from "../../utils/errors";
import { escapeSwift } from "./types";

const SWIFT_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function generateAppEnumStruct(decl: AppEnumDeclaration): string {
  if (!SWIFT_IDENT.test(decl.name)) {
    throw pluginError({
      what: `enum name "${decl.name}" is not a valid Swift identifier`,
      why: "Swift type names must start with a letter or underscore and contain only letters, digits, and underscores.",
      how: `Rename the enum to a valid Swift identifier (PascalCase by convention, e.g. "WorkoutType").`,
    });
  }
  if (decl.cases.length === 0) {
    throw pluginError({
      what: `enum "${decl.name}" must declare at least one case`,
      why: "An empty AppEnum has no possible values, so Siri/Shortcuts can't surface it as a picker option.",
      how: `Add at least one { id, display } entry to the "${decl.name}" enum's cases array.`,
    });
  }
  for (const c of decl.cases) {
    if (!SWIFT_IDENT.test(c.id)) {
      throw pluginError({
        what: `enum "${decl.name}" case id "${c.id}" is not a valid Swift identifier`,
        why: "Each case becomes a literal `case <id>` in the generated Swift enum, so the id must be a valid Swift identifier.",
        how: `Rename the case id to a valid Swift identifier (lowercase by convention, e.g. "running" or "in_progress").`,
      });
    }
  }

  const displayNameEsc = escapeSwift(decl.displayName ?? decl.name);
  const caseLines = decl.cases.map((c) => `    case ${c.id}`).join("\n");
  const displayEntries = decl.cases
    .map((c) => `        .${c.id}: "${escapeSwift(c.display)}",`)
    .join("\n");

  return `@available(iOS 16.0, *)
public enum ${decl.name}: String, AppEnum {
${caseLines}

    public static var typeDisplayRepresentation: TypeDisplayRepresentation = "${displayNameEsc}"

    public static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
${displayEntries}
    ]
}`;
}
