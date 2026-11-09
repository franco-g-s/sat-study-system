// Argument parsing for every tool that writes something -- state, a sheet, or
// the Supernote Cloud.
//
// Why this exists: until 2026-09-28 each tool read its flags with
// `argv.indexOf('--name')` and ignored everything it did not look for. So
// `build_mixed.mjs --help` ran a full default build and marked 20 questions used
// (2026-09-21), and a typo like `--dyr` for `--dry` would have done the same.
// Worse in push_note.mjs: `--dryrun` for `--dry-run` would have uploaded.
//
// The rule is now: a flag the tool does not declare is an error, `--help` / `-h`
// prints usage and exits 0, and a value flag with no value is an error. All of
// it happens before the tool reads or writes any state, because each tool calls
// this first.
//
// Deliberately tiny and dependency-free: node:util.parseArgs would do, but its
// errors are generic and it has no notion of a documented no-op flag.

export class CliError extends Error {}

/**
 * Pure parser. Returns { help: true } or { values, bools, positional }.
 * Throws CliError on anything it does not understand.
 *
 *   values  flags that take one argument     (--n 20, --out DIR, --n=20)
 *   bools   flags that take none             (--dry)
 *   noop    accepted and ignored, for documented flags whose behaviour is now
 *           the default (build_rw_set's --timed); listed so rejecting unknown
 *           flags does not break a command the README tells you to run
 */
export function parseArgs(argv, { values = [], bools = [], noop = [] } = {}) {
  const vset = new Set(values), bset = new Set(bools), nset = new Set(noop);
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const out = { values: {}, bools: new Set(), positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out.positional.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      if (vset.has(name)) {
        let v;
        if (eq !== -1) v = a.slice(eq + 1);
        else {
          v = argv[i + 1];
          if (v === undefined || v.startsWith('--')) throw new CliError(`--${name} needs a value`);
          i++;
        }
        if (v === '') throw new CliError(`--${name} needs a value`);
        out.values[name] = v;
      } else if (bset.has(name) || nset.has(name)) {
        if (eq !== -1) throw new CliError(`--${name} takes no value`);
        if (bset.has(name)) out.bools.add(name);
      } else {
        throw new CliError(`unknown option --${name}`);
      }
    } else if (/^-[A-Za-z]/.test(a)) {
      throw new CliError(`unknown option ${a}`);
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

/**
 * The CLI wrapper: prints usage on --help and exits 0, prints the error and
 * usage on anything bad and exits 2. Returns { flag, has, positional }.
 *
 * Call it before touching any state. That ordering is the whole fix.
 */
export function cli(usage, spec, argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv, spec);
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    console.error(`error: ${e.message}\n\n${usage}\n\nNothing was built and no state was touched.`);
    process.exit(2);
  }
  if (parsed.help) {
    console.log(usage);
    process.exit(0);
  }
  return {
    flag: (name, dflt) => (name in parsed.values ? parsed.values[name] : dflt),
    has: (name) => parsed.bools.has(name),
    positional: parsed.positional,
  };
}

/** A numeric flag, refused rather than silently NaN. */
export function numberFlag(args, name, dflt) {
  const raw = args.flag(name, undefined);
  if (raw === undefined) return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.error(`error: --${name} must be a number, got ${JSON.stringify(raw)}`);
    process.exit(2);
  }
  return n;
}
