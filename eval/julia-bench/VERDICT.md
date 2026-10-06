# Julia-1 benchmark — verdict: not wired in

Question: does a 144.3M-parameter decision model beat idea-re's keyword heuristic
on domain classification, the pipeline's most fragile measured component?

Answer: **no.** Measured on 19 specifications the heuristic was never fitted to.

| classifier | accuracy | data-format | distributed-systems | generic | agent-protocol |
|---|---|---|---|---|---|
| keyword heuristic | **10/19 (53%)** | 4/6 | 1/2 | 5/8 | 0/3 |
| Julia-1, CPU | 9/19 (47%) | 4/6 | 1/2 | 7/8 | 2/3 |

```bash
npm run eval:fetch
node eval/julia-bench/make-cases.mjs          # also prints --titles
# then, in a Python 3.11 environment with torch and the Julia-1 weights:
python eval/julia-bench/run-julia.py
```

## Two measurement bugs found before the comparison meant anything

**Fabricated labels.** The first table was written from RFC numbers recalled from
memory and was wrong about five: 8032 was labelled CRDTs (it is EdDSA), 9548 was
forward error correction (it is PKCS #12 transport), 9325 was a tree format (it
is DTLS), 9226 and 9704 did not support their labels either. That fabricated a
"distributed-systems scores 0/5" result that blamed the classifier for the
benchmark's own error. Raft scores 1/2 as it stands.

`make-cases.mjs` now derives each label from the document's own title and exits
non-zero when the two disagree. Labels are transcribed from `--titles` output,
not remembered.

**Table-of-contents contamination.** 15 of 19 excerpts were a table of contents
rather than prose. A TOC is a list of section titles, so it can only match on
vocabulary — exactly the failure mode under test. Every earlier result, Julia's
included, was computed on section headings.

`stripBoilerplate` now drops a leading TOC run, and excerpts start after the
abstract. TOC-like excerpts fell from 15/19 to 1/19.

Correcting both moved the numbers materially: the heuristic went from an
apparent 11/22 to 8/19, and Julia from 6/22 to 9/19. **The earlier verdict — that
Julia was confidently wrong — was based on TOC text and does not survive
correction.** What holds up is narrower and still sufficient: Julia does not beat
the heuristic, and it costs 550 MB plus a Python 3.11 environment.

## Where each classifier wins

Julia is better at `agent-protocol` (2/3 against 0/3) and at `generic` (7/8
against 5/8). It is worse at `generic`-heavy precision and equal elsewhere.

`agent-protocol` at 0/3 for the heuristic is a real defect. The domain's five
decision questions are about persistent state across sessions — concurrency,
provenance, contradiction policy, retrieval scope, scheduling — and a document
about HTTP request semantics raises none of them. The lens is right for the
*idea* of a session protocol and wrong for HTTP the protocol.

## Why it was not adopted

One decision model, 550 MB of weights, a Python 3.11 virtualenv, and torch on
CPU, to answer "which of four labels" — for a number that does not beat a regex.
The abstraction the heuristic would need (a pluggable backend) is not worth
building until something better than the regex exists to plug in.

The benchmark is kept so a future classifier has a baseline to beat rather than
an assumption, and so the labels stay verified.

## The honest conclusion

Domain classification remains idea-re's weakest measured component, and the
measurement is now trustworthy enough to act on:

- `agent-protocol` 0/3 — the domain's questions do not describe HTTP.
- `distributed-systems` 1/2 — under-sampled. IETF has almost no replicated-systems
  documents; a search for consensus RFCs returned "On Consensus and Humming in the
  IETF". Raft is currently the only real case.

Neither is fixed by a smaller model. Fixing the first needs decision questions
that describe a session protocol rather than assuming one; fixing the second needs
more real specifications to measure against.
