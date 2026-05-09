// Unit tests for utils.js
// Run with: node --test   (Node 18+)

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    mulberry32, hashStringToUint32, randomNormal, normalCDF,
    owensT, normalToSkewNormal, makeBinomialSampler,
    interpolate, ksStat, goodmanKruskalGamma, kendallTauB,
    spearmanCorrelation, shuffleInPlace, quantileSorted, boxStats, csvField,
    skewness,
} from './utils.js';

function assertFuzzyEqual(actual, expected, tol = 1e-9) {
    assert.ok(
        Math.abs(actual - expected) <= tol,
        `expected ${actual} ≈ ${expected} (tolerance ${tol})`
    );
}

// ---------------------------------------------------------------------------

describe('interpolate', () => {
    test('clamps below lower bound', () => {
        assert.strictEqual(interpolate(-1, [0, 1], [10, 20]), 10);
    });
    test('clamps above upper bound', () => {
        assert.strictEqual(interpolate(2, [0, 1], [10, 20]), 20);
    });
    test('exact lower anchor', () => {
        assert.strictEqual(interpolate(0, [0, 1], [10, 20]), 10);
    });
    test('exact upper anchor', () => {
        assert.strictEqual(interpolate(1, [0, 1], [10, 20]), 20);
    });
    test('midpoint of single segment', () => {
        assert.strictEqual(interpolate(0.5, [0, 1], [10, 20]), 15);
    });
    test('multi-segment: first segment', () => {
        assert.strictEqual(interpolate(0.5, [0, 1, 2], [0, 10, 30]), 5);
    });
    test('multi-segment: second segment', () => {
        assert.strictEqual(interpolate(1.5, [0, 1, 2], [0, 10, 30]), 20);
    });
    test('inner anchor point', () => {
        assert.strictEqual(interpolate(1, [0, 1, 2], [0, 10, 30]), 10);
    });
});

// ---------------------------------------------------------------------------

describe('ksStat', () => {
    // For fully separated equal-size arrays of length n, result = (n−1)/n.
    test('fully separated n=2', () => {
        assertFuzzyEqual(ksStat([1, 2], [3, 4]), 0.5);
    });
    test('fully separated n=5', () => {
        assertFuzzyEqual(ksStat([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]), 0.8);
    });
    // Perfectly interleaved (a[0]<b[0]<a[1]<b[1]…) → 1/n.
    test('perfectly interleaved n=5', () => {
        assertFuzzyEqual(ksStat([1, 3, 5, 7, 9], [2, 4, 6, 8, 10]), 0.2);
    });
    test('result is non-negative', () => {
        assert.ok(ksStat([1, 2, 3], [1, 2, 3]) >= 0);
    });
    test('symmetric: swapping a and b gives the same value', () => {
        assertFuzzyEqual(ksStat([10, 20, 30], [1, 2, 3]), ksStat([1, 2, 3], [10, 20, 30]));
    });
    test('larger separation produces larger statistic', () => {
        // Use n=6 with no shared values to avoid the implementation's tie-handling effect.
        const small = ksStat([1, 2, 3, 4, 5, 6], [3.5, 4.5, 5.5, 6.5, 7.5, 8.5]);
        const large = ksStat([1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]);
        assert.ok(large > small, `large ${large} should exceed small ${small}`);
    });
});

// ---------------------------------------------------------------------------

