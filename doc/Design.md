# Study Design: Paired Distributions Perception Study

## Overview

This is an online graphical perception study examining how well different statistical chart types allow observers to detect distributional differences between two groups. Each participant views a series of paired charts and rates how surprising it would be if both samples came from the same source.

Author: Xan Gregg using Claude Code

---

## Research Questions

- How do different chart types compare in their ability to convey distributional differences between groups:
  - overall?
  - for each specific signal type?
- For each chart type and signal type, how does the rating relate to the signal magnitude? Especially, is there a limit of perceptibility for each combination?
- Do overlaid dots help or hinder perception of differences?
- Do box plots detect bimodality as well as violin plots?

There are interesting questions for almost any combination of factors.

---

## Study Factors

Each trial presents a single canvas containing two statistical charts of the same type side by side (labeled A and B). Each chart represents 50 data values sampled from a specified distribution. In trials with a non-null signal, one group has an introduced difference in location, spread, or shape; in null trials both groups are drawn from the same base distribution.

<figure style="text-align: center">
    <img src="../images/trialbox.png" width="500" alt="Example trial showing a box plot pair">
    <figcaption>Example trial showing a box plot pair</figcaption>
</figure>

### Chart Types

Four chart type categories are included. Within each category, variants are either *solo* (appears alone; not mixed with other variants) or *non-solo* (all non-solo variants in a category are shown together). Which variant(s) a participant sees is randomly determined: if the randomly selected first variant is solo, only that variant is shown; otherwise all non-solo variants in the category are included. Solo vs. non-solo assignment is a between-subjects factor for categories where both types exist.

| Category | Variant | Solo | Description |
|----------|---------|------|-------------|
| Box | Box plot | — | Middle 50% shown as a rectangle with a median line. Whiskers extend to values within 1.5× the IQR; more extreme values shown as outlier dots. |
| Box | Box plot with dots | — | Same as box plot, with all individual data values overlaid as dots. |
| Box | Range bar | solo | Middle 50% shown as a rectangle with a wide median line. Thin lines extend to the full data range (no outlier trimming). |
| Bands | Central bands (66%, 90%, 99%) with median | solo | Nested quantile bands: darkest contains middle 66% of values, next 90%, outer 99%. Median line shown. Outliers beyond 99% are not shown. |
| Bands | Density bands (50%, 90%, 99%) with mode | solo | HDR bands: darkest contains densest 50% of values, next 90%, outer 99%. Mode line shown; values outside the 99% band shown as dots. Bands may be disconnected for multimodal distributions. |
| Bands | Density bands (5%, 50%, 90%) | solo | HDR bands: darkest contains densest 5%, next 50%, outer 90%. Values outside the 90% band shown as dots. Bands may be disconnected. |
| Bands | Density bands (33%, 67%, 100%) | solo | HDR bands: darkest contains densest 33%, next 67%, outer band covers all remaining values. Bands may be disconnected. |
| Dot | Dot plot | — | Each dot represents one data value; dots are spread to reduce overlap (see Jitter). |
| Dot | Dot plot with median | — | Same as dot plot, with a line marking the median. |
| Violin | Violin plot | — | Smooth symmetric outline traces the distribution shape; width encodes local density. |
| Violin | Violin plot with box | — | Violin outline with a box plot overlaid inside showing the median and middle 50% range. |
| Violin | Violin plot with dots | — | Violin outline with individual data values overlaid as dots within the shape. |
| Violin | Violin plot with median | — | Violin outline with a line marking the median. |

Since dot and violin categories have no solo variants, all participants see both dot variants and all four violin variants. For box, a participant sees either range bar alone or both non-solo box variants. For bands, exactly one solo variant is randomly selected per participant.

### Trial Allocation

Each participant completes exactly 100 trials. Trials are allocated across chart variants subject to two constraints: each chart type *category* receives at least 20 trials (`MIN_CATEGORY_TRIALS`), and each individual *variant* receives at most 20 trials (`MAX_VARIANT_TRIALS`). After the guaranteed minimums are assigned (balanced across variants within each category), the remaining trials are distributed by randomly sampling from eligible variants (those under the 20-trial cap). This gives multi-variant categories proportionally more total trials while keeping individual variant counts variable across participants.

### Jitter Types

