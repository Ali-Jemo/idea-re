# Julia-1 benchmark — verdict: not wired in

Question: does a 144.3M-parameter decision model beat idea-re's keyword heuristic
on domain classification, the pipeline's most fragile measured component?

Answer: **no.** Measured on 22 real specifications the heuristic was never fitted
to.

| classifier | accuracy | distributed-systems | data-format | generic | agent-protocol |
|---|---|---|---|---|---|
| keyword heuristic | **11/22 (50%)** | 0/5 | 4/9 | 7/7 | 0/1 |
| Julia-1, CPU | 6/22 (27%) | 1/5 | 3/9 | 2/7 | 0/1 |

```bash
npm run eval:fetch
node eval/julia-bench/make-cases.mjs
# then, in a Python 3.11 environment with torch + the Julia-1 weights:
python eval/julia-bench/run-julia.py
```

## The failure mode matters more than the score

**10 of 22 answers were wrong at p > 0.9.** Confidence did not track correctness:

| document | label | Julia said | p |
|---|---|---|---|
| RFC 9224 | data-format | generic | 0.976 |
| RFC 9110 | agent-protocol | generic | 0.940 |
| RFC 8447 (DoQ) | generic | data-format | 0.916 |
| RFC 8032 (CRDTs) | distributed-systems | agent-protocol | 0.943 |

A wrong answer delivered at 0.98 is worse than no answer. For idea-re's purpose
this is disqualifying on its own: a false gap sends an implementer after a
decision the spec already made, and a confidently wrong domain assigns the wrong
decision lens — so the wrong five questions get asked.

Julia also **inverted the heuristic's one strength**: `generic` fell from 7/7 to
2/7. The heuristic declines cleanly on documents it cannot place; Julia commits.

Agreement between the two was 8/22 — they are not making correlated mistakes, so
ensembling buys nothing.

## Why, from the model card

Julia-1 is a finite-choice classifier over supplied options. Selecting a
specification's subject area needs evidence *across* a document — an encoder
over a 2,400-character excerpt weights local vocabulary far more than structure,
so transport protocols (TLS, DoQ, HTTP/2) inherit the word "format" from
adjacent material and the decision follows.

The published evaluations agree: AG News 94/100 at 4 labels, MASSIVE 71.50% at 18
scenario labels, but **Banking77 64/100 at 72 labels**, trailing its reference by
23 points. Choice count is not the variable — label distance from the supplied
context is.

## What was kept

Nothing from the model. Recorded because a future idea-re may want an LLM-backed
router, and "144M decision model" is the obvious cheap answer. It is measurably
worse here, and the 550 MB dependency is not worth it.

The benchmark stays: it re-derives the heuristic baseline whenever the corpus
changes, so any future classifier has a number to beat rather than an assumption.

## The honest conclusion

idea-re's domain classification remains the weakest measured component —
`distributed-systems` at 0/5 is a real gap, not a solved problem. Julia does not
fix it. What would: a classifier that reads structure rather than vocabulary,
which means either an LLM or better features, not a smaller model.