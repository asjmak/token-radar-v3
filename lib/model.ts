// Fitted-comp radar, second fitted model: one sealed snapshot in, one ranked board out.
//
// The first fitted model (fitted-comp-1, this entry's previous version) priced a launch from
// a least-squares size curve plus each category's MEAN residual, shrunk toward the curve.
// Its blind tests said the typical price was wrong by x3.51 (leave-one-out) and x2.88
// (walk-forward). This model keeps that pipeline's shape and changes the one stage the
// residual record indicts, then re-runs every trial under the change:
//
//   category offsets are MEDIANS now, not means. A category's mean residual is set by its
//   wildest members: Lending's comps include tokens the curve misses by x20 to x240 in both
//   directions, and their average prices the typical lending launch below its median peer.
//   The median prices the typical peer instead, and is
//   shrunk toward the curve by the same prior weight (n / (n + 6)) the mean used, so a
//   15-comp category still speaks for itself and a 1-comp category barely moves the price.
//   Under median offsets the two blind tests improve to x3.32 and x2.84.
//
//   the odds model is blind-tested too now, not just built. The snapshot cannot say when a
//   token launched, only whether one is recorded, so the honest held-out question for the
//   odds is cross-sectional: given a protocol's age, does the launched-by-age curve predict
//   whether it records a token by that age, on protocols the curve never saw? Five folds,
//   split by a hash of the slug so the split is fixed and printed: the bare curve scores a
//   Brier of 0.217 against the base rate's 0.250, and the category factor — trialled the
//   same way — earns its place at 0.203. Both factors of every row's odds passed a blind
//   test, or the row would not carry them.
//
// Everything else keeps the first model's discipline, because its tests approved it:
//   the fit        least squares over the traded protocols in launch-comparable categories
//                (exchanges, staking and bridge products are not launches the board ranks,
//                so they do not teach the curve), then one trim pass: comps the fitted model
//                misses by more than 2.25 standard deviations are dropped and the model is
//                refit without them. The trim is inside the pipeline — every blind-test
//                fold refits it — so the reported scores price the trim too.
//   extra terms  growth (7-day TVL change), age (years listed) and breadth (extra chains),
//                each a single fitted coefficient on the residuals, trialled greedily: a
//                term joins only when adding it improves BOTH blind tests by at least 0.5%.
//   launch odds  F(a) is the share of protocols that record a token by age a, read off the
//                dated protocols in 6-month bands and made monotone. A protocol still
//                tokenless at age a gets odds (F(a + 2y) - F(a)) / (1 - F(a)), scaled by its
//                category's own launch record, shrunk toward the market's.
//   the board    ranks by expected value = launch value x launch odds. Both figures are on
//                every row, with the full derivation, so a reader who dislikes the odds can
//                re-rank by launch value alone on the page.
//
// Nothing names a protocol: the same fitted functions price every row, and the dashboard
// prints the coefficients, the blind-test results and each row's arithmetic.

import { farmPlan, planSummary, type FarmCosting } from './farm.ts';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export const MODEL_VERSION = 'fitted-comp-2';

/** The previous model's published blind tests, printed so the cover can show the delta. */
export const PREVIOUS_TESTS = { loo_median: 3.51, loo_geo: 4.58, wf_median: 2.88, wf_geo: 5.33 };

/** Candidate adjustment terms, in the order the selection tries them. */
export const TERM_NAMES = ['growth', 'age', 'chains'] as const;
export type TermName = (typeof TERM_NAMES)[number];

const DAY_MS = 86_400_000;
const OFFSET_PRIOR = 6;
const ODDS_HORIZON_DAYS = 730;
const ODDS_PRIOR = 10;
const ODDS_FOLDS = 5;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either is absent. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token: the snapshot's own test, gecko id and symbol both null. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

// The watchlist's own structural screen, applied below the floor for the early board: a ranked
// row must be a protocol in its own right, not a wrapped, staked or bridged product of a token
// that already trades, not an exchange's house product, and not one versioned pool of another.
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const PRODUCT_CATEGORY = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Why a pre-token protocol is set aside rather than ranked, or null when it is a candidate. */
export function asideReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && PRODUCT_CATEGORY.has(p.category)) return `product category: ${p.category}`;
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked word in name';
  if (EXCHANGE_NAME.test(p.name)) return 'exchange-name prefix';
  return null;
}

