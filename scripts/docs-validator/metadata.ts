// Metadata block validation — AGENTS.md §8.
//
// Every document in `docs/` opens with:
//
//     # <Title>
//
//     **Status:** Draft | In Review | Approved
//     **Owner:** <human or agent>
//     **Last updated:** YYYY-MM-DD
//     **Phase:** 01-discovery
//
// Two conventions the repository already follows are accepted deliberately:
// extra fields (several documents carry `**Scope:**`), and an annotation after
// the date (`2026-08-20 (re-verified against the live crawl)`), which records WHY a
// document was touched and is more useful than the bare date.
//
// `Status: Approved` is set by a human only; this validator reads status, it
// never judges who set it.
//
// ## Unfilled placeholders
//
// A field whose value is written in angle brackets — `<YYYY-MM-DD>`, `<name>`
// — is a TEMPLATE placeholder: a slot the reader has to fill. This kit ships
// its discovery and implementation documents as templates, and putting a real
// date in one would be a fabricated date that goes stale the moment somebody
// clones it.
//
// So a placeholder is a WARNING, not an error, and it names the field. The
// severity split is the same one this whole tool uses: an unfilled slot is
// visible and deviates from the convention; it does not break anything a link
// or an anchor depends on. `--strict` promotes it for anyone who disagrees,
// and the summary counts them on every run so nobody forgets.

import type { Document } from "./markdown.ts";
import type { Finding } from "./finding.ts";

const FIELD = /^\*\*([^:*]+):\*\*\s*(.*)$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})\b/;
const PHASE_DIRECTORY = /^\d{2}-[a-z0-9-]+$/;
/** A template slot the reader has to fill: `<YYYY-MM-DD>`, `<name>`. */
const PLACEHOLDER = /^<[^<>]+>$/;

const REQUIRED = ["Status", "Owner", "Last updated", "Phase"] as const;
const STATUSES = ["Draft", "In Review", "Approved"];

const isRealDate = (year: string, month: string, day: string): boolean => {
  const parsed = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() + 1 === Number(month) &&
    parsed.getUTCDate() === Number(day)
  );
};

/** The phase directory a document sits in, when it sits in one. */
const phaseOf = (path: string): string | null => {
  const segment = path.split("/").at(-2) ?? "";
  return PHASE_DIRECTORY.test(segment) ? segment : null;
};

/**
 * The convention is scoped: AGENTS.md §8 says "every document in `docs/` opens
 * with a metadata block". A `README.md` next to code is boundary documentation
 * under §9.2, not a phase document, and holding it to a phase document's rules
 * would produce a finding on every one of them.
 */
const isPhaseDocument = (path: string): boolean => path.startsWith("docs/");

export function validateMetadata(document: Document): readonly Finding[] {
  if (!isPhaseDocument(document.path)) return [];

  const findings: Finding[] = [];
  const at = (
    line: number,
    rule: string,
    detail: string,
    severity: Finding["severity"] = "error",
  ): void => {
    findings.push({ path: document.path, line, rule, severity, detail });
  };

  const first = document.lines.find(
    (line) => !line.fenced && line.text.trim() !== "",
  );

  if (first === undefined) {
    at(0, "meta-empty", "the document is empty.");
    return findings;
  }

  if (!/^#\s+\S/.test(first.text)) {
    at(
      first.number,
      "meta-title",
      "a document must open with a level-1 title (AGENTS.md §8).",
    );
  }

  // The block is the run of `**Field:** value` lines before the first blank
  // line after the title. Reading only that run keeps a bolded lead sentence
  // further down the page from being mistaken for metadata.
  const fields = new Map<string, { value: string; line: number }>();
  let started = false;
  for (const line of document.lines) {
    if (line.number <= first.number || line.fenced) continue;
    const match = FIELD.exec(line.text.trim());
    if (match === null) {
      if (started) break;
      if (line.text.trim() === "") continue;
      break;
    }
    started = true;
    const name = match[1].trim();
    if (!fields.has(name)) {
      fields.set(name, { value: match[2].trim(), line: line.number });
    }
  }

  if (fields.size === 0) {
    at(
      first.number,
      "meta-block-missing",
      "no metadata block follows the title. Every document in `docs/` opens with Status / Owner / Last updated / Phase (AGENTS.md §8).",
    );
    return findings;
  }

  for (const name of REQUIRED) {
    if (!fields.has(name)) {
      at(
        first.number,
        "meta-field-missing",
        `the metadata block has no \`**${name}:**\` field (AGENTS.md §8).`,
      );
    }
  }

  // An unfilled template placeholder. Reported once per field, and BEFORE the
  // value rules below, which then skip it: `<YYYY-MM-DD>` is not a malformed
  // date, it is an absent one, and saying both would be two findings about one
  // slot.
  for (const [name, field] of fields)
    if (PLACEHOLDER.test(field.value))
      at(
        field.line,
        "meta-placeholder",
        `${name} is still the template placeholder ${field.value} — fill it in.`,
        "warning",
      );

  // As with the date, a trailing annotation is accepted: "Draft — awaiting
  // human rulings" is a Draft that says what it is waiting for, and the
  // repository already uses that form. The LEADING token is what is checked.
  const status = fields.get("Status");
  const declaredStatus = status?.value.split(/\s+[—-]\s+/)[0].trim() ?? "";
  if (
    status !== undefined &&
    !PLACEHOLDER.test(status.value) &&
    !STATUSES.includes(declaredStatus)
  ) {
    at(
      status.line,
      "meta-status-value",
      `Status is "${status.value}"; AGENTS.md §8 defines ${STATUSES.map((value) => `"${value}"`).join(" · ")}.`,
    );
  }

  const owner = fields.get("Owner");
  if (
    owner !== undefined &&
    !PLACEHOLDER.test(owner.value) &&
    owner.value === ""
  ) {
    at(owner.line, "meta-owner-empty", "Owner is blank.");
  }

  const updated = fields.get("Last updated");
  if (updated !== undefined && !PLACEHOLDER.test(updated.value)) {
    const match = ISO_DATE.exec(updated.value);
    if (match === null) {
      at(
        updated.line,
        "meta-date-format",
        `Last updated is "${updated.value}"; it must begin with an absolute ISO 8601 date (AGENTS.md §8: never "today" or "recently"). An annotation may follow the date.`,
      );
    } else if (!isRealDate(match[1], match[2], match[3])) {
      at(
        updated.line,
        "meta-date-invalid",
        `Last updated is "${match[0]}", which is not a real calendar date.`,
      );
    }
  }

  const phase = fields.get("Phase");
  const directory = phaseOf(document.path);
  if (
    phase !== undefined &&
    !PLACEHOLDER.test(phase.value) &&
    directory !== null &&
    phase.value !== directory
  ) {
    at(
      phase.line,
      "meta-phase-mismatch",
      `Phase is "${phase.value}" but the document sits in \`${directory}/\` (AGENTS.md §9.3 — placement and phase must agree).`,
    );
  }

  return findings;
}
