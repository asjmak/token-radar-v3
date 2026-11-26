# Token Radar v3 — fitted-comp-2

A token launch radar for the make.fun token-radar-01 bounty. It reads the
sealed DefiLlama snapshot, prices every pre-token protocol with a valuation
model fitted on the snapshot's own traded tokens, blind-tests every part of
that model — the value terms on two held-out tests, the launch odds on a
five-fold cross-fit — and ranks a 198-row board by expected launch value.

## The model

- **Fitted value model.** log10(mcap) = 3.5795 + 0.4412 × log10(TVL) plus
  per-category offsets, fitted on 94 launch-comparable traded protocols, with
  an outlier trim refit inside every validation fold. The change from v2:
  category offsets are **medians**, not means — a category's mean residual is
  set by its wildest members (Lending's comps include tokens the curve misses
  by ×20–×240 in both directions), while the median prices the typical peer.
  Offsets are shrunk toward the curve by the same n/(n+6) prior weight.
- **Held-out validation.** Every candidate term was kept or dropped on two
  blind tests: leave-one-out and walk-forward over the dated comps.
  fitted-comp-2 scores **LOO ×3.32** median (geo ×4.66) and **walk-forward
  ×2.84** median (geo ×5.32), against fitted-comp-1's ×3.51 / ×2.88 on the
  identical protocol. Age stayed (coefficient −0.002/yr, nearly flat once
  category medians absorb each category's age mix); growth and chain count
  were dropped, and the dashboard cover prints every trial with its numbers.
- **Token odds, blind-tested too.** A launched-by-age curve fitted from the
  snapshot's own record, adjusted by a shrunk category factor. The snapshot
  cannot say when a token launched, only whether one is recorded, so the odds'
  ingredients were cross-fitted on five folds over the 645 dated protocols:
  Brier 0.2502 for the base rate, 0.2168 for the curve alone, **0.2031** for
  the curve × factor the board uses (log loss 0.6936 / 0.6259 / 0.6085). Each
  row shows both the launch value and the expected value (launch × odds),
  and the board ranks by expected value.
- **Farm verdicts.** Every row carries a costed plan: gas, a 5%/yr lock-up
  charge, hours, $/hour and the break-even capture share, netted to a
  FARM / THIN / SKIP verdict (150 / 29 / 19), plus a one-line plan summary.
- **Full accounting.** All 758 snapshot protocols are accounted for:
  416 already launched, 198 ranked here, 144 set aside with named reasons.
  The dashboard re-derives its own claims live in an integrity strip
  (10 checks) and draws the fit and the odds curve from the shipped data.

## Layout

- `main.ts` — reads `/input/snapshot.json`, writes `board.json`, the
  dashboard data, and `dossier.json` via the vendored board library.
- `lib/model.ts` — the fitted model, both blind tests, the odds cross-fit,
  the board and the accounting. `lib/farm.ts` — the costed farm plans.
- `dashboard/` — the offline dashboard (no framework, no network).
- `screenshots/` — three renders of the built dashboard.
- `NOTES.md` — the full build notes: what changed from v2, the rejected
  alternatives with their numbers, and the local gate validation.

Run it: `MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>`
(Node 22, standard library only.)
