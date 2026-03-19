// app.js

import {renderChart, quantileSorted} from "./renderers.js";
import {mulberry32, hashStringToUint32, randomNormal, shuffleInPlace} from "./utils.js";


/** ---------- Supabase ---------- **/
const SUPA_URL = "https://pidcedqlfqtvfqncaysc.supabase.co";    // project url
const SUPA_KEY = "sb_publishable_Xfi2G-RyjGXc8PhGOu2YWA_iQfbnpyE"; // publishable key

function postResponse(trial, rating, rtMs, finishedAt = null, stats = null) {
    const cond = trial.condition;
    const row = {
        participant_id: session.participantId,
        trial_index: trial.trialIdx,
        trial_seed: trial.trialSeed,
        data_seed: cond.dataSeed,
        chart_type: cond.chartType,
        chart_variant: JSON.stringify(cond.chartOptions ?? {}),
        orientation: session.design.orientation,
        jitter: session.design.jitter,
        distribution: cond.dist,
        effect_type: cond.effect.type,
        effect: cond.effect,
        effect_group: cond.effectGroup,
        rating,
        rt_ms: rtMs,
        viewport_w: window.innerWidth,
        viewport_h: window.innerHeight,
        finished_at: finishedAt,
    };
    if (stats) {
        row.a_mean = stats.a.mean; row.a_sd = stats.a.sd;
        row.a_min = stats.a.min; row.a_q1 = stats.a.q1; row.a_med = stats.a.med; row.a_q3 = stats.a.q3; row.a_max = stats.a.max;
        row.b_mean = stats.b.mean; row.b_sd = stats.b.sd;
        row.b_min = stats.b.min; row.b_q1 = stats.b.q1; row.b_med = stats.b.med; row.b_q3 = stats.b.q3; row.b_max = stats.b.max;
    }
    if (NOSUBMIT) return;
    fetch(`${SUPA_URL}/rest/v1/responses`, {
        method: "POST",
        headers: {
            "apikey": SUPA_KEY,
            "Authorization": `Bearer ${SUPA_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        },
        body: JSON.stringify(row)
    }).catch(() => {
    }); // fire-and-forget; silently ignore network errors
}

function postSession() {
    const bg = session.background ?? {};
    const row = {
        participant_id: session.participantId,
        started_at: session.startedAtISO,
        participant_group: params.get("group") ?? null,
        // background questionnaire — frequency (1=Rarely, 2=Occasionally, 3=Regularly)
        bg_viz_frequency:   bg.vizFrequency   ?? null,
        bg_chart_frequency: bg.chartFrequency ?? null,
        // background questionnaire — familiarity (1=Unfamiliar, 2=Somewhat familiar, 3=Very familiar)
        bg_mean:         bg.mean         ?? null,
        bg_sd:           bg.sd           ?? null,
        bg_median:       bg.median       ?? null,
        bg_quartile:     bg.quartile     ?? null,
        bg_box_plot:     bg.boxPlot      ?? null,
        bg_sampling:     bg.sampling     ?? null,
        bg_significance: bg.linearRegression ?? null,
        // between-subjects design factors
        orientation: session.design.orientation,
        jitter: session.design.jitter,
        // browser / device metadata
        user_agent: navigator.userAgent,
        language: navigator.language,
        languages: JSON.stringify([...navigator.languages]),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        screen_w: screen.width,
        screen_h: screen.height,
        color_depth: screen.colorDepth,
        pixel_ratio: devicePixelRatio,
        platform: navigator.userAgentData?.platform ?? navigator.platform,
        touch: navigator.maxTouchPoints > 0,
        prefers_dark: window.matchMedia("(prefers-color-scheme: dark)").matches,
        viewport_w: window.innerWidth,
        viewport_h: window.innerHeight,
    };
    if (NOSUBMIT) return;
    fetch(`${SUPA_URL}/rest/v1/sessions`, {
        method: "POST",
        headers: {
            "apikey": SUPA_KEY,
            "Authorization": `Bearer ${SUPA_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        },
        body: JSON.stringify(row)
    }).catch(() => {
    });
}

/** ---------- Background questionnaire ---------- **/
const BG_FREQ_OPTIONS = [
    { value: 1, label: "Rarely" },
    { value: 2, label: "Occasionally" },
    { value: 3, label: "Regularly" },
];
const BG_FAM_OPTIONS = [
    { value: 1, label: "Unfamiliar" },
    { value: 2, label: "Somewhat" },
    { value: 3, label: "Very familiar" },
];
const BG_SECTIONS = [
    {
        heading: "How often do you read...",
        questions: [
            { key: "vizFrequency",   label: "Bar charts / infographics" },
            { key: "chartFrequency", label: "Statistical charts" },
        ],
        options: BG_FREQ_OPTIONS,
    },
    {
        heading: "How familiar are you with...",
        questions: [
            { key: "mean",         label: "Mean" },
            { key: "sd",           label: "Standard deviation" },
            { key: "median",       label: "Median" },
            { key: "quartile",     label: "Quartile" },
            { key: "boxPlot",      label: "Box plot" },
            { key: "sampling",     label: "Population sampling" },
            { key: "linearRegression", label: "Linear regression" },
        ],
        options: BG_FAM_OPTIONS,
    },
];
const BG_QUESTIONS = BG_SECTIONS.flatMap(s => s.questions);

/** ---------- Config ---------- **/
const DEFAULT_TESTING = false;
const params = new URLSearchParams(window.location.search);
const TESTING = params.has("test")
    ? params.get("test") !== "false"
    : DEFAULT_TESTING;
const SEEDREVIEW_DIST = params.get("seedreview"); // e.g. ?seedreview=lognormal
const NOSUBMIT = params.has("nosubmit") || !!SEEDREVIEW_DIST;

const N_CHART_TYPES = TESTING ? Infinity : 4;
const N_VARIANT_TYPES = TESTING ? Infinity : 1;
// Number of reps per dist — tune to control trial count proportions
// const distReps0 = {normal: 1, lognormal: 1, binomial: 1};
const distReps = TESTING
    ? {normal: 3, lognormal: 1, binomial: 1}
    : {normal: 15, lognormal: 5, binomial: 5};

const RATING_DELAY_MS = 500;   // ms before rating buttons activate
const JITTER_CATALOG = ["random", "wilkinson", "beeswarm", "density random"];

/** ---------- Session storage ---------- **/
const STORAGE_KEY = "single_panel_study_v15";

function newParticipantId() {
    return "P" + Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function loadOrCreateSession() {
    const urlPid = new URLSearchParams(window.location.search).get("pid");
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
        try {
            const saved = JSON.parse(raw);
            // Resume saved session unless a different pid was requested via URL
            if (!urlPid || saved.participantId === urlPid) return saved;
        } catch {
        }
    }
    const participantId = urlPid ?? newParticipantId();
    const participantSeed = hashStringToUint32(participantId);
    const session = {
        participantId, participantSeed,
        startedAtISO: null, finishedAtISO: null,
        design: null, onboardingStep: 0, trialIndex: 0, results: []
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    return session;
}

let session = loadOrCreateSession();

/** ---------- UI ---------- **/
const UI = {
    introPage: document.getElementById("introPage"),
    onboardingPage: document.getElementById("onboardingPage"),
    onboardingTitle: document.getElementById("onboardingTitle"),
    onboardingCounter: document.getElementById("onboardingCounter"),
    onboardingText1: document.getElementById("onboardingText1"),
    onboardingText2: document.getElementById("onboardingText2"),
    onboardingCanvasArea: document.getElementById("onboardingCanvasArea"),
    onboardingCanvas: document.getElementById("onboardingCanvas"),
    onboardingThumbnails: document.getElementById("onboardingThumbnails"),
    onboardingChartLabel: document.getElementById("onboardingChartLabel"),
    onboardingContinueBtn: document.getElementById("onboardingContinueBtn"),
    trialPage: document.getElementById("trialPage"),
    introStartBtn: document.getElementById("introStartBtn"),
    chartDesc: document.getElementById("chartDesc"),
    trialCounter: document.getElementById("trialCounter"),
    finishedMsg: document.getElementById("finishedMsg"),
    progFill: document.getElementById("progFill"),
    chart: document.getElementById("chart"),
    debug: document.getElementById("debug"),
    downloadBtn: document.getElementById("downloadBtn"),
    downloadDesignBtn: document.getElementById("downloadDesignBtn"),
    copyDataBtn: document.getElementById("copyDataBtn"),
    resetBtn: document.getElementById("resetBtn"),
    ratingBtns: Array.from(document.querySelectorAll(".ratingBtn")),
    completionPage: document.getElementById("completionPage"),
    commentField: document.getElementById("commentField"),
    submitCommentBtn: document.getElementById("submitCommentBtn"),
    commentStatus: document.getElementById("commentStatus"),
    completionDownloadBtn: document.getElementById("completionDownloadBtn"),
    completionDownloadDesignBtn: document.getElementById("completionDownloadDesignBtn"),
    completionResetBtn: document.getElementById("completionResetBtn"),
};

let currentTrial = null;
let trialStartPerf = null;

/** ---------- Base data generation ---------- **/
const N_PER_GROUP = 50;

// DATA_SEEDS is computed after generateBasePanel (defined below)

// Orientation-aware direction words — must be called at render time, not at catalog init time.
// function names match vertical chart orientation
function verticalWord()   { return currentOrientation() === "vertical" ? "vertical"   : "horizontal"; }
function horizontalWord() { return currentOrientation() === "vertical" ? "horizontal" : "vertical";   }
function heightWord()     { return currentOrientation() === "vertical" ? "height"     : "width";      }

function jitterDesc(jitter) {
    if (jitter === "wilkinson")      return "Dots at similar values are aligned and stacked in a symmetric pattern.";
    if (jitter === "beeswarm")       return "Dots spread to each side in a balanced pattern to minimize overlap.";
    if (jitter === "density random") return "Dots spread more widely where values are densely packed.";
    return "Dots at similar values are spread apart to reduce overlap."; // "random"
}

// Each entry lists display variants for that chart type.
// At design time, N_CHART_TYPES types are chosen per participant (seeded shuffle),
// and one variant is picked per type — both are between-subjects factors.
// explanation must be a function (called at render time) so orientation words resolve correctly.
const CHART_TYPE_CATALOG = [
    {
        type: "box", variants: [
            {
                description: "Box plot",
                explanation: () => `A box plot shows the middle 50% of values as a rectangle, with a ${horizontalWord()} line at the median.` +
                    ` Thin ${verticalWord()} lines (whiskers) extend to values within 1.5 times the box ${heightWord()}` +
                    `; more extreme values (outliers) appear as individual dots.`,
                showDots: false
            },
            {
                description: "Box plot with dots",
                explanation: () => `A box plot shows the middle 50% of values as a rectangle, with a ${horizontalWord()} line at the median.` +
                    ` Thin ${verticalWord()} lines (whiskers) extend to values within 1.5 times the box ${heightWord()}` +
                    `; more extreme values are potential outliers.`,
                showDots: true
            },
            {
                description: "Range bar",
                explanation: () => `A range bar shows the middle 50% of values as a rectangle, with a thick ${horizontalWord()} line at the median.` +
                    ` Thin ${verticalWord()} lines extend to cover the range of data values.`,
                whiskers: "range", widerMedian: true, showDots: false
            },
        ]
    },
    {
        type: "bands", variants: [
            {
                description: "Central bands (66%, 90%, 99%) with median",
                explanation: () => `Nested bands show where the data falls: the darkest inner band contains the middle 66% of values, ` +
                    `the next contains 90%, and the outer band contains 99%. A ${horizontalWord()} line marks the median. ` +
                    `Any values beyond the outer 99% region are not shown.`,
                bandType: "quantile", cutoffs: [0.66, 0.90, 0.99], showMedian: true, showMode: false, showDots: false
            },
            {
                description: "Density bands (50%, 90%, 99%) with mode",
                explanation: () => `Shaded bands show where values are most densely concentrated. ` +
                    `The darkest shade contains the densest 50% of values; ` +
                    `the next shade contains 90%, and the lightest shade contains 99%. ` +
                    `Shaded regions may be disconnected. A ${horizontalWord()} line marks the point of highest density. ` +
                    `Any values outside of those regions are shown as dots.`,
                bandType: "hdr", cutoffs: [0.50, 0.90, 0.99], showMedian: false, showMode: true
            },
            {
                description: "Density bands (5%, 50%, 90%)",
                explanation: () => `Shaded bands show where values are most densely concentrated. ` +
                    `The darkest shade contains the densest 5% of values; ` +
                    `the next shade contains 50%, and the lightest shade contains 90%. ` +
                    `Shaded regions may be disconnected. ` +
                    `Any values outside of those regions are shown as dots.`,
                bandType: "hdr", cutoffs: [0.05, 0.50, 0.90], showMedian: false, showMode: false
            },
            {
                description: "Density bands (33%, 67%, 100%)",
                explanation: () => `Shaded bands show where values are most densely concentrated. ` +
                    `The darkest shade contains the densest 33% of values; ` +
                    `the next shade contains 67%, and the lightest shade contains all remaining values. ` +
                    `Shaded regions may be disconnected.`,
                bandType: "hdr", cutoffs: [1. / 3, 2. / 3, 1.00], showMedian: false, showMode: false
            },
        ]
    },
    {
        type: "dot", variants: [
            {
                description: "Dot plot with median",
                explanation: () => `Each dot represents one data value. ` +
                    `${jitterDesc(session.design.jitter)} ` +
                    `A ${horizontalWord()} line marks the median.`,
                showMedian: true
            },
            {
                description: "Dot plot",
                explanation: () => `Each dot represents one data value. ` +
                    `${jitterDesc(session.design.jitter)}`,
                showMedian: false
            },
        ]
    },
    {
        type: "violin", variants: [
            {
                description: "Violin plot",
                explanation: () => `A violin plot traces the full distribution shape as a smooth symmetric outline. ` +
                    `Wider sections indicate where values are more common.`,
                showDots: false, showMedian: false
            },
            {
                description: "Violin plot with box",
                explanation: () => `A violin outline traces the full distribution shape as a smooth symmetric outline. ` +
                    `Wider sections indicate where values are more common. ` +
                    `A box plot is overlaid inside showing the median and middle 50% range.`,
                showDots: false, showMedian: false, showBox: true
            },
            {
                description: "Violin plot with dots",
                explanation: () => `A violin outline traces the full distribution shape as a smooth symmetric outline. ` +
                    `Wider sections indicate where values are more common. ` +
                    `Individual data values are shown as dots.`,
                showDots: true, showMedian: false
            },
            {
                description: "Violin plot with median",
                explanation: () => `A violin outline traces the full distribution shape as a smooth symmetric outline. ` +
                    `Wider sections indicate where values are more common. ` +
                    `A ${horizontalWord()} line shows the median value.`,
                showDots: false, showMedian: true
            },
        ]
    },
];

function binomialGroupParams(n0, p0, effect) {
    if (effect.type === "location") {
        const delta_p = effect.delta_sd * Math.sqrt(p0 * (1 - p0) / n0);
        return {n: n0, p: Math.min(0.99, Math.max(0.01, p0 + delta_p))};
    }
    if (effect.type === "scale") {
        return {n: Math.round(n0 * effect.scale_factor), p: p0};
    }
    if (effect.type === "params") {
        return {n: effect.n, p: effect.p};
    }
    return {n: n0, p: p0};  // null and unsupported types
}

function generateBasePanel(dist, seed, effect = {type: "null"}, effectGroup = 1) {
    const rng = mulberry32(seed);
    const N = N_PER_GROUP * 2;
    const y = new Array(N);
    const group = new Array(N);
    for (let i = 0; i < N; i++) group[i] = (i < N_PER_GROUP) ? 0 : 1;
    if (dist === "normal") {
        for (let i = 0; i < N; i++)
            y[i] = randomNormal(rng);
    }
    else if (dist === "lognormal") {
        const sigma = 0.5;
        for (let i = 0; i < N; i++)
            y[i] = Math.exp(sigma * randomNormal(rng));
    }
    else if (dist === "binomial") {
        const n0 = 10, p0 = 0.2;
        const mu = n0 * p0, sigma = Math.sqrt(n0 * p0 * (1 - p0));
        const g1 = binomialGroupParams(n0, p0, effect);
        for (let i = 0; i < N; i++) {
            const n = group[i] !== effectGroup ? n0 : g1.n;
            const p = group[i] !== effectGroup ? p0 : g1.p;
            let k = 0;
            for (let j = 0; j < n; j++) if (rng() < p) k++;
            y[i] = (k - mu) / sigma;
        }
    }
    else {
        throw new Error("Unknown dist: " + dist);
    }
    return {y, group};
}

// Convert the internal {y, group} parallel arrays into the finalized panel format used everywhere
// downstream: an array of per-group sorted value arrays. Sorting once here avoids repeated sorts
// in boxStats, dot placement, KDE bandwidth, etc.
function finalizePanel(y, group) {
    const nGroups = Math.max(...group) + 1;
    const groups = Array.from({length: nGroups}, () => []);
    for (let i = 0; i < y.length; i++) groups[group[i]].push(y[i]);
    for (const g of groups) g.sort((a, b) => a - b);
    return {groups};
}

// Auto-screen candidate seeds: reject if groups differ too much under null effect.
// extremes: max/min difference as a fraction of combined range (range-based; captures tail placement).
// meanD: Cohen's d for mean difference (distribution-agnostic; ~equivalent to Welch's t > 1.25, p < 0.21).
const SEED_THRESHOLDS = {
    normal:    { extremes: 0.30 }, // 3 rejections
    lognormal: { extremes: 0.40 }, // 13 rejections
};
const MEAN_D_THRESHOLD = 0.25; // reject if Cohen's d for group means exceeds this; 38 additional rejections

function isGoodSeed(seed) {
    for (const [dist, {extremes}] of Object.entries(SEED_THRESHOLDS)) {
        const panel = generateBasePanel(dist, seed, {type: "null"}, 0);
        const A = [], B = [];
        for (let i = 0; i < panel.y.length; i++)
            (panel.group[i] === 0 ? A : B).push(panel.y[i]);
        const yMin = Math.min(...panel.y), yMax = Math.max(...panel.y);
        const range = yMax - yMin || 1;
        if (Math.abs(Math.max(...A) - Math.max(...B)) / range > extremes) return false;
        if (Math.abs(Math.min(...A) - Math.min(...B)) / range > extremes) return false;
        const meanA = A.reduce((s, v) => s + v, 0) / A.length;
        const meanB = B.reduce((s, v) => s + v, 0) / B.length;
        const varA = A.reduce((s, v) => s + (v - meanA) ** 2, 0) / (A.length - 1);
        const varB = B.reduce((s, v) => s + (v - meanB) ** 2, 0) / (B.length - 1);
        const pooledSD = Math.sqrt((varA + varB) / 2) || 1;
        if (Math.abs(meanA - meanB) / pooledSD > MEAN_D_THRESHOLD) return false;
    }
    return true;
}

// Compute per-group descriptive statistics from a panel for recording alongside ratings.
function groupStats(panel) {
    // groups are pre-sorted by finalizePanel; no sort needed here.
    function stats(sorted) {
        const n = sorted.length;
        const mean = sorted.reduce((s, v) => s + v, 0) / n;
        const sd = Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
        return { mean, sd, min: sorted[0], q1: quantileSorted(sorted, 0.25), med: quantileSorted(sorted, 0.50), q3: quantileSorted(sorted, 0.75), max: sorted[n - 1] };
    }
    return { a: stats(panel.groups[0]), b: stats(panel.groups[1]) };
}

// Compute 100 seeds of the form i*10^5 (skipping multiples of 10), auto-screened.
const DATA_SEEDS = (() => {
    const seeds = [];
    let rejected = 0;
    for (let i = 101; seeds.length < 100; i++) {
        if (i % 10 === 0) continue;
        if (isGoodSeed(i * 100_000))
            seeds.push(i * 100_000);
        else rejected++;
    }
    if (SEEDREVIEW_DIST)
        console.log(`DATA_SEEDS: ${seeds.length} accepted, ${rejected} rejected (${(rejected / (rejected + seeds.length) * 100).toFixed(1)}% rejection rate).`);
    return seeds;
})();

/** ---------- Effect generators ---------- **/

function applyEffect(panel, dist, effect, rng, effectGroup = 1) {
    if (effect.type === "null") return panel;

    if (effect.type === "location") {
        if (dist !== "lognormal") {
            for (let i = 0; i < panel.y.length; i++)
                if (panel.group[i] === effectGroup) panel.y[i] += effect.delta_sd;
        }
        else {
            for (let i = 0; i < panel.y.length; i++)
                if (panel.group[i] === effectGroup) panel.y[i] *= effect.ratio;
        }
        return panel;
    }

    if (effect.type === "scale") {
        const k = effect.scale_factor;
        if (dist !== "lognormal") {
            for (let i = 0; i < panel.y.length; i++)
                if (panel.group[i] === effectGroup) panel.y[i] *= k;
        }
        else {
            // Power transform in log-space: exp(log(y)·k) = yᵏ, which scales log-normal σ by k.
            for (let i = 0; i < panel.y.length; i++)
                if (panel.group[i] === effectGroup) panel.y[i] = Math.exp(Math.log(panel.y[i]) * k);
        }
        return panel;
    }

    if (effect.type === "skew") {
        // Azzalini skew-normal (Azzalini 1985):
        //   Y = δ|Z₁| + √(1−δ²)·Z₂,  δ = α/√(1+α²)
        // Standardized to mean 0, variance 1 so scale matches the null group.
        const alpha = effect.alpha;
        const delta = alpha / Math.sqrt(1 + alpha * alpha);
        const mu = delta * Math.sqrt(2 / Math.PI);
        const sigma = Math.sqrt(1 - 2 * delta * delta / Math.PI);
        for (let i = 0; i < panel.y.length; i++) {
            if (panel.group[i] !== effectGroup) continue;
            const z1 = Math.abs(randomNormal(rng));
            const z2 = randomNormal(rng);
            panel.y[i] = (delta * z1 + Math.sqrt(1 - delta * delta) * z2 - mu) / sigma;
        }
        // Note: median-centering to reduce location confound was tried but not adopted —
        // the standardized parameterization already keeps the skew-normal at mean 0, variance 1.
        return panel;
    }

    if (effect.type === "bimodal") {
        // Compute min/max from reference (non-effect) group for re-standardization
        let refMin = Infinity, refMax = -Infinity;
        for (let i = 0; i < panel.y.length; i++) {
            if (panel.group[i] === effectGroup) continue;
            if (panel.y[i] < refMin) refMin = panel.y[i];
            if (panel.y[i] > refMax) refMax = panel.y[i];
        }
        const refSpan = (refMax - refMin) || 1;

        for (let i = 0; i < panel.y.length; i++) {
            if (panel.group[i] !== effectGroup) continue;
            const s = (rng() < 0.5 ? -0.5 : 0.5) * effect.separation;
            panel.y[i] = panel.y[i] + s;
        }

        // Re-standardize the effect group to the reference group's range so that large
        // separations don't push values far outside the shared y-axis scale.
        let egMin = Infinity, egMax = -Infinity;
        for (let i = 0; i < panel.y.length; i++) {
            if (panel.group[i] !== effectGroup) continue;
            if (panel.y[i] < egMin) egMin = panel.y[i];
            if (panel.y[i] > egMax) egMax = panel.y[i];
        }
        const egSpan = (egMax - egMin) || 1;
        for (let i = 0; i < panel.y.length; i++) {
            if (panel.group[i] !== effectGroup) continue;
            panel.y[i] = refMin + ((panel.y[i] - egMin) / egSpan) * refSpan;
        }

        return panel;
    }

    if (effect.type === "outlier") {
        const mag = effect.magnitude ?? 4.0;
        let hi = 0, lo = 0;
        for (let i = 0; i < panel.y.length; i++) {
            if (panel.group[i] !== effectGroup) continue;
            if (hi < effect.nHigh) panel.y[i] = mag + hi++ * 0.4;
            else if (lo < effect.nLow) panel.y[i] = -mag - lo++ * 0.4;
            else break;
        }
        return panel;
    }

    throw new Error("Unknown effect type: " + effect.type);
}

/** ---------- Design ---------- **/
function makeDesign({rng}) {
    // Select which chart types this participant sees and which variant(s) of each.
    // Both are fixed for the whole session (per-participant between-subjects factors).
    // N_VARIANT_TYPES = 1 picks one random variant per type (normal use);
    // set to Infinity (along with N_CHART_TYPES) to include all types and all variants.
    const catalogShuffled = CHART_TYPE_CATALOG.slice();
    shuffleInPlace(catalogShuffled, rng);
    const selectedChartTypes = [];
    for (const entry of catalogShuffled.slice(0, N_CHART_TYPES)) {
        const variantsShuffled = entry.variants.slice();
        shuffleInPlace(variantsShuffled, rng);
        for (const options of variantsShuffled.slice(0, N_VARIANT_TYPES)) {
            selectedChartTypes.push({type: entry.type, options});
        }
    }

    const distEffects = {
        normal: [
            {type: "null"},
            {type: "location", delta_sd: 0.4},
            {type: "location", delta_sd: 0.6},
            {type: "location", delta_sd: 0.8},
            {type: "location", delta_sd: 1.0},
            {type: "location", delta_sd: 1.2},
            {type: "location", delta_sd: 1.4},
            {type: "scale", scale_factor: 1.2},
            {type: "scale", scale_factor: 1.4},
            {type: "scale", scale_factor: 1.6},
            {type: "skew", alpha: 5},
            {type: "skew", alpha: 4},
            {type: "skew", alpha: -4},
            {type: "skew", alpha: -5},
            {type: "bimodal", separation: 4.0},
            {type: "bimodal", separation: 3.0},
            {type: "bimodal", separation: 2.0},
            {type: "outlier", nHigh: 2, nLow: 0, magnitude: 4.0},
            {type: "outlier", nHigh: 1, nLow: 0, magnitude: 4.0},
            {type: "outlier", nHigh: 0, nLow: 1, magnitude: 4.0},
        ],
        lognormal: [
            {type: "null"},
            {type: "location", ratio: 1.2},
            {type: "location", ratio: 1.3},
            {type: "location", ratio: 1.4},
            {type: "location", ratio: 1.5},
            {type: "location", ratio: 1.6},
            {type: "scale", scale_factor: 1.2},
            {type: "scale", scale_factor: 1.4},
            {type: "scale", scale_factor: 1.6},
            {type: "scale", scale_factor: 1.8},
        ],
        binomial: [
            {type: "null"},
            {type: "params", n: 10, p: 0.1},
            {type: "params", n: 10, p: 0.3},
            {type: "params", n: 10, p: 0.4},
            {type: "params", n: 5, p: 0.2},
        ],
    };

    const dists = Object.keys(distEffects);
    const conditions = [];

    // Assign data seeds per dist: draw the first nPerDist seeds from DATA_SEEDS (100 screened seeds
    // always exceeds the max slot count of 60), then shuffle for random assignment to conditions.
    const seedPools = {};
    for (const dist of dists) {
        const nPerDist = distReps[dist] * selectedChartTypes.length;
        const pool = Array.from({length: nPerDist}, (_, i) => DATA_SEEDS[i % DATA_SEEDS.length]);
        shuffleInPlace(pool, rng);
        seedPools[dist] = {pool, idx: 0};
    }

    for (const dist of dists) {
        const effects = distEffects[dist];
        for (let r = 0; r < distReps[dist]; r++) {
            for (const {type: chartType, options: chartOptions} of selectedChartTypes) {
                const e = effects[Math.floor(rng() * effects.length)];
                const dataSeed = seedPools[dist].pool[seedPools[dist].idx++];
                conditions.push({chartType, chartOptions, dist, effect: e, dataSeed});
            }
        }
    }

    // Assign effectGroup with exact 50/50 balance across all conditions
    const effectGroups = conditions.map((_, i) => i < Math.floor(conditions.length / 2) ? 0 : 1);
    shuffleInPlace(effectGroups, rng);
    conditions.forEach((c, i) => c.effectGroup = effectGroups[i]);

    shuffleInPlace(conditions, rng);
    const orientation = rng() < 0.5 ? "vertical" : "horizontal";
    const jitter = JITTER_CATALOG[Math.floor(rng() * JITTER_CATALOG.length)];
    return {conditions, selectedChartTypes, orientation, jitter, distEffects, distReps, dataSeeds: DATA_SEEDS};
}

/** ---------- Trial building ---------- **/
function buildTrial(trialIdx, cond) {
    const conditionId = `${cond.chartType}|${JSON.stringify(cond.chartOptions)}|${cond.dist}|${JSON.stringify(cond.effect)}|${cond.dataSeed}`;
    const trialSeed = hashStringToUint32(`${session.participantSeed}|${trialIdx}|${conditionId}`);
    const rng = mulberry32(trialSeed);

    const raw = generateBasePanel(cond.dist, cond.dataSeed, cond.effect, cond.effectGroup);
    // Binomial effects are baked into generateBasePanel via binomialGroupParams; all others are post-hoc.
    if (cond.dist !== "binomial") applyEffect(raw, cond.dist, cond.effect, rng, cond.effectGroup);

    const panel = finalizePanel(raw.y, raw.group);

    // Groups are sorted, so min/max are at the ends of each group array.
    let yMin = Infinity, yMax = -Infinity;
    for (const g of panel.groups) {
        if (g[0] < yMin) yMin = g[0];
        if (g[g.length - 1] > yMax) yMax = g[g.length - 1];
    }
    const span = (yMax - yMin) || 1;
    const pad = span * 0.12;

    return {
        trialIdx, trialSeed,
        condition: cond, panel,
        yMin: yMin - pad, yMax: yMax + pad
    };
}

/** ---------- View switching ---------- **/
const PAGES = () => [UI.introPage, UI.onboardingPage, UI.trialPage, UI.completionPage];
function showPage(page) { for (const p of PAGES()) p.style.display = p === page ? "block" : "none"; }

function showIntro()      { showPage(UI.introPage); }
function showOnboarding() { showPage(UI.onboardingPage); renderOnboardingStep(); }
function showTrial()      { showPage(UI.trialPage); }
function showCompletion() { showPage(UI.completionPage); }

/** ---------- Onboarding ---------- **/
function getOnboardingSteps() {
    const n = session.design.selectedChartTypes.length;
    // Sort chart-type training pages to match the order the participant will first encounter each type.
    const firstOccurrence = new Array(n).fill(Infinity);
    session.design.conditions.forEach((cond, trialIdx) => {
        const i = session.design.selectedChartTypes.findIndex(ct => ct.type === cond.chartType);
        if (i >= 0 && trialIdx < firstOccurrence[i]) firstOccurrence[i] = trialIdx;
    });
    const sortedIndices = Array.from({length: n}, (_, i) => i)
        .sort((a, b) => firstOccurrence[a] - firstOccurrence[b]);
    return [
        {type: "background"},
        {type: "sampling2"},
        {type: "sampling3"},
        {type: "chartTypeIntro"},
        ...sortedIndices.map(i => ({type: "chartType", index: i})),
        {type: "responseScale"},
    ];
}

// Fixed onboarding data — same for all participants.
let _onboardingPanels = null;

function getOnboardingPanels() {
    if (_onboardingPanels) return _onboardingPanels;
    const rng = mulberry32(0x4F4E4241); // fixed seed chosen so the similar/different training are true
    const N_SRC = 500;

    // Page 2: one source, three 50-point samples from the same distribution
    const src1 = Array.from({length: N_SRC}, () => randomNormal(rng));
    const s2a = Array.from({length: N_PER_GROUP}, () => randomNormal(rng));
    const s2b = Array.from({length: N_PER_GROUP}, () => randomNormal(rng));
    const s2c = Array.from({length: N_PER_GROUP}, () => randomNormal(rng));

    // Page 3: two different sources (source 2: mean +1.2, scale 0.65), one sample each
    const src3a = Array.from({length: N_SRC}, () => randomNormal(rng));
    const s3a = Array.from({length: N_PER_GROUP}, () => randomNormal(rng));
    const src3b = Array.from({length: N_SRC}, () => randomNormal(rng) * 0.65 + 1.2);
    const s3b = Array.from({length: N_PER_GROUP}, () => randomNormal(rng) * 0.65 + 1.2);

    const panel2 = finalizePanel(
        [...src1, ...s2a, ...s2b, ...s2c],
        [...src1.map(() => 0), ...s2a.map(() => 1), ...s2b.map(() => 2), ...s2c.map(() => 3)]
    );
    const panel3 = finalizePanel(
        [...src3a, ...s3a, ...src3b, ...s3b],
        [...src3a.map(() => 0), ...s3a.map(() => 1), ...src3b.map(() => 2), ...s3b.map(() => 3)]
    );
    _onboardingPanels = {panel2, panel3};
    return _onboardingPanels;
}

// Fixed lognormal example pairs for chart-type training, one per chart family.
const EXAMPLE_SEEDS = {box: 0xE0011, bands: 0xE0022, dot: 0xE0003, violin: 0xE0004};

function buildChartTypeExamplePanel(chartType) {
    const rng = mulberry32(EXAMPLE_SEEDS[chartType] ?? 0xE0001);
    const sigma = 0.5;
    const N = N_PER_GROUP * 2;
    const y = Array.from({length: N}, () => Math.exp(sigma * randomNormal(rng)));
    const group = Array.from({length: N}, (_, i) => i < N_PER_GROUP ? 0 : 1);
    return finalizePanel(y, group);
}

const WIDTH_2_UP = 350;
const HEIGHT_2_UP = 500;
const WIDTH_4_UP_TRAINING = 500;  // 4-panel sampling canvas (wider than the standard 2-up)
const HEIGHT_4_UP_TRAINING = 500; // same height as the standard 2-up

function renderSamplingCanvas(panel, labels) {
    const c = UI.onboardingCanvas;
    const horiz = currentOrientation() === "horizontal";
    c.width = horiz ? HEIGHT_4_UP_TRAINING : WIDTH_4_UP_TRAINING;
    c.height = horiz ? WIDTH_4_UP_TRAINING : HEIGHT_4_UP_TRAINING;
    c.style.maxWidth = c.width + "px";
    c.style.display = "block";
    let mn = Infinity, mx = -Infinity;
    for (const g of panel.groups) {
        if (g[0] < mn) mn = g[0];
        if (g[g.length - 1] > mx) mx = g[g.length - 1];
    }
    const span = (mx - mn) || 1;
    renderChart(c.getContext("2d"), c, "dot", panel,
        mn - span * 0.08, mx + span * 0.08,
        {groupLabels: labels, showMedian: false, violinScale: 120, padB: 80},
        currentOrientation(), "density random");
}

function renderChartTypeCanvas(ct) {
    const c = UI.onboardingCanvas;
    const horiz = currentOrientation() === "horizontal";
    c.width = horiz ? HEIGHT_2_UP : WIDTH_2_UP;
    c.height = horiz ? WIDTH_2_UP : HEIGHT_2_UP;
    c.style.maxWidth = c.width + "px";
    c.style.display = "block";
    const panel = buildChartTypeExamplePanel(ct.type);
    let mn = Infinity, mx = -Infinity;
    for (const g of panel.groups) {
        if (g[0] < mn) mn = g[0];
        if (g[g.length - 1] > mx) mx = g[g.length - 1];
    }
    const span = (mx - mn) || 1;
    renderChart(c.getContext("2d"), c, ct.type, panel,
        mn - span * 0.12, mx + span * 0.12,
        {violinScale: 7, ...ct.options}, currentOrientation(), session.design.jitter);
}

const SAMPLING_BLURB = `<p>The charts you'll be comparing are each made from
    <strong>50 data values sampled from a larger source</strong>.
    Two samples from the same source will look similar but not identical.
    Differences due to random chance are normal, and occasional stray values can appear by chance.</p>`;

// Look up the live catalog variant so explanation functions survive localStorage round-trips.
function getLiveCatalogOptions(ct) {
    const entry = CHART_TYPE_CATALOG.find(e => e.type === ct.type);
    return entry?.variants.find(v => v.description === ct.options.description) ?? ct.options;
}

function renderOnboardingStep() {
    const steps = getOnboardingSteps();
    const step = steps[session.onboardingStep];

    UI.onboardingCounter.textContent = `Step ${session.onboardingStep + 1} of ${steps.length}`;
    UI.onboardingText1.innerHTML = "";
    UI.onboardingText1.classList.remove("muted");
    UI.onboardingText2.innerHTML = "";
    UI.onboardingChartLabel.textContent = "";
    UI.onboardingCanvas.style.display = "none";
    UI.onboardingThumbnails.style.display = "none";
    UI.onboardingContinueBtn.disabled = false;

    // Reserve fixed heights within each section so the canvas and Continue button
    // stay at the same vertical position across pages within a section.
    const isChartTypeSection = step.type === "chartTypeIntro" || step.type === "chartType";
    const isSamplingSection  = step.type === "sampling2"      || step.type === "sampling3";
    const horiz = currentOrientation() === "horizontal";
    UI.onboardingText1.style.minHeight = isChartTypeSection ? "100px" : "";
    UI.onboardingText2.style.minHeight = isChartTypeSection ? "36px"
                                       : isSamplingSection  ? "100px" : "";
    UI.onboardingCanvasArea.style.minHeight = isChartTypeSection
        ? (horiz ? WIDTH_2_UP : HEIGHT_2_UP) + "px"
        : isSamplingSection
        ? (horiz ? WIDTH_4_UP_TRAINING : HEIGHT_2_UP) + "px" : "";

    if (step.type === "sampling2") {
        UI.onboardingTitle.textContent = "Understanding Sampling";
        UI.onboardingText1.innerHTML = SAMPLING_BLURB;
        UI.onboardingText1.classList.remove("muted");
        UI.onboardingText2.innerHTML =
            `<p class="ob-section-head">Same Source, Similar Samples</p>
            <p>Below is one source (500 values) and three random 50-value samples from it (A, B, C).
            The samples resemble the source and each other, but each looks slightly different.</p>`;
        const {panel2} = getOnboardingPanels();
        renderSamplingCanvas(panel2, ["Source", "A", "B", "C"]);

    }
    else if (step.type === "sampling3") {
        UI.onboardingTitle.textContent = "Understanding Sampling";
        UI.onboardingText1.innerHTML = SAMPLING_BLURB;
        UI.onboardingText1.classList.add("muted");
        UI.onboardingText2.innerHTML =
            `<p class="ob-section-head">Different Sources, Different Samples</p>
            <p>Below are two different sources, each with one random sample.
            Sources can differ in location or shape.
            Source 2 has higher values and less spread.
            Notice how samples A and B look different from each other.</p>`;
        const {panel3} = getOnboardingPanels();
        renderSamplingCanvas(panel3, ["Source 1", "A", "Source 2", "B"]);

    }
    else if (step.type === "chartTypeIntro") {
        const n = session.design.selectedChartTypes.length;
        UI.onboardingTitle.textContent = "Chart Types";
        UI.onboardingText1.innerHTML =
            `<p>Over the course of the study you'll see <strong>${n} chart ${n === 1 ? "type" : "types"}</strong>,
            briefly explained on the following pages.
            It's not important to remember every detail —
            each question will include a short reminder.</p>
            <p>Your task is always the same: judge whether two charts appear to come from different sources.</p>`;
        UI.onboardingThumbnails.style.display = "flex";
        renderChartTypeThumbs(UI.onboardingThumbnails.querySelectorAll(".onboardingThumb"));
    }
    else if (step.type === "chartType") {
        const ct = session.design.selectedChartTypes[step.index];
        const opts = getLiveCatalogOptions(ct);
        UI.onboardingTitle.textContent = `How to read: ${opts.description}`;
        const expl = typeof opts.explanation === "function" ? opts.explanation() : (opts.explanation ?? "");
        UI.onboardingText1.innerHTML = `<p>${expl}</p>`;
        UI.onboardingText2.innerHTML =
            `<p>Below is an example pair where both samples come from the same source.</p>`;
        renderChartTypeCanvas(ct);
        UI.onboardingChartLabel.textContent = opts.description;
    }
    else if (step.type === "responseScale") {
        const total = session.design.conditions.length;
        UI.onboardingTitle.textContent = "Your Task";
        UI.onboardingText1.innerHTML =
            `<p>For each of the <strong>${total} chart pairs</strong>, rate how much evidence
            they provide that groups A and B come from <strong>genuinely different sources</strong>.</p>
            <table class="ob-scale-table">
                <thead><tr><th>Rating</th><th>Meaning</th></tr></thead>
                <tbody>
                    <tr><td><strong>No<br/>evidence</strong></td><td>The charts look like they could easily come from the same source. Any visible difference is well within what random sampling alone would produce.</td></tr>
                    <tr><td><strong>Weak<br/>evidence</strong></td><td>There's a slight suggestion of a difference — maybe a small shift in center or spread — but it could plausibly be due to chance.</td></tr>
                    <tr><td><strong>Moderate<br/>evidence</strong></td><td>The charts look noticeably different in some way (center, spread, or shape), but there's still meaningful uncertainty about whether it's real.</td></tr>
                    <tr><td><strong>Strong<br/>evidence</strong></td><td>The charts look clearly different. It would be surprising if random sampling alone produced this much of a difference.</td></tr>
                </tbody>
            </table>
            <p>There are no right or wrong answers. Go with your first impression.</p>`;
    }
    else if (step.type === "background") {
        UI.onboardingTitle.textContent = "About You";
        UI.onboardingText1.innerHTML =
            `<p>Before we start, a few quick questions about your prior knowledge.</p>` +
            BG_SECTIONS.map(sec => `
            <p class="ob-section-head">${sec.heading}</p>
            <div class="bg-grid">
                ${sec.questions.map(q => `
                <div class="bg-row">
                    <span class="bg-term">${q.label}</span>
                    <div class="bg-options">
                        ${sec.options.map(o =>
                            `<button class="bg-btn" data-key="${q.key}" data-value="${o.value}">${o.label}</button>`
                        ).join("")}
                    </div>
                </div>`).join("")}
            </div>`).join("");
        // Restore any previously saved selections
        const bg = session.background ?? {};
        for (const [key, val] of Object.entries(bg)) {
            const btn = UI.onboardingText1.querySelector(`.bg-btn[data-key="${key}"][data-value="${val}"]`);
            if (btn) btn.classList.add("selected");
        }
        // Click handlers — save each selection immediately
        UI.onboardingText1.querySelectorAll(".bg-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const {key, value} = btn.dataset;
                UI.onboardingText1.querySelectorAll(`.bg-btn[data-key="${key}"]`)
                    .forEach(b => b.classList.remove("selected"));
                btn.classList.add("selected");
                if (!session.background) session.background = {};
                session.background[key] = parseInt(value);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
                updateBgContinueBtn();
            });
        });
        updateBgContinueBtn();
    }
}

