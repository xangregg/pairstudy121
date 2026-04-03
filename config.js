// config.js
// Study configuration — tune these values to adjust trial counts, thresholds, and timing.

// Number of data values per group per trial
export const N_PER_GROUP = 50;

// localStorage key — bump the version suffix whenever the session format changes incompatibly
export const STORAGE_KEY = "single_panel_study_v17";

// Minimum delay (ms) before rating buttons activate, to discourage impulsive responses
// Tempted to set it to 2+ seconds to allow reasonable consideration, but
// if someone is trying to speedrun, the lower threshold will allow us to detect it.
export const RATING_DELAY_MS = 500;

// Available dot-jitter methods; one is randomly assigned per participant
export const JITTER_CATALOG = ["random", "wilkinson", "beeswarm", "density random"];

// Number of repetitions (reps × chart types = trials) per distribution.
// Set lognormal and binomial to 0 to exclude them from the current study.
export const DIST_REPS          = {normal: 25, lognormal: 0, binomial: 0};
export const DIST_REPS_TESTING  = {normal:  3, lognormal: 0, binomial: 0};

// Seed screening thresholds for the DATA_SEEDS pool.
// extremes: max allowed difference between groups in their min or max value,
//           as a fraction of the combined data range.
export const SEED_THRESHOLDS = {
    normal:    {extremes: 0.30}, // ~3 rejections per 100 candidates
    lognormal: {extremes: 0.40}, // ~13 rejections per 100 candidates
};

// Cohen's d threshold for the mean-balance check; ~38 additional rejections per 100 candidates.
// Corresponds approximately to a Welch's t-statistic of 1.25 (two-tailed p ≈ 0.21).
export const MEAN_D_THRESHOLD = 0.25;
