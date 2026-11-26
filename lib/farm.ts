// Costed farm plans for the token launch radar.
//
// Every row of the board carries a plan a reader can actually run: a sequence of steps, each
// with its cost and its time, and a verdict that is arithmetic, not adjectives. The costing
// model is stated here once and printed on the dashboard's cover, so any row's verdict can be
// re-derived by hand:
//
//   capital    a tier from the protocol's own TVL ($50 at the small end, $500 at the top):
//              enough to register as a real position, small enough to repeat across a board.
//   gas        a per-chain round-dollar figure for one transaction (table below); a plan pays
//              it for the setup and core transactions, half of it for each weekly touch.
//   lock cost  the capital is not spent, but it is parked: 5% a year on the capital over the
//              hold, the price of not having it elsewhere.
//   hours      the reader's minutes: setup, core, deepen and a second-chain step once, then a
//              weekly touch and a weekly claim check for every week of the hold.
//   $/hour     (gas + lock cost) / hours: what one hour of farming this row costs all-in.
//   capture    (gas + lock cost) / expected value: the share of the row's expected launch
//              value the plan must win back to break even, as a percentage.
//   verdict    FARM when the launch odds are at least 30%, capture <= 0.25% and the hour
//              costs <= $25; THIN when the odds are at least 15% and capture <= 1.2%; SKIP
//              otherwise. Capture alone cannot carry the verdict — every row's expected
//              value dwarfs a $30 plan — so the odds gate does the real sorting: a cheap
//              plan for a launch the record says is not coming is still a plan to skip.

/** The slice of a protocol record a farm plan is built from. */
export interface FarmSubject {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
}

/** One row's costing: every figure the verdict came from, kept on the row for the dashboard. */
export interface FarmCosting {
  verdict: 'FARM' | 'THIN' | 'SKIP';
  capital_usd: number;
  gas_usd: number;
  lock_usd: number;
  total_usd: number;
  hours: number;
  per_hour_usd: number;
  capture_pct: number;
  hold_days: number;
}

/** The costing constants, printed on the cover so the arithmetic can be checked. */
export const FARM_ASSUMPTIONS = {
  lock_rate_per_year: 0.05,
  farm_capture_max_pct: 0.25,
  thin_capture_max_pct: 1.2,
  farm_per_hour_max_usd: 25,
  farm_min_odds: 0.3,
  thin_min_odds: 0.15,
  setup_minutes: 20,
  core_minutes: 15,
  deepen_minutes: 10,
  second_chain_minutes: 15,
  weekly_minutes: 12,
  check_minutes: 5,
};

/** One transaction's cost in round dollars, by chain; chains not listed pay the EVM default. */
const GAS_USD: Record<string, number> = {
  Ethereum: 9,
  Bitcoin: 4,
  Tron: 2,
  Solana: 1,
  BSC: 1,
  Arbitrum: 1,
  Base: 1,
  Optimism: 1,
  Polygon: 1,
  Avalanche: 1,
  Sui: 1,
  Aptos: 1,
  Near: 1,
  Stellar: 1,
  Algorand: 1,
};

/** Gas for one transaction on `chain`, in dollars. */
export function gasUsd(chain: string): number {
  return GAS_USD[chain] ?? 2;
}

/** The capital one farm position carries, from the protocol's own TVL. */
export function capitalUsd(tvl: number): number {
  if (tvl >= 1_000_000_000) return 500;
  if (tvl >= 250_000_000) return 250;
  if (tvl >= 50_000_000) return 150;
  if (tvl >= 10_000_000) return 100;
  return 50;
}

/** How long a position is held, from the protocol's age: the young get a longer window. */
export function holdDays(ageDays: number | null): number {
  if (ageDays === null) return 45;
  if (ageDays < 180) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

/** A small stable hash of a slug, so phrasing choices are deterministic across runs. */
function slugHash(slug: string): number {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const pick = (slug: string, salt: number, options: string[]): string =>
  options[(slugHash(slug) + salt) % options.length]!;

/** The category family's key: playbooks are written per family, never per protocol. */
export function familyOf(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('curator') || c.includes('allocator')) return 'curator';
  if (c.includes('dex') || c.includes('perpetual') || c.includes('derivative') || c.includes('option') || c.includes('synthetic')) return 'trading';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('staking') || c.includes('restak')) return 'staking';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('chain') || c.includes('payment') || c.includes('card')) return 'chain';
  return 'vault';
}

interface Playbook {
  core: (name: string, chain: string, capital: number) => string;
  deepen: (name: string, chain: string, capital: number) => string;
  weekly: (name: string, chain: string) => string;
}