function updateBgContinueBtn() {
    if (NOSUBMIT) return; // optional when not submitting
    const bg = session.background ?? {};
    UI.onboardingContinueBtn.disabled = !BG_QUESTIONS.every(q => bg[q.key] != null);
}

function advanceOnboarding() {
    session.onboardingStep = (session.onboardingStep ?? 0) + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    const steps = getOnboardingSteps();
    if (session.onboardingStep >= steps.length) {
        startStudy();
        return;
    }
    renderOnboardingStep();
}

/** ---------- Rendering ---------- **/
function currentOrientation() {
    const o = params.get("orientation");
    return (o === "horizontal" || o === "vertical") ? o : session.design.orientation;
}

function renderTrial(trial) {
    const orientation = currentOrientation();
    const horiz = orientation === "horizontal";
    UI.chart.width = horiz ? HEIGHT_2_UP : WIDTH_2_UP;
    UI.chart.height = horiz ? WIDTH_2_UP : HEIGHT_2_UP;
    UI.chart.style.maxWidth = UI.chart.width + "px";
    const ctx = UI.chart.getContext("2d");
    renderChart(ctx, UI.chart, trial.condition.chartType, trial.panel, trial.yMin, trial.yMax, trial.condition.chartOptions, orientation, session.design.jitter);

    UI.debug.textContent = JSON.stringify({
        trialIdx: trial.trialIdx,
        trialSeed: trial.trialSeed,
        condition: trial.condition
    }, null, 2);
}

