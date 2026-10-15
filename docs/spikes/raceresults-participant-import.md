# Spike: importing the participant list from Race Results

**Date:** 2026-10-15
**Question (from Peter):** Can we import the participant list from Race Results?
**Source examined:** https://my.raceresult.com/361004/participants#0_66036E
**Answer in one line:** Technically yes, and it is cheap — but the data does not
contain phone numbers, and without those an import cannot produce participants
who can log in.

---

## 1. What the link actually is

The public page renders nothing in HTML. All data is loaded client-side by Race
Results' "RRPublish" component from a public JSON API that needs no
authentication. The call is two steps:

1. `GET https://my.raceresult.com/361004/RRPublish/data/config?page=participants`
   Returns a session `key`, the available list names and IDs, and the server
   that owns the event (`my4.raceresult.com` for this one).

2. `GET https://my4.raceresult.com/361004/RRPublish/data/list?key=<key>&listname=Online|Deltagare&contest=0&r=all`
   Returns the participant rows.

Two practical notes: the request must go to the server named in the config
response (`my.` answers 301 and the redirect has to be followed), and the `key`
is mandatory — omitting it returns `{"error":"no key given"}`.

## 2. What the data contains

Event: **Viadal Ultra Six Days 2026**, 2-8 August, Forslov. **42 participants.**

| Race Results field | Label    | Example                        |
| ------------------ | -------- | ------------------------------ |
| `BIB`              | Startnr  | 16                             |
| `FLNAME`           | Namn     | Hoskuldur Kristvinsson         |
| `NATION.FLAG`      | Nat.     | `[img:/graphics/flags/IS.svg]` |
| `KonM/K`           | H/D      | M                              |
| `AGEGROUP.NAME`    | AG       | M75                            |
| `CLUB`             | Forening | Natturuhlaup                   |

A results list (`Online|SlutResultat Inkl Restmeter`) is available through the
same API, so per-participant results links are also reachable.

## 3. How it maps onto our own model

Our `participants` table (migration 0001) holds `name`, `phone`, `bib`,
`category`, `race_results_url`.

| Our column         | Source              | Status                                |
| ------------------ | ------------------- | ------------------------------------- |
| `bib`              | `BIB`               | OK                                    |
| `name`             | `FLNAME`            | OK                                    |
| `category`         | `AGEGROUP.NAME`     | OK                                    |
| `race_results_url` | constructed per bib | OK                                    |
| `phone`            | —                   | MISSING, and the column is `not null` |

## 4. The blocker

Our only login method is SMS OTP on a phone number. Race Results does not expose
phone numbers publicly — reasonably so, it is personal data. An import therefore
produces 42 rows that nobody can log in to.

A second, separate gap: participants cannot log in today regardless of the
import. The `participant` role exists in the schema and `resolvePostLoginRedirect`
already routes it to `/<tenant>/participant`, but that route does not exist. That
is the participant view itself — the thing this spike was meant to inform — and
it is unaffected by where the roster data comes from.

## 5. Options (this is Peter's call, not a technical one)

1. **Peter supplies the phone numbers** from the registration system — Race
   Results holds them internally, they are just not public — and we match on bib.
   The full personal participant view then works as specified.
2. **Import without phone numbers** as a public start list. The participant view
   becomes logged-out and impersonal. Requires making `phone` nullable.
3. **Participants self-identify** with bib + their own phone number at first
   login, matched against the imported list.

Recommendation: option 1 if Peter can get the data, otherwise option 3 — it still
gives a personal view without us needing personal data we do not have.

## 6. Risk to carry forward

The API is undocumented and uncontracted. The `key` looks like a session token
and the `my4` host could move. If we build on it, it should be a **manual import
run once the start list is final**, not a live sync against an API that can
change without notice mid-event.

## 7. Effort

The import itself is roughly half a day once the phone-number question is
settled. It is not the expensive part. Building the participant view (the P3
dependency) is the real work.
