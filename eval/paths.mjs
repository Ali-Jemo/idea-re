import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shared paths for the evaluation harnesses.
 *
 * The corpora are not vendored: the RFCScope errata corpus is ~1.1 MB of
 * markdown derived from published IETF errata, and cloning it is one command.
 * Everything defaults to ./eval/data so the harness runs from a clone with no
 * setup beyond `npm run eval:fetch`.
 */

const here = dirname(fileURLToPath(import.meta.url));

export const DATA = process.env.IDEA_RE_DATA ?? resolve(here, "data");
export const RFCSCOPE = join(DATA, "rfcscope");
export const CORPORA = join(DATA, "corpora");
export const RFCS = join(DATA, "rfcs");

export const ensureDir = (path) => {
  mkdirSync(path, { recursive: true });
  return path;
};

export const RFCSCOPE_REPO = "https://github.com/HIPREL-Group/RFCScope.git";

/** The 13 unmodified RFCs carrying RFCScope's verified findings. */
export const BENCHMARK_RFCS = [
  9157, 9224, 9445, 9460, 9461, 9462, 9463, 9471, 9527, 9567, 9606, 9619, 9704,
];

/**
 * A wider set for domain classification: IANA protocol registries across
 * serialization formats, web transports, and replicated systems, so a
 * decision model's accuracy is measured on documents idea-re has never been
 * fitted to.
 */
export const CLASSIFICATION_RFCS = [
  8258, 8259, 8446, 8447, 8852, 8941, 8949, 9110, 9111, 9224, 9226, 9325, 9460,
  9461, 9527, 9548, 9704, 3339, 6269, 6749, 7234, 8032,
];

/**
 * Fetch every corpus the evaluations need.
 *
 * Documents come from rfc-editor.org, which serves the same text the RFC Editor
 * Errata portal indexes. Verification status is not asserted here: the recall
 * benchmark is scored against RFCScope's human-categorised findings, and the
 * precision benchmark uses written controls whose answers are known.
 */
export const fetchAll = async ({ timeoutMs = 30000 } = {}) => {
  ensureDir(CORPORA);
  ensureDir(RFCS);

  const { execFileSync } = await import("node:child_process");
  if (!existsSync(join(RFCSCOPE, "studied-errata"))) {
    ensureDir(DATA);
    process.stderr.write("cloning RFCScope (sparse, errata only)…\n");
    execFileSync(
      "git",
      [
        "clone", "--depth", "1", "--filter=blob:none", "--sparse",
        RFCSCOPE_REPO, RFCSCOPE,
      ],
      { stdio: "inherit" },
    );
    execFileSync("git", ["-C", RFCSCOPE, "sparse-checkout", "set", "studied-errata", "detected-bugs"], {
      stdio: "inherit",
    });
  }

  for (const number of [...new Set([...BENCHMARK_RFCS, ...CLASSIFICATION_RFCS])]) {
    const target = join(RFCS, `rfc${number}.txt`);
    if (existsSync(target)) continue;
    const url = `https://www.rfc-editor.org/rfc/rfc${number}.txt`;
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      process.stderr.write(`  skip RFC ${number}: HTTP ${response.status}\n`);
      continue;
    }
    const { writeFileSync } = await import("node:fs");
    writeFileSync(target, await response.text(), "utf8");
    process.stderr.write(`  fetched RFC ${number}\n`);
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  await fetchAll();
  process.stderr.write(`corpora ready under ${DATA}\n`);
}