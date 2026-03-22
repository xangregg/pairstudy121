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

export function shuffleInPlace(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}