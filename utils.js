// utils.js — shared RNG and math utilities

export function mulberry32(a) {
    if (!Number.isFinite(a) || (a >>> 0) !== a)
        debugger; // bad seed: inspect call stack here
    a >>>= 0; // coerce to uint32; guards against NaN/float seeds
    return function () {
        let t = a = (a + 0x6D2B79F5) >>> 0;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// FNV-1a 32-bit hash. Offset basis: 2166136261; prime: 16777619.
export function hashStringToUint32(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

// Box-Muller transform. Consumes two RNG draws; loops guard against u/v = 0 (log undefined).
export function randomNormal(rng) {
    let u, v;
    do { u = rng(); } while (!(u > 0));
    do { v = rng(); } while (!(v > 0));
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Standard normal CDF via A&S 26.2.17 rational approximation; max error < 1.5e-7.
export function normalCDF(x) {
    const p = 0.3275911;
    const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
    const sign = x >= 0 ? 1 : -1;
    const t = 1 / (1 + p * Math.abs(x) / Math.SQRT2);
    const poly = t * (a[0] + t * (a[1] + t * (a[2] + t * (a[3] + t * a[4]))));
    const y = 1 - poly * Math.exp(-x * x / 2);
    return 0.5 * (1 + sign * y);
}

// Owen's T function: T(h,a) = 1/(2π) ∫₀ᵃ exp(−h²(1+t²)/2) / (1+t²) dt
// 6-point Gauss-Legendre quadrature on [0, a]; accurate to ~1e-4 for |h| ≤ 4, a ≤ 5.
export function owensT(h, a) {
    const nodes = [0.238619186, 0.661209386, 0.932469514]; // 6-pt GL positive nodes
    const wts   = [0.467913935, 0.360761573, 0.171324493];
    const h2 = h * h;
    let sum = 0;
    for (let j = 0; j < 3; j++) {
        for (const s of [1, -1]) {
            const t = a * (1 + s * nodes[j]) / 2;
            sum += wts[j] * Math.exp(-0.5 * h2 * (1 + t * t)) / (1 + t * t);
        }
    }
    return a / (4 * Math.PI) * sum;
}

// Map z ~ N(0,1) to x ~ SN(alpha) via probability integral transform (bisection).
// Newton's method is unreliable here: for large |alpha| and negative z, the SN PDF
// is essentially zero at x₀ = z, causing catastrophic step sizes. Bisection is robust.
// Converges to < 1e-10 in ≤ 37 iterations over the bracket [-8, 8].
export function normalToSkewNormal(z, alpha) {
    const target = normalCDF(z);
    let lo = -8, hi = 8;
    for (let iter = 0; iter < 54; iter++) {
        const mid = (lo + hi) / 2;
        if (normalCDF(mid) - 2 * owensT(mid, alpha) < target)
            lo = mid;
        else
            hi = mid;
        if (hi - lo < 1e-10) break;
    }
    return (lo + hi) / 2;
}

export function makeBinomialSampler(n, p) {
    // Log-factorials for stable per-term computation (no recurrence from pow(1-p,n))
    const logFact = new Float64Array(n + 1);
    for (let i = 1; i <= n; i++)
        logFact[i] = logFact[i - 1] + Math.log(i);

    const logP = Math.log(p), logQ = Math.log(1 - p);

    // Each PMF term computed independently; underflow only where probability is truly negligible
    const cdf = new Float64Array(n + 1);
    let sum = 0;
    for (let k = 0; k <= n; k++) {
        sum += Math.exp(logFact[n] - logFact[k] - logFact[n - k] + k * logP + (n - k) * logQ);
        cdf[k] = sum;
    }
    // Normalize and clamp to guard against any residual floating-point drift
    for (let k = 0; k <= n; k++)
        cdf[k] /= sum;
    cdf[n] = 1;

    return function(rng) {
        const u = rng();
        let lo = 0, hi = n;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (cdf[mid] < u)
                lo = mid + 1;
            else
                hi = mid;
        }
        return lo;
    };
}

// Piecewise-linear interpolation. xs must be strictly increasing.
// x outside [xs[0], xs[n-1]] clamps to the corresponding y extreme.
export function interpolate(x, xs, ys) {
    if (x <= xs[0])
        return ys[0];
    if (x >= xs[xs.length - 1])
        return ys[ys.length - 1];
    for (let i = 0; i < xs.length - 1; i++) {
        if (x <= xs[i + 1]) {
            const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
            return ys[i] + t * (ys[i + 1] - ys[i]);
        }
    }
    return ys[ys.length - 1];
}

// Two-sample Kolmogorov-Smirnov statistic. Both arrays must be pre-sorted ascending.
// Returns D = max|F1(x) - F2(x)| over all observed values.
export function ksStat(a, b) {
    const n1 = a.length, n2 = b.length;
    let i = 0, j = 0, d = 0;
    while (i < n1 && j < n2) {
        const f1 = (i + 1) / n1;
        const f2 = (j + 1) / n2;
        if (a[i] <= b[j])
            i++;
        else
            j++;
        d = Math.max(d, Math.abs(f1 - f2));
    }
    return d;
}

// Wasserstein-1 (earth mover's) distance for two sorted equal-length arrays,
// normalized by the IQR of the combined dataset to match JMP's computation.
export function wassersteinStat(a, b) {
    const n = a.length;
    let sum = 0;
    for (let i = 0; i < n; i++)
        sum += Math.abs(a[i] - b[i]);
    const raw = sum / n;
    // Merge two sorted arrays to compute combined IQR.
    const combined = new Array(n * 2);
    let i = 0, j = 0, k = 0;
    while (i < n && j < n)
        combined[k++] = a[i] <= b[j] ? a[i++] : b[j++];
    while (i < n) combined[k++] = a[i++];
    while (j < n) combined[k++] = b[j++];
    const iqr = quantileSorted(combined, 0.75) - quantileSorted(combined, 0.25);
    return iqr > 0 ? raw / iqr : raw;
}

// Goodman-Kruskal γ: (C − D) / (C + D), ignoring all tied pairs.
// Ranges from -1 to 1; tied pairs (on either variable) are excluded entirely.
export function goodmanKruskalGamma(xs, ys) {
    const n = xs.length;
    if (n < 2)
        return null;
    let C = 0, D = 0;
    for (let i = 0; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
            const dx = xs[i] - xs[j], dy = ys[i] - ys[j];
            if (dx === 0 || dy === 0)
                continue;
            if (Math.sign(dx) === Math.sign(dy))
                C++;
            else
                D++;
        }
    }
    return (C + D) === 0 ? 0 : (C - D) / (C + D);
}

// Kendall's τ-b. O(n²) — fine for n ≤ a few hundred.
export function kendallTauB(xs, ys) {
    const n = xs.length;
    if (n < 2)
        return null;
    let C = 0, D = 0, Tx = 0, Ty = 0;
    for (let i = 0; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
            const dx = xs[i] - xs[j], dy = ys[i] - ys[j];
            if (dx === 0 && dy === 0) { /* tied on both — skip */ }
            else if (dx === 0)
                Tx++;
            else if (dy === 0)
                Ty++;
            else if (Math.sign(dx) === Math.sign(dy))
                C++;
            else
                D++;
        }
    }
    const denom = Math.sqrt((C + D + Tx) * (C + D + Ty));
    return denom === 0 ? 0 : (C - D) / denom;
}

export function spearmanCorrelation(xs, ys) {
    const n = xs.length;
    if (n < 2)
        return null;
    const rank = arr => {
        const sorted = arr.map((v, i) => ({v, i})).sort((a, b) => a.v - b.v);
        const ranks = new Array(n);
        for (let i = 0; i < n; ) {
            let j = i;
            while (j < n && sorted[j].v === sorted[i].v) j++;
            const avg = (i + j - 1) / 2 + 1; // average rank (1-based)
            for (let k = i; k < j; k++) ranks[sorted[k].i] = avg;
            i = j;
        }
        return ranks;
    };
    const rx = rank(xs), ry = rank(ys);
    const mx = (n + 1) / 2, my = (n + 1) / 2;
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < n; i++) {
        num  += (rx[i] - mx) * (ry[i] - my);
        dx2  += (rx[i] - mx) ** 2;
        dy2  += (ry[i] - my) ** 2;
    }
    return (dx2 === 0 || dy2 === 0) ? 0 : num / Math.sqrt(dx2 * dy2);
}

export function shuffleInPlace(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

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

// values must be pre-sorted ascending (guaranteed by finalizePanel in data.js).
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

// Quotes a single CSV field per RFC 4180: wraps in double-quotes if the value
// contains a comma, double-quote, or newline; doubles any embedded double-quotes.
export function csvField(v) {
    const s = String(v);
    return (s.includes(",") || s.includes('"') || s.includes("\n"))
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
}