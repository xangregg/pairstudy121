# Study Design: Paired Differences Perception Study

## Overview

This is an online graphical perception study examining how well different statistical chart types allow observers to detect distributional differences between two groups. Each participant views a series of paired charts and rates the strength of evidence that the two groups come from different underlying sources.

---

## Research Questions

- **Primary**: Do different chart types differ in their ability to convey distributional differences between groups?
- **Secondary**: Do observer ratings track effect magnitude? Do distribution family and effect type moderate chart type differences?

---

## Stimuli

Each trial presents a single canvas containing two statistical charts side by side (labeled A and B). Each chart displays 50 data values sampled from a specified distribution. In trials with a non-null effect, one group has an introduced difference in location, scale, or shape; in null trials both groups are drawn from the same base distribution.

### Chart Types

Four chart type categories are included. Each participant is randomly assigned one variant from each category; the assigned variant is fixed for the entire session.

| Category | Variants available |
|----------|--------------------|
| Box      | Box plot; Box plot with dots; Range bar |
| Bands    | 4 quantile/density band configurations |
| Dot      | Dot plot; Dot plot with median |
| Violin   | Violin plot; Violin with box; Violin with dots; Violin with median |

All four chart type categories appear for every participant (within-subjects); which specific variant is shown within each category is randomly assigned (between-subjects).

### Data Distributions

Three base distributions generate the raw data for each trial:

| Distribution | Proportion of trials | Notes |
|---|---|---|
| Normal (Gaussian) | 60% (60/100) | Standard parameterization |
| Lognormal | 20% (20/100) | Right-skewed; rendered on normalized scale |
| Binomial | 20% (20/100) | n = 10, p = 0.2 base; normalized to ~N(0,1) scale |

### Effects

An *effect* is a modification applied to one of the two groups to create a detectable difference. Each trial draws one effect uniformly at random from the applicable distribution's effect pool. The null effect (no modification) is included in each pool.

**Normal distribution — 20 effect types:**

| Effect type | Parameters |
|---|---|
| Null | — |
| Location shift | Δ = 0.4, 0.6, 0.8, 1.0, 1.2, 1.4 SD units (6 levels) |
| Scale change | Factor = 1.2×, 1.4×, 1.6× (3 levels) |
| Skew | Skew-normal α = ±4, ±5 (4 levels) |
| Bimodal | Separation = 2.0, 3.0, 4.0 SD units (3 levels) |
| Outlier | 1–2 extreme values at 4.0 SD magnitude (3 configurations) |

**Lognormal distribution — 10 effect types:**

| Effect type | Parameters |
|---|---|
| Null | — |
| Location | Ratio = 1.2, 1.3, 1.4, 1.5, 1.6 (5 levels) |
| Scale | Factor = 1.2×, 1.4×, 1.6×, 1.8× (4 levels) |

**Binomial distribution — 5 effect types:**

| Effect type | Parameters |
|---|---|
| Null | — |
| Parameter change | (n=10, p=0.1), (n=10, p=0.3), (n=10, p=0.4), (n=5, p=0.2) |

### Effect Assignment

Effects are drawn independently and uniformly at random for each trial. They are **not balanced across chart types** within a participant's session. Expected appearances per effect type per participant:

- Normal: ~3 (60 trials ÷ 20 effects)
- Lognormal: ~2 (20 trials ÷ 10 effects)
- Binomial: ~4 (20 trials ÷ 5 effects)

Realized counts will vary due to random sampling.

### Effect Group

"Effect group" indicates which of the two displayed groups (A or B) receives the effect. Exactly 50 of each participant's 100 trials assign the effect to group A; 50 assign it to group B. This balance is enforced globally across all 100 trials via a shuffled binary assignment vector. Balance within chart type or distribution subsets is not explicitly enforced but is expected to be approximately 50/50 given 25 trials per chart type.

---

## Response Variable

Participants respond on a 4-point ordinal scale after each trial:

| Score | Label | Operational meaning shown to participants |
|-------|-------|------------------------------------------|
| 1 | No evidence | Any difference is well within what random sampling alone would produce |
| 2 | Weak evidence | Slight suggestion of a difference; could plausibly be due to chance |
| 3 | Moderate evidence | Noticeably different in some way; meaningful uncertainty remains |
| 4 | Strong evidence | Clearly different; surprising if random sampling alone produced this |

Response buttons are suppressed for 500 ms after each trial begins to reduce impulsive responses.

---

## Design Structure

### Between-Subjects Factors

| Factor | Levels | Notes |
|--------|--------|-------|
| Chart variant | 1 per category, randomly assigned | Specific rendering option within each chart type category |
| Display orientation | Vertical, Horizontal | Axis orientation is transposed between conditions |
| Jitter method | Random, Wilkinson, Beeswarm, Density-random | Applies to dot plot rendering only |

