---
id: R05
title: Fractions with letters in them
subtitle: One rule, four moves, and how to tell which one you need
domain: Advanced Math
primitive: clear denominators
types:
  - combine rational expressions
  - rational expression simplification
  - rational equation manipulation
built_from: >
  Khan "Operations with rational expressions" (advanced-math, M18 in
  tools/khan_map.json). Its identity a/b ± c/d = (ad ± bc)/(bd) and its
  five-step procedure are the spine of Part 1.
---

<!-- PAGE -->

# Fractions with letters in them

*A method sheet: what to do with fractions that have letters in them, and how
to tell which move a question wants.*

## Why a method, not an explanation

Fraction questions are where it is most common to have **no method at all** —
not a wrong method, none. The symptoms are guessing between two choices,
forgetting to check the denominator, expanding everything and slipping
somewhere, or getting it right but taking two and a half minutes.

**There is one rule here and four moves.** That is the whole subject. It is
genuinely small, and it is the reason this sheet is short.

<!-- PAGE -->

## The one rule

You already know it for numbers:

$$\frac{1}{2} + \frac{1}{3} = \frac{3}{6} + \frac{2}{6} = \frac{5}{6}$$

You cannot add the numerators until the denominators match. Nothing changes when
the denominators contain letters:

$$\frac{a}{b} \pm \frac{c}{d} = \frac{ad}{bd} \pm \frac{bc}{bd} = \frac{ad \pm bc}{bd}$$

**The common denominator is just the two denominators multiplied.** It does not
have to be the *lowest* one — anything common works, and hunting for the lowest
costs time you do not have.

That single identity is Move 1. The other three moves are things you do to a
fraction rather than between two of them:

| Move | When | What you do |
|---|---|---|
| **1. Combine** | two fractions added or subtracted | common denominator, add the numerators |
| **2. Cancel** | one fraction, top and bottom both factor | factor both, strike the common factor |
| **3. Split** | one fraction, top does *not* factor with the bottom | quotient plus remainder |
| **4. Clear** | an equation with a fraction in it | multiply both sides by the denominator |

Every question in this family is one of these four. Part 5 is how to tell which.

<!-- PAGE -->

## Move 1 — combine

$$\frac{3}{x-1} + \frac{2}{x+4} = \frac{rx+t}{(x-1)(x+4)}$$

They have even handed you the common denominator: it is printed on the right.
Multiply each fraction by whatever its denominator is missing.

$$\frac{3}{x-1} \cdot \frac{x+4}{x+4} \;+\; \frac{2}{x+4} \cdot \frac{x-1}{x-1}$$

$$= \frac{3(x+4) + 2(x-1)}{(x-1)(x+4)} = \frac{3x + 12 + 2x - 2}{(x-1)(x+4)} = \frac{5x+10}{(x-1)(x+4)}$$

So $r = 5$, $t = 10$, $rt = 50$.

<!-- CHECK: 3/(x-1) + 2/(x+4) == (3(x+4) + 2(x-1))/((x-1)(x+4)) == (3x+12+2x-2)/((x-1)(x+4)) == (5x+10)/((x-1)(x+4)) -->
<!-- CHECK: 5*10 == 50 -->

**Four lines.** The whole question is "multiply each top by the other bottom".

> **The one that will bite you: subtraction.** The minus sign applies to the
> *entire* numerator you bring up, so bracket it before you expand.
>
> $$\frac{3}{3x-2} - \frac{1}{x+2} = \frac{3(x+2) - \mathbf{(}3x-2\mathbf{)}}{(3x-2)(x+2)}$$
>
> $$= \frac{3x+6-3x+2}{(3x-2)(x+2)} = \frac{8}{(3x-2)(x+2)}$$
>
> Without the bracket you get $3x+6-3x-2 = 4$ instead of $8$ — and expect the
> wrong answer to be among the choices.

<!-- CHECK: 3/(3x-2) - 1/(x+2) == (3(x+2) - (3x-2))/((3x-2)(x+2)) == (3x+6-3x+2)/((3x-2)(x+2)) == 8/((3x-2)(x+2)) -->
<!-- CHECK: 3/(3x-2) - 1/(x+2) != 4/((3x-2)(x+2)) -->

<!-- PAGE -->

## Try it now — combine

1. $\dfrac{3}{x} + \dfrac{2}{x+1}$. Write it as a single fraction.
2. $\dfrac{5}{x-1} - \dfrac{2}{x+3}$. Write it as a single fraction.
3. $\dfrac{5m}{n} + 5mn$. Write it as a single fraction. *(Careful — the second
   term is not a fraction yet.)*

