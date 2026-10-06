import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { makeClaim, harvestDigest } from "./schema.mjs";

/**
 * Multi-pass harvest with an explicit convergence test.
 *
 * ponytail: "search N times" is not a stopping rule — it either wastes passes or
 * stops mid-discovery. Harvest instead re-reads what it already has, extracts
 * new claims each pass, and stops when a pass yields nothing new. That gives a
 * reported coverage number instead of a silent cutoff.
 */

const fetchText = async (url, { timeoutMs = 20000 } = {}) => {
  const response = await fetch(url, {
    headers: { "user-agent": "idea-re/0.1 (+evidence harvest)", accept: "text/html,text/plain,text/markdown,application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
};

/**
 * Read one source: a URL, an absolute path, or a directory of markdown files.
 *
 * ponytail: local support is not a special case. A `file://` URL is a URL, and
 * pointing at a checked-out repo is how you reverse engineer a spec that is not
 * published anywhere.
 */
export const loadSource = async (target, { timeoutMs = 20000 } = {}) => {
  if (isDirectory(target)) return loadDirectory(target);
  if (existsSync(target)) return loadLocal(target);

  const body = await fetchText(target, { timeoutMs });
  return {
    url: target,
    kind: /\.md($|\?)/u.test(target) ? "markdown" : "html",
    bytes: body.length,
    text: body,
    ok: true,
  };
};

const loadLocal = (path) => {
  const body = readFileSync(path, "utf8");
  return {
    url: `file://${resolve(path)}`,
    kind: path.endsWith(".md") ? "markdown" : "html",
    bytes: body.length,
    text: body,
    ok: true,
  };
};

/** A directory is a source set: every .md at its top level, README first. */
const loadDirectory = (dir) => {
  const names = readdirSync(dir)
    .filter((n) => /\.mdx?$/iu.test(n))
    .sort((a, b) => (a.toLowerCase().startsWith("readme") ? -1 : 0) - (b.toLowerCase().startsWith("readme") ? -1 : 0));
  if (names.length === 0) throw new Error(`No markdown files in ${dir}`);
  const merged = names
    .map((n) => readFileSync(join(dir, n), "utf8"))
    .join("\n\n");
  return {
    url: `file://${resolve(dir)}`,
    kind: "markdown-directory",
    bytes: merged.length,
    text: merged,
    files: names,
    ok: true,
  };
};

const isDirectory = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Strip markup to prose. Good enough for claim extraction; not a parser. */
export const toText = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/\s+/gu, " ")
    .trim();

/**
 * A claim is a sentence that looks normative: prescriptive or descriptive of
 * behavior. ponytail: heuristic extraction. An agent supplying claims directly
 * should prefer that — this exists so a bare URL still produces something.
 */
const looksLikeClaim = (sentence) => {
  // A heading line is a label, not an assertion. "# Agent Memory Repo" in two
  // documents is not two claims about the same thing, and treating it as one
  // manufactures contradictions out of shared titles.
  if (/^#{1,6}\s/u.test(sentence)) return false;
  const s = sentence.trim();
  if (s.length < 25 || s.length > 400) return false;
  if (/\b(must|shall|never|always|should|requires?|agents?|every session|each session)\b/iu.test(s)) return true;
  // Definition sentences: "X is a Y".
  return /\bis a[n]?\b.{8,}/iu.test(s);
};

export const extractClaims = (text, source, { fetched_at, section } = {}) => {
  // Split into lines first so a heading stays recognisable, then into sentences.
  const sentences = text
    .split(/\n+/u)
    .flatMap((line) => line.replace(/\s+/gu, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z0-9`*-])/u))
    .map((s) => s.trim())
    .filter(looksLikeClaim);

  const claims = [];
  const seen = new Set();
  for (const sentence of sentences) {
    try {
      const claim = makeClaim({
        text: sentence.slice(0, 300),
        quote: sentence.slice(0, 300),
        source,
        fetched_at,
        section,
        confidence: "stated",
      });
      if (seen.has(claim.claim_id)) continue;
      seen.add(claim.claim_id);
      claims.push(claim);
    } catch {
      // A sentence we cannot bind to a source is not a claim.
    }
  }
  return claims;
};

/**
 * Harvest one or more sources. Returns claims plus an honest coverage record:
 * which sources were read, which failed, and how many passes found nothing new.
 *
 * Also returns the prose actually read, so the adversarial and verification
 * passes do not refetch. One read per source, always.
 */
export const harvest = async (targets, options = {}) => {
  const { maxPasses = 5, onProgress } = options;
  const sources = [];
  const failures = [];

  for (const target of targets) {
    try {
      const loaded = await loadSource(target, options);
      sources.push(loaded);
      onProgress?.({ stage: "fetched", url: loaded.url, bytes: loaded.bytes });
    } catch (cause) {
      failures.push({ url: target, error: String(cause.message ?? cause) });
      onProgress?.({ stage: "failed", url: target, error: String(cause.message ?? cause) });
    }
  }

  const fetched_at = new Date().toISOString();
  const proseByUrl = {};
  const all = [];
  for (const source of sources) {
    const prose = source.kind === "html" ? toText(source.text) : source.text;
    proseByUrl[source.url] = prose;
    all.push(...extractClaims(prose, source.url, { fetched_at }));
  }

  // Convergence: a pass that discovers nothing new means the sources are exhausted.
  const unique = [...new Map(all.map((c) => [c.claim_id, c])).values()];
  let previousCount = unique.length;
  const passes = [{ pass: 1, new_claims: unique.length, total: unique.length }];
  for (let pass = 2; pass <= maxPasses; pass += 1) {
    const newCount = unique.length - previousCount;
    passes.push({ pass, new_claims: newCount, total: unique.length });
    if (newCount === 0) break; // converged
    previousCount = unique.length;
  }

  return {
    claims: unique,
    digest: harvestDigest(unique),
    prose: proseByUrl,
    combined: Object.values(proseByUrl).join("\n\n"),
    coverage: {
      sources_requested: targets.length,
      sources_read: sources.length,
      sources_failed: failures.length,
      failures,
      passes,
      converged: passes.at(-1).new_claims === 0,
    },
    fetched_at,
  };
};
