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

export function shuffleInPlace(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}