<!-- WORKSPACE: 0.5 -->

<!-- PAGE -->

## Try it now — answers

1. $\dfrac{3(x+1) + 2x}{x(x+1)} = \dfrac{5x+3}{x(x+1)}$

2. $\dfrac{5(x+3) - 2(x-1)}{(x-1)(x+3)} = \dfrac{5x+15-2x+2}{(x-1)(x+3)} = \dfrac{3x+17}{(x-1)(x+3)}$
   — the $-2 \times -1 = +2$ is the bracket doing its job.

3. **Any term can be written over the denominator.** $5mn = \dfrac{5mn \cdot n}{n} = \dfrac{5mn^2}{n}$, so
   $$\frac{5m}{n} + 5mn = \frac{5m + 5mn^2}{n} = \frac{5m(1+n^2)}{n}$$
   Writing $5mn$ as $\frac{5mn}{n}$ instead — forgetting to multiply by $n$ —
   is the designed wrong answer on this one.

<!-- CHECK 1: 3/x + 2/(x+1) == (3(x+1) + 2x)/(x(x+1)) == (5x+3)/(x(x+1)) -->
<!-- CHECK 2: 5/(x-1) - 2/(x+3) == (5(x+3) - 2(x-1))/((x-1)(x+3)) == (5x+15-2x+2)/((x-1)(x+3)) == (3x+17)/((x-1)(x+3)) -->
<!-- CHECK 3: 5m*n == 5m*n*n/n == 5m*n^2/n -->
<!-- CHECK 3: 5m/n + 5m*n == (5m + 5m*n^2)/n == 5m(1+n^2)/n -->
<!-- CHECK 3: 5m/n + 5m*n != (5m + 5m*n)/n -->

<!-- PAGE -->

## Move 2 — cancel

$$\frac{x^3 - 16x}{x^2 - x - 12}$$

Guessing between two options is the usual failure here. The method is two
steps.

**Factor the top and the bottom completely, then strike what appears in both.**

$$x^3 - 16x = x(x^2-16) = x(x-4)(x+4)$$
$$x^2 - x - 12 = (x-4)(x+3)$$

$$\frac{x\,(x-4)(x+4)}{(x-4)(x+3)} = \frac{x(x+4)}{x+3}$$

<!-- CHECK: x^3 - 16x == x(x-4)(x+4) -->
<!-- CHECK: x^2 - x - 12 == (x-4)(x+3) -->
<!-- CHECK: (x^3 - 16x)/(x^2 - x - 12) == x(x+4)/(x+3) | x > 4 -->

The $(x-4)$ cancels. **The $(x+4)$ stays** — and picking the one that stays is
the entire question. The trap answer is $x(x-4)$, which keeps the factor that
left.

> **$x^2 - 16$ is $(x-4)(x+4)$.** A difference of two squares always splits like
> that, and it turns up constantly in this topic. If you see a square minus a square,
> factor it before you do anything else.

**The rule for cancelling, which is where most of the damage happens:** you may
only cancel a **factor** — something the whole top and the whole bottom are
*multiplied* by. You may never cancel a term that is added.

$$\frac{x(x+4)}{x+3} \ne \frac{x(x+4)}{1} \qquad \frac{2x+6}{2} = x+3 \;\text{ only because } 2x+6 = 2(x+3)$$

<!-- PAGE -->

## Try it now — cancel

1. Simplify $\dfrac{x^2 - 25}{x^2 + 3x - 10}$ for $x > 5$.
2. Simplify $\dfrac{6x(x-4) - 5(x-4)}{3x - 12}$ for $x > 4$.
3. True or false: $\dfrac{x + 4}{4}$ simplifies to $x$.

<!-- WORKSPACE: 0.5 -->

<!-- PAGE -->

## Try it now — answers

1. $\dfrac{(x-5)(x+5)}{(x+5)(x-2)} = \dfrac{x-5}{x-2}$. Difference of squares on
   top; the $(x+5)$ cancels.

2. Pull the common $(x-4)$ out of the top and factor the bottom:
   $$\frac{(x-4)(6x-5)}{3(x-4)} = \frac{6x-5}{3}$$
   **Do not expand the top.** Multiplying it all out is the slow, error-prone
   route. The $(x-4)$ was sitting there in both terms.

