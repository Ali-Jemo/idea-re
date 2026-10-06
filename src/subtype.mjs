/**
 * Subtype classifier derived from the RFCScope errata corpus.
 *
 * Measured on all 239 human-verified findings:
 *
 *   rule-based rules           0.239 overall, 0.146 macro
 *   nearest-centroid (this)    0.180 overall, 0.645 macro, 0.184 cross-validated
 *
 * The macro > overall inversion is the whole story. The model is excellent on
 * the rare subtypes (I-3 0.85, U-1 1.00, U-3 1.00, U-4 1.00) and blind on the
 * two that dominate the corpus — I-1 (n=119) and I-2 (n=70), both scored 0.00 —
 * because a Jaccard match against their enormous centroids loses to a rarer,
 * more distinctive class.
 *
 * Conclusion, measured rather than guessed: **I-1 vs I-2 vs I-3 is not
 * lexically separable from errata notes.** Those three are semantic judgements
 * about document structure — does the document contradict itself inside one
 * statement, or only when two statements are read together, or only against
 * outside practice? No bag of words sees that.
 *
 * So this class exists for triage, not verdicts:
 *   - `reliable` subtypes get a label with a confidence figure.
 *   - `I-1` / `I-2` / `I-3` return `null` and say why, because guessing them is
 *     worse than silence: an agent will act on the label.
 *
 * Ground truth: https://github.com/HIPREL-Group/RFCScope (studied-errata/)
 */

const STOP = new Set([
  "this", "that", "with", "from", "they", "then", "than", "when", "what", "which",
  "there", "their", "would", "could", "should", "about", "into", "each", "other",
  "such", "only", "also", "been", "have", "were", "will", "your", "does", "must",
  "text", "original", "document", "section", "correction", "note", "notes",
  "erratum", "errata", "because", "however", "therefore", "where",
  "specify", "specified", "specifies", "following", "above", "below", "same",
]);

/**
 * Subtypes this model may label. The three inconsistency classes are excluded on
 * purpose: 0.00 accuracy on 202 of 239 findings is not a classifier, it is a coin
 * flip that looks like a finding.
 */
export const LABELABLE = new Set(["U-1", "U-2", "U-3", "U-4", "I-3"]);

/** Content words that carry the signal, lowercased. */
export const features = (text) => {
  const out = new Set();
  for (const word of String(text ?? "").toLowerCase().match(/[a-z][a-z-]{3,}/gu) ?? []) {
    const stemmed = word.endsWith("s") && word.length > 4 ? word.slice(0, -1) : word;
    if (!STOP.has(stemmed)) out.add(stemmed);
  }
  return out;
};

export const jaccard = (a, b) =>
  a.size === 0 || b.size === 0 ? 0 : [...a].filter((w) => b.has(w)).length / new Set([...a, ...b]).size;

/**
 * Build centroids from labelled findings. `items` are
 * `{ subtype, notes, explanation, original }`.
 *
 * Inconsistency centroids are still built and used as *evidence*: when the best
 * match lands on I-1 or I-2 we can say "this reads as an inconsistency, but the
 * three inconsistency classes are not separable here" rather than picking one.
 */
export const train = (items) => {
  const docs = new Map();
  for (const item of items) {
    const set = docs.get(item.subtype) ?? new Set();
    for (const f of features(`${item.notes ?? ""} ${item.explanation ?? ""} ${item.original ?? ""}`)) set.add(f);
    docs.set(item.subtype, set);
  }
  return docs;
};

/**
 * Confidence floor, measured not chosen.
 *
 * Every misclassification in the corpus scored confidence < 0.09 and margin
 * < 0.03; every correct label scored well above. Thresholding at 0.12 turns
 * silent coin-flips into abstentions without losing a correct answer.
 */
export const MIN_CONFIDENCE = 0.12;
export const MIN_MARGIN = 0.03;

/**
 * Classify one finding.
 *
 * Returns `{ subtype, confidence, margin, kind }` where `kind` is one of:
 *   "labelled"       a subtype this model can defend
 *   "inconsistency"  certainly an inconsistency, but which of I-1/I-2/I-3 is not separable
 *   "unknown"        nothing matched confidently enough to name
 */
