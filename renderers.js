// renderers.js
// A small renderer collection for multi-group distributions.

import {mulberry32} from "./utils.js";

export function quantileSorted(sorted, p) {
    const n = sorted.length;
    if (n === 0)
        return NaN;
    const idx = (n - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const h = idx - lo;
    return (1 - h) * sorted[lo] + h * sorted[hi];
}

// values must be pre-sorted ascending (guaranteed by finalizePanel in app.js).
export function boxStats(values) {
    const q1 = quantileSorted(values, 0.25);
    const med = quantileSorted(values, 0.50);
    const q3 = quantileSorted(values, 0.75);
    const iqr = q3 - q1;
    const loFence = q1 - 1.5 * iqr;
    const hiFence = q3 + 1.5 * iqr;

    let loWhisker = values[0], hiWhisker = values[values.length - 1];
    for (let i = 0; i < values.length; i++) {
        if (values[i] >= loFence) {
            loWhisker = values[i];
            break;
        }
    }
    for (let i = values.length - 1; i >= 0; i--) {
        if (values[i] <= hiFence) {
            hiWhisker = values[i];
            break;
        }
    }

    return {q1, med, q3, loWhisker, hiWhisker};
}

function splitGroups(panel) {
    return panel.groups;
}

// at this point, the canvas will have been rotated in case of horizontal plots;
// names like left/right and width/height refer to the ideal situation of vertical plots.
export function beginPlot(ctx, canvas, yMin, yMax, nGroups = 2, opts = {}) {
    const W = canvas.width, H = canvas.height;
    // No left padding needed for y-axis labels; small uniform margin all around.
    const padL = 14, padR = 14, padT = 16, padB = opts.padB ?? 40;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    // clear + background
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    const range = (yMax - yMin) || 1;
    const yToPx = (y) => padT + innerH * (1 - (y - yMin) / range);

    // equally spaced grid lines across the active chart area
    ctx.strokeStyle = "#dddddd";
    ctx.lineWidth = 1;
    const nGridLines = 7;
    for (let i = 0; i < nGridLines; i++) {
        const y = padT + innerH * (i / (nGridLines - 1));
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + innerW, y);
        ctx.stroke();
    }

    let padInner = innerW / (20 * (nGroups + 1));
    if (W < H)
        padInner *= W / H; // reduce inner padding for square/portrait canvases (horizontal orientation)
    const groupSpacing = (innerW - 2 * padInner) / nGroups;
    const xs = Array.from({length: nGroups}, (_, i) => padL + padInner + groupSpacing * (2 * i + 1) / 2);

    return {W, H, padL, padR, padT, padB, innerW, innerH, xs, groupSpacing, yMin, yMax, yToPx};
}

