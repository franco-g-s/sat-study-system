#!/usr/bin/env python3
"""No type-level TELL or DO line may carry one question's specifics.

    python3 tools/check_taxonomy.py          # exit 1 on any unreviewed hit

The solution page of every sweep prints the type's `cue` (TELL) and `procedure`
(DO). Its whole job is to teach the cue, so a DO line that names a detail from
the one question that happened to be in front of whoever wrote the type teaches
a cue that will never fire again. `expression building with a constraint` said
"substitute the stated relationship (h = r + 4) into the formula" for three
questions, none of which contained h = r + 4, and both that were sat were
answered wrong.
Nothing checked it: check_primitives.py validates `appears_in` only.

This does not need to be clever; it needs to make the class visible. It flags:

  eq     an equation or `name = name` -- "h = r + 4", "y = px + r", "mean = median"
  num    a literal number other than 0, 1, 2
  money  a currency amount
  unit   a scenario unit of time ("day", "hour", ...), which names a context

A flagged string that is genuinely general -- "180 degrees", "b^2-4ac", a
30-60-90 triangle -- goes in REVIEWED with a reason. Keyed on the EXACT string,
so rewording it re-flags it and a human reads it again.

Primitives are deliberately not swept: they name specific identities by design.
"""
import os
import json, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (type name, field, exact string) -> why it is general, not residue.
REVIEWED = {
    ('triangle angle sum', 'procedure', 'use 180 degrees with isosceles or congruence facts'):
        'the angle sum of every triangle',
    ('discriminant or tangency', 'procedure', 'use b^2-4ac for the count; set it to zero for tangency'):
        'the discriminant, in its standard letters',
    ('convert between radians and degrees', 'procedure', 'multiply by 180/pi or pi/180'):
        'the conversion factor itself',
    ('circumference from arc information', 'procedure', 'arc length s = r*theta, or the fractional-circumference route'):
        'the arc-length formula in its standard letters',
    ('complementary angle identity', 'procedure', 'sin(theta) = cos(90 - theta) when the angles sum to 90'):
        'the cofunction identity',
    ('complementary angle identity', 'cue', 'angles sum to 90, sin equals cos'):
        'the defining condition of the type',
    ('special right triangle properties', 'procedure', 'apply 30-60-90 or 45-45-90 side ratios'):
        'the names of the two special triangles',
    ('percent change with an unknown', 'procedure', 'new = old x (1 + rate); rearrange for whichever is missing'):
        'the percent-change relationship in words',
    ('Pythagorean theorem', 'procedure', 'a^2 + b^2 = c^2 for the missing side'):
        'the theorem itself',
    ('trig ratio to find a side', 'procedure', 'set up sin/cos/tan = ratio and solve for the unknown side'):
        'the general equation shape, no values',
}

EQ = re.compile(r'(?<![<>!=])\b[\w^()]+\s*=\s*[\w(]')
NUM = re.compile(r'(?<![\w.])\d+(?:\.\d+)?(?![\w.])')
MONEY = re.compile(r'[$€£]\s*\d')
UNIT = re.compile(r'\b(day|days|hour|hours|week|weeks|month|months|year|years|minute|minutes)\b', re.I)


def flags(text):
    out = []
    if EQ.search(text):
        out.append('eq')
    nums = [n for n in NUM.findall(text) if n not in ('0', '1', '2')]
    if nums:
        out.append('num ' + ','.join(nums))
    if MONEY.search(text):
        out.append('money')
    if UNIT.search(text):
        out.append('unit')
    return out


def sweep(tax):
    types = [(s, ty) for s, v in tax['skills'].items() for ty in v['types']]
    types += [('(cross-skill)', c) for c in tax.get('cross_skill_types', [])]
    hits, reviewed = [], 0
    for skill, ty in types:
        for field in ('procedure', 'cue'):
            text = ty.get(field) or ''
            f = flags(text)
            if not f:
                continue
            if (ty['name'], field, text) in REVIEWED:
                reviewed += 1
                continue
            hits.append((skill, ty['name'], field, text, f))
    return len(types), hits, reviewed


def main():
    tax = json.load(open(f'{ROOT}/data/taxonomy.json'))
    n, hits, reviewed = sweep(tax)
    print(f'{n} types swept, {reviewed} flagged strings reviewed as general')
    live = {k for k in REVIEWED}
    present = {(ty['name'], f, ty.get(f)) for s in tax['skills'].values() for ty in s['types']
               for f in ('procedure', 'cue')}
    stale = live - present
    for k in sorted(stale):
        print(f'  note: REVIEWED entry no longer matches any string: {k[0]} / {k[1]}')
    if not hits:
        print('no question-specific residue')
        return 0
    print(f'\n{len(hits)} TELL/DO string(s) that may carry one question\'s detail:')
    for skill, name, field, text, f in hits:
        label = 'DO  ' if field == 'procedure' else 'TELL'
        print(f'  {skill} :: {name}\n    {label} {text}\n    flagged: {"; ".join(f)}')
    print('\nRewrite it to be question-independent, or add it to REVIEWED with a reason.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
