# Token Radar v3 — build notes

Entry source for make.fun **token-radar-01** ("Build the best token launch radar"), model
**fitted-comp-2**, built from the kit at `~/workspace/makefun/token-radar-kit/token-radar-01-kit`.
This directory is source + local validation only until the main flow assembles the repo,
bundles the transcripts and submits.

## Layout

- `main.ts` — the program (Node 22, stdlib only). Reads `/input/snapshot.json` (or `--input`),
  writes `/output/board.json` and `/output/data.js`, copies `dashboard/` and `screenshots/`
  into `/output`, and writes `/output/dossier.json` last via the vendored library. Honours
  `MAKEFUN_OUTPUT_DIR` outside the grader's container.
- `lib/model.ts` — snapshot parsing, the fitted valuation model, term selection by blind
  tests, the launch-odds model, the odds model's own cross-fitted blind test, the board,
  the full accounting and the board self-check.
- `lib/farm.ts` — the costed farm plans: playbooks per category family plus the costing
  arithmetic (gas, lock-up, hours, $/hour, break-even capture, verdict) and `planSummary`,
  the one-line costing each board row carries for its detail view.
- `dashboard/` — `index.html` + `app.css` + `app.js`, **34,095 bytes** in all, so the
  dossier's 65,536-byte text shows every file whole (verified: dossier text holds all three
  files, no cut marker).
- `screenshots/` — three real renders of this dashboard (below).
- `vendor/makefun-board.ts` — the kit's dossier library, copied byte for byte (sha256
  `9ca51b6e…`, matches the kit's starter copy and kit.json); `LICENSE` is the starter's MIT
  license, likewise. These two are the only copied files; all other code was written fresh
  for v3 in-session.
- `.makefun/owner.json` — the claim file naming the account wallet.

## What changed from v2, and why

v2 ("fitted-comp-1") fit a least-squares size curve plus each category's **mean** residual
(shrunk n/(n+6)), kept the age term on two blind tests (LOO ×3.51, walk-forward ×2.88), and
built launch odds from a launched-by-age curve × a category factor — but the odds were never
blind-tested, and the residual record indicted the mean offsets: a category's mean is set by
its wildest member (in-sample, one Basis Trading comp is missed by ×110 and one Lending
legacy by ×240, and the old Lending offset came out at ×0.548, pricing every lending launch
off a corpse and a mania averaged together). The leaders' boards share v2's pattern (fitted
terms, two held-out tests) and one advertises odds terms passing held-out tests too. v3
answers both points:

| | v2 — fitted-comp-1 | v3 — fitted-comp-2 |
| --- | --- | --- |
| Category offsets | mean residual, shrunk n/(n+6) | **median** residual, shrunk by the same n/(n+6) weight |
| Held-out value tests | LOO ×3.51 median (geo ×4.58); WF ×2.88 median (geo ×5.33) | LOO **×3.32** median (geo ×4.66); WF **×2.84** median (geo ×5.32) — same protocol, same folds, both medians better |
| Odds validation | none | **cross-fitted**: 5 folds by slug hash over the 645 dated protocols; Brier base rate 0.2502, curve alone 0.2168, curve × factor **0.2031** (log loss 0.6936 / 0.6259 / **0.6085**) — the factor earns its place out-of-sample |
| Dashboard | cover + integrity strip (8 checks), no charts | cover with the v2→v3 test table, **fit scatter** and **odds curve** charts drawn live, integrity strip of **10** checks, detail view led by the row's one-line plan summary |
| Top of the board | Steakhouse Financial $19.8M expected | USDD $21.3M expected (launch $34.7M × odds 0.614) |

Alternatives measured on the same protocol and rejected on the numbers: a joint
curve+dummies+terms regression (LOO ×3.75 / WF ×3.34 — the dummies destabilise the small
walk-forward train set), Huber and L1 IRLS fits (medians no better, geometric factors much
worse), trimmed-mean offsets (×3.46 / ×2.98), backfitting (×3.35 / ×2.97), mean+median
ensembles (×3.38 / ×2.86), a quadratic size term, per-category merging of small categories,
and including the 34 product-category comps in the fit population. The median offset is the
one change that improves both headline medians without a mechanism that fights the data.

## The fitted value model

Fit population: the traded protocols in launch-comparable categories — **94 comps** (the
same population as v2: of the 128 protocols carrying both a TVL and a market cap, 34 sit in
product categories whose tokens are not launches of the kind the board ranks).

