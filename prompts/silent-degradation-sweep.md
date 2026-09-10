# Silent-degradation sweep

Every `except Exception` in the backend that returns a fallback instead of
raising, classified by **whether the fallback is distinguishable from a
legitimate result**. Reported before changing anything, as asked.

**116** `except Exception` sites. **24** swallow into a fallback. Most are
correct. **Four are the same defect as `_rpc()` and `_read_bool_column`.**

## The test I applied

A swallow is a bug when *all three* hold:

1. The fallback is **indistinguishable** from a real answer (`[]` reads as
   "none found", `False` reads as "not an admin", `0` reads as "nobody paid").
2. Something downstream **acts on it** as if it were true.
3. The consequence is **money, access, or lost work**.

A swallow is fine when the fallback is honestly degraded and the consequence
is cosmetic — a photo that fails to decode renders without a photo, and that
is the right answer, not a hidden failure.

---

## 🔴 1. `core/billing.py:131` — a paid subscription with no card to renew it

**The worst one, and it is live.**

```python
token_row = _upsert_token(admin, user_id, token_id, source)   # returns None on failure
...
"payment_token_id": (token_row or {}).get("id"),              # -> None, silently
```

`_upsert_token` catches every exception, logs, and returns `None`. **The return
value is never checked.** The subscription is created anyway, with
`payment_token_id: None`.

The customer has paid. Next month the renewal job looks for a card, finds none,
and the subscription lapses.

**The tell nobody noticed** — the success line at :172 prints:

```
card ? ••••????
```

Those placeholders only render when `token_row` is `None`. **The log already
says the card wasn't stored, in the middle of a success message.**

What makes this stand out: **the author covered the adjacent case properly.**
Twelve lines earlier, a *missing* `token_id` raises a loud 🚨 saying "the money
has been taken and the plan is NOT active. Resolve by hand." A *failed store*
of a token that was present gets nothing. Half the case is handled.

## 🔴 2. `core/interview.py:152` — `_prepared_map` returns `{}` and the user pays again

```python
except Exception as e:
    logger.warning(f"Could not list saved interview preps for {user_id}: {e}")
    return {}
```

`{}` means **every CV renders as "not prepared"**. The page then calls
`handleGenerate` instead of `fetchSavedInterviewPrep` — which spends one of the
month's generations regenerating questions the user already owns.

This is the same failure I fixed in Section 2, one layer up. I moved the *save*
onto the worker so a dropped connection could not discard it; this discards the
*read* and produces the identical user-visible symptom.

**Free tier gets 0, Pro 5, Elite 15.** On Pro that is 20% of the month, spent on
work already done, from one transient database error.

## 🟠 3. `core/entitlements.py:100` — a paying pack buyer gated out

```python
except Exception as e:
    logger.warning(f"Could not read purchased_credits for {user_id}: {e}")
    return False
```

**Mine, from this session.** Fails *closed*, which is the safe direction for a
gate — but it means a customer who paid 38 SAR is refused Job Search, Interview
Prep and LinkedIn Essential, sees the upgrade prompt, and nothing anywhere says
why. A `warning`, not an `error`, so it does not stand out in the log either.

Lower severity than 1 and 2 because it self-heals on the next request. Still
wrong: a transient error should not look identical to "you have not paid".

## 🟠 4. `core/documents.py:160` — admin search says "no users"

```python
except Exception as e:
    logger.error(f"admin_search_users failed for '{term}': {e}")
    return []
```

`[]` renders as **"no users match that search"**. Support concludes the account
does not exist. Exactly the `_rpc()` shape — and note `admin_search_users` is a
SQL function, so it is vulnerable to the same "a migration did not apply"
failure that took out `admin_paid_by_users`.

---

## 🟢 Correct — the fallback is honest and the consequence is proportionate

| Site | Fallback | Why it is fine |
|---|---|---|
| `cv_photo.py` ×5 | `None` | No photo is a real, correct answer. The user sees a CV without a photo, which is what they get. |
| `arabic_localizer.py:219` | `{}` | Logs at ERROR and says what it means: "leaving Latin terms as-is". The CV still renders. |
| `jobs_finder.py:825` | `None` | A *designed* fallback — `_screen_and_finalize` explicitly handles `None` by switching to heuristic filters, and logs the switch. |
| `jobs_finder.py:966` | `False` | `_listing_is_dead` returning False on a timeout means "cannot answer, assume alive". Erring toward showing a job is right; erring toward hiding it is not. |
| `jd_analyzer.py:231` | `("", 0)` | The caller checks: `if composite:` — an empty synthesis leaves the original title in place rather than passing an empty JD downstream. Handled properly. |
| `billing.py:722,786` | `continue` | Increments `summary["unreachable"]` first, so the count is *reported*. This is what the others should look like. |
| `*_notify.py` | `False` | An email that fails to send is logged at ERROR and the order still lands in the admin queue. Explicitly documented as non-fatal. |

---

## 🟡 Worth knowing, not worth changing

- **`jobs_finder.py:1586`** returns `[]` for a failed sourcing call. Same shape
  as the others, but this path already has `TavilyQuotaExhausted` for the case
  that actually mattered, and a genuine search failure returning "no results"
  is at least *truthful* about what the user gets. Revisit after the Serper
  migration, since that code is being rewritten anyway.
- **`admin_stats.py:206`** — `_rpc` itself is correct. It returns `None`
  deliberately and documents why. **The bug was always the caller's `or []`,**
  which I fixed. Worth auditing the other `_rpc` callers for the same pattern.

---

## The pattern underneath all six

Every one is the same mistake: **a fallback value that is also a valid answer.**

`[]` means "none" *and* "I could not look". `False` means "no" *and* "I could
not check". `0` means "zero" *and* "unreadable".

The fix is never "stop catching the exception" — these all need to keep
serving. It is to make the two states **different values**, the way `_rpc`
already does by returning `None` versus `[]`. The caller can then decide, and
the UI can say "unavailable" instead of showing a confident zero.

## Proposed order, if you want them fixed

1. **`billing.py:131`** — a customer has paid and their subscription will not
   renew. Check the return, and fail the activation loudly the way the missing
   -token branch already does.
2. **`interview.py:152`** — distinguish "no preps" from "could not read", and
   have the page refuse to spend a generation when it does not know.
3. **`documents.py:160`** — return `None` and let the admin page say the search
   failed.
4. **`entitlements.py:100`** — raise to `error`, and consider one retry before
   gating someone who has paid.

Say which of these you want and I will do them. Nothing changed yet.
