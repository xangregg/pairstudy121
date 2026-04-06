// data.js — base data generation and seed screening

import {mulberry32, randomNormal} from "./utils.js";
import {N_PER_GROUP, SEED_THRESHOLDS, MEAN_D_THRESHOLD} from "./config.js";

function binomialGroupParams(n0, p0, signal) {
    if (signal.type === "location") {
        const delta_p = signal.delta_sd * Math.sqrt(p0 * (1 - p0) / n0);
        return {n: n0, p: Math.min(0.99, Math.max(0.01, p0 + delta_p))};
    }
    if (signal.type === "spread") {
        return {n: Math.round(n0 * signal.spread_factor), p: p0};
    }
    if (signal.type === "params") {
        return {n: signal.n, p: signal.p};
    }
    return {n: n0, p: p0};  // null and unsupported types
}

export function generateBasePanel(dist, seed, signal = {type: "null"}, signalGroup = 1) {
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
        const g1 = binomialGroupParams(n0, p0, signal);
        for (let i = 0; i < N; i++) {
            const n = group[i] !== signalGroup ? n0 : g1.n;
            const p = group[i] !== signalGroup ? p0 : g1.p;
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
export function finalizePanel(y, group) {
    const nGroups = Math.max(...group) + 1;
    const groups = Array.from({length: nGroups}, () => []);
    for (let i = 0; i < y.length; i++)
        groups[group[i]].push(y[i]);
    for (const g of groups)
        g.sort((a, b) => a - b);
    return {groups};
}

// Auto-screen candidate seeds: reject if groups differ too much under null signal.
// extremes: max/min difference as a fraction of combined range (range-based; captures tail placement).
// meanD: Cohen's d for mean difference (distribution-agnostic; ~equivalent to Welch's t > 1.25, p < 0.21).
export function isGoodSeed(seed, distReps) {
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

// Compute 100 seeds of the form i*10^5 (skipping multiples of 10), auto-screened.
export function computeDataSeeds(distReps, verbose = false) {
    const seeds = [];
    let rejected = 0;
    for (let i = 101; seeds.length < 100; i++) {
        if (i % 10 === 0)
            continue;
        if (isGoodSeed(i * 100_000, distReps))
            seeds.push(i * 100_000);
        else rejected++;
    }
    if (verbose)
        console.log(`DATA_SEEDS: ${seeds.length} accepted, ${rejected} rejected (${(rejected / (rejected + seeds.length) * 100).toFixed(1)}% rejection rate).`);
    return seeds;
}
