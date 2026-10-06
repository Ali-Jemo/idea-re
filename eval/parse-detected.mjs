#!/usr/bin/env node
/**
 * Parse RFCScope's detected-bug reports into a detection benchmark.
 *
 * 31 findings across 14 unmodified RFCs, each with a category, a section
 * reference, and a quoted excerpt. Three were verified on the RFC Editor Errata
 * portal, five were confirmed by the authors.
 *
 * This is the only ground truth that measures what idea-re actually claims to
 * do: read a document nobody edited and find the defects. The studied-errata
 * corpus pairs an original with its correction, which is a different task.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CORPORA, ensureDir, RFCSCOPE } from "./paths.mjs";

const ROOT = process.argv[2] ?? join(RFCSCOPE, "detected-bugs");
const OUT = process.argv[3] ?? join(ensureDir(CORPORA), "detected.json");

const CATEGORY = /\*\*Category\*\*:\s*\(([A-Z0-9-]+)/u;
const STATUS = /\*\*Status\*\*:\s*([^\n]+)/u;
const RFC = /rfc(\d+)/iu;
// Section reference appears in several shapes across the 31 reports:
//   "Excerpt from Section 2:"
//   "Excerpt (from the IPv4 example in Section 5.1):"
//   "Excerpt from Appendix A:"
//   "Appendix A, Table 3 of RFC 9461"
// Accept any of them; the exact locator is not needed to measure detection.
const SECTION = /\bSection\s+([0-9]+(?:\.[0-9]+)*)/iu;
const APPENDIX = /\bAppendix\s+([A-Z0-9]+)\b/u;

// An excerpt is the indented or fenced block following any "Excerpt" mention,
// up to the first explanation heading. Formats differ enough that anchoring on
// a single pattern parsed 3 of 31 files.
const EXCERPT = /Excerpt[^\n]*\n([\s\S]*?)(?=\n\s*(?:Issue Explanation|Issue Description|Explanation|Issue and Explanation|Additional Note)|\n\s*##|$)/u;

// Two reports (RFC9464, RFC9704-5) carry no "Excerpt" heading at all, only a
// quoted span inside a differently-named block. Falling back to the longest
// quoted run recovers them instead of silently dropping ground truth.
const QUOTED = /[“"]([^”"]{40,600})[”"]/u;

const confirmed = (status) =>
  /verified on the rfc editor|confirmed by authors/iu.test(status);

const parseOne = (filename) => {
  const text = readFileSync(join(ROOT, filename), "utf8").replace(/\r\n/gu, "\n");
  const category = CATEGORY.exec(text)?.[1];
  const status = STATUS.exec(text)?.[1]?.trim() ?? "";
  const rfc = RFC.exec(text)?.[1];
  const section = SECTION.exec(text)?.[1] ?? APPENDIX.exec(text)?.[1] ?? null;

  const raw = EXCERPT.exec(text)?.[1] ?? QUOTED.exec(text)?.[1] ?? "";
  // Keep the quote: strip fences, leading indentation, and the smart quotes the
  // reports use, so the text can be matched against a fetched RFC.
  const excerpt = raw
    .replace(/```/gu, " ")
    .split("\n")
    .map((l) =>
      l
        .replace(/^[\s“”"']+/u, "")
        .replace(/[“”"']+$/u, "")
        .trim(),
    )
    .filter((l) => l.length > 0)
    .join(" ");

  return {
    id: filename.replace(/\.md$/u, ""),
    rfc: rfc === undefined ? null : `rfc${rfc}`,
    category,
    status,
    confirmed: confirmed(status),
    section,
    excerpt,
  };
};

const bugs = existsSync(ROOT)
  ? readdirSync(ROOT)
      .filter((f) => f.endsWith(".md"))
      .map(parseOne)
      .filter((b) => b.rfc !== null && b.excerpt.length > 0)
  : [];

writeFileSync(OUT, JSON.stringify(bugs, null, 2));

const byCategory = bugs.reduce((acc, b) => ({ ...acc, [b.category]: (acc[b.category] ?? 0) + 1 }), {});
process.stdout.write(`parsed ${bugs.length} findings -> ${OUT}\n`);
process.stdout.write(`by category: ${JSON.stringify(byCategory)}\n`);
process.stdout.write(`distinct RFCs: ${new Set(bugs.map((b) => b.rfc)).size}\n`);
process.stdout.write(`author-confirmed or errata-verified: ${bugs.filter((b) => b.confirmed).length}\n`);
process.stdout.write(`with section reference: ${bugs.filter((b) => b.section !== null).length}\n`);