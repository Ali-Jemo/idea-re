/**
 * Self-contained HTML report. ponytail: no build step, no dependencies — one
 * file you can open or mail. The model graph is inline SVG rather than a 3D
 * library; a spinning cube conveys nothing a flat dependency graph doesn't.
 */

import { IMPLEMENTATION_DECISIONS } from "./adversary.mjs";

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Report the decisions actually examined; fall back to the generic set. */
const decisionsFor = (result) =>
  (result.decisions_examined ?? []).map((id) => {
    const known =
      IMPLEMENTATION_DECISIONS.find((d) => d.id === id) ?? { id, label: id.replace(/-/gu, " ") };
    return { id, label: known.label ?? id.replace(/-/gu, " ") };
  });

/** Layer the decision graph so overlapping nodes stay readable. */
const layout = (gaps, decisions) => {
  // Column count follows the domain's decision count, so a set of 5 and a set
  // of 7 both fit without labels colliding or the map stretching to 4 columns.
  const columns = Math.min(4, Math.max(3, decisions.length));
  const columnWidth = 235;
  const rowHeight = 120;
  const width = 130 + (columns - 1) * columnWidth + 130;
  const rows = Math.ceil(decisions.length / columns);
  const height = 75 + (rows - 1) * rowHeight + 105;
  const nodes = decisions.map((d, i) => {
    const open = gaps.some((g) => g.gap_id === `gap_${d.id}`);
    return {
      id: d.id,
      label: d.id.replace(/-/gu, " "),
      open,
      x: 130 + (i % columns) * columnWidth,
      y: 75 + Math.floor(i / columns) * rowHeight,
    };
  });
  const links = nodes.map((n) => ({ source: n, target: { x: width / 2, y: height - 45 } }));
  return { width, height, nodes, links };
};

const renderSvg = (gaps, decisions) => {
  const { width, height, nodes, links } = layout(gaps, decisions);
  const edges = links
    .map(
      (l) =>
        `<line x1="${l.source.x}" y1="${l.source.y}" x2="${l.target.x}" y2="${l.target.y}"
           stroke="${l.source.open ? "#b45309" : "#94a3b8"}" stroke-width="1.5" stroke-dasharray="${l.source.open ? "4 3" : "none"}" opacity="0.5"/>`,
    )
    .join("");
  const circles = nodes
    .map(
      (n) => `<g>
      <circle cx="${n.x}" cy="${n.y}" r="9" fill="${n.open ? "#b45309" : "#16a34a"}" opacity="0.9"/>
      <text x="${n.x}" y="${n.y + 26}" text-anchor="middle" font-size="10.5"
            font-family="ui-sans-serif,system-ui,sans-serif" fill="#334155">${escapeHtml(n.label)}</text>
    </g>`,
    )
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img"
    aria-label="Implementation decision coverage map">
    ${edges}${circles}
    <text x="${width / 2}" y="${height - 14}" text-anchor="middle" font-size="10"
          font-family="ui-sans-serif,system-ui,sans-serif" fill="#64748b">
      Re-implementation decisions</text>
  </svg>`;
};

const confidenceBadge = (c) => {
  const color = { stated: "#16a34a", demonstrated: "#2563eb", inferred: "#94a3b8" }[c] ?? "#94a3b8";
  return `<span style="background:${color}22;color:${color};border:1px solid ${color}55;
    border-radius:999px;padding:1px 8px;font-size:11px;font-family:ui-monospace,monospace">${escapeHtml(c)}</span>`;
};