function updateProgress() {
    const total = session.design ? session.design.conditions.length : 0;
    const done = session.results.length;
    const pct = total ? (done / total) : 0;
    UI.progFill.style.width = `${Math.min(100, Math.round(pct * 100))}%`;
    UI.trialCounter.textContent = total ? `Trial ${done + 1} of ${total}` : "";
}

/** ---------- Flow ---------- **/
function setRatingEnabled(enabled) {
    for (const b of UI.ratingBtns) b.disabled = !enabled;
}

function ensureDesign() {
    if (session.design) return;
    const rng = mulberry32((session.participantSeed ^ 0xA5A5A5A5) >>> 0);
    session.design = makeDesign({rng});
    const orientOverride = params.get("orientation");
    if (orientOverride === "horizontal" || orientOverride === "vertical")
        session.design.orientation = orientOverride;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function renderChartTypeThumbs(thumbs) {
    const steps = getOnboardingSteps();
    const chartSteps = steps.filter(s => s.type === "chartType");
    const thumbW = 140, thumbH = 200;
    chartSteps.forEach((step, i) => {
        if (i >= thumbs.length) return;
        const c = thumbs[i];
        c.width  = thumbW * 2;   // 2× for crisp rendering
        c.height = thumbH * 2;
        const ct = session.design.selectedChartTypes[step.index];
        const opts = getLiveCatalogOptions(ct);
        const panel = buildChartTypeExamplePanel(ct.type);
        let mn = Infinity, mx = -Infinity;
        for (const g of panel.groups) {
            if (g[0] < mn) mn = g[0];
            if (g[g.length - 1] > mx) mx = g[g.length - 1];
        }
        const span = (mx - mn) || 1;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, c.width, c.height);
        renderChart(ctx, c, ct.type, panel,
            mn - span * 0.12, mx + span * 0.12,
            { violinScale: 7, ...opts }, "vertical", session.design.jitter);
    });
}