const PLAYBOOKS: Record<string, Playbook> = {
  lending: {
    core: (n, ch, cap) => `Supply $${cap} of USDC as collateral on ${n} (${ch}) and leave the loan side untouched for the first week.`,
    deepen: (n, ch, cap) => `Borrow about $${Math.round(cap / 3)} of stablecoin against the collateral on ${n}, re-supply it once, and keep the health factor above 2.`,
    weekly: (n) => `Top the collateral up or adjust the loan slightly each week, so ${n} sees a living lending position, not a parked one.`,
  },
  curator: {
    core: (n, ch, cap) => `Deposit $${cap} of USDC into one of ${n}'s curated vaults on ${ch} and hold the vault shares in the farming wallet.`,
    deepen: (n, ch, cap) => `Place a second $${Math.round(cap / 2)} into a different ${n} vault on ${ch}, so the wallet counts in two markets at once.`,
    weekly: (n) => `Claim whatever the vaults pay each week and re-deposit it into ${n}, so the position compounds instead of idling.`,
  },
  trading: {
    core: (n, ch, cap) => `Deposit $${cap} of USDC into ${n} on ${ch} and open one small hedged position so the account is real from day one.`,
    deepen: (n, ch, cap) => `Work about $${cap * 2} of honest volume through ${n} across the week, in small orders on both sides, never one wash trade.`,
    weekly: (n) => `Trade at least twice a week on ${n} and keep the margin balance above half the deposit between trades.`,
  },
  bridge: {
    core: (n, ch, cap) => `Bridge $${cap} of USDC through ${n} to ${ch} and put the bridged funds to work in an app on the far side.`,
    deepen: (n, ch, cap) => `Bridge about $${Math.round(cap / 2)} back the following week, so ${n} records flow in both directions.`,
    weekly: (n) => `Send one small bridge a week through ${n} and keep a balance parked on the far chain between crossings.`,
  },
  staking: {
    core: (n, ch, cap) => `Stake $${cap} worth of the staking asset through ${n} on ${ch} and keep the receipt token in the farming wallet.`,
    deepen: (n, ch, cap) => `Commit the receipt token to a $${Math.round(cap / 2)} follow-on position ${n} itself offers, if it offers one.`,
    weekly: (n) => `Claim the staking rewards on ${n} every week and restake them, so both the balance and the record grow.`,
  },
  prediction: {
    core: (n, ch, cap) => `Fund $${cap} on ${n} and take a position in one of its liquid markets on ${ch}.`,
    deepen: (n, ch, cap) => `Spread about $${Math.round(cap / 3)} across each of three different markets on ${n} instead of a single bet.`,
    weekly: (n) => `Trade at least twice a week on ${n} and settle every market that finishes, rather than letting positions lapse.`,
  },
  vault: {
    core: (n, ch, cap) => `Deposit $${cap} of USDC into ${n}'s main vault on ${ch} and hold the shares for the whole window.`,
    deepen: (n, ch, cap) => `Add a second $${Math.round(cap / 2)} a fortnight later, so ${n} records a returning depositor, not a single visit.`,
    weekly: (n) => `Look in on the vault weekly, claim or compound any yield ${n} pays, and leave the principal where it is.`,
  },
  insurance: {
    core: (n, ch, cap) => `Buy $${cap} of cover from ${n} on ${ch} against a position you genuinely hold somewhere else.`,
    deepen: (n, ch, cap) => `Stake about $${Math.round(cap / 2)} into ${n}'s underwriting pool if it runs one, locked for the policy term.`,
    weekly: (n) => `Renew or extend one policy a week on ${n}, so the cover never lapses between weekly snapshots.`,
  },
  chain: {
    core: (n, ch, cap) => `Move $${cap} onto ${ch} and make ${n} the wallet's home ground: balances live there, not on an exchange.`,
    deepen: (n, ch, cap) => `Use two native apps on ${ch} from the same wallet, about $${Math.round(cap / 2)} in each, so the activity spans contracts.`,
    weekly: (n, ch) => `Make one transaction a week on ${ch} — a transfer, a swap or a stake — so the wallet stays an active address.`,
  },
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A capture percentage as a reader should see it: tiny is not zero. */
const fmtCapture = (pct: number): string => (pct < 0.01 ? '<0.01' : String(round2(pct)));

/**
 * One line that carries a costing's whole verdict, for lists too dense for the full plan:
 * the verdict, the all-in cost, the hours it buys, and the capture the plan must win back.
 * The dashboard's detail view leads with it; the numbers are the costing's own, reworded.
 */
export function planSummary(costing: FarmCosting): string {
  return `${costing.verdict} — $${costing.total_usd} all-in over ${costing.hours} h `
    + `($${costing.per_hour_usd}/h), break-even at ${fmtCapture(costing.capture_pct)}% capture, `
    + `${costing.hold_days}-day hold on $${costing.capital_usd} of capital.`;
}

/**
 * A protocol's costed farm plan: the steps, and the costing they add up to.
 * `expectedValueUsd` is the row's expected launch value (launch value x launch odds), and
 * `launchOdds` those odds: the verdict weighs both, as the header states.
 */
export function farmPlan(
  p: FarmSubject,
  ageDays: number | null,
  expectedValueUsd: number,
  launchOdds: number,
): { steps: string[]; costing: FarmCosting } {
  const a = FARM_ASSUMPTIONS;
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const second = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalUsd(p.tvl_usd);
  const hold = holdDays(ageDays);
  const weeks = Math.max(1, Math.ceil(hold / 7));
  const book = PLAYBOOKS[familyOf(p.category)]!;
  const g1 = gasUsd(chain);
  const g2 = second !== null ? gasUsd(second) : 0;

  const gas = 2 * g1 + g2 + weeks * Math.max(1, Math.round(g1 / 2));
  const lock = capital * a.lock_rate_per_year * (hold / 365);
  const total = gas + lock;
  const minutes =
    a.setup_minutes + a.core_minutes + a.deepen_minutes +
    (second !== null ? a.second_chain_minutes : 0) +
    weeks * (a.weekly_minutes + a.check_minutes);
  const hours = minutes / 60;
  const perHour = total / hours;
  const capturePct = expectedValueUsd > 0 ? (total / expectedValueUsd) * 100 : 100;
  const verdict: FarmCosting['verdict'] =
    launchOdds >= a.farm_min_odds && capturePct <= a.farm_capture_max_pct && perHour <= a.farm_per_hour_max_usd
      ? 'FARM'
      : launchOdds >= a.thin_min_odds && capturePct <= a.thin_capture_max_pct
        ? 'THIN'
        : 'SKIP';

  const steps = [
    `${pick(p.slug, 3, [
      `Set up one wallet for this farm alone, fund it just before starting, and keep its seed phrase on paper, offline.`,
      `Use a fresh wallet dedicated to ${p.name}, so every action below is clean, countable activity.`,
      `Fund a single-purpose wallet for ${p.name} shortly before you begin; never farm from your main wallet.`,
    ])} Cost: about $${g1} of gas for the first transactions. Time: ${a.setup_minutes} minutes.`,
    `${book.core(p.name, chain, capital)} Cost: $${capital} of capital plus about $${g1} of gas. Time: ${a.core_minutes} minutes.`,
    `${book.deepen(p.name, chain, capital)} Cost: the extra capital named plus about $${g1} of gas. Time: ${a.deepen_minutes} minutes.`,
    ...(second !== null
      ? [`Repeat the core position on ${second}, ${p.name}'s second chain, with about $${Math.round(capital / 2)}: a second chain is the cheapest extra signal a wallet can show. Cost: $${Math.round(capital / 2)} of capital plus about $${g2} of gas. Time: ${a.second_chain_minutes} minutes.`]
      : [`Widen the position on ${chain} into a second market or vault ${p.name} offers, with about $${Math.round(capital / 2)} more, so the wallet is not a one-market visitor. Cost: $${Math.round(capital / 2)} of capital plus about $${g1} of gas. Time: ${a.deepen_minutes} minutes.`]),
    `${book.weekly(p.name, chain)} Cost: about $${Math.max(1, Math.round(g1 / 2))} of gas a week. Time: ${a.weekly_minutes} minutes a week.`,
    `Hold every position for at least ${hold} days, across ${weeks} weekly snapshots of ${p.name}. Cost: the $${capital} stays parked; at a 5% yearly rate that lock-up costs about $${round2(lock)}. Time: ${hold} days.`,
    `Costed verdict: ${verdict}. All-in cost is about $${round2(total)} (gas $${gas} plus $${round2(lock)} of lock-up) over ${round2(hours)} hours of effort, $${round2(perHour)} an hour; the plan pays for itself if the wallet captures ${fmtCapture(capturePct)}% of this row's expected launch value. Check ${p.name}'s own rewards page weekly and claim only from links the app itself publishes. Time: ${a.check_minutes} minutes a week.`,
  ];
  return {
    steps: steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s)),
    costing: {
      verdict,
      capital_usd: capital,
      gas_usd: gas,
      lock_usd: round2(lock),
      total_usd: round2(total),
      hours: round2(hours),
      per_hour_usd: round2(perHour),
      capture_pct: round2(capturePct),
      hold_days: hold,
    },
  };
}