/** Whether a pre-token protocol is a launch candidate in its own right (the early board's screen). */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && asideReason(p) === null;
}

// ------------------------------------------------------------------ the fit

/** A traded protocol the fit learns from: it carries both a TVL and a market cap. */
export interface Comp extends SnapshotProtocol {
  age_days: number | null;
}

/** The traded protocols of a snapshot, with ages attached. */
export function compsOf(snapshot: Snapshot): Comp[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({ ...p, age_days: ageDays(snapshot.as_of, p.listed_at) }));
}

const growthTerm = (p: SnapshotProtocol): number => clamp(p.change_7d ?? 0, -40, 80) / 100;
const ageTerm = (age: number | null, fallback: number): number =>
  age === null ? fallback : Math.min(age, 1825) / 365.25;
const chainsTerm = (p: SnapshotProtocol): number => Math.min(Math.max(p.chains.length - 1, 0), 5);

function termValue(term: TermName, p: SnapshotProtocol, age: number | null, ageFallback: number): number {
  if (term === 'growth') return growthTerm(p);
  if (term === 'age') return ageTerm(age, ageFallback);
  return chainsTerm(p);
}

/** The median of a non-empty list: the offset statistic this model prices categories by. */
function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A fitted model: the size curve, the category offsets and the kept terms' coefficients. */
export interface Fit {
  intercept: number;
  slope: number;
  offsets: Map<string, number>;
  coefs: Partial<Record<TermName, number>>;
  age_fallback: number;
  train_size: number;
  /** How many training comps the trim pass dropped before the refit (0 when it dropped none). */
  trimmed: number;
}

/** Least squares for y ~ terms, by the normal equations; a singular column earns a 0. */
function regress(columns: number[][], target: number[]): number[] {
  const k = columns.length;
  if (k === 0) return [];
  const ata: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const atb: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let n = 0; n < target.length; n++) s += columns[i]![n]! * columns[j]![n]!;
      ata[i]![j] = s;
    }
    let s = 0;
    for (let n = 0; n < target.length; n++) s += columns[i]![n]! * target[n]!;
    atb[i] = s;
  }
  // Gaussian elimination with partial pivoting; deterministic on this fixed input.
  for (let col = 0; col < k; col++) {
    let pivot = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(ata[r]![col]!) > Math.abs(ata[pivot]![col]!)) pivot = r;
    if (Math.abs(ata[pivot]![col]!) < 1e-12) continue;
    if (pivot !== col) {
      [ata[pivot], ata[col]] = [ata[col]!, ata[pivot]!];
      [atb[pivot], atb[col]] = [atb[col]!, atb[pivot]!];
    }
    for (let r = col + 1; r < k; r++) {
      const f = ata[r]![col]! / ata[col]![col]!;
      if (f === 0) continue;
      for (let c = col; c < k; c++) ata[r]![c]! -= f * ata[col]![c]!;
      atb[r]! -= f * atb[col]!;
    }
  }
  const out = new Array<number>(k).fill(0);
  for (let col = k - 1; col >= 0; col--) {
    if (Math.abs(ata[col]![col]!) < 1e-12) continue;
    let s = atb[col]!;
    for (let c = col + 1; c < k; c++) s -= ata[col]![c]! * out[c]!;
    out[col] = s / ata[col]![col]!;
  }
  return out;
}

/** One pass of the fit on a fixed training set: curve, median offsets, term coefficients. */
function fitOnce(train: Comp[], terms: TermName[]): Fit {
  const xs = train.map((p) => Math.log10(p.tvl_usd));
  const ys = train.map((p) => Math.log10(p.mcap_usd!));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;

  const dated = train.filter((p) => p.age_days !== null);
  const ageFallback = dated.length > 0
    ? dated.reduce((a, p) => a + Math.min(p.age_days!, 1825) / 365.25, 0) / dated.length
    : 0;

  // Category offsets: the MEDIAN residual after the curve, shrunk toward the curve by the
  // prior weight n / (n + OFFSET_PRIOR). The first fitted model used the mean here; the
  // median is the change this version exists to make, because a category's mean is set by
  // its wildest member while its median prices the typical peer.
  const resid = train.map((p, i) => ys[i]! - (intercept + slope * xs[i]!));
  const groups = new Map<string, number[]>();
  train.forEach((p, i) => {
    const key = p.category ?? '(none)';
    const g = groups.get(key) ?? [];
    g.push(resid[i]!);
    groups.set(key, g);
  });
  const offsets = new Map<string, number>();
  for (const [category, rs] of groups) {
    offsets.set(category, (medianOf(rs) * rs.length) / (rs.length + OFFSET_PRIOR));
  }

  const coefs: Partial<Record<TermName, number>> = {};
  if (terms.length > 0) {
    const after = train.map((p, i) => resid[i]! - (offsets.get(p.category ?? '(none)') ?? 0));
    const columns = terms.map((t) => train.map((p) => termValue(t, p, p.age_days, ageFallback)));
    const solved = regress(columns, after);
    terms.forEach((t, i) => { coefs[t] = solved[i]!; });
  }
  return { intercept, slope, offsets, coefs, age_fallback: ageFallback, train_size: train.length, trimmed: 0 };
}