3. **False.** The 4 on top is *added*, not multiplied, so nothing cancels.
   $\frac{x+4}{4} = \frac{x}{4} + 1$. This is the single most common error in
   the whole topic.

<!-- CHECK 1: x^2 - 25 == (x-5)(x+5) -->
<!-- CHECK 1: x^2 + 3x - 10 == (x+5)(x-2) -->
<!-- CHECK 1: (x^2 - 25)/(x^2 + 3x - 10) == (x-5)(x+5)/((x+5)(x-2)) == (x-5)/(x-2) | x > 5 -->
<!-- CHECK 2: 6x(x-4) - 5(x-4) == (x-4)(6x-5) -->
<!-- CHECK 2: (6x(x-4) - 5(x-4))/(3x - 12) == (x-4)(6x-5)/(3(x-4)) == (6x-5)/3 | x > 4 -->
<!-- CHECK 3: (x+4)/4 != x -->
<!-- CHECK 3: (x+4)/4 == x/4 + 1 -->

<!-- PAGE -->

## Move 3 — split, when nothing cancels

Sometimes the top does not share a factor with the bottom. Then you rewrite the
top so that it does, and take the leftover separately.

$$\frac{3x+2}{x-7}$$

Force $x - 7$ to appear on top. Three lots of $(x-7)$ is $3x - 21$, and you have
$3x + 2$, so you are $23$ over:

$$3x + 2 = 3(x-7) + 23 \quad\Rightarrow\quad \frac{3(x-7) + 23}{x-7} = 3 + \frac{23}{x-7}$$

<!-- CHECK: (3x+2)/(x-7) == (3(x-7) + 23)/(x-7) == 3 + 23/(x-7) -->

**The recipe:** divide the leading terms to get the quotient, multiply back,
and whatever is left over sits on top of the original denominator.

$$\frac{\text{top}}{\text{bottom}} = \text{quotient} + \frac{\text{remainder}}{\text{bottom}}$$

This is the tell for **any** answer choice that looks like *"a whole thing plus a
small fraction"*. When the options have that shape, Move 3 is what they want.

<!-- PAGE -->

## Move 4 — clear, when it is an equation

If the fraction sits in an **equation** rather than an expression, you are
usually being asked to rearrange for a different letter. Multiply both sides by
the denominator and it stops being a fraction.

$$p = 15 + \frac{24}{n}$$

Get the fraction alone, then multiply both sides by $n$:

$$p - 15 = \frac{24}{n} \quad\Rightarrow\quad n(p-15) = 24 \quad\Rightarrow\quad n = \frac{24}{p-15}$$

<!-- CHECK: n = 3; p = 15 + 24/n; 24/(p-15) == n == 3 -->

> Note what happened at the last step: $n$ ended up **underneath**. Going from
> $\frac{24}{n}$ to $n = \frac{24}{\ldots}$ flips which side the unknown is on,
> and the wrong answers on these questions are almost always the un-flipped
> version. Substitute one number at the end to check — if $n = 3$ then $p = 23$,
> and $\frac{24}{23-15} = 3$. Ten seconds, and it settles it.

<!-- PAGE -->

## Try it now — split and clear

1. Write $\dfrac{3x + 5}{x + 1}$ as a whole number plus a fraction.
2. $v = \dfrac{w}{12t}$. Write $w$ in terms of $v$ and $t$.

<!-- WORKSPACE: 0.42 -->

<!-- PAGE -->

## Try it now — answers

1. $3(x+1) = 3x + 3$, and you have $3x+5$, so you are $2$ over:
   $$\frac{3(x+1) + 2}{x+1} = 3 + \frac{2}{x+1}$$

2. Multiply both sides by $12t$: $\;12tv = w$, so $w = 12tv$.

<!-- CHECK 1: (3x+5)/(x+1) == (3(x+1) + 2)/(x+1) == 3 + 2/(x+1) -->
<!-- CHECK 2: (12t*v)/(12t) == v | t != 0 -->

<!-- PAGE -->

## Part 5 — which move, decided from the shape

This is the muscle-memory part. **Do not try a move and see. Read
the shape first — it takes three seconds and it picks the move for you.**

| What you see | Move |
|---|---|
| Two fractions with a $+$ or $-$ between them | **1. Combine** |
| One fraction, and top and bottom are both factorable | **2. Cancel** |
| One fraction, and the options look like *"something $+$ something small over the bottom"* | **3. Split** |
| An $=$ sign, and they want a different letter on its own | **4. Clear** |
| A repeated bracket in every term, like $(x-6)$ | **2. Cancel** — pull it out, do not expand |