- **Size curve:** log10(mcap) = **3.5795 + 0.4412 × log10(TVL)**, least squares over the comps.
- **Category offsets:** each category's **median** residual after the curve, shrunk toward
  the curve by n/(n+6). Largest by comp count: Lending ×0.717 (15 comps; the mean said
  ×0.548), Dexs ×1.192 (11), RWA ×1.300 (9), Yield ×1.094 (9), Basis Trading ×1.347 (7).
- **Trim pass:** after the first fit, comps missed by more than 2.25σ of log residual are
  dropped and the model refit once — **4 comps trimmed** in the final fit. The trim is
  inside the pipeline: every blind-test fold refits it.
- **Age fallback:** undated protocols are priced with the dated comps' mean age term,
  2.6257 years.

### Term selection — two blind tests or the term is dropped

Baseline under the median offsets (curve + offsets only): LOO ×3.38, walk-forward ×3.02.
A term joins only if adding it improves **both** medians by ≥0.5% (the rule v2 used):

| Term | Transform | LOO × | WF × | Verdict |
| --- | --- | --- | --- | --- |
| age | years listed, capped at 5 | 3.32 | 2.84 | **kept**, coefficient **−0.002** per year |
| growth | clamp(change_7d, −40, +80)/100 | 3.32 | 2.37 | dropped — walk-forward loved it, leave-one-out did not improve (needed ≤3.30) |
| chains | min(extra chains, 5) | 3.30 | 3.48 | dropped — leave-one-out loved it, walk-forward did not |

Final model: **LOO ×3.32 median (geo ×4.66, n=94)**, **walk-forward ×2.84 median
(geo ×5.32, train 47 / test 24)**. The kept age coefficient is nearly flat — once category
medians absorb each category's age mix, raw tenure adds almost nothing to price — but both
tests still prefer the model with it, so it stays, printed as fitted. Growth's story is the
mirror of v2's: it is the strongest walk-forward term and the weakest leave-one-out one,
and the both-tests rule is exactly the discipline that keeps a one-test wonder out.

## The launch-odds model — now blind-tested

The odds themselves are unchanged in construction: F(a) is the share of dated protocols
that record a token by age a, read in 6-month bands and made monotone: F(0.5y)=0.33,
F(1y)=0.40, F(2y)=0.47, F(3y)=0.76, F(4y)=0.81, F(5y)=0.89. A protocol still tokenless at
age a gets **odds = (F(a+2y) − F(a)) / (1 − F(a))**, scaled by its category's own launch
record (shrunk toward the market-wide share 0.5488 with a prior of 10): Lending ×1.38,
Dexs ×1.31, Risk Curators ×0.39, CEX ×0.54. Odds are clamped to [0.02, 0.90]; undated
protocols get the dated pre-token average age base, 0.5302, times their category factor.

What is new is the evidence. The snapshot cannot say **when** a token launched, only
whether one is recorded, so the honest held-out question is cross-sectional: given a
protocol's age, does F(age) — with or without the category factor — predict whether it
records a token by that age, on protocols the fit never saw? Five folds, split by an
FNV-1a hash of the slug (the split is deterministic and printed in the code), every dated
protocol scored exactly once:

