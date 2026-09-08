import type { Sop } from "../data-sources/sop-source.js";

export function sopDocumentContent(document: Sop): string {
  return [
    document.id,
    document.title,
    document.keywords.join(" "),
    document.steps.join(" "),
  ].join("\n");
}