Jitter controls how dots are spread to reduce overlap in dot-based chart types (dot plots, and box or violin plots with overlaid dots). The jitter method is assigned **per trial** from a balanced pool: the four jitter types are cycled across all conditions and shuffled, so each method appears approximately equally often across all trials. A separate session-level jitter assignment (drawn once per participant) is used only for training page displays.

| Jitter | Description |
|--------|-------------|
| Random | Each dot is placed at a uniform random horizontal offset within a fixed half-width, with a small number of candidate positions tried to reduce overlap. |
| Wilkinson | Dots at similar values are binned by proximity, then stacked symmetrically within each bin. Not precisely Wilkinson's algorithm. |
| Beeswarm | Dots are placed one at a time, in ascending value order, at the horizontal position closest to center that does not overlap any already-placed dot. |
| Density random | Like random, but the horizontal range available to each dot scales with the local KDE density, keeping dots within the violin shape. |

### Data Distributions

The survey app supports up to three base distributions to generate the raw data for each trial. However, for the current study, only the normal distribution is used.

| Distribution | Proportion of trials | Notes |
|---|---|---|
| Normal (Gaussian) | 100% (100/100) | Standard parameterization |
| Lognormal | 0% (0/100) | Right-skewed; rendered on normalized scale |
| Binomial | 0% (0/100) | n = 10, p = 0.2 base; normalized to ~N(0,1) scale |

### Signals

A *signal* is a modification applied to one of the two groups to create a potentially detectable difference. Each trial draws one signal from the applicable distribution's signal pool using weighted random sampling. The null signal (no modification) is included in each pool. Signals with weight 0 are defined but excluded from sampling.

**Normal distribution — 11 active signal types (weight > 0), total active weight = 85:**

| Signal type | Parameters | Level | Weight | Expected trials |
|---|---|---|---|---|
| Null | — | null | 10 | ~12 |
| Location shift | Δ = 0.5 SD | weak | 5 | ~6 |
| Location shift | Δ = 0.8 SD | moderate | 10 | ~12 |
| Location shift | Δ = 1.1 SD | strong | 10 | ~12 |
| Spread change | Factor = 1.5× | moderate | 10 | ~12 |
| Spread change | Factor = 1.8× | strong | 10 | ~12 |
| Skew | Skew-normal α = 5; median-centered, spread-normalized | moderate | 5 | ~6 |
| Skew | Skew-normal α = 7; median-centered, spread-normalized | strong | 5 | ~6 |
| Bimodal | Separation = 3.0 SD | moderate | 8 | ~9 |
| Bimodal | Separation = 4.0 SD | strong | 8 | ~9 |
| Bimodal | Separation = 5.0 SD | strong | 4 | ~5 |

**Lognormal distribution — 10 signal types (inactive, weight defined for future use):**

| Signal type | Parameters |
|---|---|
| Null | — |
| Location | Ratio = 1.2, 1.3, 1.4, 1.5, 1.6 (5 levels) |
| Spread | Factor = 1.2×, 1.4×, 1.6×, 1.8× (4 levels) |

**Binomial distribution — 5 signal types (inactive):**

| Signal type | Parameters |
|---|---|
| Null | — |
| Parameter change | (n=10, p=0.1), (n=10, p=0.3), (n=10, p=0.4), (n=5, p=0.2) |

### Signal Assignment

Signals are assigned using weighted random sampling. A pool of exactly 100 signal instances is constructed via the largest-remainder method applied to each signal's weight, then shuffled. This guarantees the total count per signal type is proportional to its weight, with each signal appearing either ⌊100 × w/W⌋ or ⌈100 × w/W⌉ times.

Signals are **not balanced within chart type**: a given signal may pair with one chart type more than another within a session, though this averages out across participants.

### Signal Group

"Signal group" indicates which of the two displayed groups (A or B) receives the signal. Exactly 50 of each participant's 100 trials assign the signal to group A; 50 assign it to group B. This balance is enforced globally across all 100 trials via a shuffled binary assignment vector.

### Participant Background

Before the main study begins, participants complete a brief self-report questionnaire collected as potential covariates for analysis.

**Familiarity** (Unfamiliar / Somewhat / Very familiar):
- Bar charts
- Scatter plots
- Box plots
- Mean
- Standard deviation
- Median
- Quartile
- Linear regression

### Training

