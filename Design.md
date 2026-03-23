# Study Design: Paired Differences Perception Study

## Overview

This is an online graphical perception study examining how well different statistical chart types allow observers to detect distributional differences between two groups. Each participant views a series of paired charts and rates the strength of evidence that the two groups come from different underlying sources.

Author: Xan Gregg using Claude Code

---

## Research Questions

- How do different chart types compare in their ability to convey distributional differences between groups:
  - overall?
  - for each specific effect type?
- For each chart type and effect type, how does the rating relate to the effect magnitude? Especially, is there a limit of perceptibility for each combination?
- Do overlaid dots help or hinder perception of differences?
- Do box plots detect bimodality as well as violin plots?
- Without any hinting about outliers, will participants ignore them?

There are interesting questions for almost any combination of factors.

---

## Study Factors

Each trial presents a single canvas containing two statistical charts of the same type side by side (labeled A and B). Each chart represents 50 data values sampled from a specified distribution. In trials with a non-null effect, one group has an introduced difference in location, scale, or shape; in null trials both groups are drawn from the same base distribution.

<figure style="text-align: center">
    <img src="images/trialbox.png" width="500" alt="Example trial showing a box plot pair">
    <figcaption>Example trial showing a box plot pair</figcaption>
</figure>

### Chart Types

Four chart type categories are included. Each participant is randomly assigned one variant from each category; the assigned variant is fixed for the entire session.

| Category | Variant | Description                                                                                                                                                                                 |
|----------|---------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Box | Box plot | Middle 50% shown as a rectangle with a median line. Whiskers extend to values within 1.5× the IQR; more extreme values shown as outlier dots.                                               |
| Box | Box plot with dots | Same as box plot, with all individual data values overlaid as dots.                                                                                                                         |
| Box | Range bar | Middle 50% shown as a rectangle with a wide median line. Thin lines extend to the full data range (no outlier trimming).                                                                    |
| Bands | Central bands (66%, 90%, 99%) with median | Nested quantile bands: darkest contains middle 66% of values, next 90%, outer 99%. Median line shown. Outliers are not shown.                                                               |
| Bands | Density bands (50%, 90%, 99%) with mode | HDR bands: darkest contains densest 50% of values, next 90%, outer 99%. Mode line shown; values outside the 99% band shown as dots. Bands may be disconnected for multimodal distributions. |
| Bands | Density bands (5%, 50%, 90%) | HDR bands: darkest contains densest 5%, next 50%, outer 90%. Values outside the 90% band shown as dots. Bands may be disconnected.                                                          |
| Bands | Density bands (33%, 67%, 100%) | HDR bands: darkest contains densest 33%, next 67%, outer band covers all remaining values. Bands may be disconnected.                                                                       |
| Dot | Dot plot | Each dot represents one data value; dots are spread horizontally to reduce overlap (according to jitter factor).                                                                            |
| Dot | Dot plot with median | Same as dot plot, with a horizontal line marking the median.                                                                                                                                |
| Violin | Violin plot | Smooth symmetric outline traces the distribution shape; width encodes local density.                                                                                                        |
| Violin | Violin plot with box | Violin outline with a box plot overlaid inside showing the median and middle 50% range.                                                                                                     |
| Violin | Violin plot with dots | Violin outline with individual data values overlaid as dots within the shape.                                                                                                               |
| Violin | Violin plot with median | Violin outline with a line marking the median.                                                                                                                                              |

All four chart type categories appear for every participant (within-subjects); which specific variant is shown within each category is randomly assigned (between-subjects).

### Jitter Types

Jitter controls how dots are spread horizontally (assuming vertical charts of ease of this description) to reduce overlap. One jitter method is randomly assigned per participant and applied consistently to all dot-based chart types (including box or violin plots with overlaid dots).

| Jitter | Description                                                                                                                                             |
|--------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
| Random | Each dot is placed at a uniform random horizontal offset within a fixed half-width, with a small number of candidate positions tried to reduce overlap. |
| Wilkinson | Dots at similar values are binned by proximity, then stacked symmetrically within each bin. Not precisely Wilkinson's algorithm,                        |
| Beeswarm | Dots are placed one at a time, in ascending value order, at the horizontal position closest to center that does not overlap any already-placed dot.     |
| Density random | Like random, but the horizontal range available to each dot scales with the local KDE density, keeping dots within the violin shape.                    |

### Data Distributions

The survey app supports up to three base distributions to generate the raw data for each trial. However, for the current study, only the normal distribution is used.

| Distribution | Proportion of trials | Notes |
|---|------------------|---|
| Normal (Gaussian) | 100% (100/100)   | Standard parameterization |
| Lognormal | 0% (0/100)       | Right-skewed; rendered on normalized scale |
| Binomial | 0% (0/100)       | n = 10, p = 0.2 base; normalized to ~N(0,1) scale |

