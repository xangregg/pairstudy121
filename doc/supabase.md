# Supabase Setup

## Overview

[Supabase](https://supabase.com) is an open-source backend-as-a-service built on PostgreSQL.
This app uses it as a lightweight database to collect study data from participants
without requiring a custom server.

Data is written directly from the participant's browser using Supabase's REST API.
There are three tables:
`sessions` (one row per participant, written at the start of the main study),
`responses` (one row per trial rating, written immediately after each response),
and `comments` (optional free-text feedback submitted on the completion page).

Writes use the project's publishable anon key,
which is safe to embed in client-side code because row-level security policies
restrict it to insert-only access.
Reads for analysis should use the service role key from a secure environment.

All writes are fire-and-forget —
network errors are silently ignored so a failed submission does not interrupt the participant.

---

## Project Credentials

In `database.js`, fill in your project's URL and publishable (anon) key:

```js
const SUPA_URL = "https://<your-project-id>.supabase.co";
const SUPA_KEY = "<your-publishable-anon-key>";
```

Both values are found in your Supabase project under:
**Project Settings → API → Project URL** and **API Keys → anon / public**

The anon key is safe to include in client-side code.
Do not use the `service_role` key here.

---

## Table Definitions

Run the following SQL in the Supabase **SQL Editor** to create the three tables.

### `sessions`

One row per participant, written when they complete the onboarding questionnaire.

```sql
create table sessions (
    participant_id       text primary key,
    started_at           timestamptz,
    participant_group    text,

    -- Prolific integration
    prolific_pid         text,
    prolific_study_id    text,
    prolific_session_id  text,

    -- background questionnaire: reading frequency (1=Rarely, 2=Occasionally, 3=Regularly)
    bg_viz_frequency     smallint,
    bg_chart_frequency   smallint,

    -- background questionnaire: familiarity (1=Unfamiliar, 2=Somewhat, 3=Very familiar)
    bg_mean              smallint,
    bg_sd                smallint,
    bg_median            smallint,
    bg_quartile          smallint,
    bg_box_plot          smallint,
    bg_sampling          smallint,
    bg_significance      smallint,

    -- between-subjects design factors
    orientation          text,
    jitter               text,

    -- browser / device metadata
    user_agent           text,
    language             text,
    languages            text,
    timezone             text,
    screen_w             integer,
    screen_h             integer,
    color_depth          smallint,
    pixel_ratio          real,
    platform             text,
    touch                boolean,
    prefers_dark         boolean,
    viewport_w           integer,
    viewport_h           integer
);
```

### `trials`

One row per trial rating, written immediately after each response.
Replaces the older `responses` table.

**Seeds:** `data_seed` is drawn from the screened DATA_SEEDS pool and fully determines the base
sample values for both groups — sufficient to reconstruct the raw data given the signal parameters.
`trial_seed` is derived from the participant seed + trial index + condition and drives within-trial
randomization (e.g. rendering details).
`a_data`/`b_data` store the same data redundantly for analysis convenience,
avoiding the need to keep analysis code in sync with the survey's data generation.

**Raw data scaling:** values are integers 0–1000 over a ±5 SD range;
invertible via `value = i / 100.0 - 5`.
In CSV exports, `smallint[]` columns appear as `{v1,v2,...}` strings.

```sql
create table trials (
    id              bigint generated always as identity primary key,
    participant_id  text references sessions(participant_id),
    trial_index     integer,
    trial_seed      bigint,     -- derived from participant seed + trial index + condition; drives within-trial RNG
    data_seed       bigint,     -- from screened DATA_SEEDS pool; determines base sample values for both groups
    chart_type      text,
    chart_variant   text,       -- JSON string of chart options
    orientation     text,
    jitter          text,
    distribution    text,
    signal_group    integer,    -- 0 = group A received signal, 1 = group B

    -- independent signal factors; neutral value when not applied (0 for all except spread where neutral = 1)
    location        real,       -- delta in SD units (0 = no shift)
    spread          real,       -- scale factor (1 = no change)
    skew            real,       -- skew-normal alpha (0 = symmetric)
    bimodal         real,       -- mode separation in SD units (0 = unimodal)
    outlier         smallint,   -- +n = n high, -n = n low, m*100+n = m high and n low (0 = none)

    rating          smallint,   -- 1–4
    rt_ms           integer,
    finished_at     timestamptz, -- non-null on final trial only; use with sessions.started_at for session duration

    -- raw data scaled to 0–1000 (±5 SD range); redundant with data_seed but convenient for analysis
    a_data          smallint[],
    b_data          smallint[]
);

-- RLS
alter table trials enable row level security;
create policy "anon insert" on trials for insert to anon with check (true);
```

### `responses` (legacy)

Kept for pilot data collected before the `trials` table was introduced.
Not written to by current code.

```sql
create table responses (
    id              bigint generated always as identity primary key,
    participant_id  text references sessions(participant_id),
    trial_index     integer,
    trial_seed      bigint,
    data_seed       bigint,
    chart_type      text,
    chart_variant   text,
    orientation     text,
    jitter          text,
    distribution    text,
    effect_type     text,
    effect          jsonb,
    effect_group    integer,
    rating          smallint,
    rt_ms           integer,
    viewport_w      integer,
    viewport_h      integer,
    finished_at     timestamptz,
    a_mean  real, a_sd real, a_min real, a_q1 real, a_med real, a_q3 real, a_max real,
    b_mean  real, b_sd real, b_min real, b_q1 real, b_med real, b_q3 real, b_max real
);
```

### `comments`

Optional free-text comments submitted on the completion page.

```sql
create table comments (
    id              bigint generated always as identity primary key,
    participant_id  text references sessions(participant_id),
    comment         text,
    submitted_at    timestamptz
);
```

---

## Row-Level Security

The app posts data using the anon key,
so RLS must either be disabled for these tables
or have an insert policy that allows anonymous writes.
The simplest approach:

```sql
-- Allow anonymous inserts; no reads via anon key
alter table sessions  enable row level security;
alter table responses enable row level security;
alter table comments  enable row level security;

create policy "anon insert" on sessions  for insert to anon with check (true);
create policy "anon insert" on responses for insert to anon with check (true);
create policy "anon insert" on comments  for insert to anon with check (true);
```

To read data for analysis, use the **service role key** from a secure environment
(e.g., an R script or a Supabase Edge Function), never from client-side code.

---

## Migrations

If the tables already exist and need new columns added:

```sql
-- Prolific columns (add if running a Prolific study)
alter table sessions add column if not exists prolific_pid        text;
alter table sessions add column if not exists prolific_study_id   text;
alter table sessions add column if not exists prolific_session_id text;
```
