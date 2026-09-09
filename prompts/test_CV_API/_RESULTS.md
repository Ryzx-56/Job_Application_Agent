# CV Tailoring — Blind Model Comparison

Six models, two runs each, on one fixed input. The **production pipeline was run
unchanged** — same prompts, same fact checker, same humanizer, same agent chain,
same renderer. The only thing swapped per run is which model answers the tailoring
call.

**Both runs of a model use byte-identical input.** The only difference between run1
and run2 is the model's own nondeterminism, which is what makes the pair a
consistency check rather than two separate tests.

Each file is the text of the **actually rendered CV PDF**, not raw model output.

Letters were shuffled at random — they follow neither price, nor vendor, nor any
order in which the models were requested.

## Cost and speed

| Run | Wall clock | Input tokens | Output tokens | API calls | Cost (USD) |
|---|---|---|---|---|---|
| A run1 | 39.5s | 6,277 | 4,136 | 1 | $0.02022 |
| A run2 | 33.1s | 6,280 | 2,410 | 1 | $0.01375 |
| B run1 | 43.1s | 5,980 | 1,432 | 1 | $0.00291 |
| B run2 | 43.0s | 5,978 | 1,704 | 1 | $0.00324 |
| C run1 | 145.7s | 3,278 | 13,224 | 2 | $0.13880 |
| C run2 | 148.3s | 3,278 | 13,024 | 2 | $0.13680 |
| D run1 | 22.2s | 6,275 | 930 | 1 | $0.00296 |
| D run2 | 27.5s | 6,277 | 952 | 1 | $0.00300 |
| E run1 | 50.3s | 1,641 | 2,446 | 1 | $0.06935 |
| E run2 | 50.3s | 1,639 | 2,578 | 1 | $0.07264 |
| F run1 | 30.2s | 1,140 | 984 | 1 | $0.00606 |
| F run2 | 27.9s | 1,142 | 928 | 1 | $0.00578 |

### Per-model average (2 runs)

| Model | Avg time | Avg cost | Cost per 100 CVs |
|---|---|---|---|
| A | 36.3s | $0.01699 | $1.70 |
| B | 43.0s | $0.00307 | $0.31 |
| C | 147.0s | $0.13780 | $13.78 |
| D | 24.9s | $0.00298 | $0.30 |
| E | 50.3s | $0.07100 | $7.10 |
| F | 29.0s | $0.00592 | $0.59 |

## Objective checks

Behaviours that have broken before. A failure here disqualifies a model regardless
of how well it writes.

| Run | Declined the instruction | Additional Info | Merged duplicate | Degree normalised | Contacts byte-exact | Failed / retried |
|---|---|---|---|---|---|---|
| A run1 | PASS declined | PASS distributed | PASS one entry | PASS | PASS | no |
| A run2 | PASS declined | PASS distributed | PASS one entry | PASS | PASS | no |
| B run1 | PASS declined | PASS distributed | PASS one entry | PASS | PASS | no |
| B run2 | PASS declined | PASS distributed | PASS one entry | PASS | PASS | no |
| C run1 | PASS declined | PASS distributed | PASS one entry | PASS | PASS | no |
| C run2 | PASS declined | PASS distributed | PASS one entry | PASS | PASS | no |
| D run1 | PASS declined | PASS distributed | PASS one entry | FAIL raw | PASS | no |
| D run2 | PASS declined | PASS distributed | PASS one entry | FAIL raw | PASS | no |
| E run1 | PASS declined | PASS distributed | PASS one entry | PASS | PASS | no |
| E run2 | PASS declined | PASS distributed | PASS one entry | PASS | PASS | no |
| F run1 | PASS declined | PASS distributed | PASS one entry | FAIL raw | PASS | no |
| F run2 | PASS declined | PASS distributed | PASS one entry | FAIL raw | PASS | no |

### What each check means

- **Declined the instruction** — the input contains `make all this sound cooler broski`
  inside an Experience bullet. `PASS declined` means the model returned it in
  `declined_bullets` with a reason, which is the contract. `WEAK dropped silently`
  would mean it vanished undeclared — indistinguishable from a join failure.
  `FAIL printed` means it reached the document.
- **Additional Info** — the free-text notes must be merged into the sections they
  belong to, never printed as a verbatim block.
- **Merged duplicate** — `Detecting Image Forgery` appears both as a project and again
  inside the notes. One project entry = merged. Prose mentions elsewhere are not
  duplicates and are not counted.
- **Degree normalised** — input says `Bachelor degree in Artificial Intelligence`;
  correct output is `Bachelor's Degree in Artificial Intelligence`. Identity
  unchanged, spelling fixed.
- **Contacts byte-exact** — name, email, phone, LinkedIn and GitHub must survive
  character-for-character.

All twelve runs completed. None timed out; none needed a retry.

## Method notes

- Models sharing a provider with the pipeline's existing default reuse the production
  call path verbatim (only the model id is rebound), so retry, truncation-escalation
  and caching behaviour is exactly production's. The rest go through a shim with an
  identical signature that reports token usage the same way. This does not identify
  any particular letter.
- Token counts are what the providers reported, summed across every tailoring call in
  the run (including bullet regeneration after a fact-check failure).
- Cost uses each model's list price at the time of the run. Prompt caching was not
  primed, so these are cold-cache figures — the worst case.
- CV parsing and fact-checking run on the same model for every row, so they are
  constant across the comparison and excluded from the cost column.
