// app.js

import {renderChart, quantileSorted} from "./renderers.js";
import {mulberry32, hashStringToUint32, randomNormal, shuffleInPlace, normalToSkewNormal} from "./utils.js";
import {N_PER_GROUP, STORAGE_KEY, RATING_DELAY_MS, JITTER_CATALOG,
    DIST_REPS, DIST_REPS_TESTING, SEED_THRESHOLDS, MEAN_D_THRESHOLD} from "./config.js";
import {buildCatalog} from "./catalog.js";
import {loadOrCreateSession, postResponse, postSession, postComment} from "./database.js";
import {BG_QUESTIONS, yourTaskHTML, backgroundHTML, RATING_SCALE, TRIAL_QUESTION} from "./question.js";

/** ---------- Config ---------- **/
const DEFAULT_TESTING = false;
const params = new URLSearchParams(window.location.search);
const TESTING = params.has("test")
    ? params.get("test") !== "false"
    : DEFAULT_TESTING;
const SEEDREVIEW_DIST = params.get("seedreview"); // e.g. ?seedreview=lognormal
const SKEWPREVIEW = params.has("skewpreview");
const NOSUBMIT = params.has("nosubmit") || !!SEEDREVIEW_DIST || SKEWPREVIEW;

// Prolific appends these in uppercase; accept either case for local testing.
const PROLIFIC_PID        = params.get("PROLIFIC_PID")  ?? params.get("prolific_pid");
const PROLIFIC_STUDY_ID   = params.get("STUDY_ID")      ?? params.get("study_id");
const PROLIFIC_SESSION_ID = params.get("SESSION_ID")    ?? params.get("session_id");
// Completion code is base64-encoded in the survey URL (?cc=...) so it isn't immediately
// readable to participants. Encode once with btoa("YOUR_CODE") when setting up the study URL.
const COMPLETION_CODE = (() => {
    const raw = params.get("pg");
    if (!raw) return null;
    try { return atob(raw); } catch { return raw; }
})();

const N_CHART_TYPES = TESTING ? Infinity : 4;
const N_VARIANT_TYPES = TESTING ? Infinity : 1;
const distReps = TESTING ? DIST_REPS_TESTING : DIST_REPS;

/** ---------- Session storage ---------- **/

let session = loadOrCreateSession();

