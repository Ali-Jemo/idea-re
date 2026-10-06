#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { analyzeIdea } from "./pipeline.mjs";
import { renderReport } from "./report.mjs";
import { DOMAINS } from "./domains.mjs";

const usage = `idea-re — reverse engineer an idea, mechanism, or specification

Usage:
  idea-re analyze <source> [source...] [options]
  idea-re domains

Sources may be absolute URLs, absolute file paths, or a directory of
markdown files (read as one source set).

Options:
  --out FILE        write a self-contained HTML report
  --title TEXT      report title
  --domain NAME     override classification: ${DOMAINS.join(" | ")} | generic
  --json            print the full JSON result

Reports how completely a source specifies an idea: which implementation
decisions it states, which a re-implementer would have to invent, and where
two sources disagree.
`;

const main = async (argv) => {
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(usage);
    return 0;
  }

  const command = argv[0];
  if (command === "domains") {
    for (const d of DOMAINS) process.stdout.write(`${d}\n`);
    process.stdout.write("generic\n");
    return 0;
  }
  if (command !== "analyze") {
    process.stderr.write(`Unknown command: ${command}\n\n${usage}`);
    return 1;
  }

  const sources = [];
  let out = null;
  let asJson = false;
  let title = null;
  let domain;
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") out = argv[++i];
    else if (arg === "--title") title = argv[++i];
    else if (arg === "--domain") domain = argv[++i];
    else if (arg === "--json") asJson = true;
    else if (arg.startsWith("--")) return fail(`Unknown option: ${arg}`);
    else sources.push(arg);
  }

  if (sources.length === 0) return fail("At least one source is required.");

  const result = await analyzeIdea(sources, { domain });
  if (title === null) {
    title = "Idea Reconstruction";
    try {
      const parsed = new URL(sources[0]);
      title = parsed.pathname.replace(/\/$/u, "").split("/").filter(Boolean).at(-1) ?? title;
    } catch {
      // A local path or directory: leave the default title.
    }
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const c = result.coverage;
    process.stdout.write(
      `${result.convergence.rebuildable ? "REBUILDABLE" : `${result.convergence.blocking_gaps} blocking gap(s)`} ` +
        `· ${Math.round(result.convergence.completeness * 100)}% complete · ${result.domain} domain · ` +
        `${result.claims.length} claims (${result.verification.verified} verified) · ` +
        `${c.sources_read}/${c.sources_requested} sources` +
        `${result.contradictions.length > 0 ? ` · ${result.contradictions.length} contradiction(s)` : ""}\n`,
    );
    for (const gap of result.gaps) process.stdout.write(`  ! ${gap.decision}\n`);
    for (const c2 of result.contradictions) process.stdout.write(`  ~ contradiction: "${truncate(c2.a.text)}" vs "${truncate(c2.b.text)}"\n`);
    for (const f of c.failures) process.stdout.write(`  x ${f.url}: ${f.error}\n`);
  }

  if (out !== null) {
    await writeFile(out, renderReport(result, { title }), "utf8");
    process.stdout.write(`Report written to ${out}\n`);
  }
  return 0;
};

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  return 1;
};

const truncate = (text, limit = 58) =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;

process.exitCode = await main(process.argv.slice(2));
