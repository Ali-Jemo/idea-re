#!/usr/bin/env node
/**
 * Parse the RFCScope errata corpus into structured JSON for evaluation.
 *
 * Source: https://github.com/HIPREL-Group/RFCScope (studied-errata/)
 * 239 categorised findings across 7 subtypes, derived from 273 verified IETF
 * errata. Layout is uniform: title, RFC metadata, a fenced "says / should say /
 * Notes" block, then an Explanation.
 *
 * ponytail: only the fields the evaluator needs. The whole corpus is ~1.1 MB of
 * markdown with no API to query, so parsing once into JSON is worth it.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CORPORA, ensureDir, RFCSCOPE } from "./paths.mjs";

const ROOT = process.argv[2] ?? join(RFCSCOPE, "studied-errata");
const OUT = process.argv[3] ?? ensureDir(CORPORA) + "/corpus.json";

const FENCE = /```\n([\s\S]*?)```/u;

const parseOne = (subtype, filename, text) => {
  const header = /^# Errata (\d+) - RFC (\d+)/u.exec(text);
  const title = /\*\*RFC Title:\*\*\s*(.+)/u.exec(text);
  const fence = FENCE.exec(text);
  const body = fence?.[1] ?? "";
  const explanation = /## Explanation\s*([\s\S]*)$/u.exec(text)?.[1]?.trim() ?? "";

  // Split the fenced block at the markers the corpus uses. The "says:" line
  // carries a section reference and a space before the colon ("Section 7 says:").
  const saysIdx = body.search(/^\s*\S[^\n]*\bsays\s*:\s*$/mu);
  const shouldIdx = body.search(/^\s*It should say\s*:\s*$/mu);
  const notesIdx = body.search(/^\s*Notes\s*:\s*$/mu);

  const slice = (from, to) =>
    from === -1 ? "" : body.slice(from, to === -1 ? body.length : to).trim();

  const stripSays = (s) => s.replace(/^\s*\S[^\n]*\bsays\s*:\s*$/mu, "").trim();
  const original = saysIdx === -1 ? "" : stripSays(slice(saysIdx, shouldIdx === -1 ? notesIdx : shouldIdx));
  const corrected = shouldIdx === -1 ? "" : slice(shouldIdx, notesIdx).replace(/^\s*It should say\s*:\s*$/mu, "").trim();
  const notes = slice(notesIdx, -1);

  const keywordSet = [
    ...new Set((original + " " + notes + " " + explanation).match(/\b(MUST NOT|MUST|SHALL NOT|SHALL|REQUIRED|SHOULD NOT|SHOULD|MAY|OPTIONAL)\b/gu) ?? []),
  ];

  return {
    id: header ? `eid${header[1]}` : filename.replace(/\.md$/u, ""),
    rfc: header?.[2] ?? null,
    subtype,
    rfc_title: title?.[1]?.trim() ?? null,
    original,
    corrected,
    notes,
    explanation,
    keywords: keywordSet,
    // I-1 in the corpus includes strength drift (Errata 3945). A finding whose
    // original and corrected differ by exactly one requirement keyword is that
    // shape, whatever the corpus filed it under.
    strength_changed:
      keywordSet.length > 0 &&
      keywordSet.some((k) => !["MUST NOT","MUST","SHALL NOT","SHALL","REQUIRED","SHOULD NOT","SHOULD","MAY","OPTIONAL"].includes(k)) === false &&
      original !== "" &&
      /MUST|SHOULD|SHALL|MAY|REQUIRED|OPTIONAL/u.test(original) &&
      original.replace(/\b(MUST|SHOULD|SHALL|MAY|REQUIRED|OPTIONAL)\b/gu, (m) => m) !== corrected.replace(/\b(MUST|SHOULD|SHALL|MAY|REQUIRED|OPTIONAL)\b/gu, (m) => m),
  };
};

const corpus = [];
for (const subtype of existsSync(ROOT) ? readdirSync(ROOT) : []) {
  const dir = join(ROOT, subtype);
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    continue;
  }
  for (const filename of entries) {
    if (!filename.endsWith(".md")) continue;
    // The corpus is checked out with CRLF on some filesystems; a ```\n fence
    // pattern silently matches nothing otherwise, which looks like a parse bug
    // rather than a line-ending bug.
    const text = readFileSync(join(dir, filename), "utf8").replace(/\r\n/gu, "\n");
    corpus.push(parseOne(subtype, filename, text));
  }
}

writeFileSync(OUT, JSON.stringify(corpus, null, 2));
const bySubtype = corpus.reduce((acc, c) => ({ ...acc, [c.subtype]: (acc[c.subtype] ?? 0) + 1 }), {});
process.stdout.write(`parsed ${corpus.length} findings -> ${OUT}\n`);
process.stdout.write(`by subtype: ${JSON.stringify(bySubtype)}\n`);
process.stdout.write(`with original+corrected: ${corpus.filter((c) => c.original && c.corrected).length}\n`);
process.stdout.write(`with explanation: ${corpus.filter((c) => c.explanation).length}\n`);
process.stdout.write(`distinct RFCs: ${new Set(corpus.map((c) => c.rfc)).size}\n`);