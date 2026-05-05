// design.js — study design construction and signal application

import {shuffleInPlace} from "./utils.js";
import {JITTER_CATALOG, MIN_CATEGORY_TRIALS, MAX_VARIANT_TRIALS, N_DUPLICATE_SEEDS} from "./config.js";

// Build a pool of nTrials signals drawn with probability proportional to weight.
// Signals with weight=0 are excluded. Each entry gets floor(weight/total * nTrials) slots;
// remaining slots are filled by random sampling from a weight-proportional pool.
export function makeWeightedSignalPool(signals, nTrials, rng) {
    const active = signals.filter(e => (e.weight ?? 10) > 0);
    const totalWeight = active.reduce((s, e) => s + (e.weight ?? 10), 0);
    const floats  = active.map(e => (e.weight ?? 10) / totalWeight * nTrials);
    const counts  = floats.map(f => Math.floor(f));
    const pool = [];
    for (let i = 0; i < active.length; i++)
        for (let j = 0; j < counts[i]; j++)
            pool.push(active[i]);
    shuffleInPlace(pool, rng);
    let remaining = nTrials - pool.length;
    if (remaining > 0) {
        const extras = [];
        for (let i = 0; i < active.length; i++)
            for (let j = 0; j < active[i].weight; j++)
                extras.push(active[i]);
        shuffleInPlace(extras, rng);
        for (let i = 0; i < remaining; i++)
            pool.push(extras[i]);
    }
    return pool;
}