function renderIntroThumbnails() {
    renderChartTypeThumbs(document.querySelectorAll(".introThumb"));
}

function beginSession() {
    if (!session.startedAtISO) {
        session.startedAtISO = new Date().toISOString();
        session.trialIndex = 0;
        session.results = [];
        session.onboardingStep = 0;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    }
    const steps = getOnboardingSteps();
    if ((session.onboardingStep ?? 0) < steps.length) {
        showOnboarding();
    }
    else {
        startStudy();
    }
}

function startStudy() {
    postSession(); // fires once; re-entries after onboarding resumption are silently rejected by the DB unique constraint on participant_id
    UI.downloadBtn.disabled = UI.downloadDesignBtn.disabled = false;
    showTrial();
    nextTrial();
}

function nextTrial() {
    const total = session.design.conditions.length;
    if (session.trialIndex >= total) {
        finishStudy();
        return;
    }
    const cond = session.design.conditions[session.trialIndex];
    currentTrial = buildTrial(session.trialIndex, cond);
    renderTrial(currentTrial);
    trialStartPerf = performance.now();
    UI.copyDataBtn.disabled = false;
    // disable buttons briefly to avoid accidental double/quick clicks
    setRatingEnabled(false);
    setTimeout(() => setRatingEnabled(true), RATING_DELAY_MS);
    // don't show initial hover in an effort to reduce anchoring on one's previous choice
    document.body.classList.add("inhibit-hover");
    document.addEventListener("mousemove",
        () => document.body.classList.remove("inhibit-hover"), {once: true});
    updateProgress();
    UI.chartDesc.textContent = cond.chartOptions.description ?? "";
    UI.finishedMsg.textContent = "";
}