// draw the labels "below" each group's plot, usually a single letter or "Source N",
// with some effort to compensate for rotation and extra padding for wide text.
export function drawGroupLabels(ctx, plot, horizontal = false, labels = null) {
    const {xs, H, padB} = plot;
    ctx.fillStyle = "#111";
    ctx.font = "bold 18px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const getLabel = i => labels?.[i] ?? String.fromCharCode(65 + i);
    if (horizontal) {
        // The canvas has a 90° CW rotation applied; compensate with -90° at each
        // label site so the text appears upright on screen.
        const yLabel = H - padB / 2;
        for (let i = 0; i < xs.length; i++) {
            ctx.save();
            ctx.translate(xs[i], yLabel);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(getLabel(i), 0, 0);
            ctx.restore();
        }
    }
    else {
        for (let i = 0; i < xs.length; i++)
            ctx.fillText(getLabel(i), xs[i], H - padB / 2);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
}

export function renderBoxLayer(ctx, plot, panel, opts = {}) {
    const {yToPx, groupSpacing, xs} = plot;
    const groups = splitGroups(panel);

    const whiskers = opts.whiskers ?? "iqr";   // "iqr" | "range"
    const widerMedian = opts.widerMedian ?? false;  // for range bars and dots overlay
    const insideViolinPlot = opts.violinBox ?? false;

    const boxW = groupSpacing * (insideViolinPlot ? 0.075 : 0.48);

    // For "range" whiskers, override lo/hi with the actual data min/max.
    // values is pre-sorted ascending, so endpoints are direct array accesses.
    function whiskerAdjustment(s, values) {
        if (whiskers !== "range")
            return s;
        return {...s, loWhisker: values[0], hiWhisker: values[values.length - 1]};
    }

    function drawBoxAndWhiskers(x, s) {
        // Range bar uses half the box width; box plot uses full width.
        const bw = widerMedian ? boxW * 0.5 : boxW;

        const yQ1 = yToPx(s.q1), yQ3 = yToPx(s.q3);
        const yMed = yToPx(s.med), yLo = yToPx(s.loWhisker), yHi = yToPx(s.hiWhisker);

        ctx.strokeStyle = "#333";
        ctx.lineWidth = 1.6;

        // whisker
        ctx.beginPath();
        ctx.moveTo(x, yHi);
        ctx.lineTo(x, yLo);
        ctx.stroke();

        // whisker caps — omitted for range bar (Spear 1952) and violin box
        if (!widerMedian && !insideViolinPlot) {
            ctx.beginPath();
            ctx.moveTo(x - bw * 0.3, yHi);
            ctx.lineTo(x + bw * 0.3, yHi);
            ctx.moveTo(x - bw * 0.3, yLo);
            ctx.lineTo(x + bw * 0.3, yLo);
            ctx.stroke();
        }

        // box
        ctx.fillStyle = "#f3f3f3";
        ctx.beginPath();
        ctx.rect(x - bw / 2, Math.min(yQ1, yQ3), bw, Math.abs(yQ3 - yQ1));
        ctx.fill();
        ctx.stroke();

        // median — widerMedian extends it beyond the box (range bar style, per Spear 1952);
        // otherwise extend/thicken only when coincident with a quartile (discrete data).
        if (widerMedian) {
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(x - bw * 0.75, yMed);
            ctx.lineTo(x + bw * 0.75, yMed);
            ctx.stroke();
            ctx.lineWidth = 1.6;
        }
        else {
            const medCoincident = Math.abs(yMed - yQ1) < 1 || Math.abs(yMed - yQ3) < 1; // 1 pixel
            ctx.lineWidth = medCoincident ? 2.8 : 1.6;
            ctx.beginPath();
            ctx.moveTo(x - bw / 2, yMed);
            ctx.lineTo(x + bw / 2, yMed);
            ctx.stroke();
            ctx.lineWidth = 1.6;
        }
    }

    function drawOutliers(x, values, s) {
        const r = 5.0;
        const positions = values
            .filter(v => v < s.loWhisker || v > s.hiWhisker)
            .map(v => ({dx: 0, py: yToPx(v)}));
        drawDots(ctx, x, positions, {r, alpha: 0.75});
    }

    for (let i = 0; i < xs.length; i++) {
        const s = boxStats(groups[i]);
        drawBoxAndWhiskers(xs[i], whiskerAdjustment(s, groups[i]));
    }

    // No outliers for range whiskers — all points are within the whiskers by definition.
    if (opts.showOutliers !== false && whiskers !== "range") {
        for (let i = 0; i < xs.length; i++) {
            const s = boxStats(groups[i]);
            drawOutliers(xs[i], groups[i], s);
        }
    }
}

// --- KDE utilities (shared by renderViolinLayer and renderBandsLayer) ---

function kdeStddev(arr) {
    const n = arr.length;
    const mean = arr.reduce((s, v) => s + v, 0) / n;
    // use n instead of n-1 for sd denominator to match Silverman and for as-is spread
    return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
}

// Silverman's rule of thumb (Silverman 1986, p.48), using min(σ, IQR/1.34) as
// the scale estimate to reduce over-smoothing for skewed or heavy-tailed data.
function kdeBandwidth(arr) {
    const n = arr.length;
    const s = kdeStddev(arr);
    const iqr = quantileSorted(arr, 0.75) - quantileSorted(arr, 0.25);
    const scale = Math.min(s, iqr / 1.34) || s;
    return 1.06 * scale * Math.pow(n, -0.2);
}

// Gaussian kernel KDE: f(y) = (1/n) Σ φ((y−xᵢ)/h) / h
function kdeEval(arr, bw, ys) {
    const k = 1 / (arr.length * bw * Math.sqrt(2 * Math.PI));
    return ys.map(y => {
        let sum = 0;
        for (const v of arr) {
            const u = (y - v) / bw;
            sum += Math.exp(-0.5 * u * u);
        }
        return k * sum;
    });
}

// Evaluate KDE on allYs, clip to margin beyond data range, return clipped arrays + stats.
// allYs must be a uniform grid; margin is in data units.
function computeClippedKDE(values, allYs, margin) {
    const bw = kdeBandwidth(values);
    const allD = kdeEval(values, bw, allYs);
    const loClip = Math.min(...values) - margin;
    const hiClip = Math.max(...values) + margin;
    let iLo = allYs.findIndex(y => y >= loClip);
    if (iLo < 0)
        iLo = 0;
    let iHi = allYs.length - 1;
    while (iHi > iLo && allYs[iHi] > hiClip)
        iHi--;
    const ys = allYs.slice(iLo, iHi + 1);
    const d = allD.slice(iLo, iHi + 1);
    const maxD = d.reduce((m, v) => Math.max(m, v), 0);
    const sumD = d.reduce((s, v) => s + v, 0);
    return {bw, ys, d, maxD, sumD};
}

// For each coverage level, find the KDE threshold f* such that
// ∫{f(y)≥f*} f(y)dy = coverage, then extract connected intervals above that threshold.
// Returns an array (one entry per coverage) of interval lists [[lo,hi], ...].
// Multiple intervals arise for multimodal distributions.
function computeAllHDRIntervals(values, coverages, margin = 0) {
    const bw = kdeBandwidth(values);
    const nGrid = 512;  // higher resolution for interpolation and trapezoidal rule integration
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const lo = dataMin - 3 * bw;
    const hi = dataMax + 3 * bw;
    const step = (hi - lo) / nGrid;
    const ys = Array.from({length: nGrid + 1}, (_, i) => lo + i * step);
    const ds = kdeEval(values, bw, ys);

    let total = 0;
    for (let i = 0; i < nGrid; i++)
        total += (ds[i] + ds[i + 1]) * 0.5 * step;

    function areaAbove(fstar) {
        let area = 0;
        for (let i = 0; i < nGrid; i++) {
            const d0 = ds[i], d1 = ds[i + 1];
            if (d0 >= fstar && d1 >= fstar) {
                area += (d0 + d1) * 0.5 * step;
            }
            else if (d0 >= fstar || d1 >= fstar) {
                // exactly one side above threshold — find the crossing point
                const t = (fstar - d0) / (d1 - d0);
                const yCross = ys[i] + t * step;
                if (d0 >= fstar)
                    area += (d0 + fstar) * 0.5 * (yCross - ys[i]);
                else
                    area += (fstar + d1) * 0.5 * (ys[i + 1] - yCross);
            }
        }
        return area / total;
    }

    function findThreshold(coverage) {
        let fLo = 0, fHi = Math.max(...ds);
        for (let iter = 0; iter < 50; iter++) {
            const fMid = (fLo + fHi) / 2;
            if (areaAbove(fMid) > coverage)
                fLo = fMid;
            else
                fHi = fMid;
        }
        return (fLo + fHi) / 2;
    }

    const clipLo = dataMin - margin, clipHi = dataMax + margin;

    function extractIntervals(coverage, fstar) {
        const intervals = [];
        let inRegion = false, regionLo = 0;
        for (let i = 0; i <= nGrid; i++) {
            if (ds[i] >= fstar && !inRegion) {
                regionLo = i > 0
                    ? ys[i - 1] + ((fstar - ds[i - 1]) / (ds[i] - ds[i - 1])) * step
                    : ys[i];
                inRegion = true;
            }
            else if (ds[i] < fstar && inRegion) {
                const regionHi = ys[i - 1] + ((fstar - ds[i - 1]) / (ds[i] - ds[i - 1])) * step;
                intervals.push([regionLo, regionHi]);
                inRegion = false;
            }
        }
        if (inRegion)
            intervals.push([regionLo, ys[nGrid]]);

        // At very low coverage (< 10%), even a narrow interval is a genuine density peak —
        // don't enforce a minimum width. At higher coverages, drop sub-bw/4 slivers as artifacts.
        const dropInterval = coverage < 0.1 ? 0 : bw / 4;

        // Clamp each interval to [clipLo, clipHi]; drop any that become empty.
        const clipped = intervals
            .map(([a, b]) => [Math.max(a, clipLo), Math.min(b, clipHi)])
            .filter(([a, b]) => dropInterval < b - a);

        // Merge adjacent intervals whose gap is less than one bandwidth —
        // sub-bw gaps are KDE smoothing artifacts, not genuine features.
        // This also eliminates thin peaks (tiny intervals barely crossing the threshold).
        const merged = [];
        for (const iv of clipped) {
            if (merged.length > 0 && iv[0] - merged[merged.length - 1][1] < dropInterval) {
                merged[merged.length - 1][1] = iv[1];
            }
            else {
                merged.push([iv[0], iv[1]]);
            }
        }
        return merged;
    }

    return coverages.map(coverage => extractIntervals(coverage, findThreshold(coverage)));
}

// KDE mode: y-value at the peak of the estimated density.
// A smooth KDE has a single floating-point maximum in practice; indexOf finds it directly.
function computeKDEMode(values) {
    const bw = kdeBandwidth(values);
    const nGrid = 512;
    const lo = Math.min(...values) - 3 * bw;
    const hi = Math.max(...values) + 3 * bw;
    const ys = Array.from({length: nGrid + 1}, (_, i) => lo + (hi - lo) * i / nGrid);
    const ds = kdeEval(values, bw, ys);
    return ys[ds.indexOf(Math.max(...ds))];
}

// Default color table for bands: each entry covers coverages from the previous
// cutoff up to and including its own cutoff value.  A band whose coverage falls
// in that range gets that fill.  Lower coverage = denser region = darker gray.
// Override per-render via opts.bandFills.
export const DEFAULT_BAND_FILLS = [
    {cutoff: 0.20, fill: "#666666"},   // 0 – 20 %: very dense
    {cutoff: 0.40, fill: "#777777"},   // 20 – 40 %: dense
    {cutoff: 0.75, fill: "#aaaaaa"},   // 40 – 75 %
    {cutoff: 0.95, fill: "#cccccc"},   // 75 – 95 %
    {cutoff: 1.00, fill: "#e8e8e8"},   // 95 – 100 %: sparse
];

export function renderBandsLayer(ctx, plot, panel, opts = {}) {
    const {yToPx, groupSpacing, innerH, yMin, yMax, xs} = plot;
    const groups = splitGroups(panel);

    const bandType = opts.bandType ?? "quantile";
    const cutoffs = (opts.cutoffs ?? [0.50, 0.90, 0.99]).slice().sort((a, b) => a - b);
    const finalCutoff = cutoffs[cutoffs.length - 1];
    const showDots = opts.showDots ?? finalCutoff < 1;
    const showMedian = opts.showMedian ?? true;
    const showMode = opts.showMode ?? false;
    const clipPx = opts.clipPx ?? 6;
    const bandFills = opts.bandFills ?? DEFAULT_BAND_FILLS;

    // Margin in data units: same pixel rule as renderViolinLayer
    const hdrMargin = clipPx * (yMax - yMin) / innerH;

    const bandW = groupSpacing * 0.42;

    // Return the fill for a band whose coverage value is `c`.
    // Finds the first table entry where c <= entry.cutoff.
    function lookupFill(c) {
        for (const entry of bandFills) {
            if (c <= entry.cutoff)
                return entry.fill;
        }
        return bandFills[bandFills.length - 1].fill;
    }

    function drawRect(lo, hi, x, fill) {
        const top = Math.min(yToPx(lo), yToPx(hi));
        const h = Math.abs(yToPx(hi) - yToPx(lo));
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.rect(x - bandW / 2, top, bandW, h);
        ctx.fill();
    }

    function drawHorizLine(x, y) {
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(x - bandW / 2, yToPx(y));
        ctx.lineTo(x + bandW / 2, yToPx(y));
        ctx.stroke();
    }

    function drawTailDots(x, values, outerIntervals) {
        const r = 5;
        const positions = values
            .filter(v => !outerIntervals.some(([lo, hi]) => v >= lo && v <= hi))
            .map(v => ({dx: 0, py: yToPx(v)}));
        drawDots(ctx, x, positions, {r, alpha: 0.75});
    }

    // Returns array of interval lists, one per cutoff entry.
    // Each interval list is [[lo, hi], ...] (multiple intervals for HDR multimodal).
    function getBandIntervals(values) {
        if (bandType === "quantile") {
            return cutoffs.map(p => [[quantileSorted(values, (1 - p) / 2), quantileSorted(values, (1 + p) / 2)]]);
        }
        return computeAllHDRIntervals(values, cutoffs, hdrMargin);
    }

    function drawGroup(x, values) {
        const bandIntervals = getBandIntervals(values);

        // Draw outermost band first so inner bands paint on top
        for (let i = cutoffs.length - 1; i >= 0; i--) {
            const fill = lookupFill(cutoffs[i]);
            for (const [lo, hi] of bandIntervals[i]) {
                drawRect(lo, hi, x, fill);
            }
        }

        if (showDots) {
            drawTailDots(x, values, bandIntervals[cutoffs.length - 1]);
        }

        if (showMedian)
            drawHorizLine(x, quantileSorted(values, 0.5));
        if (showMode)
            drawHorizLine(x, computeKDEMode(values));
    }

    for (let i = 0; i < xs.length; i++)
        drawGroup(xs[i], groups[i]);
}

function drawDots(ctx, x, positions, {r, alpha, scale = 1}) {
    ctx.lineWidth = 1.0;
    ctx.fillStyle = `rgba(0,0,0,${alpha / 15})`;
    ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
    for (const {dx, py} of positions) {
        ctx.beginPath();
        ctx.arc(x + dx * scale, py, r, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
    }
}

export function renderDotLayer(ctx, plot, panel, opts = {}) {
    const {yToPx, groupSpacing, xs, yMin, yMax} = plot;
    const groups = splitGroups(panel);

    const r = opts.radius ?? 6;
    const alpha = opts.alpha ?? 0.55;
    const jitterW = opts.jitterW ?? groupSpacing * 0.36;   // guide width for random candidates
    const jitterLimit = opts.jitterLimit ?? Math.min(jitterW * 3, groupSpacing / 2 - r);   // hard cap
    const showMedian = opts.showMedian ?? true;
    const jitter = opts.jitter ?? "random";   // "random" | "wilkinson" | "beeswarm" | "density random"

    // Each compute function returns [{dx, py}] positions relative to the group center.
    // Drawing is deferred so an overflow scale can be applied across both groups.

    // Fixed seed so jitter positions are deterministic and stable across re-renders.
    let rng = mulberry32(10000);

    function overlapScore(dx, py, placed) {
        let score = 0;
        for (const p of placed) {
            const d = Math.hypot(dx - p.dx, py - p.py);
            if (d < 2 * r) score += 2 * r - d;
        }
        return score;
    }

    // Place dots by random candidate sampling: draw nTries random dx values within halfWidthFn(v)
    // of center, keep the one with least overlap (ties broken by proximity to center).
    function computeGroupDotsRandomBase(values, halfWidthFn, nTries) {
        const placed = [];
        for (const v of values) {
            const py = yToPx(v);
            const hw = halfWidthFn(v);
            let bestDx = (rng() - 0.5) * 2 * hw;
            let bestOverlap = overlapScore(bestDx, py, placed);
            for (let t = 0; t < nTries; t++) {
                const dx = (rng() - 0.5) * 2 * hw;
                const overlap = overlapScore(dx, py, placed);
                if (overlap < bestOverlap || (overlap === bestOverlap && Math.abs(dx) < Math.abs(bestDx))) {
                    bestOverlap = overlap;
                    bestDx = dx;
                }
            }
            placed.push({dx: bestDx, py});
        }
        return placed;
    }

    function computeGroupDotsRandom(values) {
        return computeGroupDotsRandomBase(values, () => jitterW, 2);
    }

    // Wilkinson dot plot: greedy y-binning, symmetric horizontal stacking.
    function computeGroupDotsWilkinson(values) {
        const pys = values.map(v => yToPx(v)).sort((a, b) => a - b);
        const bins = [];
        for (const py of pys) {
            const last = bins[bins.length - 1];
            if (!last || py - last.anchor > 2 * r)
                bins.push({anchor: py, pys: [py]});
            else
                last.pys.push(py);
        }
        for (const bin of bins)
            bin.py = bin.pys.reduce((s, v) => s + v, 0) / bin.pys.length;
        for (let i = 1; i < bins.length; i++)
            bins[i].py = Math.max(bins[i].py, bins[i - 1].py + 2 * r);

        const positions = [];
        for (const bin of bins) {
            const n = bin.pys.length;
            for (let i = 0; i < n; i++)
                positions.push({dx: (i - (n - 1) / 2) * 2 * r, py: bin.py});
        }
        return positions;
    }

    // Density-constrained random: like random jitter but each dot's horizontal range is
    // limited to the violin half-width at its y position, keeping dots inside the KDE shape.
    // Uses the same per-group scale formula as renderViolinLayer (violinScale=9 default).
    function computeViolinHalfWidthFns() {
        const maxHalfW = groupSpacing * 0.54;
        const scale = (opts.violinScale ?? 9) * maxHalfW * (yMax - yMin) / groups[0].length;
        return groups.map(values => {
            const bw = kdeBandwidth(values);
            return v => kdeEval(values, bw, [v])[0] * scale;
        });
    }

    function computeGroupDotsDensityRandom(values, halfWFn) {
        // r/3 inset keeps dot edges within the violin outline; more tries than random for tighter packing.
        return computeGroupDotsRandomBase(values, v => Math.max(1, halfWFn(v) - r / 3), 7);
    }

    // Beeswarm: bottom-to-top, forbidden-interval placement.
    function computeGroupDotsBeeswarm(values) {
        const pys = values.map(v => yToPx(v)).sort((a, b) => b - a);
        const placed = [];
        for (const py of pys) {
            const forbidden = [];
            for (const p of placed) {
                const dy = py - p.py;
                if (Math.abs(dy) < 2 * r) {
                    const halfSpan = Math.sqrt(4 * r * r - dy * dy);
                    forbidden.push([p.dx - halfSpan, p.dx + halfSpan]);
                }
            }
            const candidates = [0];
            for (const [lo, hi] of forbidden)
                candidates.push(lo, hi);
            let bestDx = Infinity;
            for (const c of candidates) {
                if (Math.abs(c) < Math.abs(bestDx) &&
                    !forbidden.some(([lo, hi]) => c > lo && c < hi))
                    bestDx = c;
            }
            if (!isFinite(bestDx))
                bestDx = 0;
            placed.push({dx: bestDx, py});
        }
        return placed;
    }

    let allPos;
    if (jitter === "density random") {
        const halfWFns = computeViolinHalfWidthFns();
        allPos = groups.map((g, i) => computeGroupDotsDensityRandom(g, halfWFns[i]));
    }
    else {
        const computeGroupDots = jitter === "wilkinson" ? computeGroupDotsWilkinson
            : jitter === "beeswarm" ? computeGroupDotsBeeswarm
                : computeGroupDotsRandom;
        allPos = groups.map(g => computeGroupDots(g));
    }

    // If any dot exceeds jitterLimit, scale all dx values down uniformly.
    // Using the same factor for all groups preserves their relative spread.
    const maxDx = Math.max(0, ...allPos.flatMap(pos => pos.map(p => Math.abs(p.dx))));
    const scale = maxDx > jitterLimit ? jitterLimit / maxDx : 1;

    for (let i = 0; i < xs.length; i++)
        drawDots(ctx, xs[i], allPos[i], {r, alpha, scale});

    if (showMedian) {
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 3.0;
        const w = groupSpacing * 0.4;
        ctx.beginPath();
        for (let i = 0; i < xs.length; i++) {
            const med = quantileSorted(groups[i], 0.5);
            ctx.moveTo(xs[i] - w / 2, yToPx(med));
            ctx.lineTo(xs[i] + w / 2, yToPx(med));
        }
        ctx.stroke();
    }
}

export function renderViolinLayer(ctx, plot, panel, opts = {}) {
    const {yToPx, yMin, yMax, groupSpacing, innerH, xs} = plot;
    const groups = splitGroups(panel);

    const maxHalfW = opts.maxHalfW ?? groupSpacing * 0.54;
    const clipPx = opts.clipPx ?? 6;   // px beyond data min/max to truncate KDE
    const showMedian = opts.showMedian ?? true;
    const violinScale = opts.violinScale ?? 9;
    const nGrid = 100;

    // Convert pixel margin to data units for clip bounds
    const pxToData = (yMax - yMin) / innerH;

    // Per-group scale: area ∝ maxHalfW*(yMax-yMin)/nObs, independent of other groups.
    // violinScale tunes the overall amplitude; peaks may exceed maxHalfW for narrow dists.
    const nObs = groups[0].length;
    const scale = violinScale * maxHalfW * (yMax - yMin) / nObs;

    function computeViolin(values) {
        // Clip to clipPx pixels beyond the data range — path starts/ends at non-zero density.
        const allYs = Array.from({length: nGrid + 1}, (_, i) => yMin + (yMax - yMin) * i / nGrid);
        const {bw, ys, d} = computeClippedKDE(values, allYs, clipPx * pxToData);
        const med = quantileSorted(values, 0.5);
        const medD = kdeEval(values, bw, [med])[0];
        return {ys, d, med, medD};
    }

    const violins = groups.map(computeViolin);

    function drawViolin(x, v) {
        if (v.d.every(d => d === 0))
            return;

        const n = v.d.length;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const px = x + v.d[i] * scale, py = yToPx(v.ys[i]);
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        // Left side top→bottom; the transition from right[n-1] to left[n-1] is the top endcap,
        // and closePath draws the bottom endcap — both are horizontal at the clip boundary.
        for (let i = n - 1; i >= 0; i--)
            ctx.lineTo(x - v.d[i] * scale, yToPx(v.ys[i]));
        ctx.closePath();
        ctx.fillStyle = "#e0e0e0";
        ctx.fill();
        ctx.strokeStyle = "#444";
        ctx.lineWidth = 1.0;
        ctx.stroke();

        // Median line spanning full local width
        if (showMedian) {
            ctx.beginPath();
            ctx.moveTo(x - v.medD * scale, yToPx(v.med));
            ctx.lineTo(x + v.medD * scale, yToPx(v.med));
            ctx.strokeStyle = "#444";
            ctx.lineWidth = 2.0;
            ctx.stroke();
        }
    }

    for (let i = 0; i < xs.length; i++)
        drawViolin(xs[i], violins[i]);
}

export function renderChart(ctx, canvas, chartType, panel, yMin, yMax, chartOptions = {}, orientation = "vertical", jitter = "random") {
    const horizontal = orientation === "horizontal";

    // For horizontal orientation, rotate the canvas 90° CW so the drawing code
    // runs unchanged in a virtual coordinate space with swapped dimensions.
    // translate(W, 0) + rotate(+90°) maps virtual (x, y) → screen (W−y, x),
    // which puts the group axis on screen-y and the data axis on screen-x.
    if (horizontal) {
        ctx.save();
        ctx.translate(canvas.width, 0);
        ctx.rotate(Math.PI / 2);
    }
    const vc = horizontal ? {width: canvas.height, height: canvas.width} : canvas;

    const nGroups = panel.groups.length;
    const plot = beginPlot(ctx, vc, yMin, yMax, nGroups, {padB: chartOptions.padB});

    if (chartType === "violin") {
        renderViolinLayer(ctx, plot, panel, {...chartOptions});
        const showBox = chartOptions.showBox ?? false;
        if (showBox) {
            renderBoxLayer(ctx, plot, panel, {showOutliers: false, violinBox: true, ...chartOptions});
        }
        const showDots = chartOptions.showDots ?? true;
        if (showDots) {
            renderDotLayer(ctx, plot, panel, {
                radius: 5,
                alpha: 0.8,
                jitter,
                jitterW: plot.groupSpacing * 0.195,
                showMedian: false,
                ...chartOptions,
            });
        }
    }
    else if (chartType === "bands") {
        renderBandsLayer(ctx, plot, panel, {...chartOptions});
    }
    else if (chartType === "dot") {
        renderDotLayer(ctx, plot, panel, {
            radius: 5,
            alpha: 0.8,
            jitter,
            jitterW: plot.groupSpacing * 0.15,
            showMedian: true,
            ...chartOptions,
        });
    }
    else if (chartType === "box") {
        const showDots = chartOptions.showDots ?? true;
        renderBoxLayer(ctx, plot, panel, {showOutliers: !showDots, ...chartOptions});
        if (showDots) {
            renderDotLayer(ctx, plot, panel, {
                radius: 5,
                alpha: 0.8,
                jitter,
                jitterW: plot.groupSpacing * 0.15,
                showMedian: false,
                ...chartOptions,
            });
        }
    }
    else {
        throw new Error("Unknown chart type: " + chartType);
    }

    drawGroupLabels(ctx, plot, horizontal, chartOptions.groupLabels ?? null);
    if (horizontal)
        ctx.restore();
}