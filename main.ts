// Token launch radar, fitted-comp-2 (token-radar-01): a Node 22 program, standard library only.
//
// It reads the sealed snapshot from /input/snapshot.json (or --input), fits the valuation model
// on the snapshot's traded protocols — category offsets by median, not mean, the one change
// the previous model's residual record indicted — keeps only the terms two blind tests
// approve, cross-fits the launch-odds model on five folds so its factors are blind-tested
// too, prices every launch candidate, and writes the ranked board to /output/board.json. It
// writes the dashboard's data to /output/data.js, copies dashboard/ and screenshots/ into
// /output, and writes /output/dossier.json last with the vendored library, exactly as the
// gate expects to rebuild it.
//
// The board ranks by expected value (launch value x launch odds) and covers the whole
// watchlist plus every other protocol that passes the watchlist's own structural screen.
// Protocols that already record a token are never ranked; the dashboard shows the largest of
// them apart, at the market's own values, as the peer evidence the fit learned from.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps, restated so the program refuses early rather than handing in junk. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value of `--name` among the arguments, or the fallback when it is absent. */
function argValue(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = argValue('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`fitted radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const outDir = argValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`fitted radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a directory's regular files into the output, skipping dotfiles; returns the names. */
function copyPlainFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyPlainFiles(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyPlainFiles(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`fitted radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`fitted radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier goes last: the scorer rebuilds it from this output and compares byte for byte.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

const acc = radar.accounting;
const keptTerms = radar.validation.trials.filter((t) => t.kept).map((t) => t.term);
const droppedTerms = radar.validation.trials.filter((t) => !t.kept).map((t) => t.term);
const verdicts = { FARM: 0, THIN: 0, SKIP: 0 };
for (const row of board) verdicts[row.farm.verdict] += 1;
const ov = radar.odds_validation;
process.stdout.write(
  `fitted radar: ${acc.scanned} protocols accounted for: ${acc.launched} already record a token, ` +
    `${acc.board_rows} ranked (${acc.watchlist_rows} watchlist + ${acc.early_rows} early), ${acc.aside} set aside\n` +
    `fitted radar: model fitted on ${radar.fit.comps} comps (${radar.fit.trimmed} trimmed as outliers), median category offsets; ` +
    `terms kept: ${keptTerms.join(', ') || 'none'}; dropped after both blind tests: ${droppedTerms.join(', ') || 'none'}\n` +
    `fitted radar: blind tests leave-one-out x${radar.validation.loo.median_factor}, ` +
    `walk-forward x${radar.validation.wf.median_factor}; farm verdicts FARM ${verdicts.FARM}, THIN ${verdicts.THIN}, SKIP ${verdicts.SKIP}\n` +
    `fitted radar: odds cross-fit over ${ov.n} dated protocols: Brier base ${ov.base_rate.brier}, ` +
    `curve ${ov.curve_only.brier}, curve + category factor ${ov.curve_and_factor.brier}\n` +
    `fitted radar: wrote board.json (${board.length} rows), data.js, dashboard/ (${dashFiles.length} files), ` +
    `screenshots/ (${shots.length} images) and dossier.json under ${outDir}\n`,
);
