# Backlog — parked ideas (design later)

Captured during the engagement-v2 work. Not yet designed/scheduled. Each gets its
own brainstorm → spec → plan when picked up.

## 1. Autonomous mode — one button, multi-module, drains the daily budget (§2.3)

**Vision:** one **«Запустить»** = autopilot. It reads which **modules are enabled**
(engagement / smart-connect / content) and works each up to its **daily/weekly
budget** (budget = "how much", not a timer — anti-ban is about volume + rate).
Press it, park the window on a second monitor, forget. At the end → a **report**.

Decided so far:

- Stop criterion = **daily/weekly budget per module** (randomised ceiling), not a
  per-session count and not a wall-clock timer.
- **Module-aware**: only enabled modules run; today only engagement-likes acts
  end-to-end (comments = increment 3 / needs LLM key; smart-connect + content =
  future, DOM adapters not built). Others report "not yet available".
- New **«Отчёты» (Reports) tab**: each run persists a `RunReport` (timestamp +
  per-module tallies: done / skipped / failed). Tab lists recent runs.

Decided in brainstorm (2026-06-24), pending spec:

- **Loop host = user choice**: current feed tab OR a dedicated worker window
  (`chrome.windows.create`, park on a 2nd monitor). The loop lives in the feed
  content script either way (survives SW eviction while the tab is open). SW is
  the authoritative gatekeeper (budget/burst/risk, persisted).
- **Daily ceiling = random around a base** (e.g. base 40 → 30–50/day via
  rng+jitter) + warmup ramp for new accounts. Not a fixed number, not a timer.
- **Full anti-ban for continuous run**: pacing (done) + `BurstGuard` (≤5 actions
  / 3 min) + occasional "human breaks" (1–3 min) + `RiskMonitor` kill-switch
  (captcha/challenge/429 → global stop). Work-hours gate deferred (not chosen).
- **Module-aware**: «Запустить» runs enabled modules; today only engagement-likes
  acts. Stop reasons recorded: budget / risk / manual.
- **«Отчёты» tab** + Start/Stop controls + live status dot in the top bar.

## 3. Content module — idea bank → custom prompt → drafts → approve → publish

The content pipeline, increments 2–3.

- **Idea bank** (inc 2): whole diverse feed → `IdeaExtractor` → `IdeaBank`, with a
  bank screen. The signal layer for everything below.
- **Settings tab → post-generator prompt**: the user pastes a custom prompt (voice,
  tone, structure). Stored in settings (SSOT, not hard-coded). `draftGeneration`
  takes an idea from the bank + this prompt → a post draft.
- **«Черновики» (Drafts) tab**: queue of generated posts → preview →
  **Approve / Reject / Edit** → publish via the composer DOM adapter.
- **Posts are human-in-the-loop by default — NOT full-auto.** Rationale (§5.5): a
  post under the user's real name is the most public, least reversible action; one
  bad AI post read by recruiters undoes the brand-building that is the product's
  whole point. Full-auto for posts is a later, opt-in step once the draft history
  proves quality (the manual → guardrails → full ladder, with a high trust bar for
  posts). Likes stay broad/auto; posts stay approve-first.

## 2. Usage telemetry — anonymous active-user count

**Goal:** know how many people use the extension.

- Thin `TelemetryClient` behind a port (mirrors the LLM provider): POST an **anonymous install UUID** (generated once, stored in
  `chrome.storage`; no PII, no LinkedIn data) + extension version + a daily
  heartbeat. Backend counts unique IDs → active users.
- **Must be disclosed + opt-out** (a "send anonymous stats" toggle + a README /
  privacy line). Minimal data only.
- Requires a separately designed backend endpoint.

## SSI-guide roadmap (mentor guide, 2026-07-16)

Gap analysis of a community mentor's LinkedIn-SSI guide vs Lodestar → prioritized
SSI-boosting features. **Full analysis: memory-bank `ssi-guide-roadmap.md`.**

Top-3 to build (SSI-impact × fit × safety):

1. **Auto-withdraw stale Sent invites (>2 weeks)** — removed. Lodestar no longer opens Sent or withdraws outgoing invites.
2. **Auto-accept incoming invites** — grows the network pillar (50 of 100), safe (guide §4.4).
3. **Real Profile Audit against the guide's checklist** — one-time +25 Brand; already the
   next task; honest unknown-state (naive reader gave false negatives).

More: weekly tracker 1 post+1 comment+1 reaction, post-format compliance (900-1200 chars,
media, hashtags, link-in-comment), Interests auto-follow, 3/mo personalized notes, repost.

Out (deliberate): the guide's "legend"/fake certs/false demographics/interview cheating —
they do NOT move SSI (guide §9.3) and conflict with the honesty bar.

## Next-session queue (2026-07-17)

Three tasks queued to start in a fresh session (Влад):

1. **India-exclusion filter** — design APPROVED, ready to implement. Full design +
   the load-bearing DOM finding (PYMK cards carry no location → keyword filter on
   headline is the workhorse) in memory-bank `india-exclusion-design.md`.
2. **Auto-accept incoming invites** (SSI-roadmap #2) — grows the network pillar; safe.
   See memory-bank `ssi-guide-roadmap.md`.
3. **Real Profile Audit against the guide's checklist** (SSI-roadmap #3) — one-time +25
   Brand; honest unknown-state. See `ssi-guide-roadmap.md`.