export function applySignal(panel, dist, signal, rng, signalGroup = 1) {
    if (signal.type === "null")
        return panel;

    if (signal.type === "location") {
        if (dist !== "lognormal") {
            for (let i = 0; i < panel.y.length; i++)
                if (panel.group[i] === signalGroup) panel.y[i] += signal.delta_sd;
        }
        else {
            for (let i = 0; i < panel.y.length; i++)
                if (panel.group[i] === signalGroup) panel.y[i] *= signal.ratio;
        }
        return panel;
    }

    if (signal.type === "spread") {
        const k = signal.spread_factor;
        if (dist !== "lognormal") {
            for (let i = 0; i < panel.y.length; i++)
                if (panel.group[i] === signalGroup) panel.y[i] *= k;
        }
        else {
            // Power transform in log-space: exp(log(y)·k) = yᵏ, which spreads log-normal σ by k.
            for (let i = 0; i < panel.y.length; i++)
                if (panel.group[i] === signalGroup) panel.y[i] = Math.exp(Math.log(panel.y[i]) * k);
        }
        return panel;
    }

    if (signal.type === "skew") {
        // Log-normal-like transform: sgn(s) * |s|^y where s is the base parameter and y
        // is the data value. For s > 0 this produces a right-skewed distribution (s^y is
        // log-normal when y ~ N(0,1)); negative s mirrors it for left skew.
        // Normalize empirically so mean=0, SD=1 leaving only the shape as the signal.
        const s = signal.base;
        const sign = Math.sign(s), absS = Math.abs(s);
        const indices = [], transformed = [];
        for (let i = 0; i < panel.y.length; i++) {
            if (panel.group[i] !== signalGroup) continue;
            indices.push(i);
            transformed.push(sign * Math.pow(absS, panel.y[i]));
        }
        const n = transformed.length;
        const mean = transformed.reduce((a, b) => a + b, 0) / n;
        const sd = Math.sqrt(transformed.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
        indices.forEach((idx, i) => {
            panel.y[idx] = sd > 0 ? (transformed[i] - mean) / sd : 0;
        });
        return panel;
    }

    if (signal.type === "bimodal") {
        // Shift each point in the signal group to one of two modes at ±separation/2.
        for (let i = 0; i < panel.y.length; i++) {
            if (panel.group[i] !== signalGroup) continue;
            panel.y[i] = panel.y[i] + (rng() < 0.5 ? -0.5 : 0.5) * signal.separation;
        }

        // Cap range growth: if the signal group spans more than BIMODAL_MAX_SPAN_RATIO times
        // the reference group's range, scale it down around its center. This limits how much
        // participants can use the wider y-axis as a detection cue, while preserving the shape.
        const BIMODAL_MAX_SPAN_RATIO = 1.2;
        let refMin = Infinity, refMax = -Infinity, egMin = Infinity, egMax = -Infinity;
        for (let i = 0; i < panel.y.length; i++) {
            const y = panel.y[i];
            if (panel.group[i] === signalGroup) {
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
                if (panel.group[i] !== signalGroup) continue;
                panel.y[i] = egCenter + (panel.y[i] - egCenter) * scale;
            }
        }
        return panel;
    }

    if (signal.type === "outlier") {
        const mag = signal.magnitude ?? 4.0;
        let hi = 0, lo = 0;
        for (let i = 0; i < panel.y.length; i++) {
            if (panel.group[i] !== signalGroup) continue;
            if (hi < signal.nHigh) panel.y[i] = mag + hi++ * 0.4;
            else if (lo < signal.nLow) panel.y[i] = -mag - lo++ * 0.4;
            else break;
        }
        return panel;
    }

    throw new Error("Unknown signal type: " + signal.type);
}

export function makeDesign({rng, catalog, nChartTypes, nVariantTypes, distReps, dataSeeds}) {
    // Select which chart types this participant sees and which variant(s) of each.
    // Both are fixed for the whole session (per-participant between-subjects factors).
    // nVariantTypes = 1 picks one random variant per type (normal use);
    // set to Infinity (along with nChartTypes) to include all types and all variants.
    const catalogShuffled = catalog.slice();
    shuffleInPlace(catalogShuffled, rng);
    const selectedChartTypes = [];
    for (const entry of catalogShuffled.slice(0, nChartTypes)) {
        const variantsShuffled = entry.variants.slice();
        shuffleInPlace(variantsShuffled, rng);
        // Collect variants: a solo variant appears alone; non-solo variants are collected
        // together up to nVariantTypes. A solo variant encountered after collecting non-solo
        // variants is skipped (and vice versa).
        const selected = [];
        for (const options of variantsShuffled) {
            if (options.solo) {
                if (selected.length === 0)
                    selected.push(options);
                break;
            }
            selected.push(options);
            if (selected.length >= nVariantTypes)
                break;
        }
        for (const options of selected)
            selectedChartTypes.push({type: entry.type, options});
    }

    const distSignals = {
        normal: [
            {type: "null",    level: "null",     weight: 12},
            {type: "location", delta_sd: 0.2, level: "weak",     weight: 2},
            {type: "location", delta_sd: 0.3, level: "weak",     weight: 2},
            {type: "location", delta_sd: 0.4, level: "weak",     weight: 2},
            {type: "location", delta_sd: 0.5, level: "moderate", weight: 2},
            {type: "location", delta_sd: 0.6, level: "moderate", weight: 3},
            {type: "location", delta_sd: 0.7, level: "moderate", weight: 3},
            {type: "location", delta_sd: 0.8, level: "moderate", weight: 3},
            {type: "location", delta_sd: 0.9, level: "strong",   weight: 2},
            {type: "location", delta_sd: 1.0, level: "strong",   weight: 2},
            {type: "location", delta_sd: 1.1, level: "strong",   weight: 0},
            {type: "spread", spread_factor: 1.2, level: "weak",     weight: 3},
            {type: "spread", spread_factor: 1.4, level: "moderate", weight: 3},
            {type: "spread", spread_factor: 1.6, level: "moderate", weight: 5},
            {type: "spread", spread_factor: 1.8, level: "strong",   weight: 5},
            {type: "skew", base:  2.50, level: "strong",    weight: 0},
            {type: "skew", base:  2.25, level: "strong",    weight: 1},
            {type: "skew", base:  2.00, level: "moderate",  weight: 2},
            {type: "skew", base:  1.75, level: "weak",      weight: 1},
            {type: "skew", base:  1.50, level: "weak",      weight: 1},
            {type: "skew", base: -1.50, level: "weak",      weight: 1},
            {type: "skew", base: -1.75, level: "weak",      weight: 1},
            {type: "skew", base: -2.00, level: "moderate",  weight: 2},
            {type: "skew", base: -2.25, level: "strong",    weight: 1},
            {type: "skew", base: -2.50, level: "strong",    weight: 0},
            {type: "bimodal", separation: 5.0, level: "strong",   weight: 2},
            {type: "bimodal", separation: 4.0, level: "strong",   weight: 3},
            {type: "bimodal", separation: 3.0, level: "moderate", weight: 3},
            {type: "bimodal", separation: 2.0, level: "weak",     weight: 3},
            {type: "outlier", nHigh: 2, nLow: 0, magnitude: 4.0, level: "moderate", weight: 0},
            {type: "outlier", nHigh: 1, nLow: 0, magnitude: 4.0, level: "weak",     weight: 0},
            {type: "outlier", nHigh: 0, nLow: 1, magnitude: 4.0, level: "weak",     weight: 0},
        ],
        lognormal: [
            {type: "null",    level: "null",     weight: 10},
            {type: "location", ratio: 1.2, level: "weak",     weight: 10},
            {type: "location", ratio: 1.3, level: "weak",     weight: 10},
            {type: "location", ratio: 1.4, level: "moderate", weight: 10},
            {type: "location", ratio: 1.5, level: "moderate", weight: 10},
            {type: "location", ratio: 1.6, level: "strong",   weight: 10},
            {type: "spread", spread_factor: 1.2, level: "weak",     weight: 10},
            {type: "spread", spread_factor: 1.4, level: "moderate", weight: 10},
            {type: "spread", spread_factor: 1.6, level: "moderate", weight: 10},
            {type: "spread", spread_factor: 1.8, level: "strong",   weight: 10},
        ],
        binomial: [
            {type: "null",   level: "null",     weight: 10},
            {type: "params", n: 10, p: 0.1, level: "moderate", weight: 10},
            {type: "params", n: 10, p: 0.3, level: "weak",     weight: 10},
            {type: "params", n: 10, p: 0.4, level: "strong",   weight: 10},
            {type: "params", n:  5, p: 0.2, level: "weak",     weight: 10},
        ],
    };

    // Group selected variants by chart type category.
    const typesSeen = new Set();
    const chartTypeGroups = [];
    for (const ct of selectedChartTypes) {
        if (!typesSeen.has(ct.type)) {
            typesSeen.add(ct.type);
            chartTypeGroups.push({type: ct.type, variants: [ct.options]});
        }
        else {
            chartTypeGroups.find(g => g.type === ct.type).variants.push(ct.options);
        }
    }

    const dists = Object.keys(distSignals);
    const conditions = [];

    // Build per-distribution seed and signal pools (sized by total trials per dist).
    const seedPools = {}, signalPools = {}, poolIdxs = {};
    for (const dist of dists) {
        const nPerDist = distReps[dist] * chartTypeGroups.length;
        const seeds = Array.from({length: nPerDist}, (_, i) => dataSeeds[i % dataSeeds.length]);
        shuffleInPlace(seeds, rng);
        seedPools[dist] = seeds;
        signalPools[dist] = makeWeightedSignalPool(distSignals[dist], nPerDist, rng);
        poolIdxs[dist] = 0;
    }

    for (const dist of dists) {
        const totalTrials = distReps[dist] * chartTypeGroups.length;
        // Clamp minimum so it fits even in testing mode with few total trials.
        const minPerCategory = Math.min(MIN_CATEGORY_TRIALS, Math.floor(totalTrials / chartTypeGroups.length));

        // Assign guaranteed minimum trials to each category, balanced across its variants.
        const variantCounts = new Array(selectedChartTypes.length).fill(0);
        for (let ci = 0; ci < chartTypeGroups.length; ci++) {
            const indices = selectedChartTypes.reduce((acc, ct, i) =>
                ct.type === chartTypeGroups[ci].type ? [...acc, i] : acc, []);
            for (let r = 0; r < minPerCategory; r++)
                variantCounts[indices[r % indices.length]]++;
        }

        // Randomly assign remaining trials by sampling uniformly from eligible variants
        // (those under MAX_VARIANT_TRIALS), giving multi-variant categories proportionally
        // more appearances while keeping per-participant counts variable.
        let remaining = totalTrials - variantCounts.reduce((a, b) => a + b, 0);
        while (remaining > 0) {
            const eligible = variantCounts.reduce((acc, c, i) =>
                c < MAX_VARIANT_TRIALS ? [...acc, i] : acc, []);
            if (eligible.length === 0) break;
            variantCounts[eligible[Math.floor(rng() * eligible.length)]]++;
            remaining--;
        }

        // Build conditions from variant counts.
        for (let i = 0; i < selectedChartTypes.length; i++) {
            const {type: chartType, options: chartOptions} = selectedChartTypes[i];
            for (let r = 0; r < variantCounts[i]; r++) {
                const idx = poolIdxs[dist]++;
                conditions.push({chartType, chartOptions, dist, signal: signalPools[dist][idx], dataSeed: seedPools[dist][idx]});
            }
        }
    }

    // Add duplicate conditions for within-subject chart-type comparison.
    // Each duplicate re-uses the seed+signal from an existing condition paired with a
    // randomly selected variant from a different chart type category, so the same
    // underlying data appears twice under different visualizations for the same participant.
    // signalGroup and jitter are assigned below along with the rest of the conditions.
    const nDups = Math.min(N_DUPLICATE_SEEDS, conditions.length);
    if (nDups > 0) {
        const shuffledIdx = Array.from({length: conditions.length}, (_, i) => i);
        shuffleInPlace(shuffledIdx, rng);
        for (let k = 0; k < nDups; k++) {
            const orig = conditions[shuffledIdx[k]];
            const otherTypes = selectedChartTypes.filter(ct => ct.type !== orig.chartType);
            if (otherTypes.length === 0)
                continue;
            const paired = otherTypes[Math.floor(rng() * otherTypes.length)];
            conditions.push({
                chartType: paired.type,
                chartOptions: paired.options,
                dist: orig.dist,
                signal: orig.signal,
                dataSeed: orig.dataSeed,
            });
        }
    }

    // Assign signalGroup with exact 50/50 balance across all conditions
    const signalGroups = conditions.map((_, i) => i < Math.floor(conditions.length / 2) ? 0 : 1);
    shuffleInPlace(signalGroups, rng);
    conditions.forEach((c, i) => c.signalGroup = signalGroups[i]);

    // Assign jitter per condition, balanced across JITTER_CATALOG.
    const jitterPool = Array.from({length: conditions.length}, (_, i) => JITTER_CATALOG[i % JITTER_CATALOG.length]);
    shuffleInPlace(jitterPool, rng);
    conditions.forEach((c, i) => c.jitter = jitterPool[i]);

    shuffleInPlace(conditions, rng);
    const orientation = "vertical";
    const jitter = JITTER_CATALOG[Math.floor(rng() * JITTER_CATALOG.length)]; // used for onboarding/training display only
    return {conditions, selectedChartTypes, orientation, jitter, distSignals, distReps, dataSeeds};
}