function finishStudy() {
    session.finishedAtISO = new Date().toISOString();
    localStorage.removeItem(STORAGE_KEY);  // clear so next visitor starts fresh
    setRatingEnabled(false);
    showCompletion();
}

function postComment(text) {
    if (NOSUBMIT) return;
    fetch(`${SUPA_URL}/rest/v1/comments`, {
        method: "POST",
        headers: {
            "apikey": SUPA_KEY,
            "Authorization": `Bearer ${SUPA_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        },
        body: JSON.stringify({
            participant_id: session.participantId,
            comment: text,
            submitted_at: new Date().toISOString()
        })
    }).catch(() => {});
}

function recordResponse(rating) {
    const rtMs = Math.round(performance.now() - trialStartPerf);
    const isLast = currentTrial.trialIdx + 1 >= session.design.conditions.length;
    const finishedAt = isLast ? new Date().toISOString() : null;
    const stats = groupStats(currentTrial.panel);
    // participantId/Seed and startedAtISO are session-level; not duplicated here.
    session.results.push({
        trialIdx: currentTrial.trialIdx,
        trialSeed: currentTrial.trialSeed,
        condition: currentTrial.condition,
        rating,   // 1..4
        rtMs,
        viewport: {w: window.innerWidth, h: window.innerHeight},
        groupStats: stats
    });
    session.trialIndex = currentTrial.trialIdx + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    postResponse(currentTrial, rating, rtMs, finishedAt, stats);
    setRatingEnabled(false);
    nextTrial();
}

function downloadResults() {
    const payload = {
        meta: {
            app: "chart-perception-study",
            version: "2.0",
            createdAtISO: new Date().toISOString(),
            nPerGroup: N_PER_GROUP,
            scale: "1=No evidence, 2=Weak evidence, 3=Moderate evidence, 4=Strong evidence"
        },
        session: {
            participantId: session.participantId,
            participantSeed: session.participantSeed,
            startedAtISO: session.startedAtISO,
            finishedAtISO: session.finishedAtISO,
            background: session.background ?? null,
            design: session.design
        },
        results: session.results
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${session.participantId}-results.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function copyTrialData() {
    if (!currentTrial) return;
    const {groups} = currentTrial.panel;
    const rows = ["y,group"];
    const labels = groups.map((_, i) => String.fromCharCode(65 + i));
    for (let g = 0; g < groups.length; g++)
        for (const v of groups[g])
            rows.push(`${v},${labels[g]}`);
    navigator.clipboard.writeText(rows.join("\n"));
}

function downloadDesign() {
    const cols = ["participantId", "trialIdx", "orientation", "jitter", "chartType", "chartVariant", "dist", "effectType",
        "delta_sd", "ratio", "scale_factor", "alpha", "separation", "n", "p",
        "nHigh", "nLow", "magnitude", "dataSeed"];
    const rows = [cols.join(",")];
    session.design.conditions.forEach((c, i) => {
        const e = c.effect;
        rows.push([
            session.participantId, i, session.design.orientation, session.design.jitter, c.chartType, JSON.stringify(c.chartOptions ?? {}), c.dist, e.type,
            e.delta_sd ?? "", e.ratio ?? "", e.scale_factor ?? "",
            e.alpha ?? "", e.separation ?? "", e.n ?? "", e.p ?? "",
            e.nHigh ?? "", e.nLow ?? "", e.magnitude ?? "", c.dataSeed
        ].join(","));
    });
    const blob = new Blob([rows.join("\n")], {type: "text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${session.participantId}-design.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function resetSession() {
    localStorage.removeItem(STORAGE_KEY);
    session = loadOrCreateSession();
    currentTrial = null;
    trialStartPerf = null;
    _onboardingPanels = null;
    UI.downloadBtn.disabled = UI.downloadDesignBtn.disabled = UI.copyDataBtn.disabled = true;
    setRatingEnabled(false);
    const ctx = UI.chart.getContext("2d");
    ctx.clearRect(0, 0, UI.chart.width, UI.chart.height);
    UI.debug.textContent = "";
    UI.finishedMsg.textContent = "";
    UI.commentField.value = "";
    UI.commentField.disabled = false;
    UI.submitCommentBtn.disabled = false;
    UI.commentStatus.textContent = "";
    ensureDesign();
    showIntro();
    renderIntroThumbnails();
}

/** ---------- Wire up ---------- **/
UI.introStartBtn.addEventListener("click", beginSession);
UI.onboardingContinueBtn.addEventListener("click", advanceOnboarding);
UI.downloadBtn.addEventListener("click", downloadResults);
UI.downloadDesignBtn.addEventListener("click", downloadDesign);
UI.copyDataBtn.addEventListener("click", copyTrialData);
UI.resetBtn.addEventListener("click", resetSession);

UI.submitCommentBtn.addEventListener("click", () => {
    const text = UI.commentField.value.trim().slice(0, 2000);
    if (!text) { UI.commentStatus.textContent = "Please enter a comment first."; return; }
    postComment(text);
    UI.submitCommentBtn.disabled = true;
    UI.commentField.disabled = true;
    UI.commentStatus.textContent = "Comment submitted — thank you!";
});
UI.completionDownloadBtn.addEventListener("click", downloadResults);
UI.completionDownloadDesignBtn.addEventListener("click", downloadDesign);
UI.completionResetBtn.addEventListener("click", resetSession);

for (const b of UI.ratingBtns) {
    b.addEventListener("click", () => recordResponse(parseInt(b.dataset.rating, 10)));
}

// Hide diagnostic controls unless ?diagnostics=true or seed review mode
if (params.get("diagnostics") !== "true" && !SEEDREVIEW_DIST) {
    for (const id of ["trialFooter", "debugDetails", "completionActions"]) {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    }
}

if (SEEDREVIEW_DIST) {
    // Seed review mode: one trial per DATA_SEED in order, fixed distribution, null effect, dot plot
    localStorage.removeItem(STORAGE_KEY);
    const dotOptions = CHART_TYPE_CATALOG.find(e => e.type === "dot").variants[0];
    session = {
        participantId: "seed-review",
        participantSeed: 0,
        startedAtISO: new Date().toISOString(),
        trialIndex: 0,
        results: [],
        design: {
            conditions: DATA_SEEDS.map(seed => ({
                chartType: "dot", chartOptions: dotOptions,
                dist: SEEDREVIEW_DIST, effect: {type: "null"},
                dataSeed: seed, effectGroup: 0,
            })),
            selectedChartTypes: [{type: "dot", options: dotOptions}],
            orientation: "vertical", jitter: "wilkinson",
            distEffects: {}, distReps: {}, dataSeeds: DATA_SEEDS,
        },
    };
    UI.downloadBtn.disabled = UI.downloadDesignBtn.disabled = false;
    showTrial();
    nextTrial();
}
// Resume from wherever the participant left off
else if (!session.startedAtISO) {
    ensureDesign();
    showIntro();
    renderIntroThumbnails();
}
else {
    const steps = getOnboardingSteps();
    const onbStep = session.onboardingStep ?? steps.length; // old sessions skip onboarding
    if (onbStep < steps.length) {
        showOnboarding();
    }
    else if (session.trialIndex < session.design.conditions.length) {
        UI.downloadBtn.disabled = UI.downloadDesignBtn.disabled = false;
        showTrial();
        nextTrial();
    }
    else {
        finishStudy();
    }
}