describe('quantileSorted', () => {
    test('median of odd-length array', () => {
        assert.strictEqual(quantileSorted([1, 2, 3, 4, 5], 0.5), 3);
    });
    test('median of even-length array (interpolated)', () => {
        assert.strictEqual(quantileSorted([1, 2, 3, 4], 0.5), 2.5);
    });
    test('p=0 returns minimum', () => {
        assert.strictEqual(quantileSorted([1, 2, 3, 4, 5], 0), 1);
    });
    test('p=1 returns maximum', () => {
        assert.strictEqual(quantileSorted([1, 2, 3, 4, 5], 1), 5);
    });
    test('fractional quartile (p=0.25, n=5)', () => {
        // idx = 4*0.25 = 1 exactly → arr[1] = 2
        assert.strictEqual(quantileSorted([1, 2, 3, 4, 5], 0.25), 2);
    });
    test('interpolated quartile (p=0.25, n=6)', () => {
        // idx = 5*0.25 = 1.25 → 0.75*arr[1] + 0.25*arr[2] = 0.75*2 + 0.25*3 = 2.25
        assert.strictEqual(quantileSorted([1, 2, 3, 4, 5, 6], 0.25), 2.25);
    });
    test('single element returns that element', () => {
        assert.strictEqual(quantileSorted([42], 0.5), 42);
    });
    test('empty array returns NaN', () => {
        assert.ok(Number.isNaN(quantileSorted([], 0.5)));
    });
});

// ---------------------------------------------------------------------------

describe('boxStats', () => {
    test('no outliers: correct quartiles and whiskers', () => {
        // [1,2,3,4,5]: q1=2, med=3, q3=4, iqr=2, fences=[-1,7], no outliers
        const s = boxStats([1, 2, 3, 4, 5]);
        assert.strictEqual(s.q1, 2);
        assert.strictEqual(s.med, 3);
        assert.strictEqual(s.q3, 4);
        assert.strictEqual(s.loWhisker, 1);
        assert.strictEqual(s.hiWhisker, 5);
    });
    test('high outlier: hiWhisker trimmed, outlier excluded', () => {
        // [1,2,3,4,5,100]: q1=2.25, q3=4.75, iqr=2.5, hiFence=8.5 → hiWhisker=5
        const s = boxStats([1, 2, 3, 4, 5, 100]);
        assert.strictEqual(s.q1, 2.25);
        assert.strictEqual(s.q3, 4.75);
        assert.strictEqual(s.loWhisker, 1);
        assert.strictEqual(s.hiWhisker, 5);
    });
    test('low outlier: loWhisker trimmed', () => {
        // mirror of above
        const s = boxStats([-100, 1, 2, 3, 4, 5]);
        assert.strictEqual(s.loWhisker, 1);
        assert.strictEqual(s.hiWhisker, 5);
    });
});

// ---------------------------------------------------------------------------

describe('normalCDF', () => {
    test('cdf(0) ≈ 0.5', () => {
        assertFuzzyEqual(normalCDF(0), 0.5, 1e-6);
    });
    test('cdf(1.96) ≈ 0.975', () => {
        assertFuzzyEqual(normalCDF(1.96), 0.975, 1e-4);
    });
    test('symmetry: cdf(-x) = 1 - cdf(x)', () => {
        for (const x of [0.5, 1, 1.96, 2.5]) {
            assertFuzzyEqual(normalCDF(-x), 1 - normalCDF(x));
        }
    });
    test('monotone increasing', () => {
        let prev = -Infinity;
        for (const x of [-3, -1, 0, 1, 3]) {
            const v = normalCDF(x);
            assert.ok(v > prev, `not monotone at x=${x}`);
            prev = v;
        }
    });
});

// ---------------------------------------------------------------------------

describe('spearmanCorrelation', () => {
    test('perfect positive correlation → 1', () => {
        assert.strictEqual(spearmanCorrelation([1, 2, 3], [1, 2, 3]), 1);
    });
    test('perfect negative correlation → -1', () => {
        assert.strictEqual(spearmanCorrelation([1, 2, 3], [3, 2, 1]), -1);
    });
    test('constant ys → 0', () => {
        assert.strictEqual(spearmanCorrelation([1, 2, 3], [5, 5, 5]), 0);
    });
    test('n < 2 → null', () => {
        assert.strictEqual(spearmanCorrelation([1], [1]), null);
        assert.strictEqual(spearmanCorrelation([], []), null);
    });
});

// ---------------------------------------------------------------------------