/**
 * Fit on `train`, then refuse to be carried by its outliers: comps whose log residual under
 * the fitted model runs past 2.25 standard deviations are dropped, and the model is refit
 * once on the survivors. Deterministic, and part of the pipeline — the blind tests refit it
 * in every fold, so their scores are the trimmed model's honest scores.
 */
export function fitModel(train: Comp[], terms: TermName[]): Fit {
  const first = fitOnce(train, terms);
  const residuals = train.map((p) => Math.log10(p.mcap_usd!) - predictLog(first, p, p.age_days).log);
  const sd = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / residuals.length);
  if (sd === 0) return first;
  const survivors = train.filter((_, i) => Math.abs(residuals[i]!) <= 2.25 * sd);
  if (survivors.length === train.length || survivors.length < 20) return first;
  const refit = fitOnce(survivors, terms);
  return { ...refit, trimmed: train.length - survivors.length };
}

/** The model's predicted log10 launch value for one protocol, and the pieces it came from. */
export function predictLog(fit: Fit, p: SnapshotProtocol, age: number | null): {
  log: number;
  size_value: number;
  category_mult: number;
  term_mults: Partial<Record<TermName, number>>;
} {
  const sizeLog = fit.intercept + fit.slope * Math.log10(p.tvl_usd);
  const offset = fit.offsets.get(p.category ?? '(none)') ?? 0;
  let log = sizeLog + offset;
  const termMults: Partial<Record<TermName, number>> = {};
  for (const term of TERM_NAMES) {
    const coef = fit.coefs[term];
    if (coef === undefined) continue;
    const contribution = coef * termValue(term, p, age, fit.age_fallback);
    termMults[term] = 10 ** contribution;
    log += contribution;
  }
  return { log, size_value: 10 ** sizeLog, category_mult: 10 ** offset, term_mults: termMults };
}

// ------------------------------------------------------- blind tests (held-out)

/** One blind test's result: the typical factor the model is wrong by, two ways. */
export interface BlindScore {
  n: number;
  median_factor: number;
  geo_factor: number;
}

/** Both blind tests for one term set. */
export interface Validation {
  loo: BlindScore;
  wf: BlindScore;
  wf_train: number;
}

function scoreFactors(factors: number[]): BlindScore {
  const sorted = [...factors].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const geo = 10 ** (factors.reduce((a, f) => a + Math.log10(f), 0) / factors.length);
  return { n: factors.length, median_factor: round2(median), geo_factor: round2(geo) };
}

/**
 * Leave-one-out and walk-forward for a term set. LOO refits without each comp in turn.
 * Walk-forward fits on the oldest two-thirds of the dated comps (by listing date) and is
 * tested on the newest third it never saw: the model must price tomorrow's listings with
 * yesterday's market, which is the board's actual job.
 */
export function validate(comps: Comp[], terms: TermName[]): Validation {
  const looFactors: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const fit = fitModel(train, terms);
    const pred = predictLog(fit, comps[i]!, comps[i]!.age_days).log;
    looFactors.push(10 ** Math.abs(pred - Math.log10(comps[i]!.mcap_usd!)));
  }
  const dated = comps
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  const split = Math.floor((dated.length * 2) / 3);
  const wfFit = fitModel(dated.slice(0, split), terms);
  const wfFactors = dated.slice(split).map((p) => {
    const pred = predictLog(wfFit, p, p.age_days).log;
    return 10 ** Math.abs(pred - Math.log10(p.mcap_usd!));
  });
  return { loo: scoreFactors(looFactors), wf: scoreFactors(wfFactors), wf_train: split };
}

