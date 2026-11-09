# Type-assignment pass — one chunk

You are assigning College Board SAT maths questions to question TYPES from a
fixed taxonomy. One chunk = one CB skill, so you will see the same types recur.

## Read your task file first

`TASK_FILE_PATH` — a JSON object with:

- `skill` — the CB skill all these questions belong to
- `labels` — **the closed label set.** Each has `name`, `procedure`, `cue`
- `questions` — `[{qid, image, difficulty}]`
- `out` — where to write your result

## Method

1. **Read every image with the Read tool.** All of them, in order, none skipped.
   The maths is *rendered as an image*: a text-only reading of these questions is
   invalid and has already produced a wrong taxonomy once. You must look.
2. For each question decide which single label's `procedure` is what a fast
   solver would actually execute. Match on the `cue` — the three-second
   recognition tell — not on surface vocabulary.
3. Read the **Question ID from the image's own header** and record it. This is an
   identity check on the crop, not a formality: a page-numbering bug once put the
   wrong question in a correctly-named file and every automated check passed.
   Report what the image says even when it disagrees with the filename.

## Rules

- **Exactly one label per question**, chosen from `labels` by its exact `name`
  string. Never invent, abbreviate or rephrase a name.
- **`"unmatched"` is allowed and is a real answer.** Use it when no label's
  procedure is what the question asks for. Never stretch a label to fit; a
  forced assignment is worse than an honest gap, because it hides the gap.
- Confidence is `high`, `medium` or `low`. Use `low` freely — it steers a
  later review pass.
- Judge by the *procedure*, not the topic. Two questions mentioning circles are
  different types if one completes the square and the other reads a radius off
  a graph.

## Output

Write to the task's `out` path — a JSON array, one object per question, in the
same order as `questions`:

```json
[{"qid": "3d1070c9", "header_qid": "3d1070c9", "type": "find intercept from equation", "confidence": "high"}]
```

`qid` is the filename's id, `header_qid` is what you read in the image. Then
reply with one line: `<task_id> <n written> <n unmatched> <n id-mismatches>`.
Nothing else — your reply is a return value, not a message to a person.
