---
id: R07
title: The circle equation, and where the signs go
subtitle: Not a re-derivation — a sign convention, a check, and what the equation tells you
domain: Geometry and Trigonometry
primitive: complete the square
from_sweep: SW08 Circles
types:
  - centre and radius from standard form
  - coordinate constraints from the circle equation
  - transform a circle equation
  - circumference from arc information
surface: >
  34 of 1077 assigned questions (3.2%) across the four types — 13 centre and
  radius, 9 transform, 6 coordinate constraints, 6 circumference from arc.
  Below the 7% bar and stated deliberately. What carries it is not the surface,
  it is that this is a REPEAT failure: completing the square had already been
  taught (M02) and applied to circles (M03), and a later sweep still showed both
  signs wrong when completing the square and the circle equation forgotten
  outright.
why_not_a_rederivation: >
  M02 already derived it, and M03 re-teaches nothing because M02 had just
  covered it. Repeating that would be doing the same thing a third time and
  expecting a different result. What fails is not the derivation — it is the
  SIGN convention and the absence of a check. So this sheet spends its pages on
  the two sign flips, on a ten-second verification that makes the error
  self-catching, and on what the finished equation actually tells you.
style_note: >
  Scoped to the learner's own list of what to cover: completing the square,
  coordinate constraints, and the arc question type. Arcs have nothing to do
  with the equation, so they get their own short part rather than being forced
  into the same frame.
---

<!-- PAGE -->

# The circle equation, and where the signs go

## Common trap — the derivation is not the problem

This sheet assumes you have already seen completing the square derived. If the
topic still goes wrong, it almost always goes wrong the same way:

$$x^2 - 10x \;\longrightarrow\; (x+5)^2 + 25$$

Both signs are wrong. It is $(x-5)^2 - 25$.

**So this sheet is not going to derive it again.** Seeing the same derivation a
third time rarely makes it stick. The derivation is not what fails. Two
specific sign flips are, and there is usually no check in the process to catch
them — you can grind on a question for minutes and never find out you were
wrong.

That is what these pages are for: **the two signs, and a ten-second check that
makes getting them wrong self-correcting.**

<!-- PAGE -->

## Sign flip 1 — the bracket lies to you

$$(x-h)^2 + (y-k)^2 = r^2 \qquad \text{centre } (h,k)$$

The formula has a **minus** in it. So whatever you *see* inside the bracket, the
centre coordinate is the **opposite**.

| You see | $h$ is | because |
|---|---|---|
| $(x-5)^2$ | $+5$ | it already matches $(x-h)$ |
| $(x+5)^2$ | $-5$ | $(x+5) = (x-(-5))$ |
| $x^2$ | $0$ | $(x-0)$ |

**And the right-hand side is $r^2$, not $r$.**

| You see | $r$ is |
|---|---|
| $= 25$ | $5$ |
| $= 16$ | $4$ |
| $= 169$ | $13$ |

> **Common trap.** A question makes the radius 3 units bigger and asks for the
> new right-hand side. Writing $36 + 3 = 39$ is wrong: the $36$ is $r^2$, so
> $r = 6$, the new radius is $9$, and the new right-hand side is $9^2 = 81$.
> The rule is "square root it first, and square it back at the end".

<!-- CHECK: r = sqrt(36); (r+3)^2 == 81 -->
<!-- CHECK: sqrt(36) + 3 != sqrt(39) -->

When the equation is already in standard form, this is all the machinery you
need.

<!-- PAGE -->

## Sign flip 2 — completing the square

This is the part that breaks. Here is the mechanical version, no derivation.

$$x^2 - 10x$$

1. **Halve the number in front of $x$**, keeping its sign. Half of $-10$ is $-5$.
2. That is what goes in the bracket: $(x-5)^2$.
3. **Subtract the square of it.** $(-5)^2 = 25$, so subtract $25$.

$$x^2 - 10x = (x-5)^2 - 25$$

**Both signs, stated as flat rules:**

- The bracket keeps the sign of the halved number. Minus in, minus in the bracket.
- **The correction is ALWAYS subtracted**, whatever the sign inside. You added
  something by completing the square, so you take it back off.

$$x^2 + 14x = (x+7)^2 - 49 \qquad\qquad y^2 - 6y = (y-3)^2 - 9$$

Notice both corrections are negative even though one bracket is $+$ and one is
$-$. **That is the rule most often held backwards** — writing $+25$ or $+16$
where it should be $-25$ or $-16$.