| Forecaster | Brier | Log loss |
| --- | --- | --- |
| Base rate (the fold's overall share) | 0.2502 | 0.6936 |
| Launched-by-age curve alone | 0.2168 | 0.6259 |
| Curve × category factor (what the board uses) | **0.2031** | **0.6085** |

The factor improves both scores out-of-sample, so the board keeps it — the same
kept-only-on-evidence discipline as the value terms. The dashboard's cover prints this
table, and its detail views cite the factored Brier on every row's odds line.

## Farm costing

Unchanged from v2 (its verdicts were arithmetic, and the arithmetic was not the problem):
capital from a TVL tier ($50–$500); gas per chain from a round-dollar table (Ethereum $9,
most L2s $1, default $2); lock-up cost 5%/yr over a 30–60-day hold set by the protocol's
age; **$/hour = (gas + lock-up) / hours**; **capture = (gas + lock-up) / expected value**.
Verdict: FARM when odds ≥ 0.30, capture ≤ 0.25% and $/hour ≤ $25; THIN when odds ≥ 0.15
and capture ≤ 1.2%; otherwise SKIP. Distribution over the 198 rows: **FARM 150, THIN 29,
SKIP 19**. Every plan has 7 steps, and each row now also carries a one-line `farm_summary`
(verdict, all-in cost, $/hour, break-even capture, hold, capital) that leads its detail view.

## Full accounting — all 758 protocols

416 already record a token (128 of them carry a market cap; the largest 24 are shown on the
cover as the peer evidence, and all 94 fit comps are plotted in the fit chart) · **198
ranked** (all 40 watchlist + 158 early candidates that pass the watchlist's own structural
screen) · 144 pre-token set aside, by reason: product category CEX 42, Liquid Staking 38,
Bridge 28, Canonical Bridge 15, Liquid Restaking 3, Restaked BTC 2, versioned name 11,
wrapped/staked word in name 5.

Top of the board (expected value): USDD $21.31M (launch $34.72M × 0.614), Steakhouse
Financial $19.01M ($72.82M × 0.261), Sentora Curator $18.27M ($72.99M × 0.250), OnRe
$17.75M, BitFi Basis $16.89M, OpenTrade $15.04M, Gauntlet $14.86M, Plume Vaults $14.18M,
Veda $14.07M, Hive Protocol $12.81M. The median offsets lift Lending-family rows (the old
mean had priced the whole category off its worst corpses), and USDD's CDP median offset
(×0.962 on a $1.06B TVL) carries it to rank 1.

## The dashboard

Offline, no framework, no network references anywhere (the gate's scan passes). A new
visual identity for this version — deep-green ink, parchment text, amber signal, serif
display heads, mono numerals — distinct from v2's warm paper. Board view: masthead with
the accounting, the model cover (formula with fitted coefficients, the v2→v3 blind-test
table, term trials, median-offset table, the odds method **and its cross-fit table**, the
farm-costing rule), two live SVG charts (the fit: all 94 comps against the size curve,
amber where the fitted price misses by more than ×2; the odds: F(a) and the two-year
launch odds by age), the **integrity strip** (10 live checks recomputed in the browser,
including re-deriving filed launch values and one row's odds from the printed coefficients
and knots), search + category + chain + set + verdict filters, five sort orders (expected,
launch, TVL, odds, cheapest hour), the ranked table, and the already-trading table. Detail
view per protocol (hash route `#/p/<slug>`): the one-line plan summary, stat grid, the
full pricing derivation, the costed farm plan, and nearby rows.

## Screenshots

Real renders of the built output in Chrome headless shell (puppeteer from
`~/workspace/makefun/shot-tools/`), all 1440×1440:

| file | view | bytes |
| --- | --- | --- |
| `1-board.png` | board: masthead, cover, blind-test tables, PNG | 308,279 |
| `2-detail.jpg` | USDD detail (rank 1), JPEG q92 | 316,577 |
| `3-filtered.jpg` | verdict = FARM, sort = cheapest hour, JPEG q88 | 284,204 |

## Gate validation (local, all seven rows)

RULES.txt states there is **no local grade** for this competition ("the server grades every
entry"), and the kit ships no local scorer — so, as for v1 and v2, the seven gate rows of
RULES.txt were implemented verbatim in a validator (kept outside the entry) and run on a
real `/output` produced by `main.ts` against the kit's sealed input:

- dashboard_files — PASS (3 files, 34,095 bytes, no network address in any scanned position)
- board_file — PASS (198 rows, all slugs from the snapshot, values in range)
- sorted_by_value — PASS (ranks exactly 1..198, expected value non-increasing)
- coverage — PASS (all 40 watchlist slugs present)
- farm_steps — PASS (7 steps per row, all within 20–600 chars trimmed)
- screenshots — PASS (3 images, whole PNG/JPEG, 1440×1440, 284–317 KB each)
- dossier_matches — PASS (rebuilt with the vendored `buildDossier(output, {text_max_bytes:
  65536})`; dossier 1,248,128 bytes ≤ 1.5 MiB; dossier text 34,095 bytes of dashboard
  source, no cut marker)

The dashboard's own 10 integrity checks were also replayed in Node against the real
`data.js`: all 10 hold (re-pricing within 0.04% on the sampled rows; the sampled row's odds
re-derive exactly).

Determinism: two consecutive runs of `main.ts` produced byte-identical `board.json`,
`data.js`, `dossier.json`, dashboard files and screenshot copies (no clocks, no randomness;
ages derive from the snapshot's own `as_of`; every sort has a slug tie-break; the fit, the
trim, both blind tests and the odds cross-fit are pure arithmetic on the sealed input).
Runtime ~0.6 s a run, far inside the 120 s cap.

## Blockers

None for the build. For the submission step: the entry needs the transcript bundle and the
public GitHub repo (asjmak/token-radar-v3, with README + About per `how_to_submit`) —
handled by the main flow after these notes.