### Effects

An *effect* is a modification applied to one of the two groups to create a potentially detectable difference. Each trial draws one effect uniformly at random from the applicable distribution's effect pool. The null effect (no modification) is included in each pool.

**Normal distribution — 20 effect types:**

| Effect type | Parameters                                                |
|---|-----------------------------------------------------------|
| Null | —                                                         |
| Location shift | Δ = 0.4, 0.6, 0.8, 1.0, 1.2, 1.4 SD units (6 levels)      |
| Scale change | Factor = 1.2×, 1.4×, 1.6× (3 levels)                      |
| Skew | Skew-normal α = ±3, ±5 (4 levels); mean-centered (µ=0) but SD < 1 (σ≈0.77 for α=±3, σ≈0.62 for α=±5) |
| Bimodal | Separation = 2.0, 3.0, 4.0 SD units (3 levels)            |
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

Effects are assigned from a balanced pool. For each distribution, the effect list is replicated ⌊nTrials / nEffects⌋ times and a partial replicate of size (nTrials mod nEffects) is appended; each replicate is independently shuffled. This guarantees each effect type appears either ⌊nTrials / nEffects⌋ or ⌈nTrials / nEffects⌉ times — exact counts per participant:

- Normal: exactly 5 (100 trials ÷ 20 effects, perfectly balanced)
- Lognormal: 0 (unused)
- Binomial: 0 (unused)

Effects are **not balanced within chart type**: a given effect may pair with one chart type more than another within a session, though this averages out across participants.

### Effect Group

"Effect group" indicates which of the two displayed groups (A or B) receives the effect. Exactly 50 of each participant's 100 trials assign the effect to group A; 50 assign it to group B. This balance is enforced globally across all 100 trials via a shuffled binary assignment vector. Balance within chart type or distribution subsets is not explicitly enforced but is expected to be approximately 50/50 given 25 trials per chart type.

### Participant Background

Before the main study begins, participants complete a brief self-report questionnaire collected as potential covariates for analysis.

**Reading frequency** (Rarely / Occasionally / Regularly):
- Bar charts and infographics
- Statistical charts

**Familiarity** (Unfamiliar / Somewhat / Very familiar):
- Mean
- Standard deviation
- Median
- Quartile
- Box plot
- Population sampling
- Linear regression

### Training

All participants complete the same onboarding sequence before their first trial. The sequence is not adaptive and cannot be skipped. Steps proceed in this order:

1. **Background questionnaire** — the familiarity and frequency questions above. The Continue button is disabled until all questions are answered.
2. **Understanding Sampling (3 pages)** — introduces the concept that each chart shows a random sample from a larger source. Page 1 shows one source and one sample; page 2 shows one source and three samples to illustrate within-source variation; page 3 shows two sources with one sample each to illustrate between-source differences.
3. **Chart Types** — an overview page showing thumbnail examples of all four assigned chart types, followed by one dedicated page per chart type explaining how to read it, with an example pair drawn from the same source. The training is only for the variants of the chart tye that the participant will see in the study.
4. **Response scale** — explains the 4-point rating scale and its intended meaning.

<figure style="text-align: center">
    <img src="images/sampling2.png" width="400" alt="Second sampling training page">
    <figcaption>Second sampling training page.</figcaption>                
</figure>   
The chart-type training pages are ordered to match the sequence in which each chart type first appears in that participant's randomized trial list. Additionally, each trial page shows a brief summary of the chart type details, such as specific cut-offs in use for band charts.

---

## Response Variable

Participants respond on a 4-point ordinal scale after each trial:

| Score | Label | Operational meaning shown to participants |
|-------|-------|------------------------------------------|
| 1 | No evidence | The charts look like they could easily come from the same source. Any visible difference is well within what random sampling alone would produce. |
| 2 | Weak evidence | The charts look similar, but there's a slight difference which might be real or random. |
| 3 | Moderate evidence | The charts look noticeably different in some way, but there's still meaningful uncertainty about whether it's real. |
| 4 | Strong evidence | The charts look clearly different. It would be surprising if random sampling alone produced this much of a difference. |

Response buttons are suppressed for 500 ms after each trial begins to reduce accidental and impulsive responses. Additionally, the button's hover highlight is disabled until the mouse is moved to reduce anchoring bias.

In addition to the response and design factors, key summary statistics for each trial are also recorded. Though the entire trial data sets can be recovered from the seed, these measures are a convenience for analysis and reporting purposes. An analysis may prefer to use, for instance, the actual mean difference rather than the effect magnitude.

---

## Design Structure

### Between-Subjects Factors
Each participant is assigned a random combination of the following factors. The idea is to reduce training and ambiguity (some variants have similar appearances but different meanings).