<!-- PAGE -->

## The check that makes it self-correcting

**Substitute $x = 0$ into both sides.** It takes ten seconds and it catches
every sign error in this topic.

Check $x^2 - 10x = (x-5)^2 - 25$:

$$\text{left: } 0 - 0 = 0 \qquad\qquad \text{right: } (0-5)^2 - 25 = 25 - 25 = 0 \quad\checkmark$$

Now check the common wrong version, $(x+5)^2 + 25$:

$$\text{right: } (0+5)^2 + 25 = 25 + 25 = 50 \ne 0 \quad\times$$

**Ten seconds, instead of minutes of grinding on a wrong equation.** You do not
need to spot the mistake — the check finds it for you.

> Use $x = 0$ because everything with an $x$ in it vanishes and you are left
> with pure arithmetic. If the original has no constant term, both sides should
> come out to zero.

<!-- PAGE -->

## Worked example, end to end

$$x^2 + y^2 + 8x - 6y - 4n = 0$$

Group, complete both squares, and move the corrections across:

$$(x+4)^2 - 16 + (y-3)^2 - 9 = 4n$$
$$(x+4)^2 + (y-3)^2 = 4n + 25$$

Check at $x = 0, y = 0$: left is $16 + 9 = 25$, right is $25$. ✓

So circle A has centre $(-4,3)$ and $r_A^2 = 4n + 25$.

Circle B has the same centre and **three times the radius**, so
**nine times $r^2$**. Point $(2,12)$ is on B:

$$r_B^2 = (2+4)^2 + (12-3)^2 = 36 + 81 = 117$$

$$117 = 9 \, r_A^2 \;\Rightarrow\; r_A^2 = 13 \;\Rightarrow\; 4n + 25 = 13 \;\Rightarrow\; n = -3$$

<!-- CHECK: x^2 + y^2 + 8x - 6y - 4n == (x+4)^2 + (y-3)^2 - (4n + 25) -->
<!-- CHECK: x = 2; y = 12; (x+4)^2 + (y-3)^2 == 117 == 9*13 -->
<!-- CHECK: n = -3; 4n + 25 == 13 -->

> **The step people miss:** using the given point to get $r_B$ as a number.
> Setting up the radius in terms of $n$ and then stopping is the usual place
> this question stalls. **A point on a circle is always a radius waiting to be
> computed**, by distance from the centre.

<!-- PAGE -->

## What the finished equation tells you

Once it is in standard form you can read three things off it, and the third is
the one most often missed.

$$(x+5)^2 + (y-8)^2 = 225$$

- **Centre** $(-5, 8)$ — flip the bracket signs.
- **Radius** $\sqrt{225} = 15$.
- **The range of $x$ and of $y$.** The circle reaches exactly $r$ left and right
  of the centre, and $r$ up and down:

$$x \text{ runs from } -5-15 = -20 \;\text{ to }\; -5+15 = 10$$
$$y \text{ runs from } 8-15 = -7 \;\text{ to }\; 8+15 = 23$$

So if you need an $x$-value that **no** point on the circle can have, anything
outside $[-20, 10]$ — such as $12$ — will do.

<!-- CHECK: sqrt(225) == 15 -->
<!-- CHECK: x = -20; y = 8; (x+5)^2 + (y-8)^2 == 225 -->
<!-- CHECK: x = 10; y = 8; (x+5)^2 + (y-8)^2 == 225 -->
<!-- CHECK: x = -5; y = -7; (x+5)^2 + (y-8)^2 == 225 -->
<!-- CHECK: x = -5; y = 23; (x+5)^2 + (y-8)^2 == 225 -->

> **Centre ± radius, in each direction.** That is the whole of "coordinate
> constraints", and it is two subtractions — about 20 seconds once you know the
> equation gives you a range.

**A related version:** a circle touches the $y$-axis at exactly one point when
the distance from the centre to that axis equals the radius — that is, when
$|h| = r$. Same idea, read sideways.

<!-- PAGE -->

## Part 4 — arcs

Nothing to do with equations. One proportion, and it is the only thing you need
for this whole type:

$$\frac{\text{central angle}}{360^\circ} = \frac{\text{arc length}}{\text{circumference}} = \frac{\text{sector area}}{\text{whole area}}$$

**All three fractions are the same fraction.** Whichever two you have, you get
the rest.