describe('kendallTauB', () => {
    test('perfect positive correlation → 1', () => {
        assert.strictEqual(kendallTauB([1, 2, 3], [1, 2, 3]), 1);
    });
    test('perfect negative correlation → -1', () => {
        assert.strictEqual(kendallTauB([1, 2, 3], [3, 2, 1]), -1);
    });
    test('all ties on one variable → 0', () => {
        // All dx=0 → Tx=3, denom=sqrt(3*0)=0 → 0
        assert.strictEqual(kendallTauB([1, 1, 1], [1, 2, 3]), 0);
    });
    test('n < 2 → null', () => {
        assert.strictEqual(kendallTauB([1], [1]), null);
    });
});

// ---------------------------------------------------------------------------

describe('goodmanKruskalGamma', () => {
    test('all concordant → 1', () => {
        assert.strictEqual(goodmanKruskalGamma([1, 2, 3], [1, 2, 3]), 1);
    });
    test('all discordant → -1', () => {
        assert.strictEqual(goodmanKruskalGamma([1, 2, 3], [3, 2, 1]), -1);
    });
    test('all ties → 0', () => {
        // All pairs tied on x, skipped → C+D=0 → 0
        assert.strictEqual(goodmanKruskalGamma([1, 1, 1], [1, 2, 3]), 0);
    });
    test('mixed: more concordant than discordant → positive', () => {
        // [1,2,3,4] vs [1,2,4,3]: pairs (3,4) and (4,3) flip — mostly concordant
        assert.ok(goodmanKruskalGamma([1, 2, 3, 4], [1, 2, 4, 3]) > 0);
    });
    test('n < 2 → null', () => {
        assert.strictEqual(goodmanKruskalGamma([1], [1]), null);
    });
});

// ---------------------------------------------------------------------------

describe('hashStringToUint32', () => {
    test('deterministic: same string gives same value', () => {
        assert.strictEqual(hashStringToUint32('hello'), hashStringToUint32('hello'));
        assert.strictEqual(hashStringToUint32(''), hashStringToUint32(''));
    });
    test('returns a non-negative integer ≤ 2^32−1', () => {
        for (const s of ['', 'a', 'test', 'study1']) {
            const h = hashStringToUint32(s);
            assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xFFFFFFFF);
        }
    });
    test('different strings produce different values (spot check)', () => {
        assert.notEqual(hashStringToUint32('foo'), hashStringToUint32('bar'));
        assert.notEqual(hashStringToUint32('a'), hashStringToUint32('b'));
    });
});

// ---------------------------------------------------------------------------

describe('csvField', () => {
    test('plain string returned as-is', () => {
        assert.strictEqual(csvField('hello'), 'hello');
    });
    test('number converted to string, returned as-is', () => {
        assert.strictEqual(csvField(42), '42');
    });
    test('empty string returned as-is', () => {
        assert.strictEqual(csvField(''), '');
    });
    test('value with comma is quoted', () => {
        assert.strictEqual(csvField('a,b'), '"a,b"');
    });
    test('value with double-quote is quoted and escaped', () => {
        assert.strictEqual(csvField('say "hi"'), '"say ""hi"""');
    });
    test('value with newline is quoted', () => {
        assert.strictEqual(csvField('line1\nline2'), '"line1\nline2"');
    });
    test('JSON object string (the motivating case) is quoted', () => {
        const json = JSON.stringify({showDots: true, showMedian: false});
        const result = csvField(json);
        assert.ok(result.startsWith('"') && result.endsWith('"'));
        // Round-trip: stripping outer quotes and unescaping should recover the original
        assert.strictEqual(result.slice(1, -1).replace(/""/g, '"'), json);
    });
});

// ---------------------------------------------------------------------------

