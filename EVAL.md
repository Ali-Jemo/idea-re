# Corpus evaluation

Measured against the [RFCScope](https://github.com/HIPREL-Group/RFCScope)
errata corpus: **239 human-verified findings across 144 IETF RFCs**.

```bash
npm run eval:fetch        # clone the corpus, download the benchmark RFCs
npm run eval:corpus
npm run eval:corpus:errors   # per-finding misclassifications
```

`eval:fetch` sparse-clones [RFCScope](https://github.com/HIPREL-Group/RFCScope)
(errata only) and downloads the 13 benchmark RFCs into `eval/data/`. Paths come
from `eval/paths.mjs`; override with `IDEA_RE_DATA`.

## Subtype classification

| classifier | overall | macro |
|---|---|---|
| rule-based (regex on notes) | 0.239 | 0.146 |
| corpus-derived nearest centroid | 0.075 | 0.338 |

The corpus-derived model emits **precision 1.00** on every label it produces,
with recall 0.15–1.00. It labels 18 of 239 findings and abstains on the rest.

### What the measurement proved

**I-1, I-2 and I-3 are not lexically separable.** All three scored **0.00**
across 202 of 239 findings. Distinguishing a contradiction *inside* one
statement from one that appears only when two statements are read together, or
one that exists only against outside practice, is a semantic judgement about
document structure. No bag of words reaches it.

The model therefore **abstains** on those classes and reports the `I` family
instead. Guessing is worse than silence: an agent will act on a label it does
not know is a guess. Measured labelable accuracy:

| subtype | n | precision | recall |
|---|---|---|---|
| U-1 undefined term | 7 | 1.00 | 0.71 |
| U-2 incomplete constraint | 15 | 1.00 | 0.20 |
| U-3 indirect underspec | 10 | 1.00 | 0.30 |
| U-4 bad reference | 5 | 1.00 | 1.00 |
| I-3 knowledge conflict | 13 | 1.00 | 0.15 |

Cross-validated on the 50 labelable findings: **0.02**. The in-sample numbers
above are optimistic; treat them as an upper bound.

### Two bugs the corpus exposed

1. `[^.]{0,40}` cannot match across `"3.2 and 3.3 do not exist"` — the periods in
   section numbers. U-4 scored 0 until the gap became a lazy `[\s\S]`.
2. Domain scoring by keyword frequency filed CBOR (RFC 8949) as
   `distributed-systems`, because "key ordering" appears 48 times and "the
   consensus of the IETF community" once. Fixed by scoring the *proportion* of
   topical sentences that make a demand.

## Domain classification

Verified on real specifications:

| document | domain | margin over runner-up |
|---|---|---|
| RFC 8949 CBOR | `data-format` | +1.17 |
| RFC 8259 JSON | `data-format` | +3.57 |
| RFC 3339 date-time | `data-format` | +2.54 |
| RFC 6749 OAuth | `generic` | 0.027 — declines to guess |
| RFC 9110 HTTP | `agent-protocol` | +1.20 |
| Agent Memory Repo spec | `agent-protocol` | — |

`stripBoilerplate` exists because RFC 6749 first classified as `data-format` on
its own front matter: "Copyright Notice", "Request for Comments: 6749" and
contents rows matched the parser, identity and size signatures 247 times.

## Detection recall

The studied-errata corpus pairs an original with its correction. idea-re's actual
job is different: read a document nobody edited and report what is wrong with it.
RFCScope published 31 findings of that kind across 14 unmodified RFCs — 3 verified
on the RFC Editor Errata portal, 5 confirmed by the authors.

```bash
npm run eval:detect
```

**30 findings, 13 RFCs, 7 author-confirmed. Recall at 0.3 content-word overlap:**

| metric | value |
|---|---|
| recall, all findings | **0.567** (17/30) |
| recall, author-confirmed only | 0.429 (3/7) |
| mean overlap | 0.377 |

Per category:

| category | recall | |
|---|---|---|
| I-3 knowledge conflict | 1.00 | 2/2 |
| U-3 indirect underspec | 0.80 | 4/5 |
| I-1 direct inconsistency | 0.75 | 3/4 |
| U-2 incomplete constraint | 0.67 | 2/3 |
| U-4 bad reference | 0.50 | 1/2 |
| I-2 indirect inconsistency | 0.40 | 4/10 |
| U-1 undefined term | 0.25 | 1/4 |

### Two bugs this benchmark exposed

**Findings carried no evidence.** A gap said "the size limit is unstated" with no
citation, so it could not be checked against any document and the benchmark
scored a constant 0.000 — a broken measurement that looked like a broken tool.
Every finding now carries the sentences that raised it.

**Evidence started with front matter.** "Further information on Internet
Standards is available in Section 2 of RFC 7841" mentions Internet Standards,
Section, and RFC: it matches every topical signature. Sorting by position made it
the first citation of every finding. Filtering page furniture and preferring the
longest substantive sentence moved recall from **0.40 to 0.567** — the largest
single improvement in this evaluation.

### A verified true positive

RFC 9224, idea-re `gap_canonical-representation`:

> "Elements within these two arrays are not ordered in any way."
> "The longest match is done the same way as in packet forwarding: the addresses
> are converted in binary form and then the binary strings are compared to …"

RFCScope reports RFC9224-1/-2/-3 on exactly this longest-match ordering defect.
idea-re reached it independently, through its ordering question rather than
through the reports.

## False positives and precision

The measurement that matters most: a false gap sends an implementer after a
decision the spec already made. The detection benchmark cannot measure it,
because it only scores documents known to contain defects.

Real RFCs cannot serve as controls either — "no errata" is not "no ambiguity",
and the RFC Editor's errata search is not machine-readable. So the controls are
written, and their correct answer is known by construction: three documents that
settle every decision in their domain, and three that leave exactly one open.

```bash
npm run eval:precision
```

**Before the fixes: precision 0.000.** Four gaps on complete documents, zero
true positives.

| | before | after |
|---|---|---|
| false positives on complete documents | 4 | **0** |
| detection recall on partial documents | 0.00 | **1.00** |
| precision | 0.000 | **1.000** |

### Three bugs this measurement exposed

**Answer patterns matched literal wording.** `/after \d+/` rejects "after two
seconds"; `/ignore unknown/` rejects "MUST ignore any field it does not
recognise". A detector that calls a settled decision open is worse than one that
misses, so `answeredWhen` now matches the *shape of a commitment* — numeric
limits in digits or words, prohibitions, conditional actions with outcomes.

**Hard-wrapped sentences broke word matching.** RFC prose wraps at 70 columns, so
"at\nmost 500 lines" was read as `at` then `most`, and every limit pattern
silently missed. Sentences are now whitespace-collapsed before matching.

**A heading's period split a topic from its answer.** `"Parsing."` and
`"A malformed record MUST be rejected."` are one specification sentence. Scored
apart, the topic and its answer landed in different fragments and a settled
decision read as open.

### Guard against overfitting

Six controls are easy to tune against. The independent check is RFCScope's
31 findings on unmodified RFCs, which nothing in `src/` was fitted to:

| metric | before controls | after controls |
|---|---|---|
| recall, author-confirmed findings | 0.429 | **0.571** |
| recall, all findings | 0.567 | 0.500 |
| false positives, complete documents | — | **0** |

Author-confirmed recall rose while precision went to 1.000, so the fixes are not
fitting the controls.

### Two expectations were wrong

The benchmark was corrected against the tool, not the reverse, where the tool was
right:

- `partial-protocol` has no link syntax at all, so `link-graph-semantics` cannot
  fire. Its real gap is the unbounded `MEMORY.md`, which is what idea-re reported.
- `complete-protocol` was renamed: naming `MEMORY.md` as a per-session entry
  point with no stated bound *is* a gap. The "complete" version now says
  "at most 500 lines".

`partial-format` remains a genuine recall miss: no size limit is stated, but
nothing names an index or manifest either, so the topic is never raised.

## What is still not measured

- **The dismissal gate.** Five criteria, each unit-tested, but never against a
  human's accept/reject decision on real output.
- **Generalisation beyond three domains.** Controls exist for
  `distributed-systems`, `data-format` and `agent-protocol` only.
- **Real-world documents.** Controls are written, not found. A clean production
  spec would test the same thing less circularly.