For example, a $40°$ central angle with an arc of $6\pi$: $40 \times 9 = 360$, so
the arc is a ninth, so the circumference is $9 \times 6\pi = 54\pi$. That is
the proportion.

<!-- CHECK: 40*9 == 360 -->
<!-- CHECK: C = 9*6*pi; C*40/360 == 6*pi -->

**Worked example.** A circle has circumference $72\pi$, diameters $AC$ and
$BD$, and arc $AD$ three times arc $AB$. Because $BD$ is a diameter, arcs $BA$
and $AD$ together make a half-circle:

$$AB + AD = 180^\circ \;\Rightarrow\; AB + 3AB = 180^\circ \;\Rightarrow\; AB = 45^\circ$$

Then $AC$ is also a diameter, so $AB + BC = 180^\circ$, giving $BC = 135^\circ$:

$$\text{arc } BC = \frac{135}{360} \times 72\pi = 27\pi$$

<!-- CHECK: a = 45; a + 3a == 180 -->
<!-- CHECK: 135/360 * 72pi == 27pi -->

> **The fact that unlocks it:** a diameter splits the circle into two $180°$
> halves, so any two arcs on the same side of a diameter add to $180°$. The
> circumference is never the obstacle.

<!-- PAGE -->

## Try it now

1. $(x+2)^2 + (y-9)^2 = 36$. Give the centre and the radius.
2. Complete the square: $x^2 + 8x = \;?$ — then check your answer at $x=0$.
3. A circle has centre $(6,-1)$ and radius $4$. What is the largest possible
   $x$-coordinate of a point on it? The smallest possible $y$-coordinate?
4. A central angle of $30°$ cuts an arc of length $5\pi$. What is the
   circumference?

<!-- WORKSPACE: 0.42 -->

<!-- PAGE -->

## Try it now — answers

1. Centre $(-2, 9)$ — both signs flip — and radius $\sqrt{36} = 6$.

2. $x^2 + 8x = (x+4)^2 - 16$. Half of $8$ is $4$; the correction is subtracted
   even though the bracket is a plus.
   Check at $x=0$: left $=0$, right $= 16 - 16 = 0$ ✓.

3. Largest $x$ is $6 + 4 = 10$. Smallest $y$ is $-1 - 4 = -5$. Centre ± radius.

4. $\dfrac{30}{360} = \dfrac{1}{12}$, so the arc is a twelfth of the
   circumference: $C = 12 \times 5\pi = 60\pi$.

<!-- CHECK 1: h = -2; k = 9; r = sqrt(36); (x+2)^2 + (y-9)^2 - 36 == (x-h)^2 + (y-k)^2 - r^2 -->
<!-- CHECK 1: sqrt(36) == 6 -->
<!-- CHECK 2: x^2 + 8x == (x+4)^2 - 16 -->
<!-- CHECK 2: x = 0; x^2 + 8x == (x+4)^2 - 16 == 0 -->
<!-- CHECK 3: 6 + 4 == 10 -->
<!-- CHECK 3: -1 - 4 == -5 -->
<!-- CHECK 3: x = 10; y = -1; (x-6)^2 + (y+1)^2 == 4^2 -->
<!-- CHECK 3: x = 6; y = -5; (x-6)^2 + (y+1)^2 == 4^2 -->
<!-- CHECK 4: 30/360 == 1/12 -->
<!-- CHECK 4: C = 12*5*pi; C*30/360 == 5*pi -->
<!-- CHECK 4: 12*5*pi == 60*pi -->

<!-- PAGE -->

## Now against the clock

Eight questions from the official bank. They run from reading a centre straight
off, through completing the square from an expanded equation, to the two
constraint types.

**Two habits, and they are the whole sheet:**

1. **Flip the bracket signs, and square-root the right-hand side.**
2. **After completing a square, substitute $x=0$ into both sides.** Ten seconds.

**Write the seconds in the box before you turn the page.**

<!-- QUESTIONS: fc8aa563, 82c8325f, b0a72bdc, a5ff1a96, e50afdd3, 9d159400, 6585d841, 800e71b8 -->

<!-- PAGE -->

## Stop here

That's the end of the sheet.

The question worth asking yourself on this one is narrower than usual: **did
you run the $x=0$ check, and did it ever catch anything?** A sheet that gives
you a correct answer is worth much less than one that gives you a way of
noticing you were wrong, and this topic tends to fail silently — you rarely find
out at the time.

Come back to these types cold in a couple of weeks. If the signs hold then, the
topic is closed.
