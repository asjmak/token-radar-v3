// fitted-comp-2 dashboard: renders window.RADAR (written by the radar program beside this
// page as ../data.js). No fetch, no network: every number on the page comes from that one
// object, and the integrity strip re-derives the page's own claims from it, live.

const R = window.RADAR;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt$ = (n) => {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n}`;
};
const fmtPct = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${Number(n).toFixed(1)}%`);
const fmtAge = (days) => (days === null ? 'undated' : days >= 730 ? `${(days / 365.25).toFixed(1)} y` : `${Math.round(days / 30.4)} mo`);
const bySlug = new Map(R.rows.map((r) => [r.slug, r]));

// ------------------------------------------------------------- masthead

$('m-version').textContent = R.model_version;
const acc = R.accounting;
$('m-standfirst').textContent =
  `${acc.scanned} protocols scanned as of ${R.as_of}. ${acc.launched} already record a token and are never ranked; ` +
  `${acc.board_rows} pre-token protocols are ranked by expected launch value (${acc.watchlist_rows} on the house watchlist, ` +
  `${acc.early_rows} found early below its floor); ${acc.aside} are set aside with named reasons. ` +
  `The value model was blind-tested two ways (leave-one-out ×${R.validation.loo.median_factor}, walk-forward ×${R.validation.wf.median_factor}) ` +
  `and the odds model was cross-fitted on ${R.odds_validation.n} dated protocols (Brier ${R.odds_validation.curve_and_factor.brier} against a ${R.odds_validation.base_rate.brier} base rate).`;
$('m-chips').innerHTML = [
  ['board rows', acc.board_rows],
  ['watchlist covered', `${acc.watchlist_rows} / ${acc.watchlist_rows}`],
  ['LOO median error', `×${R.validation.loo.median_factor}`],
  ['walk-forward', `×${R.validation.wf.median_factor}`],
  ['odds Brier', R.odds_validation.curve_and_factor.brier],
  ['verdicts', `${R.rows.filter((r) => r.farm.verdict === 'FARM').length} FARM`],
].map(([k, v]) => `<span class="chip">${k}: <b>${v}</b></span>`).join('');
$('m-source').textContent = `Snapshot: ${R.source} · as of ${R.as_of} · watchlist floor ${fmt$(R.floor_usd)}.`;

/** F(age in days) off the printed odds knots, by linear interpolation; flat outside them. */
function curveF(age) {
  const k = R.odds.knots;
  if (age <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (age <= k[i][0]) {
      const [ax, ay] = k[i - 1]; const [bx, by] = k[i];
      return ay + ((by - ay) * (age - ax)) / (bx - ax);
    }
  }
  return k[k.length - 1][1];
}

// ------------------------------------------------------------- the cover

