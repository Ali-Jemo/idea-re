import { normalize } from "./schema.mjs";

/**
 * Verify claims against a freshly read source.
 *
 * A claim carries a quote. If the source no longer contains that quote, the
 * claim is unsupported — the page changed, the agent paraphrased into fiction,
 * or the extraction misfired. REA can do this because it hashes bytes; we can
 * only do the weaker "does this text still appear", and we say so.
 */
export const verifyClaim = (claim, sourceText, { threshold = 0.82 } = {}) => {
  const haystack = normalize(sourceText);
  const needle = normalize(claim.quote);
  if (needle.length === 0) return { claim_id: claim.claim_id, status: "unverifiable", reason: "empty quote" };

  if (haystack.includes(needle)) return { claim_id: claim.claim_id, status: "verified" };

  // A paraphrase is weaker evidence than an exact hit, but not a failure.
  const tokens = needle.split(" ").filter((w) => w.length > 3);
  if (tokens.length > 0) {
    const present = tokens.filter((t) => haystack.includes(t)).length / tokens.length;
    if (present >= threshold)
      return { claim_id: claim.claim_id, status: "paraphrased", overlap: Number(present.toFixed(2)) };
    return { claim_id: claim.claim_id, status: "unsupported", overlap: Number(present.toFixed(2)) };
  }
  return { claim_id: claim.claim_id, status: "unsupported", overlap: 0 };
};

/** Verify every claim of one source against the text actually read from it. */
export const verifyClaims = (claims, sourceTextsByUrl) => {
  const results = claims.map((claim) => {
    const text = sourceTextsByUrl[claim.source];
    if (text === undefined)
      return { claim_id: claim.claim_id, status: "unverifiable", reason: "source not fetched" };
    return verifyClaim(claim, text);
  });

  const tally = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  return {
    results,
    summary: {
      total: results.length,
      verified: tally.verified ?? 0,
      paraphrased: tally.paraphrased ?? 0,
      unsupported: tally.unsupported ?? 0,
      unverifiable: tally.unverifiable ?? 0,
    },
  };
};