describe('skewness', () => {
    test('symmetric array returns 0', () => {
        assertFuzzyEqual(skewness([1, 2, 3, 4, 5]), 0);
    });
    test('right-skewed: one high outlier gives positive skewness', () => {
        // [1,1,1,5]: mean=2, m2=3, m3=6, skewness=6/3^1.5 ≈ 1.1547
        assertFuzzyEqual(skewness([1, 1, 1, 5]), 6 / Math.pow(3, 1.5), 1e-9);
    });
    test('left-skewed: one low outlier gives negative skewness', () => {
        assertFuzzyEqual(skewness([1, 5, 5, 5]), -6 / Math.pow(3, 1.5), 1e-9);
    });
    test('constant array returns 0 (no divide-by-zero)', () => {
        assertFuzzyEqual(skewness([3, 3, 3, 3]), 0);
    });
    test('negates when array is reflected', () => {
        const a = [1, 2, 4, 8];
        const neg = a.map(v => -v);
        assertFuzzyEqual(skewness(a), -skewness(neg), 1e-9);
    });
});

// ---------------------------------------------------------------------------
// Sanity checks for harder-to-test functions
// ---------------------------------------------------------------------------

describe('mulberry32 — sanity', () => {
    test('produces values in [0, 1)', () => {
        const rng = mulberry32(42 >>> 0);
        for (let i = 0; i < 200; i++) {
            const v = rng();
            assert.ok(v >= 0 && v < 1, `value ${v} out of [0, 1)`);
        }
    });
    test('deterministic: same seed → same sequence', () => {
        const rng1 = mulberry32(99999 >>> 0);
        const rng2 = mulberry32(99999 >>> 0);
        for (let i = 0; i < 50; i++)
            assert.strictEqual(rng1(), rng2());
    });
    test('different seeds produce different sequences', () => {
        const r1 = mulberry32(1 >>> 0)();
        const r2 = mulberry32(2 >>> 0)();
        assert.notEqual(r1, r2);
    });
});

describe('randomNormal — sanity', () => {
    test('produces finite values', () => {
        const rng = mulberry32(1 >>> 0);
        for (let i = 0; i < 100; i++)
            assert.ok(Number.isFinite(randomNormal(rng)));
    });
});

describe('owensT — sanity', () => {
    test('T(h, 0) = 0 for any h', () => {
        for (const h of [-2, -1, 0, 1, 2])
            assertFuzzyEqual(owensT(h, 0), 0);
    });
    test('T(0, a) ≈ atan(a) / (2π)', () => {
        for (const a of [0.5, 1, 2])
            assertFuzzyEqual(owensT(0, a), Math.atan(a) / (2 * Math.PI), 1e-4);
    });
});

describe('normalToSkewNormal — sanity', () => {
    test('alpha=0 ≈ identity', () => {
        for (const z of [-2, -1, 0, 1, 2])
            assertFuzzyEqual(normalToSkewNormal(z, 0), z, 1e-6);
    });
    test('monotone increasing in z', () => {
        let prev = -Infinity;
        for (const z of [-2, -1, 0, 1, 2]) {
            const x = normalToSkewNormal(z, 3);
            assert.ok(x > prev, `not monotone at z=${z}: ${x} <= ${prev}`);
            prev = x;
        }
    });
});

describe('makeBinomialSampler — sanity', () => {
    test('produces integers in [0, n]', () => {
        const rng = mulberry32(7 >>> 0);
        const sample = makeBinomialSampler(10, 0.3);
        for (let i = 0; i < 200; i++) {
            const v = sample(rng);
            assert.ok(Number.isInteger(v) && v >= 0 && v <= 10,
                `value ${v} outside [0, 10]`);
        }
    });
});

describe('shuffleInPlace — sanity', () => {
    test('preserves all elements', () => {
        const rng = mulberry32(42 >>> 0);
        const original = [1, 2, 3, 4, 5, 6, 7, 8];
        const arr = [...original];
        shuffleInPlace(arr, rng);
        assert.deepStrictEqual([...arr].sort((a, b) => a - b), original);
    });
    test('length unchanged', () => {
        const rng = mulberry32(1 >>> 0);
        const arr = [10, 20, 30];
        shuffleInPlace(arr, rng);
        assert.strictEqual(arr.length, 3);
    });
});