// Persist Prolific PID on the session if present (survives page refresh).
if (PROLIFIC_PID && !session.prolificPid) {
    session.prolificPid = PROLIFIC_PID;
    session.prolificStudyId = PROLIFIC_STUDY_ID;
    session.prolificSessionId = PROLIFIC_SESSION_ID;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

/** ---------- UI ---------- **/

// Populate trial question and rating buttons from question.js so all text lives in one place.
document.getElementById("trialQuestion").textContent = TRIAL_QUESTION;
const ratingRow = document.querySelector(".rating-row");
RATING_SCALE.forEach((r, i) => {
    const btn = document.createElement("button");
    btn.className = "ratingBtn";
    btn.dataset.rating = String(i + 1);
    btn.disabled = true;
    const [word1, ...rest] = r.label.split(" ");
    const fullLabel = rest.length
        ? `${word1}<br/><span class="label-dim">${rest.join(" ")}</span>`
        : word1;
    btn.innerHTML = `<span class="label label-full">${fullLabel}</span><span class="label label-short">${r.shortLabel}</span>`;
    ratingRow.appendChild(btn);
});

const UI = {
    introPage: document.getElementById("introPage"),
    onboardingPage: document.getElementById("onboardingPage"),
    onboardingTitle: document.getElementById("onboardingTitle"),
    onboardingCounter: document.getElementById("onboardingCounter"),
    onboardingText: document.getElementById("onboardingText"),
    onboardingCanvasArea: document.getElementById("onboardingCanvasArea"),
    onboardingCanvas: document.getElementById("onboardingCanvas"),
    onboardingThumbnails: document.getElementById("onboardingThumbnails"),
    onboardingChartLabel: document.getElementById("onboardingChartLabel"),
    onboardingBackBtn:     document.getElementById("onboardingBackBtn"),
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

// DATA_SEEDS is computed after generateBasePanel (defined below)

// Each entry lists display variants for that chart type.
// At design time, N_CHART_TYPES types are chosen per participant (seeded shuffle),
// and one variant is picked per type — both are between-subjects factors.
// explanation must be a function (called at render time) so orientation words resolve correctly.
// Built after currentOrientation is defined (see below).
let CHART_TYPE_CATALOG;

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
    for (let i = 0; i < N; i++)
        group[i] = (i < N_PER_GROUP) ? 0 : 1;
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
            for (let j = 0; j < n; j++)
                if (rng() < p)
                    k++;
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
    for (let i = 0; i < y.length; i++)
        groups[group[i]].push(y[i]);
    for (const g of groups)
        g.sort((a, b) => a - b);
    return {groups};
}

// Auto-screen candidate seeds: reject if groups differ too much under null effect.
// extremes: max/min difference as a fraction of combined range (range-based; captures tail placement).
// meanD: Cohen's d for mean difference (distribution-agnostic; ~equivalent to Welch's t > 1.25, p < 0.21).
function isGoodSeed(seed) {
    for (const [dist, {extremes}] of Object.entries(SEED_THRESHOLDS)) {
        if (distReps[dist] === 0)
            continue;
        const panel = generateBasePanel(dist, seed, {type: "null"}, 0);
        const A = [], B = [];
        for (let i = 0; i < panel.y.length; i++)
            (panel.group[i] === 0 ? A : B).push(panel.y[i]);
        const yMin = Math.min(...panel.y), yMax = Math.max(...panel.y);
        const range = yMax - yMin || 1;
        if (Math.abs(Math.max(...A) - Math.max(...B)) / range > extremes)
            return false;
        if (Math.abs(Math.min(...A) - Math.min(...B)) / range > extremes)
            return false;
        const meanA = A.reduce((s, v) => s + v, 0) / A.length;
        const meanB = B.reduce((s, v) => s + v, 0) / B.length;
        const varA = A.reduce((s, v) => s + (v - meanA) ** 2, 0) / (A.length - 1);
        const varB = B.reduce((s, v) => s + (v - meanB) ** 2, 0) / (B.length - 1);
        const pooledSD = Math.sqrt((varA + varB) / 2) || 1;
        if (Math.abs(meanA - meanB) / pooledSD > MEAN_D_THRESHOLD)
            return false;
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
        if (i % 10 === 0)
            continue;
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
    if (effect.type === "null")
        return panel;

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
        // Probability integral transform: map each existing z ~ N(0,1) to the same quantile
        // in SN(alpha), then standardize to mean 0.
        // This is a deterministic transform of the base data — no new RNG draws needed.
        const alpha = effect.alpha;
        const delta = alpha / Math.sqrt(1 + alpha * alpha);
        const mu    = delta * Math.sqrt(2 / Math.PI);
        // const sigma = Math.sqrt(1 - 2 * delta * delta / Math.PI);
        for (let i = 0; i < panel.y.length; i++) {
            if (panel.group[i] !== effectGroup) continue;
            panel.y[i] = (normalToSkewNormal(panel.y[i], alpha) - mu);
        }
        return panel;
    }

    if (effect.type === "bimodal") {
        // Shift each point in the effect group to one of two modes at ±separation/2.
        for (let i = 0; i < panel.y.length; i++) {
            if (panel.group[i] !== effectGroup) continue;
            panel.y[i] = panel.y[i] + (rng() < 0.5 ? -0.5 : 0.5) * effect.separation;
        }

        // Cap range growth: if the effect group spans more than BIMODAL_MAX_SPAN_RATIO times
        // the reference group's range, scale it down around its center. This limits how much
        // participants can use the wider y-axis as a detection cue, while preserving the shape.
        const BIMODAL_MAX_SPAN_RATIO = 1.2;
        let refMin = Infinity, refMax = -Infinity, egMin = Infinity, egMax = -Infinity;
        for (let i = 0; i < panel.y.length; i++) {
            const y = panel.y[i];
            if (panel.group[i] === effectGroup) {
                if (y < egMin) egMin = y;
                if (y > egMax) egMax = y;
            }
            else {
                if (y < refMin) refMin = y;
                if (y > refMax) refMax = y;
            }
        }
        const refSpan = (refMax - refMin) || 1;
        const egSpan  = (egMax  - egMin)  || 1;
        const maxSpan = refSpan * BIMODAL_MAX_SPAN_RATIO;
        if (egSpan > maxSpan) {
            const scale = maxSpan / egSpan;
            const egCenter = (egMin + egMax) / 2;
            for (let i = 0; i < panel.y.length; i++) {
                if (panel.group[i] !== effectGroup) continue;
                panel.y[i] = egCenter + (panel.y[i] - egCenter) * scale;
            }
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

// Build a pool of nTrials effects drawn with probability proportional to weight.
// Effects with weight=0 are excluded. Counts are assigned via the largest-remainder
// method so they sum exactly to nTrials. The pool is then shuffled.
function makeWeightedEffectPool(effects, nTrials, rng) {
    const active = effects.filter(e => (e.weight ?? 10) > 0);
    const totalWeight = active.reduce((s, e) => s + (e.weight ?? 10), 0);
    const floats  = active.map(e => (e.weight ?? 10) / totalWeight * nTrials);
    const counts  = floats.map(f => Math.floor(f));
    let remaining = nTrials - counts.reduce((a, b) => a + b, 0);
    const order   = floats.map((f, i) => i).sort((a, b) => (floats[b] - counts[b]) - (floats[a] - counts[a]));
    for (let i = 0; i < remaining; i++)
        counts[order[i]]++;
    const pool = [];
    for (let i = 0; i < active.length; i++)
        for (let j = 0; j < counts[i]; j++)
            pool.push(active[i]);
    shuffleInPlace(pool, rng);
    return pool;
}

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
            {type: "null",    level: "null",     weight: 12},
            {type: "location", delta_sd: 0.5, level: "weak",     weight: 5},
            {type: "location", delta_sd: 0.8, level: "moderate", weight: 10},
            {type: "location", delta_sd: 1.1, level: "strong",   weight: 10},
            {type: "location", delta_sd: 1.4, level: "strong",   weight: 5},
            {type: "scale", scale_factor: 1.2, level: "weak",     weight: 5},
            {type: "scale", scale_factor: 1.5, level: "moderate", weight: 10},
            {type: "scale", scale_factor: 1.8, level: "strong",   weight: 5},
            {type: "skew", alpha:  7, level: "strong",   weight: 5},
            {type: "skew", alpha:  5, level: "moderate", weight: 5},
            {type: "skew", alpha:  3, level: "weak",     weight: 0},
            {type: "skew", alpha: -3, level: "weak",     weight: 0},
            {type: "skew", alpha: -5, level: "moderate", weight: 0},
            {type: "bimodal", separation: 5.0, level: "strong",   weight: 2},
            {type: "bimodal", separation: 4.0, level: "strong",   weight: 8},
            {type: "bimodal", separation: 3.0, level: "moderate", weight: 8},
            {type: "bimodal", separation: 2.0, level: "weak",     weight: 8},
            {type: "outlier", nHigh: 2, nLow: 0, magnitude: 4.0, level: "moderate", weight: 0},
            {type: "outlier", nHigh: 1, nLow: 0, magnitude: 4.0, level: "weak",     weight: 5},
            {type: "outlier", nHigh: 0, nLow: 1, magnitude: 4.0, level: "weak",     weight: 0},
        ],
        lognormal: [
            {type: "null",    level: "null",     weight: 10},
            {type: "location", ratio: 1.2, level: "weak",     weight: 10},
            {type: "location", ratio: 1.3, level: "weak",     weight: 10},
            {type: "location", ratio: 1.4, level: "moderate", weight: 10},
            {type: "location", ratio: 1.5, level: "moderate", weight: 10},
            {type: "location", ratio: 1.6, level: "strong",   weight: 10},
            {type: "scale", scale_factor: 1.2, level: "weak",     weight: 10},
            {type: "scale", scale_factor: 1.4, level: "moderate", weight: 10},
            {type: "scale", scale_factor: 1.6, level: "moderate", weight: 10},
            {type: "scale", scale_factor: 1.8, level: "strong",   weight: 10},
        ],
        binomial: [
            {type: "null",   level: "null",     weight: 10},
            {type: "params", n: 10, p: 0.1, level: "moderate", weight: 10},
            {type: "params", n: 10, p: 0.3, level: "weak",     weight: 10},
            {type: "params", n: 10, p: 0.4, level: "strong",   weight: 10},
            {type: "params", n:  5, p: 0.2, level: "weak",     weight: 10},
        ],
    };

    const dists = Object.keys(distEffects);
    const conditions = [];

    // Build per-distribution seed and effect pools, then assign one condition per slot.
    const seedPools = {}, effectPools = {}, poolIdxs = {};
    for (const dist of dists) {
        const nPerDist = distReps[dist] * selectedChartTypes.length;
        const seeds = Array.from({length: nPerDist}, (_, i) => DATA_SEEDS[i % DATA_SEEDS.length]);
        shuffleInPlace(seeds, rng);
        seedPools[dist] = seeds;
        effectPools[dist] = makeWeightedEffectPool(distEffects[dist], nPerDist, rng);
        poolIdxs[dist] = 0;
    }

    for (const dist of dists) {
        for (let r = 0; r < distReps[dist]; r++) {
            for (const {type: chartType, options: chartOptions} of selectedChartTypes) {
                const idx = poolIdxs[dist]++;
                const e = effectPools[dist][idx];
                const dataSeed = seedPools[dist][idx];
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
    if (cond.dist !== "binomial")
        applyEffect(raw, cond.dist, cond.effect, rng, cond.effectGroup);

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
        {type: "sampling1"},
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
    if (_onboardingPanels)
        return _onboardingPanels;
    const rng = mulberry32(0x4F4E4243); // fixed seed chosen so the similar/different training are true
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

    const panel1 = finalizePanel(
        [...src1, ...s2a],
        [...src1.map(() => 0), ...s2a.map(() => 1)]
    );
    const panel2 = finalizePanel(
        [...src1, ...s2a, ...s2b, ...s2c],
        [...src1.map(() => 0), ...s2a.map(() => 1), ...s2b.map(() => 2), ...s2c.map(() => 3)]
    );
    const panel3 = finalizePanel(
        [...src3a, ...s3a, ...src3b, ...s3b],
        [...src3a.map(() => 0), ...s3a.map(() => 1), ...src3b.map(() => 2), ...s3b.map(() => 3)]
    );
    _onboardingPanels = {panel1, panel2, panel3};
    return _onboardingPanels;
}

// Fixed lognormal example pairs for chart-type training, one per chart family.
const EXAMPLE_SEEDS = {box: 0xE0011, bands: 0xE0022, dot: 0xE0003, violin: 0xE0004};

function buildChartTypeExamplePanel(chartType) {
    const rng = mulberry32(EXAMPLE_SEEDS[chartType] ?? 0xE0001);
    const N = N_PER_GROUP * 2;
    const y = distReps.lognormal > 0
        ? Array.from({length: N}, () => Math.exp(0.5 * randomNormal(rng)))  // lognormal
        : Array.from({length: N}, () => randomNormal(rng));                  // normal
    const group = Array.from({length: N}, (_, i) => i < N_PER_GROUP ? 0 : 1);
    return finalizePanel(y, group);
}

const WIDTH_2_UP = 350;
const HEIGHT_2_UP = 500;
const WIDTH_4_UP_TRAINING = 500;  // 4-panel sampling canvas (wider than the standard 2-up)
const HEIGHT_4_UP_TRAINING = 500; // same height as the standard 2-up

const MIN_ONBOARDING_CANVAS_HEIGHT = 200;
const ONBOARDING_CHROME_HEIGHT = 350; // approx px reserved for title, counter, text, nav, padding

// Returns the max pixel height the onboarding canvas should display at, to fit in the viewport.
function onboardingCanvasMaxHeight() {
    return Math.max(MIN_ONBOARDING_CANVAS_HEIGHT, window.innerHeight - ONBOARDING_CHROME_HEIGHT);
}

function renderSamplingCanvas(panel, labels) {
    const c = UI.onboardingCanvas;
    const horiz = currentOrientation() === "horizontal";
    c.width = horiz ? HEIGHT_4_UP_TRAINING : WIDTH_4_UP_TRAINING;
    c.height = horiz ? WIDTH_4_UP_TRAINING : HEIGHT_4_UP_TRAINING;
    c.style.maxHeight = onboardingCanvasMaxHeight() + "px";
    c.style.maxWidth = "100%";
    c.style.width = "auto";
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
    c.style.maxHeight = onboardingCanvasMaxHeight() + "px";
    c.style.maxWidth = "100%";
    c.style.width = "auto";
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

// Look up the live catalog variant so explanation functions survive localStorage round-trips.
function getLiveCatalogOptions(ct) {
    const entry = CHART_TYPE_CATALOG.find(e => e.type === ct.type);
    return entry?.variants.find(v => v.description === ct.options.description) ?? ct.options;
}

function renderOnboardingStep() {
    const steps = getOnboardingSteps();
    const step = steps[session.onboardingStep];

    UI.onboardingCounter.textContent = `Step ${session.onboardingStep + 1} of ${steps.length}`;
    UI.onboardingText.innerHTML = "";
    UI.onboardingChartLabel.textContent = "";
    UI.onboardingCanvas.style.display = "none";
    UI.onboardingThumbnails.style.display = "none";
    UI.onboardingContinueBtn.disabled = false;
    UI.onboardingBackBtn.style.visibility = session.onboardingStep > 0 ? "visible" : "hidden";

    // Reserve fixed heights within each section so the canvas and Continue button
    // stay at the same vertical position across pages within a section.
    const isChartTypeSection = step.type === "chartTypeIntro" || step.type === "chartType";
    const isSamplingSection  = step.type === "sampling1" || step.type === "sampling2" || step.type === "sampling3";
    const horiz = currentOrientation() === "horizontal";
    UI.onboardingText.style.minHeight = isChartTypeSection ? "150px" : isSamplingSection ? "150px" : "";
    const naturalCanvasH = isChartTypeSection ? (horiz ? WIDTH_2_UP : HEIGHT_2_UP)
        : isSamplingSection ? (horiz ? WIDTH_4_UP_TRAINING : HEIGHT_4_UP_TRAINING) : 0;
    UI.onboardingCanvasArea.style.minHeight = naturalCanvasH
        ? Math.min(naturalCanvasH, onboardingCanvasMaxHeight()) + "px" : "";
    UI.onboardingCanvasArea.style.display        = step.type === "chartTypeIntro" ? "flex" : "";
    UI.onboardingCanvasArea.style.flexDirection  = step.type === "chartTypeIntro" ? "column" : "";
    UI.onboardingCanvasArea.style.justifyContent = step.type === "chartTypeIntro" ? "center" : "";

    if (step.type === "sampling1") {
        UI.onboardingTitle.textContent = "Understanding Sampling";
        UI.onboardingText.innerHTML =
            `<p>The charts you'll be comparing are each made from
            <strong>50 data values sampled from a larger source</strong>.</p>
            <p>Below is one source (500 values) and one random 50-value sample from it.</p>`;
        const {panel1} = getOnboardingPanels();
        renderSamplingCanvas(panel1, ["Source", "Sample"]);

    }
    else if (step.type === "sampling2") {
        UI.onboardingTitle.textContent = "Same Source, Similar Samples";
        UI.onboardingText.innerHTML =
            `<p>Two samples from the same source will look similar but not identical.</p>
            <p>Below is one source and three random 50-value samples from it (A, B, C).
            The samples resemble the source and each other, but each looks slightly different.</p>`;
        const {panel2} = getOnboardingPanels();
        renderSamplingCanvas(panel2, ["Source", "A", "B", "C"]);

    }
    else if (step.type === "sampling3") {
        UI.onboardingTitle.textContent = "Different Sources, Different Samples";
        UI.onboardingText.innerHTML =
            `<p>Below are two different sources, each with one random sample.
            Sources can differ in location, spread, or shape.
            Source 2 has higher values and less spread.
            Notice how samples A and B also look different from each other.</p>`;
        const {panel3} = getOnboardingPanels();
        renderSamplingCanvas(panel3, ["Source 1", "A", "Source 2", "B"]);

    }
    else if (step.type === "chartTypeIntro") {
        const n = session.design.selectedChartTypes.length;
        UI.onboardingTitle.textContent = "Chart Types";
        UI.onboardingText.innerHTML =
            `<p>Over the course of the study you'll see <strong>${n} chart ${n === 1 ? "type" : "types"}</strong>,
            briefly explained on the following pages.
            It's not important to remember every detail —
            each page will include a short reminder above the chart.</p>
            <p>Your task is always the same: judge whether two charts appear to come from different sources.</p>`;
        UI.onboardingThumbnails.style.display = "flex";
        renderChartTypeThumbs(UI.onboardingThumbnails.querySelectorAll(".onboardingThumb"));
    }
    else if (step.type === "chartType") {
        const ct = session.design.selectedChartTypes[step.index];
        const opts = getLiveCatalogOptions(ct);
        UI.onboardingTitle.textContent = `How to read: ${opts.description}`;
        const expl = typeof opts.explanation === "function" ? opts.explanation() : (opts.explanation ?? "");
        UI.onboardingText.innerHTML =
            `<p>${expl}</p>
            <p>Below is an example pair where both samples come from the same source.</p>`;
        renderChartTypeCanvas(ct);
        UI.onboardingChartLabel.textContent = opts.description;
    }
    else if (step.type === "responseScale") {
        const total = session.design.conditions.length;
        UI.onboardingTitle.textContent = "Your Task";
        UI.onboardingText.innerHTML = yourTaskHTML(total);
    }
    else if (step.type === "background") {
        UI.onboardingTitle.textContent = "About You";
        UI.onboardingText.innerHTML = backgroundHTML();
        // Restore any previously saved selections
        const bg = session.background ?? {};
        for (const [key, val] of Object.entries(bg)) {
            const btn = UI.onboardingText.querySelector(`.bg-btn[data-key="${key}"][data-value="${val}"]`);
            if (btn) btn.classList.add("selected");
        }
        // Click handlers — save each selection immediately
        UI.onboardingText.querySelectorAll(".bg-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const {key, value} = btn.dataset;
                UI.onboardingText.querySelectorAll(`.bg-btn[data-key="${key}"]`)
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
    if (NOSUBMIT)
        return; // optional when not submitting
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
    if (window.innerWidth <= 480) return "vertical";
    const o = params.get("orientation");
    return (o === "horizontal" || o === "vertical") ? o : session.design.orientation;
}
CHART_TYPE_CATALOG = buildCatalog(currentOrientation, () => session);

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
    for (const b of UI.ratingBtns)
        b.disabled = !enabled;
}

function ensureDesign() {
    if (session.design)
        return;
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
    postSession(session, params.get("group") ?? COMPLETION_CODE, NOSUBMIT); // fires once; re-entries after onboarding resumption are silently rejected by the DB unique constraint on participant_id
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

function computeRatingStats() {
    const buckets = {null: [], weak: [], moderate: [], strong: []};
    const EXPECTED = {null: 1, weak: 2, moderate: 3, strong: 4};
    const POINTS    = [1, 0.9, 0.2, 0]; // indexed by distance 0,1,2,3
    let totalPoints = 0, totalTrials = 0;

    for (const r of session.results) {
        const level = r.condition.effect.level;
        if (level in buckets) {
            buckets[level].push(r.rating);
            const dist = Math.abs(r.rating - EXPECTED[level]);
            totalPoints += POINTS[Math.min(dist, 3)];
            totalTrials++;
        }
    }
    const avg = arr => arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length;
    const byLevel = Object.fromEntries(
        Object.entries(buckets).map(([k, arr]) => [k, {mean: avg(arr), n: arr.length}])
    );
    byLevel.alignmentScore = totalTrials > 0 ? totalPoints / totalTrials : null;
    return byLevel;
}

function finishStudy() {
    session.finishedAtISO = new Date().toISOString();
    const ratingStats = computeRatingStats();
    localStorage.removeItem(STORAGE_KEY);  // clear so next visitor starts fresh
    setRatingEnabled(false);
    showCompletion();
    const statsEl = document.getElementById("ratingStats");
    const [s1, s2, s3, s4] = RATING_SCALE;
    const LEVELS = [
        {key: "null",     label: s1.shortLabel},
        {key: "weak",     label: s2.shortLabel},
        {key: "moderate", label: s3.shortLabel},
        {key: "strong",   label: s4.shortLabel},
    ];
    const rows = LEVELS.map(({key, label}) => {
        const s = ratingStats[key];
        const avg = s.n > 0 ? s.mean.toFixed(1) : "--";
        return `<tr><td>${label}</td><td>${avg}</td><td>${s.n}</td></tr>`;
    }).join("");
    const scorePct = ratingStats.alignmentScore !== null
        ? Math.round(ratingStats.alignmentScore * 100) + "%"
        : "--";
    statsEl.innerHTML =
        `<p>The study aims to evaluate the charts, not the participants, but if you're curious, here are your average responses on a 1–4 scale.</p>` +
        `<table class="rating-stats-table">` +
        `<thead><tr><th>Expected Surprise</th><th>Avg. response</th><th>Count</th></tr></thead>` +
        `<tbody>${rows}</tbody>` +
        `</table>` +
        `<p style="margin-top:12px;">Overall alignment score: <strong>${scorePct}</strong></p>`;
    statsEl.style.display = "block";
    if (PROLIFIC_PID && COMPLETION_CODE) {
        document.getElementById("completionCodeText").textContent = COMPLETION_CODE;
        document.getElementById("prolificCompletionCode").style.display = "block";
        document.getElementById("copyCodeBtn").addEventListener("click", () => {
            navigator.clipboard.writeText(COMPLETION_CODE).then(() => {
                document.getElementById("copyCodeBtn").textContent = "Copied!";
            });
        });
        const btn = document.getElementById("prolificReturnBtn");
        btn.href = `https://app.prolific.com/submissions/complete?cc=${encodeURIComponent(COMPLETION_CODE)}`;
        btn.style.display = "inline-block";
    }
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
    postResponse(session, currentTrial, rating, rtMs, finishedAt, stats, NOSUBMIT);
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
    if (!currentTrial)
        return;
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
UI.onboardingBackBtn.addEventListener("click", () => {
    if (session.onboardingStep > 0) {
        session.onboardingStep--;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        renderOnboardingStep();
    }
});
UI.downloadBtn.addEventListener("click", downloadResults);
UI.downloadDesignBtn.addEventListener("click", downloadDesign);
UI.copyDataBtn.addEventListener("click", copyTrialData);
UI.resetBtn.addEventListener("click", resetSession);

UI.submitCommentBtn.addEventListener("click", () => {
    const text = UI.commentField.value.trim().slice(0, 2000);
    if (!text) {
        UI.commentStatus.textContent = "Please enter a comment first.";
        return;
    }
    postComment(session, text, NOSUBMIT);
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
if (params.get("diagnostics") !== "true" && !SEEDREVIEW_DIST && !SKEWPREVIEW) {
    for (const id of ["trialFooter", "debugDetails", "completionActions"]) {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    }
}

/** ---------- Skew preview mode (?skewpreview) ---------- **/

function renderSkewPreview() {
    // Replace the entire body with a self-contained preview grid.
    // Shows null N(0,1) paired with normalized SN(alpha) for each alpha in the study.
    const ALPHAS = [-5, -4, -2, 2, 4, 5];
    const N = 500;
    const CHART_TYPES = ["violin", "box"];
    const rng = mulberry32(0xA1B2C3D4);

    // Generate null group once; reused as group A in every pair.
    const nullData = Array.from({length: N}, () => randomNormal(rng)).sort((a, b) => a - b);

    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0; padding:16px; background:var(--bg); color:var(--text); font-family:system-ui,sans-serif;";

    const title = document.createElement("h2");
    title.textContent = "Skew preview — null N(0,1) vs normalized SN(α)";
    title.style.cssText = "margin:0 0 16px; font-size:18px;";
    document.body.appendChild(title);

    for (const alpha of ALPHAS) {
        const delta = alpha / Math.sqrt(1 + alpha * alpha);
        const mu    = delta * Math.sqrt(2 / Math.PI);
        const sigma = Math.sqrt(1 - 2 * delta * delta / Math.PI);

        // Generate skewed group B, normalized to zero-mean unit-variance SN.
        // Seed per alpha: spread them out so each alpha gets an independent sequence.
        const skewSeed = (0xA1B2C3D4 + (alpha < 0 ? 0x10000 : 0) + Math.abs(alpha) * 0x1000) >>> 0;
        const skewedRng = mulberry32(skewSeed);
        const skewData = Array.from({length: N}, () => {
            const z = randomNormal(skewedRng);
            return (normalToSkewNormal(z, alpha) - mu);
        }).sort((a, b) => a - b);

        const panel = {groups: [nullData.slice(), skewData]};
        const allY = [...panel.groups[0], ...panel.groups[1]];
        const yMin = Math.min(...allY);
        const yMax = Math.max(...allY);
        const pad = (yMax - yMin) * 0.12;

        const section = document.createElement("div");
        section.style.cssText = "margin-bottom:24px;";

        const heading = document.createElement("p");
        heading.style.cssText = "margin:0 0 8px; font-size:16px; font-weight:600; color:var(--text);";
        heading.textContent = `α = ${alpha}  (delta=${delta.toFixed(3)}, mu=${mu.toFixed(3)}, sigma=${sigma.toFixed(3)})`;
        section.appendChild(heading);

        const row = document.createElement("div");
        row.style.cssText = "display:flex; gap:12px; flex-wrap:wrap;";

        for (const chartType of CHART_TYPES) {
            const wrap = document.createElement("div");
            wrap.style.cssText = "display:flex; flex-direction:column; align-items:center; gap:4px;";

            const label = document.createElement("span");
            label.style.cssText = "font-size:13px; color:var(--text-muted);";
            label.textContent = chartType;
            wrap.appendChild(label);

            const c = document.createElement("canvas");
            c.width = WIDTH_2_UP;
            c.height = HEIGHT_2_UP;
            c.style.cssText = "width:200px; height:auto; border:1px solid var(--border); border-radius:6px; background:#fff;";
            renderChart(c.getContext("2d"), c, chartType, panel, yMin - pad, yMax + pad, {showDots:false, maxHalfW:500}, "vertical", "wilkinson");
            wrap.appendChild(c);

            row.appendChild(wrap);
        }

        section.appendChild(row);
        document.body.appendChild(section);
    }
}

if (SKEWPREVIEW) {
    renderSkewPreview();
}
else if (SEEDREVIEW_DIST) {
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