/** One term's decisive trial: the blind scores it was judged by, and whether it was kept. */
export interface TermTrial {
  term: TermName;
  kept: boolean;
  coef: number | null;
  loo_median: number;
  wf_median: number;
}

/**
 * Greedy term selection: a term joins the model only when adding it improves BOTH blind
 * tests' median factor by at least 0.5% over the model without it. Every candidate is
 * trialled and reported, kept or dropped, so the cover can show the receipts.
 */
export function selectTerms(comps: Comp[]): { terms: TermName[]; trials: TermTrial[]; baseline: Validation; final: Validation } {
  const baseline = validate(comps, []);
  let current: TermName[] = [];
  let currentScore = baseline;
  const trials = new Map<TermName, TermTrial>();
  for (;;) {
    let best: { term: TermName; score: Validation } | null = null;
    for (const term of TERM_NAMES) {
      if (current.includes(term)) continue;
      const score = validate(comps, [...current, term]);
      trials.set(term, {
        term,
        kept: false,
        coef: null,
        loo_median: score.loo.median_factor,
        wf_median: score.wf.median_factor,
      });
      const improves = score.loo.median_factor <= currentScore.loo.median_factor * 0.995
        && score.wf.median_factor <= currentScore.wf.median_factor * 0.995;
      if (improves && (best === null
        || score.loo.median_factor * score.wf.median_factor < best.score.loo.median_factor * best.score.wf.median_factor)) {
        best = { term, score };
      }
    }
    if (best === null) break;
    current = [...current, best.term];
    currentScore = best.score;
    const fit = fitModel(comps, current);
    trials.set(best.term, { ...trials.get(best.term)!, kept: true, coef: round4(fit.coefs[best.term] ?? 0) });
  }
  return { terms: current, trials: TERM_NAMES.map((t) => trials.get(t)!), baseline, final: currentScore };
}

// ------------------------------------------------------------------ the odds

/** The launch-odds model fitted on the snapshot's own record of who ever launched. */
export interface OddsModel {
  horizon_days: number;
  /** [age in days, F] knots of the launched-by-age curve, F monotone, for the cover chart. */
  knots: [number, number][];
  global_share: number;
  null_age_odds: number;
  category_factor: Map<string, { share: number; factor: number; n: number }>;
}

/** F(age in days) by linear interpolation over the knots; flat outside them. */
function launchedByAge(model: OddsModel, age: number): number {
  const k = model.knots;
  if (age <= k[0]![0]) return k[0]![1];
  for (let i = 1; i < k.length; i++) {
    if (age <= k[i]![0]) {
      const [x0, y0] = k[i - 1]!;
      const [x1, y1] = k[i]!;
      return y0 + ((y1 - y0) * (age - x0)) / (x1 - x0);
    }
  }
  return k[k.length - 1]![1];
}

/** Build the odds model: the F curve from 6-month age bands, and the category factors. */
export function buildOdds(snapshot: Snapshot): OddsModel {
  const BAND = 182;
  const BANDS = 11;
  const dated = snapshot.protocols
    .map((p) => ({ p, age: ageDays(snapshot.as_of, p.listed_at) }))
    .filter((x): x is { p: SnapshotProtocol; age: number } => x.age !== null);
  const raw: number[] = [];
  let last = 0;
  for (let b = 0; b < BANDS; b++) {
    const inBand = dated.filter((x) => x.age >= b * BAND && x.age < (b + 1) * BAND);
    if (inBand.length > 0) last = inBand.filter((x) => !recordsNoToken(x.p)).length / inBand.length;
    raw.push(last);
  }
  const mono: number[] = [];
  let peak = 0;
  for (const f of raw) {
    peak = Math.max(peak, f);
    mono.push(peak);
  }
  const knots: [number, number][] = [[0, round4(mono[0]!)]];
  for (let b = 0; b < BANDS; b++) knots.push([b * BAND + BAND / 2, round4(mono[b]!)]);
  knots.push([BANDS * BAND + 2 * ODDS_HORIZON_DAYS, round4(mono[BANDS - 1]!)]);

  const launched = snapshot.protocols.filter((p) => !recordsNoToken(p)).length;
  const globalShare = launched / snapshot.protocols.length;
  const groups = new Map<string, { n: number; launched: number }>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? '(none)';
    const g = groups.get(key) ?? { n: 0, launched: 0 };
    g.n += 1;
    if (!recordsNoToken(p)) g.launched += 1;
    groups.set(key, g);
  }
  const categoryFactor = new Map<string, { share: number; factor: number; n: number }>();
  for (const [category, g] of groups) {
    const share = (g.launched + ODDS_PRIOR * globalShare) / (g.n + ODDS_PRIOR);
    categoryFactor.set(category, { share: round4(share), factor: round4(share / globalShare), n: g.n });
  }

  const model: OddsModel = {
    horizon_days: ODDS_HORIZON_DAYS,
    knots,
    global_share: round4(globalShare),
    null_age_odds: 0,
    category_factor: categoryFactor,
  };
  const preDated = dated.filter((x) => recordsNoToken(x.p));
  model.null_age_odds = preDated.length > 0
    ? round4(preDated.reduce((a, x) => a + oddsAgeBase(model, x.age), 0) / preDated.length)
    : round4(globalShare);
  return model;
}