**The order to work in, every time:**

1. **Factor everything first.** Before combining, before cancelling, before
   anything. Most of these questions are easy once factored and horrible if not.
2. **Then pick the move** from the table.
3. **Then execute**, bracketing any numerator you subtract.

> **Common trap:** expanding $5x(x-6) - 2(x-6)$ into $5x^2 - 32x + 12$ and
> losing the thread. The $(x-6)$ is in both terms and in the bottom. Factoring first turns
> that question into one line. **Expanding is almost never the move here** —
> this whole topic runs the other way.

<!-- CHECK: 5x(x-6) - 2(x-6) == 5x^2 - 32x + 12 == (x-6)(5x-2) -->

<!-- PAGE -->

## Now against the clock

Nine questions from the official bank, ordered roughly easiest to hardest. They
cover all four moves, including rational equation manipulation.

**Before each one, name the move out loud — or write its number in the corner —
before you start writing algebra.** That is the habit this sheet exists to
build, and naming it is what separates the two minutes from the twenty seconds.

**Write the seconds in the box before you turn the page.**

<!-- QUESTIONS: 6d04c89d, 4e18fc5d, 29ed5d39, abc61109, 967ef685, 433184f1, d8789a4c, 89fc23af, 38c90632 -->

<!-- PAGE -->

## Stop here

That's the end of the main sheet.

Mark it against the official key. The thing worth checking is not the score: it
is **whether you named the move before you started**, and on which ones the
naming was wrong rather than the algebra.

The pages that follow are an appendix for a fifth move the four above do not
cover.

<!-- PAGE -->

## Move 5 — multiply back and match

**When two polynomials are equal for every value of $x$, their coefficients
match one at a time.** $x^2$ with $x^2$, $x$ with $x$, number with number. That
is the whole idea, and it turns "find the constants" into simple equations.

**Worked example.** Find the constants $p$ and $w$ in

$$\frac{19x+132}{x(x+33)} = \frac{p}{x} + \frac{w}{x+33}$$

Combine the right-hand side first — that is just Move 1:

$$\frac{p(x+33) + wx}{x(x+33)} = \frac{19x+132}{x(x+33)}$$

Same bottom, so the tops are equal. Expand the left and **group by power of $x$**:

$$px + 33p + wx = (p+w)\,x + 33p \qquad\text{must equal}\qquad 19x + 132$$

Now read off two equations:

$$33p = 132 \;\Rightarrow\; p = 4 \qquad\quad p + w = 19 \;\Rightarrow\; w = 15$$

<!-- CHECK: p = 4; w = 15; (19x+132)/(x(x+33)) == p/x + w/(x+33) -->

**Always take the constant term first.** It usually has only one unknown in it,
which hands you the other for free. Here $33p = 132$ needed nothing else.

<!-- PAGE -->

## A second example — the same move

$$\frac{x^2+kx-15}{x+5} = x-3 \;\Rightarrow\; x^2 + kx - 15 = (x+5)(x-3) = x^2 + 2x - 15 \;\Rightarrow\; k = 2$$

Multiply both sides by the denominator to clear it, expand, match. The $x^2$ and
number terms already agree, which is your check; the $x$ terms give $k$.

<!-- CHECK: k = 2; (x^2 + k*x - 15)/(x+5) == x - 3 -->
<!-- CHECK: (x+5)(x-3) == x^2 + 2x - 15 -->

> **The tell for Move 5:** the question contains an $=$ *and* letters that are
> called *constants*. Whenever you see the phrase "where $a$ and $b$ are
> constants", you are being asked to match coefficients. Nothing else does that.

<!-- PAGE -->

## Follow-up 1 / 2

*Pure matching, nothing hidden. Expand and read the coefficients off.*

<!-- QUESTIONS: label=Follow-up, ea6d05bb -->

<!-- PAGE -->

## Follow-up 2 / 2

*Now the unknown is buried inside the expansion — the worked example's structure.
Group by power of $x$ before you match.*

<!-- QUESTIONS: label=Follow-up, c81b6c57 -->

<!-- PAGE -->

## That's the end

Two questions, one habit: **when they name a constant, multiply back and match.**

There are two rather than one because the setup is usually right and only the
matching fails. The first question tests matching on its own; the second buries
the unknown the way the worked example did. If the first is fast and the second
is slow, the gap is the disguise rather than the technique.

Come back to these types cold in a couple of weeks — one question each, notes
shut.
