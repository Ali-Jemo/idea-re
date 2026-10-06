# idea-re

Reverse engineering an idea is not summarizing a page. The question is:
**can we rebuild this, and what would we have to invent?**

An idea has no bytes to hash, so claims carry *provenance* — quote, source,
fetch time, confidence — rather than a content digest. A claim without a quote
is rejected: an unsourced claim is an opinion.

## Run

```bash
npm test        # 56 checks
npm link        # optional: puts `idea-re` on PATH
```

```bash
idea-re analyze <source> [source...] [--out report.html] [--domain NAME] [--json]
idea-re domains
```

Sources are URLs, absolute file paths, or a directory of markdown files.
Plenty of specs are never published, so local sources matter.

MCP tools: `idea_analyze`, `idea_report`, `idea_check_claim`,
`idea_find_contradictions`, `idea_domains`, `idea_taxonomy`, `idea_refute`.
Point any MCP client at `src/server.mjs`.

## Evaluate

```bash
npm run eval:fetch      # clone the errata corpus, download the benchmark RFCs
npm run eval:all        # every measurement below
```

Data lands in `eval/data/` (git-ignored). Individual runs: `eval:corpus` for
subtype classification, `eval:detect` for recall on real specifications,
`eval:precision` for false positives on written controls. See [EVAL.md](EVAL.md).

## Pipeline

| Stage | Module | What it produces |
|---|---|---|
| harvest | `harvest.mjs` | claims bound to quotes, convergence record |
| verify | `verify.mjs` | `verified` / `paraphrased` / `unsupported` / `unverifiable` |
| classify | `domains.mjs` | which decision lens applies to this idea |
| adversize | `adversary.mjs` | decisions the source leaves unstated |
| contradict | `contradictions.mjs` | same subject, opposite polarity, across sources |
| strengthen | `taxonomy.mjs` | RFC 2119 MUST/SHOULD drift |
| refute | `refute.mjs` | conservative dismissal, with the criterion recorded |

Sources are read exactly once. Every stage works from that captured prose, so a
page changing mid-run cannot make two stages disagree.

## Reading the verdict

- `rebuildable: true` — no blocking decision was left unstated. NOT "the idea is
  correct".
- `completeness` — fraction of *that domain's* decisions that were settled.
- `subtype` — `I-*` means the spec contradicts itself; `U-*` means it fails to
  speak. Different failures.
- `gate.survival_rate` — how much survived dismissal.
- `coverage.converged` — a harvest pass found no new claims.

## Prior art

The taxonomy and the dismissal gate are adapted from:

> Pawagi, Shao, Lee, Sun, Wang. *RFCScope: Detecting Logical Ambiguities in
> Internet Protocol Specifications.* ASE 2025.
> DOI [10.1109/ASE63991.2025.00106](https://doi.org/10.1109/ASE63991.2025.00106)
> Artifacts: <https://github.com/HIPREL-Group/RFCScope>

The seven subtypes (`I-1`..`I-3`, `U-1`..`U-4`) and their counts come from their
manual categorisation of 273 verified IETF errata. The five dismissal criteria
come from their evaluator prompt, whose stated posture is "extremely
conservative, your default behavior will be to REJECT"; their pipeline emitted
281 candidate reports and 31 survived.

`detectStrengthMismatch` is built against **Errata 3945 (RFC 7139)**, a verified
erratum: SE style is `MUST` for bandwidth increase but `SHOULD` for decrease.
Validated against RFC 9110, where it went from 7 candidate mismatches to 1 after
actor-only false merges were removed.

## Limits

Claim extraction is heuristic. Verification is substring matching over prose,
not a byte digest, so it cannot detect a rewritten page. Gap finding finds
*unstated* decisions, not *wrong* ones. The dismissal gate needs flags idea-re
cannot infer — an agent reviewing the output must supply them, or everything
survives. Subtypes are heuristic approximations of the RFCScope taxonomy, not a
validated classifier.