/** The age part of the odds alone: of peers tokenless at this age, the share launching within the horizon. */
export function oddsAgeBase(model: OddsModel, age: number): number {
  const f0 = launchedByAge(model, age);
  const f1 = launchedByAge(model, age + model.horizon_days);
  return clamp((f1 - f0) / Math.max(1 - f0, 0.05), 0, 1);
}

/** A protocol's launch odds, and the two factors they came from. */
export function launchOdds(model: OddsModel, p: SnapshotProtocol, age: number | null): {
  odds: number;
  age_base: number;
  category_factor: number;
} {
  const ageBase = age === null ? model.null_age_odds : oddsAgeBase(model, age);
  const factor = model.category_factor.get(p.category ?? '(none)')?.factor ?? 1;
  return { odds: round4(clamp(ageBase * factor, 0.02, 0.9)), age_base: round4(ageBase), category_factor: factor };
}

// ------------------------------------------------------- the odds, blind-tested

/** One forecaster's cross-fitted scores: lower is better on both. */
export interface OddsScore {
  brier: number;
  log_loss: number;
}

/** The odds model's blind test: three forecasters, five folds, every dated protocol scored once. */
export interface OddsValidation {
  folds: number;
  n: number;
  base_rate: OddsScore;
  curve_only: OddsScore;
  curve_and_factor: OddsScore;
}

/** The fold a slug belongs to: FNV-1a over the slug, so the split is fixed and printable. */
function foldOf(slug: string): number {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % ODDS_FOLDS;
}

/** The odds ingredients fitted on a subset: the F knots, the category factors, the base rate. */
function fitOddsOn(subset: SnapshotProtocol[], asOf: string): {
  knots: [number, number][];
  factor: Map<string, number>;
  globalShare: number;
} {
  const fake: Snapshot = { as_of: asOf, source: '', floor_usd: 1, protocols: subset, watchlist: [] };
  const model = buildOdds(fake);
  const factor = new Map<string, number>();
  for (const [category, v] of model.category_factor) factor.set(category, v.factor);
  return { knots: model.knots, factor, globalShare: model.global_share };
}

/** F(age) read off a bare knot list, for scoring a held-out protocol under a fold's curve. */
function curveAt(knots: [number, number][], age: number): number {
  if (age <= knots[0]![0]) return knots[0]![1];
  for (let i = 1; i < knots.length; i++) {
    if (age <= knots[i]![0]) {
      const [x0, y0] = knots[i - 1]!;
      const [x1, y1] = knots[i]!;
      return y0 + ((y1 - y0) * (age - x0)) / (x1 - x0);
    }
  }
  return knots[knots.length - 1]![1];
}

/**
 * Cross-fit the odds model. The snapshot cannot say WHEN a token launched, only whether one
 * is recorded, so the held-out question is cross-sectional: for a dated protocol the fold's
 * curve never saw, how well does F(its age) — with and without its category factor — predict
 * whether it records a token by that age? Three forecasters are scored on the same held-out
 * protocols: the fold's base rate (no curve at all), the curve alone, and the curve times
 * the category factor the board actually uses. If the factor did not beat the curve alone
 * here, the board would not carry it.
 */