All participants complete the same onboarding sequence before their first trial. The sequence is not adaptive and cannot be skipped. Steps proceed in this order:

1. **Background questionnaire** — the familiarity questions above. The Continue button is disabled until all questions are answered.
2. **Understanding Sampling (3 pages)** — introduces the concept that each chart shows a random sample from a larger source. Page 1 shows one source and one sample; page 2 shows one source and three samples to illustrate within-source variation; page 3 shows two sources side by side followed by one sample from each, to illustrate between-source differences.
3. **Chart Types** — an overview page showing thumbnail examples of all assigned chart type categories, followed by one dedicated page per unique chart type explaining how to read it, with an example pair drawn from the same source. For solo variants, the training shows the assigned variant. For non-solo variants, training shows the *plain* variant (marked `plain: true` in the catalog), which is the simplest form of that chart type. Pages are ordered to match the sequence in which each chart type first appears in the participant's randomized trial list.
4. **Response scale** — explains the 4-point rating scale and its intended meaning.

<figure style="text-align: center">
    <img src="../images/sampling2.png" width="400" alt="Second sampling training page">
    <figcaption>Second sampling training page.</figcaption>
</figure>

Each trial page shows a brief description of the specific chart variant in use (e.g., band cutoff percentages).

---

## Response Variable

The trial question is: *"How surprising would it be if samples A and B were from the same source?"*

Participants respond on a 4-point ordinal scale:

| Score | Label | Operational meaning shown to participants |
|-------|-------|------------------------------------------|
| 1 | Not surprising | The difference looks like normal sampling variation — what you'd expect even if A and B come from the same source. |
| 2 | Slightly surprising | The difference is a little more than typical, but could still easily be due to random sampling. |
| 3 | Quite surprising | The difference seems more than you'd usually expect from random sampling alone. |
| 4 | Very surprising | The difference would be very unusual if A and B were random samples from the same source. |

Response buttons are suppressed for 500 ms after each trial begins to reduce accidental and impulsive responses. Additionally, the button's hover highlight is disabled until the mouse is moved to reduce anchoring bias.

In addition to the response and design factors, the full A and B data sets are stored with each trial result as `a_data` and `b_data` — integer arrays of length 50, scaled to 0–1000 over a ±5 SD range (invertible: value = i/100 − 5). Though the data sets can also be regenerated deterministically from the trial seed, storing them directly simplifies analysis.

---

## Design Structure

### Between-Subjects Factors

| Factor | Levels | Notes |
|--------|--------|-------|
| Chart variant(s) | 1–2 per category, randomly assigned | Solo variants appear alone; non-solo variants appear together within a category |

### Within-Subjects Factors

Each participant completes 100 trials presented in randomized order.

| Factor | Levels | Trials per level |
|--------|--------|-----------------|
| Chart type category | 4 | ≥20 each (random allocation of extras) |
| Jitter method | Random, Wilkinson, Beeswarm, Density-random | ~25 each (balanced pool, per-trial) |
| Distribution | Normal, Lognormal, Binomial | 100, 0, 0 |
| Signal type | 11 active (19 defined) | Weighted random assignment per trial |
| Signal magnitude | Continuous / ordinal within type | Nested within signal type |
| Signal group | A or B | 50 each (globally balanced) |

---

## Randomization

All randomization uses the mulberry32 pseudo-random number generator (32-bit LFSR). Each participant receives a random seed at first visit. All aspects of the design — chart type and variant assignments, jitter pool, trial order, signal draws, signal group assignments — are derived deterministically from that seed, ensuring full reproducibility from the participant seed alone.

Data generation uses a fixed pool of 100 algorithmically screened seeds (DATA_SEEDS) that are shuffled separately per distribution and assigned to trials without replacement within a participant. With 100 seeds and at most 100 normal trials per participant, each base dataset appears at most once per participant.

Seeds are selected by scanning integer multiples of 100,000 (starting at 10,100,000) and retaining those that pass two null-balance checks:

1. **Extremes check:** the difference between groups A and B in their maximum values, and separately in their minimum values, must each be less than a threshold fraction of the combined range (0.30 for normal, 0.40 for lognormal).
2. **Mean check (Cohen's d):** the standardized mean difference between groups A and B must satisfy |d| < 0.25, computed using the pooled sample standard deviation. This corresponds approximately to a Welch's t-statistic of 1.25 (two-tailed p ≈ 0.21).

These criteria ensure that null-signal trials show no systematic group difference beyond natural random-sampling variation.

---

## Completion Page Scoring

A brief score summary is shown on the completion page, intended as participant entertainment rather than a formal measure.

**Alignment score:** For each trial, the realized K-S statistic D is mapped to a continuous expected rating via piecewise-linear interpolation over the anchor points `(ks, expectedRating) = (0, 0.5), (0.05, 1), (0.17, 1.5), (0.26, 2.5), (0.34, 3.5), (0.44, 4.4), (1.0, 4.5)`. The anchors were chosen to align "quite" with a p-value of 0.05 and "very" with a p-value of 0.01 for K-S with n-50. A grace margin of 0.25 rating units is applied (no penalty within that range of the expected value). The alignment score is `1 − MSE / (max_error²)`, reported as a percentage.

K-S thresholds between rating buckets: D < 0.17 → expected 1, 0.17–0.26 → 2, 0.26–0.34 → 3, ≥ 0.34 → 4. These thresholds are tunable pending calibration from pilot data.

---

## Inactive Components

The following factors are implemented in code but not currently active in the study:

| Component | Status | Notes |
|-----------|--------|-------|
| Display orientation | Fixed to vertical | Code supports horizontal (transposed axis); was previously a between-subjects factor. Orientation-aware wording in chart explanations is still dynamically generated. |
| Lognormal distribution | Weight = 0 | Full signal set defined; can be reactivated via `DIST_REPS` in `config.js`. |
| Binomial distribution | Weight = 0 | Partial signal set defined. |
| Several signal types | Weight = 0 | Includes location Δ=1.4, spread ×1.2, skew α=±3 and α=−5, bimodal separation=2.0, all outlier variants. Defined in `design.js`; can be reactivated by setting weight > 0. |
| Correlation scores | Computed but not displayed | Spearman ρ, Kendall τ-b, and Goodman-Kruskal γ between K-S values and ratings are computed at session end but hidden pending calibration. |

---

## Data Quality

Participants will be filtered based on attention checks to be determined after the pilot run. Basic ideas:
1. Require reasonable responses for null and strong signals on average.
2. Check some response patterns (repeats and sawtooths).
3. Check response times for rapid clicking.

---

## Analysis Plans

Not sure if response needs to be ordinal or treated linear (which I believe is common treatment for Likert scales).

General plan is to collect enough samples so that between-subjects effects will balance out but to also try a full factor random effects model.

Hoping to clarify after pilot runs. During pilot runs, signal magnitudes can be adjusted.

**Modeling:** Conditioned on the input factors, the rating response can be predicted by:
1. the injected signal magnitude: assumes only one signal at a time and can be swamped by randomization
2. the computed signal magnitude (from a_data and b_data): not trivial for all signals
3. P-values based on each signal (means difference, unequal variances, and normality testing)
4. an overall computed difference measure:
   1. Kolmogorov-Smirnov distance between the ECDFs
   1. a combination of the above p-values


---

## Hypotheses

### Hot Takes
1. Bimodal signals are detected at lower magnitudes with box plots than with violin plots.
1. Adding dots to violin and box plots decreases response quality, diminishing surprise response.
1. Beeswarm jitter performs worse than the other jitter types, exaggerating surprise response.
1. Though least familiar, the bands charts are no worse than the others.
1. Density bands charts are better than all others at bimodal data.

### Cold Takes
1. *If orientation is in the study:* Chart orientation doesn't affect response quality.
1. Skew is the hardest strong signal to detect.
1. *If the outlier signal is in the study:* Range Bar makes the mild outlier signal look strongish.
1. Participant surprise underestimates statistical significance (That is, statistically differences with p-value of 0.05 will average closer to "slight" surprise than "quite" or "very")

---

## Design Limitations

1. **Some chart types are not seen by all participants.** That makes it harder to analyze chart effects since it's between-participant, but it makes the training simpler (each participant only has to learn one basic form of each of the four chart types), which hopefully makes the response quality better.
1. **Anchoring could be a problem.** That is, one response can be biased by the previous response — either as a tendency to not move the mouse, or as a relative rating. The usual fixes seem worse: re-arranging response buttons, required pauses between questions, ...