| Factor | Levels | Notes |
|--------|--------|-------|
| Chart variant | 1 per category, randomly assigned | Specific rendering option within each chart type category |
| Display orientation | Vertical, Horizontal | Axis orientation is transposed between conditions |
| Jitter method | Random, Wilkinson, Beeswarm, Density-random | Applies to dot plot rendering only |

### Within-Subjects Factors

Each participant completes 100 trials presented in randomized order.

| Factor | Levels | Trials per level          |
|--------|--------|---------------------------|
| Chart type | 4 | 25 each                   |
| Distribution | Normal, Lognormal, Binomial | 100, 0, 0                 |
| Effect type | 20 | Random assignment per trial |
| Effect magnitude | Continuous / ordinal within type | Nested within effect type |
| Effect group | A or B | 50 each (globally balanced) |

Distribution and chart type are crossed within each participant: each combination of chart type × distribution appears with trial counts proportional to the distribution weights (normal: 25 trials per chart type; lognormal and binomial: 0 each).

---

## Randomization

All randomization uses the mulberry32 pseudo-random number generator (32-bit LFSR). Each participant receives a random seed at first visit. All aspects of the design — chart type and variant assignments, orientation, jitter, trial order, effect draws, effectGroup assignments — are derived deterministically from that seed, ensuring full reproducibility from the participant seed alone.

Data generation uses a fixed pool of 100 algorithmically screened seeds (DATA_SEEDS) that are shuffled separately per distribution and assigned to trials without replacement within a participant. With 100 seeds and at most 100 normal trials per participant, each base dataset appears at most once per participant.

Seeds are selected by scanning integer multiples of 100,000 (starting at 10,100,000) and retaining those that pass two null-balance checks applied independently for both the normal and lognormal, if in use, distributions:

1. **Extremes check:** the difference between groups A and B in their maximum values, and separately in their minimum values, must each be less than a threshold fraction of the combined range (0.30 for normal, 0.40 for lognormal). This screens out seeds where one group's tail placement is deceptively extreme relative to the other.
2. **Mean check (Cohen's d):** the standardized mean difference between groups A and B must satisfy |d| < 0.25, where d is computed using the pooled sample standard deviation. This threshold is distribution-agnostic and corresponds approximately to a Welch's t-statistic of 1.25 (two-tailed p ≈ 0.21). Seeds with a larger mean difference would look deceptively shifted under a null effect.

These criteria ensure that null-effect trials show no systematic group difference beyond natural random-sampling variation.

---

## Suggested Analysis

Given the ordinal response and repeated-measures structure, a **cumulative link mixed model (CLMM)** or **ordinal logistic mixed model** is appropriate.

**Fixed effects to consider:**
- Chart type (primary factor; 4 levels, within-subjects)
- Effect type and/or effect magnitude (covariate; captures stimulus difficulty)
- Distribution family (only is lognormal or binomial is reintroduced)
- Effect group (within-subjects
- Display orientation (between-subjects)
- Jitter method (between-subjects; note: only affects dot plot trials)
- Background familiarity covariates (from pre-study questionnaire)
- Lag-1 rating (to account for sequential dependency / anchoring bias)

**Random effects:**
- Participant intercept (to account for between-participant differences in scale usage)
- Possibly random slopes for chart type within participant

**Primary comparison:** Chart type main effect and pairwise contrasts, estimated net of effect magnitude and distribution family.

---

## Design Limitations

1. **Effect type is not balanced within chart type.** The interaction of effect type × chart type cannot be cleanly estimated within a single participant. The random assignment means some participants will encounter a given chart type more often paired with easy effects and others with hard ones; this averages out across participants but limits within-participant analysis.

2. **Jitter factor is partially confounded with chart type.** Jitter only affects dot plot rendering; its effect on other chart types is by definition zero. This limits the interpretability of a jitter main effect and necessitates a jitter × chart type interaction term if jitter is of interest.

3. **Variant × chart type conflation.** Variants within a chart type category differ meaningfully in information content (e.g., box plot alone vs. box plot with individual data points overlaid). Analyses that collapse across variants within a category may mask substantial variant effects; analyses that treat variants as separate levels expand the factor considerably. 

4. **effectGroup balance is global, not stratified.** Within any chart type or distribution subset, effectGroup assignment may deviate from 50/50, though large deviations are unlikely given 25 trials per chart type.

---

## Open Questions

1. How to frame the main question and with what response scale? The survey aims to explore the basic question or Exploratory Data Analysis (EDA) question: "Is this anything?" However, it is not clear how to frame the question. **Status quo**: framed as evidence of difference.
2. How many response scale items? The main feature of the question is that it's asymmetric. In the spirit of the null hypothesis, there is only evidence for a difference, not evidence for similarity. **Status quo**: 4 levels: no/weak/moderate/strong.