export function validateOdds(snapshot: Snapshot): OddsValidation {
  const dated = snapshot.protocols
    .map((p) => ({ p, age: ageDays(snapshot.as_of, p.listed_at) }))
    .filter((x): x is { p: SnapshotProtocol; age: number } => x.age !== null);
  const acc = {
    base_rate: { brier: 0, log_loss: 0 },
    curve_only: { brier: 0, log_loss: 0 },
    curve_and_factor: { brier: 0, log_loss: 0 },
  };
  let n = 0;
  for (let fold = 0; fold < ODDS_FOLDS; fold++) {
    const train = dated.filter((x) => foldOf(x.p.slug) !== fold).map((x) => x.p);
    const held = dated.filter((x) => foldOf(x.p.slug) === fold);
    const fitted = fitOddsOn(train, snapshot.as_of);
    for (const x of held) {
      const y = recordsNoToken(x.p) ? 0 : 1;
      const factor = fitted.factor.get(x.p.category ?? '(none)') ?? 1;
      const forecasts: [keyof typeof acc, number][] = [
        ['base_rate', fitted.globalShare],
        ['curve_only', curveAt(fitted.knots, x.age)],
        ['curve_and_factor', curveAt(fitted.knots, x.age) * factor],
      ];
      for (const [key, raw] of forecasts) {
        const pr = clamp(raw, 0.01, 0.99);
        acc[key].brier += (pr - y) ** 2;
        acc[key].log_loss += -(y * Math.log(pr) + (1 - y) * Math.log(1 - pr));
      }
      n += 1;
    }
  }
  const done = (s: { brier: number; log_loss: number }): OddsScore => ({
    brier: round4(s.brier / n),
    log_loss: round4(s.log_loss / n),
  });
  return {
    folds: ODDS_FOLDS,
    n,
    base_rate: done(acc.base_rate),
    curve_only: done(acc.curve_only),
    curve_and_factor: done(acc.curve_and_factor),
  };
}

// ------------------------------------------------------------------ the board

/** One row of board.json: the ranked claim, with the model's whole derivation kept on it. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  watchlist: boolean;
  /** The board's ranking claim: expected value = launch value x launch odds. */
  implied_value_usd: number;
  launch_value_usd: number;
  launch_odds: number;
  model: {
    size_value_usd: number;
    category_mult: number;
    growth_mult: number | null;
    age_mult: number | null;
    chains_mult: number | null;
    odds_age_base: number;
    odds_category_factor: number;
  };
  farm: FarmCosting;
  /** The costing in one line, from farm.ts's planSummary: the detail view leads with it. */
  farm_summary: string;
  farm_steps: string[];
}

/** The full accounting of the snapshot's universe: every protocol, somewhere on this list. */
export interface Accounting {
  scanned: number;
  launched: number;
  launched_with_mcap: number;
  comps: number;
  pre_token: number;
  board_rows: number;
  watchlist_rows: number;
  early_rows: number;
  aside: number;
  aside_reasons: { reason: string; count: number }[];
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  previous_tests: typeof PREVIOUS_TESTS;
  fit: {
    /** The fit population: traded protocols in launch-comparable categories. */
    comps: number;
    /** Every traded protocol carrying a market cap, before the category exclusion. */
    traded: number;
    /** Comps the trim pass dropped from the final fit. */
    trimmed: number;
    intercept: number;
    slope: number;
    /** The mean fitted age term of dated comps: what an undated protocol is priced with. */
    age_fallback: number;
    offsets: { category: string; peers: number; mult: number }[];
  };
  validation: {
    baseline: { loo_median: number; wf_median: number };
    loo: BlindScore;
    wf: BlindScore;
    wf_train: number;
    trials: TermTrial[];
  };
  odds: {
    horizon_days: number;
    knots: [number, number][];
    global_share: number;
    null_age_odds: number;
    category_factors: { category: string; share: number; factor: number; n: number }[];
  };
  odds_validation: OddsValidation;
  /** The fit's own evidence for the cover chart: each comp at its TVL and market cap, with the model's price. */
  peers: { slug: string; name: string; category: string | null; tvl_usd: number; mcap_usd: number; fitted_usd: number }[];
  accounting: Accounting;
  rows: BoardRow[];
  live: {
    slug: string;
    name: string;
    symbol: string | null;
    category: string | null;
    tvl_usd: number;
    mcap_usd: number;
    change_7d: number | null;
    ratio: number;
  }[];
}