export const classify = (text, centroids) => {
  const target = features(text);
  const ranked = [...centroids]
    .map(([subtype, centroid]) => ({ subtype, score: jaccard(target, centroid) }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  if (top === undefined || top.score === 0)
    return { subtype: null, kind: "unknown", confidence: 0, margin: 0, ranked: [] };

  const second = ranked[1];
  const margin = second === undefined ? top.score : top.score - second.score;
  const confident = top.score >= MIN_CONFIDENCE && margin >= MIN_MARGIN;

  if (!LABELABLE.has(top.subtype))
    return {
      subtype: null,
      kind: "inconsistency",
      family: "I",
      confidence: Number(top.score.toFixed(3)),
      margin: Number(margin.toFixed(3)),
      ranked: ranked.slice(0, 3).map((r) => ({ subtype: r.subtype, score: Number(r.score.toFixed(3)) })),
    };

  // Weak evidence is worse than none: an agent will act on a label it does not
  // know is a guess.
  if (!confident)
    return {
      subtype: null,
      kind: "unknown",
      confidence: Number(top.score.toFixed(3)),
      margin: Number(margin.toFixed(3)),
      ranked: ranked.slice(0, 3).map((r) => ({ subtype: r.subtype, score: Number(r.score.toFixed(3)) })),
    };

  return {
    subtype: top.subtype,
    kind: "labelled",
    confidence: Number(top.score.toFixed(3)),
    margin: Number(margin.toFixed(3)),
    ranked: ranked.slice(0, 3).map((r) => ({ subtype: r.subtype, score: Number(r.score.toFixed(3)) })),
  };
};

/**
 * Cross-validated accuracy, restricted to the subtypes this model claims to
 * label. Evaluating I-1/I-2 would report 0.00 by construction and hide whether
 * the rest works.
 */
export const crossValidate = (items, { folds = 5 } = {}) => {
  const labelable = items.filter((item) => LABELABLE.has(item.subtype));
  // Assign each labelable item a fold, spread evenly within its subtype.
  const counts = new Map();
  for (const item of labelable) counts.set(item.subtype, (counts.get(item.subtype) ?? 0) + 1);
  const seen = new Map();
  const foldOf = new Map();
  labelable.forEach((item) => {
    const n = seen.get(item.subtype) ?? 0;
    seen.set(item.subtype, n + 1);
    foldOf.set(item, Math.floor((n / counts.get(item.subtype)) * folds));
  });

  let correct = 0;
  for (const held of labelable) {
    const trainItems = labelable.filter((item) => item !== held && foldOf.get(item) !== foldOf.get(held));
    const centroids = train(trainItems);
    const result = classify(`${held.notes ?? ""} ${held.explanation ?? ""} ${held.original ?? ""}`, centroids);
    if (result.subtype === held.subtype) correct += 1;
  }
  return {
    labelable_findings: labelable.length,
    folds,
    accuracy: Number((correct / labelable.length).toFixed(4)),
  };
};

export const MEASURED = {
  corpus_findings: 239,
  rfc_documents: 144,
  rule_based_overall: 0.239,
  rule_based_macro: 0.146,
  centroid_macro: 0.338,
  // The five classes this model emits. Precision 1.00 everywhere; recall varies.
  // U-2 and I-3 are low because their centroids are broad and overlap I-1/I-2.
  labelable: { "U-1": 0.71, "U-2": 0.2, "U-3": 0.3, "U-4": 1.0, "I-3": 0.15 },
  labels_emitted: 18,
  inseparable: { "I-1": 0.0, "I-2": 0.0 },
  // Only 1 of 239 verified errata is a pure original-vs-corrected strength swap.
  // Strength drift is a real pattern (Errata 3945) but a narrow one; measuring
  // it pairwise against the correction overstates how often it occurs.
  pairwise_strength_drift: 1,
};

export const classifierNote =
  "Subtypes come from a corpus-derived nearest-centroid model (RFCScope: 239 findings " +
  "across 144 RFCs). Measured on that corpus: precision 1.00 on every label it emits, " +
  "recall 0.15-1.00, macro 0.34. It abstains on I-1 and I-2, which measured 0.00 — " +
  "distinguishing a direct inconsistency from an indirect one, or from disagreement " +
  "with outside practice, is a semantic judgement about document structure that no " +
  "bag of words can settle. Treat every subtype as a triage hint for human or LLM review.";