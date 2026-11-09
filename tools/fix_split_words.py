#!/usr/bin/env python3
"""Rejoin words the PDF text extraction split in half.

PDFKit breaks a word at a text-run boundary and the extractor keeps the break,
so `certain` is stored as `cer tain` and `vertical` as `ver tical`. For the
affected words it is total rather than occasional -- **the word "vertical" does
not appear intact anywhere in the maths bank, and there are 36 of them.**

That makes an absence look like a finding. `grep vertical` over the bank comes
back clean, and the honest-looking conclusion is that the bank has no
vertical-asymptote questions. It has 36. Every text-driven rule inherits it:
the `figures` derivation, `NO_ROUTE` in build_desmos.mjs (which fails OPEN on a
split, admitting the questions it exists to exclude), and any hand grep.

THIS IS THE NORMALISATION STEP OF EXTRACTION, not a reader-side workaround. A
regex at each call site is how this becomes permanent and invisible -- some
readers get it, some do not, and the ones that do not look identical. Run this
after `index_export.swift`, before the index is merged:

    swift tools/index_export.swift "bank/Algebra.pdf" > data/idx-algebra.json
    python3 tools/fix_split_words.py data/idx-algebra.json --write

    python3 tools/fix_split_words.py            # both live indexes, dry run
    python3 tools/fix_split_words.py --write

`text` is the ONLY field this touches. crop_y and question_y are never
recomputed -- the crop filenames are built from them (sheet.mjs:275), so
re-deriving those mid-sweep would invalidate every built sheet. Idempotent:
running it twice changes nothing the second time.

THE RULE is deliberately conservative, and asymmetric on purpose:

    rejoin `a b` only when `a` is NOT a word and `ab` IS one.

That single asymmetry is what protects real two-word phrases. "table forks",
"periodic table" and "car pet" all survive untouched, because `table`,
`periodic` and `car` are words and the rule never even looks at the join. The
cost is missing a split whose first fragment happens to be a word ("over all"
-> "overall" is not repaired); that is the right direction to fail in, since a
wrong rejoin corrupts text that was correct.

No assumption is made that the split is always `r` + ` t`. Every observed case
fits that shape, but the issue notes it was never proved to be the only one,
and the dictionary test does not need it.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_INDEXES = ["data/qb_index.json", "data/rw_index.json"]
DICT = "/usr/share/dict/words"
STAMP = "data/text_normalised.json"

MIN_JOINED = 6   # shorter joins are where the false positives live
MIN_FIRST = 2    # "a tomic" -- a one-letter fragment is usually a real word

# Never treat one of these as the tail of a split word. Found by reading the
# full proposed-rejoin list rather than the top of it: four rejoins were wrong
# and all four had a function word as the second fragment --
#
#   "Europe and Asia"        -> Europeand    (x4)
#   "Fung is seated"         -> Fungis       (x4)
#   "Heim in 1984"           -> Heimin
#   "Atlante and"            -> Atlanteand
#
# They slipped through because the suffix allowance in _is_word accepted
# "europeand" (minus d -> european) and "fungis" (minus s -> fungi). The proper
# nouns "Europe", "Fung", "Heim" are absent from web2, so nothing blocked them.
#
# The cost is a real split whose tail happens to be a function word --
# "prote in" -> protein would now be skipped. That is the right direction to
# fail in: a missed repair leaves correct-but-split text, a wrong rejoin
# destroys text that was right. Skipped candidates are REPORTED, not silent.
# Pairs that the stopword guard blocks but which I read in context and confirmed
# ARE splits. Kept as an explicit, auditable list of six-ish decisions rather
# than as a cleverer rule: corpus frequency does not separate these ("Alber"
# scores 21 precisely BECAUSE it is split 21 times), and a rule tuned until it
# got them right would be fitted to this bank and wrong on the next one.
#
#   "(the Stor ting)"        Norway's legislature          -> Storting  (rejoined, no guard)
#   "the Nagoya Prot ocol"   the agreement                 -> Protocol  (rejoined, no guard)
#   "Alber to"               a first name                  -> Alberto   (guard overridden)
#   "Sierr a"                a place name                  -> Sierra    (guard overridden)
#
# Anything new lands in the skipped report instead of being applied silently.
REVIEWED_REJOINS = {"Alber to", "Sierr a"}

# The inverse: pairs the rules WOULD rejoin that are two real words. Found by
# reading all 451 proposed rejoins, not the top of the list -- these four are
# the only wrong ones in the bank as it stands, and every one is a proper noun
# followed by a short token:
#
#   "Jung led"     a surname, then a verb               not "Jungled"
#   "Le Pass"      start of a French title              not "LePass"
#   "Mensae d"     a star name, then a planet letter    not "Mensaed"
#   "Philipp E"    a first name, then an initial        not "PhilippE"
#
# No rule separates these from the capitalised splits that ARE real -- "Eastlak
# e" -> Eastlake, "Eur opa" -> Europa, "Alber t" -> Albert all look identical to
# a machine, because the difference is whether the first fragment is a whole
# name or a truncated one. Every discriminator tried (corpus frequency, exact
# dictionary membership, tail casing) rescued some and broke others, so this is
# four reviewed decisions rather than a rule fitted until it agreed with them.
#
# The durable part is not this list, it is that `--show` prints every proposed
# rejoin: when the bank grows, read the list again.
#
# THE MIRROR FAILURE, and it is not fixable by rule either: a non-English proper
# noun stays split, because the rejoined form is not an English word and nothing
# in a dictionary says it should be. "Bosco Ver ticale" survives in rw 64b6427a
# (six times) -- correctly refused, since "verticale" is Italian, and yet
# plainly a split. Both failure modes live at proper nouns: the four above are
# real words wrongly joined, this is a real split wrongly left. Recognise the
# shape rather than rediscovering it; neither direction is worth a rule.
NOT_SPLITS = {"Jung led", "Le Pass", "Mensae d", "Philipp E"}

TAIL_STOPWORDS = {
    "a", "an", "and", "as", "at", "be", "but", "by", "do", "for", "he", "if",
    "in", "is", "it", "its", "me", "my", "no", "of", "on", "or", "so", "the",
    "to", "up", "us", "we", "was", "are", "not", "had", "has", "him", "her",
}

# Tokenise rather than regex-substitute over the string. `re.sub` CONSUMES its
# match, so scanning "line ver tical" tests the pair ("line","ver"), fails it,
# and resumes AFTER "ver" -- so ("ver","tical") is never tested at all. That
# left 20 of 48 "ver tical" rows unrepaired while "cer tain" happened to come
# out clean, which is exactly the kind of partial success that reads as done.
# Found by checking the issue's own headline claim after applying the fix.
_TOKEN = re.compile(r"(\s+)")
# Match the alpha run at the INNER edge of each token, not the whole token. A
# token is often glued to punctuation on the far side -- "self-por" before the
# gap, "tainty-that" after it (an em dash with no spaces around it). Requiring
# the whole token to be one alpha run left those unrepaired: 4 "self-por traits"
# and 2 "cer tainty" survived the first pass.
_LEFT = re.compile(r"^(.*?)([A-Za-z]+)$")     # prefix, trailing alpha run
_RIGHT = re.compile(r"^([A-Za-z]+)(.*)$")     # leading alpha run, suffix


def text_digest(rows):
    """Fingerprint of every `text` field, in row order.

    The stamp has to go stale when the index is REGENERATED, not merely when
    someone forgets to update a sidecar. Hashing the text is what ties it to
    content: re-extract a bank PDF by any route and the digest stops matching,
    so the omission becomes loud instead of silent.

    Defined so JavaScript can compute the identical value -- newline-joined,
    UTF-8, sha256 -- because the consumer that enforces this is sheet.mjs.
    """
    joined = "\n".join((r.get("text") or "") for r in rows)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def tool_revision():
    try:
        out = subprocess.run(
            ["git", "-C", ROOT, "log", "-1", "--format=%h", "--",
             "tools/fix_split_words.py"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10)
        rev = out.stdout.decode().strip()
        return rev or "unknown"
    except Exception:
        return "unknown"


def load_words(path=DICT):
    if not os.path.exists(path):
        raise SystemExit(
            "no dictionary at %s -- the rejoin rule needs one and guessing "
            "without it would corrupt correct text" % path
        )
    with open(path, encoding="utf-8", errors="ignore") as fh:
        return {w.strip().lower() for w in fh if w.strip()}


def _is_word(token, words):
    t = token.lower()
    if t in words:
        return True
    # web2 is a dictionary, not a corpus: it has "support" but the inflected
    # forms are hit and miss. Only used to decide a fragment IS a word, i.e.
    # only ever to BLOCK a rejoin, so being generous here is the safe direction.
    for suf in ("s", "es", "ed", "ing", "ly", "d"):
        if t.endswith(suf) and t[: -len(suf)] in words:
            return True
    return False


def _joined_is_word(token, words):
    # Deciding a rejoin SHOULD happen, so this one must be strict-ish: same
    # suffix allowance, but nothing looser.
    return _is_word(token, words)


def _exact_word(token, words):
    """In the dictionary as written -- no suffix allowance.

    The suffix allowance is what let the false positives through: "europeand"
    minus d is "european", "fungis" minus s is "fungi", "texand" minus d is
    "texan". None of those is a word anyone wrote.
    """
    return token.lower() in words


def repair(text, words, seen=None, skipped=None):
    """Rejoin split words in one string. Returns (new_text, [(a, b, joined)]).

    Loops until stable, because one pass is not a fixed point: joining a pair
    emits the joined token and moves past it, so a word split into THREE pieces
    ("ver tebr ates") only loses its second gap on the next pass. Running the
    tool twice used to repair one more row than running it once -- a tool that
    needs running twice to finish is a trap, and "idempotent" was a claim in
    this docstring before it was true.
    """
    made = []
    for _ in range(6):
        text, step = _repair_once(text, words, seen, skipped)
        if not step:
            break
        made.extend(step)
    return text, made


def _repair_once(text, words, seen=None, skipped=None):
    made = []
    parts = _TOKEN.split(text)          # [word, sep, word, sep, word, ...]
    out = []
    i = 0
    while i < len(parts):
        tok = parts[i]
        # A join is only considered across a SINGLE space between two tokens.
        if i + 2 < len(parts) and parts[i + 1] == " ":
            ma, mb = _LEFT.match(tok), _RIGHT.match(parts[i + 2])
            if ma and mb:
                a, b = ma.group(2), mb.group(1)
                joined = a + b
                if (len(a) >= MIN_FIRST and len(joined) >= MIN_JOINED
                        and not _is_word(a, words)
                        and _joined_is_word(joined, words)):
                    pair = "%s %s" % (a, b)
                    # A function-word tail is where the false positives live,
                    # but "-or" and "-as" are also real suffixes: narrator,
                    # predator, numerator, ancestor. So do not blanket-skip --
                    # skip only when the join ALSO looks manufactured, i.e. the
                    # first fragment is a proper noun, or the joined form is a
                    # word only after stripping a suffix.
                    suspect = (b.lower() in TAIL_STOPWORDS
                               and (a[:1].isupper() or not _exact_word(joined, words)))
                    if pair in NOT_SPLITS:
                        if skipped is not None:
                            skipped["%s -> %s  (two real words)" % (pair, joined)] += 1
                        out.append(tok)
                        i += 1
                        continue
                    if suspect and pair not in REVIEWED_REJOINS:
                        if skipped is not None:
                            skipped["%s -> %s" % (pair, joined)] += 1
                    else:
                        made.append((a, b, joined))
                        if seen is not None:
                            seen["%s -> %s" % (pair, joined)] += 1
                        # Emit prefix punctuation + joined word + the tail's
                        # trailing punctuation, then skip both tokens and the
                        # space between them.
                        out.append(ma.group(1) + joined + mb.group(2))
                        i += 3
                        continue
        out.append(tok)
        i += 1
    return "".join(out), made


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("indexes", nargs="*", default=None,
                    help="index json files; defaults to the two live ones")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--show", type=int, default=40,
                    help="how many distinct rejoins to print for review")
    args = ap.parse_args()

    words = load_words()
    targets = args.indexes or DEFAULT_INDEXES
    seen = Counter()
    skipped = Counter()
    stamps = {}
    touched_rows = 0
    total_rows = 0

    for rel in targets:
        path = rel if os.path.isabs(rel) else os.path.join(ROOT, rel)
        if not os.path.exists(path):
            print("skip %s (absent)" % rel)
            continue
        rows = json.load(open(path))
        changed = 0
        for row in rows:
            total_rows += 1
            text = row.get("text")
            if not text:
                continue
            new, made = repair(text, words, seen, skipped)
            if made:
                changed += 1
                row["text"] = new
        touched_rows += changed
        print("%-24s %5d rows, %4d repaired" % (rel, len(rows), changed))
        if args.write:
            if changed:
                tmp = path + ".tmp"
                with open(tmp, "w") as fh:
                    json.dump(rows, fh, ensure_ascii=False)
                os.replace(tmp, path)
            stamps[rel] = {
                "tool": "fix_split_words",
                "rev": tool_revision(),
                "rows": len(rows),
                "rows_changed_this_run": changed,
                "text_sha256": text_digest(rows),
            }

    print("\n%d distinct rejoins, %d rows touched of %d"
          % (len(seen), touched_rows, total_rows))
    for pair, n in seen.most_common(args.show):
        print("  %4d  %s" % (n, pair))
    if len(seen) > args.show:
        print("  ... %d more distinct rejoins (--show N)" % (len(seen) - args.show))

    if skipped:
        print("\n%d candidate(s) skipped because the tail is a function word "
              "-- read these, a real split could hide here:" % sum(skipped.values()))
        for pair, n in skipped.most_common():
            print("  %4d  %s" % (n, pair))

    if args.write and stamps:
        path = os.path.join(ROOT, STAMP)
        existing = json.load(open(path)) if os.path.exists(path) else {}
        existing.update(stamps)
        with open(path, "w") as fh:
            json.dump(existing, fh, indent=1, sort_keys=True)
            fh.write("\n")
        print("\nstamped %s for: %s" % (STAMP, ", ".join(sorted(stamps))))

    if not args.write:
        print("\n(dry run -- read the list above, then pass --write)")


if __name__ == "__main__":
    main()