export const renderReport = (result, { title = "Idea Reconstruction" } = {}) => {
  const pct = Math.round(result.convergence.completeness * 100);
  const verdict = result.convergence.rebuildable
    ? "<strong style='color:#16a34a'>No blocking gaps found.</strong> Every decision an implementer must make is stated."
    : `<strong style='color:#b45309'>${result.convergence.blocking_gaps} blocking gap(s) found.</strong> A re-implementer would have to invent these decisions.`;

  const gapCards = result.gaps.length
    ? result.gaps
        .map(
          (g) => `<article class="card gap">
        <h3>${escapeHtml(g.topic ?? g.gap_id.replace("gap_", "").replace(/-/gu, " "))}
            ${g.subtype ? `<span class="tag" title="${escapeHtml(g.subtype_label ?? "")}">${escapeHtml(g.subtype)}</span>` : ""}</h3>
        <p class="decision">${escapeHtml(g.decision)}</p>
        ${(g.evidence ?? []).length > 0
          ? `<blockquote class="ev">${g.evidence
              .slice(0, 2)
              .map((e) => `<p>${escapeHtml(e.slice(0, 320))}</p>`)
              .join("")}</blockquote>`
          : ""}
        ${g.strongest && g.weakest ? `<p class="pair"><strong>Mandated:</strong> ${escapeHtml(g.strongest)}</p>
        <p class="pair"><strong>Recommended:</strong> ${escapeHtml(g.weakest)}</p>` : ""}
        <p class="why"><strong>Why it matters:</strong> ${escapeHtml(g.why_it_matters)}</p>
      </article>`,
        )
        .join("")
    : `<article class="card ok"><h3>No gaps</h3><p>${verdict}</p></article>`;

  const contradictionCards = (result.contradictions ?? []).length
    ? `<h2>Cross-source contradictions (${result.contradictions.length})</h2>` +
      result.contradictions
        .map(
          (c) => `<article class="card gap">
        <h3>Unresolved · overlap ${c.overlap}</h3>
        <p class="decision">${escapeHtml(c.a.text)}</p>
        <p class="decision">${escapeHtml(c.b.text)}</p>
        <p class="why">${escapeHtml(c.a.source)} <em>vs</em> ${escapeHtml(c.b.source)}</p>
      </article>`,
        )
        .join("")
    : "";

  const v = result.verification;
  const verificationLine = v
    ? `<p style="margin:.5rem 0 0;font-size:.8rem;color:var(--muted)">
         Claims: ${v.verified} verified, ${v.paraphrased} paraphrased, ${v.unsupported} unsupported,
         ${v.unverifiable} unverifiable.</p>`
    : "";

  const claimRows = result.claims
    .slice(0, 200)
    .map(
      (c) => `<tr>
      <td>${confidenceBadge(c.confidence)}</td>
      <td>${escapeHtml(c.text)}</td>
      <td><a href="${escapeHtml(c.source)}">${escapeHtml(c.source.replace(/^https?:\/\//u, ""))}</a></td>
    </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root{--bg:#fbfaf8;--fg:#1c1917;--muted:#78716c;--line:#e7e5e4;--card:#fff;--accent:#b45309}
  *{box-sizing:border-box}
  body{margin:0;padding:2.5rem 1.25rem;background:var(--bg);color:var(--fg);
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.6}
  main{max-width:70rem;margin:0 auto}
  h1{font-size:1.9rem;margin:0 0 .35rem;letter-spacing:-.02em}
  .sub{color:var(--muted);margin:0 0 2rem;font-size:.95rem}
  .score{display:flex;align-items:center;gap:1.25rem;background:var(--card);
    border:1px solid var(--line);border-radius:.75rem;padding:1.25rem 1.5rem;margin-bottom:1.5rem}
  .pct{font-size:2.5rem;font-weight:600;font-variant-numeric:tabular-nums;line-height:1}
  .bar{flex:1;height:.5rem;background:var(--line);border-radius:999px;overflow:hidden}
  .bar>span{display:block;height:100%;background:var(--accent)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:.6rem;
    padding:1rem 1.15rem;margin-bottom:.75rem}
  .card h3{margin:0 0 .4rem;font-size:.95rem;text-transform:capitalize}
  .decision{margin:0 0 .4rem;font-weight:500}
  .why{margin:0;color:var(--muted);font-size:.9rem}
  .gap{border-left:3px solid var(--accent)}
  .ok{border-left:3px solid #16a34a}
  .tag{display:inline-block;background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe;
    border-radius:.25rem;padding:0 .35rem;font-size:.7rem;font-family:ui-monospace,monospace;
    vertical-align:.15em;margin-left:.4rem}
  .pair{margin:.15rem 0;font-size:.85rem;color:#475569}
  .ev{margin:.5rem 0;padding:.45rem 0 .45rem .7rem;border-left:2px solid var(--line);
    color:#57534e;font-size:.83rem}
  .ev p{margin:.2rem 0}
  table{width:100%;border-collapse:collapse;background:var(--card);
    border:1px solid var(--line);border-radius:.6rem;overflow:hidden;font-size:.88rem}
  th,td{text-align:left;padding:.6rem .75rem;border-bottom:1px solid var(--line);vertical-align:top}
  th{background:#f5f5f4;font-weight:600;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}
  tr:last-child td{border-bottom:0}
  td:nth-child(2){max-width:34rem}
  a{color:#2563eb;text-decoration:none} a:hover{text-decoration:underline}
  h2{font-size:1.15rem;margin:2.25rem 0 .75rem;letter-spacing:-.01em}
  .meta{font-family:ui-monospace,monospace;font-size:.78rem;color:var(--muted);margin-top:2.5rem;
    padding-top:1rem;border-top:1px solid var(--line)}
  ul{margin:.4rem 0 0;padding-left:1.1rem;color:var(--muted);font-size:.85rem}
</style></head>
<body><main>
  <h1>${escapeHtml(title)}</h1>
  <p class="sub">Evidence-backed reconstruction · domain <strong>${escapeHtml(result.domain)}</strong> ·
    ${escapeHtml(result.sources.join(", "))}</p>

  <div class="score">
    <div class="pct">${pct}%</div>
    <div style="flex:1">
      <div class="bar"><span style="width:${pct}%"></span></div>
      <p style="margin:.5rem 0 0;font-size:.9rem">${verdict}</p>
    </div>
  </div>

  <h2>Decision coverage map</h2>
  <div class="card">${renderSvg(result.gaps, decisionsFor(result))}
    <p style="margin:.5rem 0 0;font-size:.8rem;color:var(--muted)">
      Solid green = stated in the source. Dashed amber = unstated decision blocking a faithful rebuild.</p>
    ${verificationLine}
  </div>

  <h2>Blocking gaps</h2>
  ${gapCards}

  ${contradictionCards}

  <h2>Extracted claims (${result.claims.length})</h2>
  <table>
    <thead><tr><th>Confidence</th><th>Claim</th><th>Source</th></tr></thead>
    <tbody>${claimRows || "<tr><td colspan=3>No claims extracted.</td></tr>"}</tbody>
  </table>

  <div class="meta">
    harvest ${escapeHtml(result.digest)} · fetched ${escapeHtml(result.fetched_at)}<br>
    ${result.coverage.sources_read}/${result.coverage.sources_requested} sources read ·
    ${result.coverage.converged ? "converged" : "did not converge"} ·
    ${result.coverage.passes.length} pass(es) ·
    ${result.gate.dismissed_count} finding(s) dismissed ·
    gate survival ${Math.round(result.gate.survival_rate * 100)}%<br>
    ${result.attribution ? `<strong>Method</strong> ${escapeHtml(result.attribution)}<br>` : ""}
    <strong>Limitations</strong>
    <ul>${result.limitations.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
  </div>
</main></body></html>`;
};