### Within-Subjects Factors

Each participant completes 100 trials presented in randomized order.

| Factor | Levels | Trials per level |
|--------|--------|-----------------|
| Chart type | 4 | 25 each |
| Distribution | Normal, Lognormal, Binomial | 60, 20, 20 |
| Effect type | 20 / 10 / 5 (by distribution) | Random assignment per trial |
| Effect magnitude | Continuous / ordinal within type | Nested within effect type |
| Effect group | A or B | 50 each (globally balanced) |

Distribution and chart type are crossed within each participant: each combination of chart type × distribution appears with trial counts proportional to the distribution weights (normal: 15 trials per chart type; lognormal and binomial: 5 each).

---

## Randomization

All randomization uses the mulberry32 pseudo-random number generator (32-bit LFSR). Each participant receives a random seed at first visit. All aspects of the design — chart type and variant assignments, orientation, jitter, trial order, effect draws, effectGroup assignments — are derived deterministically from that seed, ensuring full reproducibility from the participant seed alone.

Data generation uses a fixed pool of 100 algorithmically screened seeds (DATA_SEEDS) that are shuffled separately per distribution and assigned to trials without replacement within a participant. With 100 seeds and at most 60 normal trials per participant, each base dataset appears at most once per participant.

Seeds are selected by scanning integer multiples of 100,000 (starting at 10,100,000) and retaining those that pass two null-balance checks applied independently for both the normal and lognormal distributions:

1. **Extremes check:** the difference between groups A and B in their maximum values, and separately in their minimum values, must each be less than a threshold fraction of the combined range (0.30 for normal, 0.40 for lognormal). This screens out seeds where one group's tail placement is deceptively extreme relative to the other.
2. **Mean check (Cohen's d):** the standardized mean difference between groups A and B must satisfy |d| < 0.25, where d is computed using the pooled sample standard deviation. This threshold is distribution-agnostic and corresponds approximately to a Welch's t-statistic of 1.25 (two-tailed p ≈ 0.21). Seeds with a larger mean difference would look deceptively shifted under a null effect.

These criteria ensure that null-effect trials show no systematic group difference beyond natural random-sampling variation.

---

## Trial Count and Replication

Per participant:

| Breakdown | Count |
|-----------|-------|
| Total trials | 100 |
| Per chart type | 25 |
| Per chart type × Normal | 15 |
| Per chart type × Lognormal | 5 |
| Per chart type × Binomial | 5 |
| Expected appearances per Normal effect type | ~3 |
| Expected appearances per Lognormal effect type | ~2 |
| Expected appearances per Binomial effect type | ~4 |

---

## Suggested Analysis

Given the ordinal response and repeated-measures structure, a **cumulative link mixed model (CLMM)** or **ordinal logistic mixed model** is appropriate.

**Fixed effects to consider:**
- Chart type (primary factor; 4 levels, within-subjects)
- Effect type and/or effect magnitude (covariate; captures stimulus difficulty)
- Distribution family
- Display orientation (between-subjects)
- Jitter method (between-subjects; note: only affects dot plot trials)
- Background familiarity covariates (from pre-study questionnaire)
- Lag-1 rating (to account for sequential dependency / anchoring bias)

**Random effects:**
- Participant intercept (to account for between-participant differences in scale usage)
- Possibly random slopes for chart type within participant

**Primary comparison:** Chart type main effect and pairwise contrasts, estimated net of effect magnitude and distribution family.

---

## Design Limitations and Open Questions

1. **Effect type is not balanced within chart type.** The interaction of effect type × chart type cannot be cleanly estimated within a single participant. The random assignment means some participants will encounter a given chart type more often paired with easy effects and others with hard ones; this averages out across participants but limits within-participant analysis.

2. **Jitter factor is partially confounded with chart type.** Jitter only affects dot plot rendering; its effect on other chart types is by definition zero. This limits the interpretability of a jitter main effect and necessitates a jitter × chart type interaction term if jitter is of interest.

3. **Variant × chart type conflation.** Variants within a chart type category differ meaningfully in information content (e.g., box plot alone vs. box plot with individual data points overlaid). Analyses that collapse across variants within a category may mask substantial variant effects; analyses that treat variants as separate levels expand the factor considerably.

4. **effectGroup balance is global, not stratified.** Within any chart type or distribution subset, effectGroup assignment may deviate from 50/50, though large deviations are unlikely given 25 trials per chart type.

5. ~~**DATA_SEEDS reuse.**~~ Resolved. The pool of 100 screened seeds exceeds the maximum number of trials per distribution (60 normal, 20 lognormal, 20 binomial), so each base dataset appears at most once per participant. No seed-level non-independence remains.
