import { createHash } from "node:crypto";

/**
 * A claim carries provenance instead of a content digest.
 *
 * ponytail: an idea has no bytes to hash, so `subject.digest` from REA's
 * Evidence model has no honest equivalent here. A claim is identified by its
 * normalized text, and backed by the exact quoted span it was read from.
 */

/** Stable id for a claim: hash of normalized text, not of a byte range. */
export const claimId = (text) =>
  `clm_${createHash("sha256").update(normalize(text)).digest("hex").slice(0, 24)}`;

export const normalize = (text) =>
  text.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim().replace(/\s+/gu, " ");

/** How strongly the sources support a claim. Ordered: higher wins on conflict. */
export const CONFIDENCE = {
  stated: 3, // a source says this outright
  demonstrated: 2, // shown by an example, not asserted
  inferred: 1, // our reading; nobody said it
};

const url = (value) => {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};

/**
 * One verifiable assertion, bound to the exact text that supports it.
 * Rejects a claim with no quote: an unsourced idea is an opinion.
 */
export const makeClaim = (input) => {
  const errors = [];
  const text = String(input.text ?? "").trim();
  const quote = String(input.quote ?? "").trim();
  const sourceUrl = String(input.source ?? "");

  if (text.length === 0) errors.push("text is required");
  if (quote.length === 0) errors.push("quote is required: an unsourced claim is an opinion");
  if (url(sourceUrl) === undefined) errors.push("source must be an absolute URL");

  const confidence = input.confidence ?? "inferred";
  if (!(confidence in CONFIDENCE))
    errors.push(`confidence must be one of ${Object.keys(CONFIDENCE).join(", ")}`);

  if (errors.length > 0)
    throw new TypeError(`Invalid claim: ${errors.join("; ")}`);

  return Object.freeze({
    claim_id: claimId(text),
    text,
    quote,
    source: sourceUrl,
    fetched_at: input.fetched_at ?? new Date().toISOString(),
    confidence,
    section: input.section ?? null,
  });
};

/** Content hash of a whole harvest, so a rerun is provably the same evidence. */
export const harvestDigest = (claims) =>
  `hst_${createHash("sha256")
    .update(claims.map((c) => `${c.claim_id}:${c.source}`).sort().join("\n"))
    .digest("hex")
    .slice(0, 24)}`;