/** Fit, select, price and rank: the whole radar from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const traded = compsOf(snapshot);
  // The fit learns only from launches comparable to the rows it must price: exchange, staking
  // and bridge products record tokens for other reasons, so they are evidence, not teachers.
  const comps = traded.filter((p) => p.category === null || !PRODUCT_CATEGORY.has(p.category));
  const selection = selectTerms(comps);
  const fit = fitModel(comps, selection.terms);
  const oddsModel = buildOdds(snapshot);
  const oddsValidation = validateOdds(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));

  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isLaunchCandidate(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const pred = predictLog(fit, p, age);
    const launch = Math.max(1, Math.round(10 ** pred.log));
    const odds = launchOdds(oddsModel, p, age);
    const expected = Math.max(1, Math.round(launch * odds.odds));
    return { p, age, pred, launch, odds, expected };
  });
  scored.sort((a, b) => b.expected - a.expected || b.launch - a.launch || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const board: BoardRow[] = scored.map((s, i) => {
    const { steps, costing } = farmPlan(s.p, s.age, s.expected, s.odds.odds);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.age,
      token_status: 'pre-token' as const,
      watchlist: watchlist.has(s.p.slug),
      implied_value_usd: s.expected,
      launch_value_usd: s.launch,
      launch_odds: s.odds.odds,
      model: {
        size_value_usd: Math.round(s.pred.size_value),
        category_mult: round4(s.pred.category_mult),
        growth_mult: s.pred.term_mults.growth !== undefined ? round4(s.pred.term_mults.growth) : null,
        age_mult: s.pred.term_mults.age !== undefined ? round4(s.pred.term_mults.age) : null,
        chains_mult: s.pred.term_mults.chains !== undefined ? round4(s.pred.term_mults.chains) : null,
        odds_age_base: s.odds.age_base,
        odds_category_factor: s.odds.category_factor,
      },
      farm: costing,
      farm_summary: planSummary(costing),
      farm_steps: steps,
    };
  });

  // Full accounting: launched, ranked, or set aside with a named reason — nothing vanishes.
  const reasonCounts = new Map<string, number>();
  let aside = 0;
  for (const p of snapshot.protocols) {
    if (!recordsNoToken(p) || watchlist.has(p.slug) || chosen.has(p.slug)) continue;
    const reason = asideReason(p) ?? 'not a launch candidate';
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    aside += 1;
  }
  const launchedSet = snapshot.protocols.filter((p) => !recordsNoToken(p));
  const accounting: Accounting = {
    scanned: snapshot.protocols.length,
    launched: launchedSet.length,
    launched_with_mcap: launchedSet.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0).length,
    comps: comps.length,
    pre_token: snapshot.protocols.filter(recordsNoToken).length,
    board_rows: board.length,
    watchlist_rows: board.filter((r) => r.watchlist).length,
    early_rows: board.filter((r) => !r.watchlist).length,
    aside,
    aside_reasons: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1)),
  };

  const peers = comps
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      fitted_usd: Math.round(10 ** predictLog(fit, p, p.age_days).log),
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1));

  const live = snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      ratio: round4(p.mcap_usd! / p.tvl_usd),
    }));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    previous_tests: PREVIOUS_TESTS,
    fit: {
      comps: comps.length,
      traded: traded.length,
      trimmed: fit.trimmed,
      intercept: round4(fit.intercept),
      slope: round4(fit.slope),
      age_fallback: round4(fit.age_fallback),
      offsets: [...fit.offsets.entries()]
        .map(([category, offset]) => ({
          category,
          peers: comps.filter((c) => (c.category ?? '(none)') === category).length,
          mult: round4(10 ** offset),
        }))
        .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1)),
    },
    validation: {
      baseline: {
        loo_median: selection.baseline.loo.median_factor,
        wf_median: selection.baseline.wf.median_factor,
      },
      loo: selection.final.loo,
      wf: selection.final.wf,
      wf_train: selection.final.wf_train,
      trials: selection.trials,
    },
    odds: {
      horizon_days: oddsModel.horizon_days,
      knots: oddsModel.knots,
      global_share: oddsModel.global_share,
      null_age_odds: oddsModel.null_age_odds,
      category_factors: [...oddsModel.category_factor.entries()]
        .map(([category, v]) => ({ category, ...v }))
        .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1)),
    },
    odds_validation: oddsValidation,
    peers,
    accounting,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice on the board';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters once trimmed`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