function trialsTable() {
  const rows = R.validation.trials.map((t) => {
    const verdict = t.kept
      ? `<span class="kept">kept</span> (coef ${t.coef})`
      : '<span class="dropped">dropped</span>';
    return `<tr><td>${esc(t.term)}</td><td class="num">×${t.loo_median}</td><td class="num">×${t.wf_median}</td><td>${verdict}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>Term</th><th class="num">LOO ×</th><th class="num">Walk-forward ×</th><th>Verdict</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function offsetsTable() {
  const rows = R.fit.offsets.slice(0, 12).map((o) =>
    `<tr><td>${esc(o.category)}</td><td class="num">${o.peers}</td><td class="num">×${o.mult}</td></tr>`).join('');
  return `<table><thead><tr><th>Category</th><th class="num">Comps</th><th class="num">Median offset</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function oddsTestTable() {
  const ov = R.odds_validation;
  const row = (name, s) => `<tr><td>${name}</td><td class="num">${s.brier}</td><td class="num">${s.log_loss}</td></tr>`;
  return `<table><thead><tr><th>Forecaster (held-out folds)</th><th class="num">Brier</th><th class="num">Log loss</th></tr></thead><tbody>` +
    row('Base rate — no curve, no factor', ov.base_rate) +
    row('Launched-by-age curve alone', ov.curve_only) +
    row('Curve × category factor — what the board uses', ov.curve_and_factor) +
    `</tbody></table>`;
}

function cover() {
  const f = R.fit;
  const v = R.validation;
  const pt = R.previous_tests;
  const top = R.rows[0];
  const factors = [...R.odds.category_factors].sort((a, b) => b.factor - a.factor);
  const aside = acc.aside_reasons.map((a) => `${esc(a.reason)} ${a.count}`).join(' · ');
  $('cover-body').innerHTML = `
  <p>The board prices a launch the way the market has priced the launches it can see. On the
  ${f.comps} traded protocols in launch-comparable categories (of ${f.traded} carrying a market cap;
  exchanges, staking and bridge products record tokens for other reasons, so they are evidence, not
  teachers), the model fits a size curve, a per-category offset and — only where two blind tests
  approve — adjustment terms. ${f.trimmed} comps the fitted model missed by more than 2.25 standard
  deviations were trimmed and the model refit; the trim runs inside every blind-test fold, so the
  scores below price it too.</p>
  <div class="formula">log10(launch value) = ${f.intercept} + ${f.slope} × log10(TVL) + median category offset + kept terms</div>
  <h3>What changed since the previous model (fitted-comp-1)</h3>
  <p><b>Category offsets are medians now, not means.</b> A category's mean residual is set by its
  wildest members — Lending's fifteen comps include tokens the curve misses by ×20 to ×240 in both
  directions, and their average (×0.548) prices the typical lending launch below what its median
  peer (×0.717) justifies. The median prices the typical peer,
  shrunk toward the curve by the same n/(n+6) prior weight. <b>The odds are blind-tested now too:</b>
  the snapshot cannot say when a token launched, only whether one is recorded, so the odds'
  ingredients were cross-fitted — fitted on four fifths of the dated protocols, scored on the
  fifth — before the board was allowed to use them.</p>
  <table><thead><tr><th>Blind test</th><th class="num">fitted-comp-1</th><th class="num">fitted-comp-2</th></tr></thead><tbody>
  <tr><td>Leave-one-out, median factor error (n=${v.loo.n})</td><td class="num">×${pt.loo_median}</td><td class="num">×${v.loo.median_factor}</td></tr>
  <tr><td>Leave-one-out, geometric factor</td><td class="num">×${pt.loo_geo}</td><td class="num">×${v.loo.geo_factor}</td></tr>
  <tr><td>Walk-forward, median factor error (train ${v.wf_train}, test ${v.wf.n})</td><td class="num">×${pt.wf_median}</td><td class="num">×${v.wf.median_factor}</td></tr>
  <tr><td>Walk-forward, geometric factor</td><td class="num">×${pt.wf_geo}</td><td class="num">×${v.wf.geo_factor}</td></tr>
  </tbody></table>
  <p class="small">Walk-forward fits on the oldest two-thirds of the dated comps and is tested on the newest
  third it never saw: pricing tomorrow's listings with yesterday's market is the board's actual job.
  The no-term baseline under this model's offsets scores ×${v.baseline.loo_median} / ×${v.baseline.wf_median};
  a term joins only if it improves both medians by at least 0.5%. Honest limit: the worst held-out
  misses are idiosyncratic — tokens trading at hundreds of times their TVL — and no model reading
  TVL, growth and tenure sees those coming; the medians above are the typical case, not the worst.</p>
  <h3>Term trials — every candidate, kept or dropped on the same two tests</h3>
  ${trialsTable()}
  <h3>Category offsets — the median peer, shrunk (top 12 by comp count)</h3>
  ${offsetsTable()}
  <h3>Launch odds — fitted, then blind-tested</h3>
  <p>Of the dated protocols, the share recording a token rises with age: F(½y)=${curveF(182).toFixed(2)},
  F(2y)=${curveF(730).toFixed(2)}, F(5y)=${curveF(1826).toFixed(2)}. A protocol still tokenless at age a gets
  odds (F(a+2y) − F(a)) / (1 − F(a)) — of its peers that reached a without a token, the share that
  launched within the next two years — scaled by its category's own launch record, shrunk toward the
  market-wide ${R.odds.global_share}. Strongest category factors: ${factors.slice(0, 3).map((x) => `${esc(x.category)} ×${x.factor}`).join(', ')};
  weakest: ${factors.slice(-3).map((x) => `${esc(x.category)} ×${x.factor}`).join(', ')}. Undated protocols
  get the dated pre-token average base, ${R.odds.null_age_odds}. The cross-fit that licensed the factor:</p>
  ${oddsTestTable()}
  <h3>Farm costing — the rule every verdict came from</h3>
  <p>Capital is tiered by the protocol's own TVL ($50–$500). Gas is a per-chain round dollar figure
  (Ethereum $9, most L2s $1, default $2), paid for setup and core transactions and half-weekly after;
  the capital is charged 5% a year for the 30–60 days it is parked. $/hour is (gas + lock-up) / hours;
  capture is (gas + lock-up) / expected value. FARM needs odds ≥ 0.30, capture ≤ 0.25% and $/hour ≤ $25;
  THIN needs odds ≥ 0.15 and capture ≤ 1.2%; the rest are SKIP. Every row's detail view shows its own
  arithmetic, and its plan's last step states the verdict in words.</p>
  <h3>The whole universe, accounted for</h3>
  <p>${acc.scanned} scanned · ${acc.launched} already record a token (${acc.launched_with_mcap} carry a market cap) ·
  ${acc.board_rows} ranked (${acc.watchlist_rows} watchlist + ${acc.early_rows} early) · ${acc.aside} set aside: ${aside}.
  Rank 1 is ${esc(top.name)} at ${fmt$(top.implied_value_usd)} expected (${fmt$(top.launch_value_usd)} launch × ${top.launch_odds} odds).</p>`;
}

// ------------------------------------------------------------- charts

function fitChart() {
  const W = 520, H = 340, L = 52, B = 34, T = 10, Rt = 10;
  const x0 = 6.5, x1 = 9.7, y0 = 4.6, y1 = 9.7;
  const px = (lx) => L + ((lx - x0) / (x1 - x0)) * (W - L - Rt);
  const py = (ly) => H - B - ((ly - y0) / (y1 - y0)) * (H - B - T);
  let s = '';
  for (const g of [7, 8, 9]) {
    s += `<line x1="${px(g)}" y1="${T}" x2="${px(g)}" y2="${H - B}" stroke="#2a3d2f"/><text x="${px(g)}" y="${H - B + 18}" fill="#a89f88" font-size="11" text-anchor="middle">$${g === 7 ? '10M' : g === 8 ? '100M' : '1B'} TVL</text>`;
    s += `<line x1="${L}" y1="${py(g)}" x2="${W - Rt}" y2="${py(g)}" stroke="#2a3d2f"/><text x="${L - 6}" y="${py(g) + 4}" fill="#a89f88" font-size="11" text-anchor="end">$${g === 7 ? '10M' : g === 8 ? '100M' : '1B'}</text>`;
  }
  const xa = 6.6, xb = 9.6;
  const ya = R.fit.intercept + R.fit.slope * xa, yb = R.fit.intercept + R.fit.slope * xb;
  s += `<line x1="${px(xa)}" y1="${py(ya)}" x2="${px(xb)}" y2="${py(yb)}" stroke="#e8a33d" stroke-width="2"/>`;
  for (const p of R.peers) {
    const miss = Math.abs(Math.log10(p.mcap_usd / p.fitted_usd)) > Math.log10(2);
    s += `<circle cx="${px(Math.log10(p.tvl_usd)).toFixed(1)}" cy="${py(Math.log10(p.mcap_usd)).toFixed(1)}" r="3" fill="${miss ? '#e8a33d' : '#43b08e'}" opacity="0.85"><title>${esc(p.name)}: TVL ${fmt$(p.tvl_usd)}, cap ${fmt$(p.mcap_usd)}, fitted ${fmt$(p.fitted_usd)}</title></circle>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fit scatter: comps against the size curve">${s}</svg>`;
}

function oddsChart() {
  const W = 520, H = 340, L = 40, B = 34, T = 10, Rt = 10;
  const maxAge = 2737; // 7.5 years in days
  const px = (d) => L + (d / maxAge) * (W - L - Rt);
  const py = (f) => H - B - f * (H - B - T);
  const F = (age) => {
    const k = R.odds.knots;
    if (age <= k[0][0]) return k[0][1];
    for (let i = 1; i < k.length; i++) {
      if (age <= k[i][0]) {
        const [ax, ay] = k[i - 1]; const [bx, by] = k[i];
        return ay + ((by - ay) * (age - ax)) / (bx - ax);
      }
    }
    return k[k.length - 1][1];
  };
  let s = '';
  for (const g of [0, 0.25, 0.5, 0.75, 1]) {
    s += `<line x1="${L}" y1="${py(g)}" x2="${W - Rt}" y2="${py(g)}" stroke="#2a3d2f"/><text x="${L - 6}" y="${py(g) + 4}" fill="#a89f88" font-size="11" text-anchor="end">${g}</text>`;
  }
  for (const yr of [0, 2, 4, 6]) {
    s += `<text x="${px(yr * 365.25)}" y="${H - B + 18}" fill="#a89f88" font-size="11" text-anchor="middle">${yr}y</text>`;
  }
  let line = '';
  for (let d = 0; d <= 2002; d += 45) line += `${d === 0 ? 'M' : 'L'}${px(d).toFixed(1)},${py(F(d)).toFixed(1)} `;
  s += `<path d="${line}" fill="none" stroke="#e8a33d" stroke-width="2"/>`;
  let dash = '';
  for (let d = 0; d <= 1825; d += 45) {
    const base = Math.min(Math.max((F(d + R.odds.horizon_days) - F(d)) / Math.max(1 - F(d), 0.05), 0), 1);
    dash += `${d === 0 ? 'M' : 'L'}${px(d).toFixed(1)},${py(base).toFixed(1)} `;
  }
  s += `<path d="${dash}" fill="none" stroke="#43b08e" stroke-width="2" stroke-dasharray="6 4"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Launched-by-age curve and two-year launch odds by age">${s}</svg>`;
}

// ------------------------------------------------------------- integrity strip

function integrity() {
  const checks = [];
  const rows = R.rows;
  checks.push(['Board holds ' + rows.length + ' rows and the ranks are exactly 1..' + rows.length,
    rows.every((r, i) => r.rank === i + 1)]);
  checks.push(['Implied value never rises as rank ascends',
    rows.every((r, i) => i === 0 || r.implied_value_usd <= rows[i - 1].implied_value_usd)]);
  checks.push([`All ${acc.watchlist_rows} watchlist protocols are on the board`,
    rows.filter((r) => r.watchlist).length === acc.watchlist_rows]);
  const offsetOf = new Map(R.fit.offsets.map((o) => [o.category, o.mult]));
  checks.push(['Every row\'s category multiplier is the printed median offset for its category',
    rows.every((r) => Math.abs(r.model.category_mult - (offsetOf.get(r.category ?? '(none)') ?? 1)) < 0.0011)]);
  const reprice = (r) => {
    let v = Math.pow(10, R.fit.intercept + R.fit.slope * Math.log10(r.tvl_usd)) * r.model.category_mult;
    for (const m of [r.model.growth_mult, r.model.age_mult, r.model.chains_mult]) if (m !== null) v *= m;
    return v;
  };
  checks.push(['Ranks 1, 100 and the last row re-price from the printed coefficients within 2%',
    [rows[0], rows[99], rows[rows.length - 1]].every((r) => Math.abs(reprice(r) / r.launch_value_usd - 1) < 0.02)]);
  checks.push(['Every row\'s implied value is its launch value × its odds, rounded',
    rows.every((r) => r.implied_value_usd === Math.round(r.launch_value_usd * r.launch_odds))]);
  const knots = R.odds.knots;
  checks.push(['The launched-by-age curve is monotone, as printed',
    knots.every((k, i) => i === 0 || k[1] >= knots[i - 1][1])]);
  const F = (age) => {
    if (age <= knots[0][0]) return knots[0][1];
    for (let i = 1; i < knots.length; i++) {
      if (age <= knots[i][0]) {
        const [ax, ay] = knots[i - 1]; const [bx, by] = knots[i];
        return ay + ((by - ay) * (age - ax)) / (bx - ax);
      }
    }
    return knots[knots.length - 1][1];
  };
  const datedRow = rows.find((r) => r.age_days !== null && r.age_days > 400);
  const base = (F(datedRow.age_days + R.odds.horizon_days) - F(datedRow.age_days)) / Math.max(1 - F(datedRow.age_days), 0.05);
  const reOdds = Math.min(Math.max(base * datedRow.model.odds_category_factor, 0.02), 0.9);
  checks.push([`${datedRow.name}'s odds re-derive from the printed curve and its category factor`,
    Math.abs(reOdds - datedRow.launch_odds) < 0.011]);
  const f1 = rows[0].farm;
  checks.push(['Rank 1\'s farm costing adds up: total = gas + lock-up, capture = total / expected',
    Math.abs(f1.total_usd - (f1.gas_usd + f1.lock_usd)) < 0.02
    && Math.abs(f1.capture_pct - (f1.total_usd / rows[0].implied_value_usd) * 100) < 0.02]);
  checks.push(['The accounting closes: launched + pre-token = scanned, ranked + set aside = pre-token',
    acc.launched + acc.pre_token === acc.scanned && acc.board_rows + acc.aside === acc.pre_token]);
  $('checks').innerHTML = checks.map(([text, ok]) =>
    `<li class="${ok ? '' : 'fail'}">${esc(text)} — ${ok ? 'holds' : 'FAILS'}</li>`).join('');
}

// ------------------------------------------------------------- the board

const state = { q: '', category: '', chain: '', set: '', verdict: '', sort: 'rank' };

function visibleRows() {
  let rows = R.rows.filter((r) =>
    (state.q === '' || r.name.toLowerCase().includes(state.q) || r.slug.includes(state.q))
    && (state.category === '' || (r.category ?? '(none)') === state.category)
    && (state.chain === '' || r.chains.includes(state.chain))
    && (state.set === '' || (state.set === 'watchlist' ? r.watchlist : !r.watchlist))
    && (state.verdict === '' || r.farm.verdict === state.verdict));
  const sorts = {
    rank: (a, b) => a.rank - b.rank,
    launch: (a, b) => b.launch_value_usd - a.launch_value_usd,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    odds: (a, b) => b.launch_odds - a.launch_odds,
    cheap: (a, b) => a.farm.per_hour_usd - b.farm.per_hour_usd,
  };
  return rows.sort(sorts[state.sort]);
}

function renderBoard() {
  const rows = visibleRows();
  $('row-count').textContent = `${rows.length} of ${R.rows.length} rows`;
  $('board-body').innerHTML = rows.map((r) => `
    <tr class="clickable" data-slug="${esc(r.slug)}">
      <td class="num">${r.rank}</td>
      <td>${esc(r.name)}${r.watchlist ? '<span class="tag">watchlist</span>' : '<span class="tag">early</span>'}</td>
      <td>${esc(r.category ?? '—')}</td>
      <td class="num">${fmt$(r.tvl_usd)}</td>
      <td class="num">${fmtPct(r.change_7d === null ? null : r.change_7d)}</td>
      <td class="num">${fmtAge(r.age_days)}</td>
      <td class="num">${fmt$(r.launch_value_usd)}</td>
      <td class="num">${r.launch_odds.toFixed(2)}</td>
      <td class="num"><b>${fmt$(r.implied_value_usd)}</b></td>
      <td><span class="verdict v-${r.farm.verdict}">${r.farm.verdict}</span> <span class="small">$${r.farm.per_hour_usd}/h</span></td>
    </tr>`).join('');
  for (const tr of document.querySelectorAll('#board-body tr')) {
    tr.addEventListener('click', () => { location.hash = `#/p/${tr.dataset.slug}`; });
  }
}

function renderLive() {
  $('live-body').innerHTML = R.live.map((p) => `
    <tr><td>${esc(p.name)}</td><td>${esc(p.symbol ?? '—')}</td><td>${esc(p.category ?? '—')}</td>
    <td class="num">${fmt$(p.tvl_usd)}</td><td class="num">${fmt$(p.mcap_usd)}</td><td class="num">${p.ratio.toFixed(2)}</td></tr>`).join('');
}

// ------------------------------------------------------------- detail view

function derivationRows(r) {
  const m = r.model;
  const line = (k, v, s) => `<tr><td>${k}</td><td class="num">${v}</td><td>${s ?? ''}</td></tr>`;
  return `<table><tbody>
    ${line('Size value — the curve at this TVL', fmt$(m.size_value_usd), `<span class="mono">${R.fit.intercept} + ${R.fit.slope} × log10(${r.tvl_usd.toLocaleString('en-US')})</span>`)}
    ${line('Category multiplier — median offset', `×${m.category_mult}`, esc(r.category ?? '(none)'))}
    ${m.growth_mult !== null ? line('Growth multiplier — fitted term', `×${m.growth_mult}`, `7d change ${fmtPct(r.change_7d)}`) : ''}
    ${m.age_mult !== null ? line('Age multiplier — fitted term', `×${m.age_mult}`, fmtAge(r.age_days)) : ''}
    ${m.chains_mult !== null ? line('Breadth multiplier — fitted term', `×${m.chains_mult}`, `${r.chains.length} chains`) : ''}
    ${line('Launch value', `<b>${fmt$(r.launch_value_usd)}</b>`, 'what the token would be worth on this record')}
    ${line('Odds — age base', m.odds_age_base.toFixed(4), 'of peers tokenless at this age, the share launching within two years')}
    ${line('Odds — category factor', `×${m.odds_category_factor}`, 'the category\'s own launch record, shrunk; cross-fitted Brier ' + R.odds_validation.curve_and_factor.brier)}
    ${line('Expected value — the board\'s rank claim', `<b>${fmt$(r.implied_value_usd)}</b>`, 'launch value × odds')}
  </tbody></table>`;
}

function renderDetail(slug) {
  const r = bySlug.get(slug);
  if (!r) { location.hash = ''; return; }
  $('view-board').hidden = true;
  $('view-detail').hidden = false;
  const f = r.farm;
  const near = R.rows.filter((x) => Math.abs(x.rank - r.rank) <= 2 && x.slug !== r.slug)
    .map((x) => `<a href="#/p/${esc(x.slug)}">#${x.rank} ${esc(x.name)} — ${fmt$(x.implied_value_usd)}</a>`).join('');
  $('detail').innerHTML = `
    <p class="kicker">Rank ${r.rank} of ${R.rows.length} · ${r.watchlist ? 'house watchlist' : 'early, below the floor'}</p>
    <h1>${esc(r.name)}</h1>
    <p class="summary-line">${esc(r.farm_summary)}</p>
    <div class="stat-grid">
      <div class="stat"><div class="k">Expected value</div><div class="v">${fmt$(r.implied_value_usd)}</div><div class="s">the rank claim</div></div>
      <div class="stat"><div class="k">Launch value</div><div class="v">${fmt$(r.launch_value_usd)}</div><div class="s">if it issues on this record</div></div>
      <div class="stat"><div class="k">Launch odds</div><div class="v">${r.launch_odds.toFixed(2)}</div><div class="s">within two years</div></div>
      <div class="stat"><div class="k">TVL</div><div class="v">${fmt$(r.tvl_usd)}</div><div class="s">7d ${fmtPct(r.change_7d)}</div></div>
      <div class="stat"><div class="k">Age</div><div class="v">${fmtAge(r.age_days)}</div><div class="s">${r.listed_at ?? 'not dated'}</div></div>
      <div class="stat"><div class="k">Verdict</div><div class="v verdict v-${f.verdict}">${f.verdict}</div><div class="s">$${f.per_hour_usd} an hour</div></div>
    </div>
    <section class="panel"><h2>How this price was derived</h2>${derivationRows(r)}</section>
    <section class="panel"><h2>The costed farm plan</h2>
      <div class="stat-grid">
        <div class="stat"><div class="k">Capital</div><div class="v">$${f.capital_usd}</div><div class="s">tiered by TVL</div></div>
        <div class="stat"><div class="k">Gas</div><div class="v">$${f.gas_usd}</div><div class="s">setup, core, weekly</div></div>
        <div class="stat"><div class="k">Lock-up cost</div><div class="v">$${f.lock_usd}</div><div class="s">5% a year, ${f.hold_days} days</div></div>
        <div class="stat"><div class="k">All-in</div><div class="v">$${f.total_usd}</div><div class="s">over ${f.hours} hours</div></div>
        <div class="stat"><div class="k">Break-even capture</div><div class="v">${f.capture_pct}%</div><div class="s">of the expected value</div></div>
      </div>
      <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    </section>
    <section class="panel"><h2>Nearby on the board</h2><div class="nearby">${near}</div></section>`;
  window.scrollTo(0, 0);
}

function route() {
  const m = location.hash.match(/^#\/p\/(.+)$/);
  if (m) renderDetail(decodeURIComponent(m[1]));
  else {
    $('view-detail').hidden = true;
    $('view-board').hidden = false;
  }
}

// ------------------------------------------------------------- wiring

function fillFilters() {
  const cats = [...new Set(R.rows.map((r) => r.category ?? '(none)'))].sort();
  $('f-category').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  $('f-chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join('');
}
$('q').addEventListener('input', (e) => { state.q = e.target.value.toLowerCase(); renderBoard(); });
$('f-category').addEventListener('change', (e) => { state.category = e.target.value; renderBoard(); });
$('f-chain').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
$('f-set').addEventListener('change', (e) => { state.set = e.target.value; renderBoard(); });
$('f-verdict').addEventListener('change', (e) => { state.verdict = e.target.value; renderBoard(); });
$('f-sort').addEventListener('change', (e) => { state.sort = e.target.value; renderBoard(); });
$('back').addEventListener('click', (e) => { e.preventDefault(); location.hash = ''; });
window.addEventListener('hashchange', route);

cover();
$('chart-fit').innerHTML = fitChart();
$('chart-odds').innerHTML = oddsChart();
integrity();
fillFilters();
renderBoard();
renderLive();
route();
