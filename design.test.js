// design.test.js — unit tests for design.js and data.js
// Run with: node --test  (Node 18+)

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from './utils.js';
import { makeWeightedSignalPool, applySignal, makeDesign } from './design.js';
import { generateBasePanel, finalizePanel } from './data.js';
import { N_PER_GROUP, JITTER_CATALOG, N_DUPLICATE_SEEDS, DIST_REPS } from './config.js';
import { buildCatalog } from './catalog.js';

// ---------------------------------------------------------------------------
// Minimal mock catalog: N plain chart type categories, 1 variant each
// ---------------------------------------------------------------------------
function makeCatalog(nTypes) {
    const types = ['bar', 'box', 'violin', 'dot', 'strip', 'hist'];
    return types.slice(0, nTypes).map(t => ({
        type: t,
        variants: [{label: t + '_plain', plain: true}],
    }));
}

// Small fixed seed pool for use in makeDesign tests
const TEST_SEEDS = Array.from({length: 20}, (_, i) => (i + 101) * 100_000);

// ---------------------------------------------------------------------------

describe('makeWeightedSignalPool', () => {
    test('length equals nTrials', () => {
        const rng = mulberry32(1 >>> 0);
        const signals = [
            {type: 'null',     weight: 5},
            {type: 'location', weight: 3},
            {type: 'spread',   weight: 2},
        ];
        assert.strictEqual(makeWeightedSignalPool(signals, 40, rng).length, 40);
    });

    test('weight-0 signals excluded', () => {
        const rng = mulberry32(2 >>> 0);
        const signals = [
            {type: 'null',     weight: 10},
            {type: 'location', weight: 0},
        ];
        const pool = makeWeightedSignalPool(signals, 20, rng);
        assert.ok(pool.every(s => s.type !== 'location'),
            'weight-0 signal should not appear');
    });

    test('deterministic: same seed → same sequence', () => {
        const signals = [{type: 'null', weight: 5}, {type: 'location', weight: 5}];
        const p1 = makeWeightedSignalPool(signals, 10, mulberry32(42 >>> 0));
        const p2 = makeWeightedSignalPool(signals, 10, mulberry32(42 >>> 0));
        assert.deepStrictEqual(p1.map(s => s.type), p2.map(s => s.type));
    });

    test('all pool entries come from the active signal set', () => {
        const signals = [{type: 'null', weight: 3}, {type: 'spread', weight: 7}];
        const pool = makeWeightedSignalPool(signals, 30, mulberry32(3 >>> 0));
        const allowed = new Set(signals.map(s => s.type));
        assert.ok(pool.every(s => allowed.has(s.type)));
    });

    test('counts match largest-remainder allocation (1:9 ratio)', () => {
        const signals = [{type: 'rare', weight: 1}, {type: 'common', weight: 9}];
        const pool = makeWeightedSignalPool(signals, 100, mulberry32(5 >>> 0));
        assert.strictEqual(pool.filter(s => s.type === 'rare').length,   10);
        assert.strictEqual(pool.filter(s => s.type === 'common').length, 90);
    });

    test('single active signal fills entire pool', () => {
        const signals = [{type: 'only', weight: 5}, {type: 'skip', weight: 0}];
        const pool = makeWeightedSignalPool(signals, 15, mulberry32(9 >>> 0));
        assert.strictEqual(pool.length, 15);
        assert.ok(pool.every(s => s.type === 'only'));
    });
});

// ---------------------------------------------------------------------------

describe('applySignal', () => {
    function makePanel(nPerGroup = 5) {
        const n = nPerGroup * 2;
        return {
            y:     Array.from({length: n}, (_, i) => i * 0.1 + 0.1),  // 0.1..1.0
            group: Array.from({length: n}, (_, i) => i < nPerGroup ? 0 : 1),
        };
    }

    test('null signal leaves panel unchanged', () => {
        const panel = makePanel();
        const before = [...panel.y];
        applySignal(panel, 'normal', {type: 'null'}, mulberry32(1 >>> 0));
        assert.deepStrictEqual(panel.y, before);
    });

    test('location: only signal group is shifted', () => {
        const panel = makePanel(4);
        const before = [...panel.y];
        applySignal(panel, 'normal', {type: 'location', delta_sd: 1.0}, mulberry32(1 >>> 0), 1);
        for (let i = 0; i < 4; i++)
            assert.strictEqual(panel.y[i], before[i], `group 0 index ${i} should be unchanged`);
        for (let i = 4; i < 8; i++)
            assert.ok(Math.abs(panel.y[i] - (before[i] + 1.0)) < 1e-10,
                `group 1 index ${i} should shift by 1.0`);
    });

    test('location: signalGroup=0 shifts group 0, not group 1', () => {
        const panel = makePanel(4);
        const before = [...panel.y];
        applySignal(panel, 'normal', {type: 'location', delta_sd: 2.0}, mulberry32(1 >>> 0), 0);
        for (let i = 0; i < 4; i++)
            assert.ok(Math.abs(panel.y[i] - (before[i] + 2.0)) < 1e-10, `group 0 index ${i}`);
        for (let i = 4; i < 8; i++)
            assert.strictEqual(panel.y[i], before[i], `group 1 index ${i} should be unchanged`);
    });

    test('spread: only signal group is scaled', () => {
        const panel = makePanel(4);
        const before = [...panel.y];
        applySignal(panel, 'normal', {type: 'spread', spread_factor: 3.0}, mulberry32(1 >>> 0), 1);
        for (let i = 0; i < 4; i++)
            assert.strictEqual(panel.y[i], before[i], `group 0 index ${i} should be unchanged`);
        for (let i = 4; i < 8; i++)
            assert.ok(Math.abs(panel.y[i] - before[i] * 3.0) < 1e-10,
                `group 1 index ${i} should scale by 3`);
    });

    test('skew leaves reference group unchanged and normalises signal group', () => {
        const panel = makePanel(10);
        const before = [...panel.y];
        applySignal(panel, 'normal', {type: 'skew', base: 2.0}, mulberry32(1 >>> 0), 1);
        // group 0 unchanged
        for (let i = 0; i < 10; i++)
            assert.strictEqual(panel.y[i], before[i], `group 0 index ${i} should be unchanged`);
        // group 1 modified and normalised: mean ≈ 0, sd ≈ 1
        const g1 = panel.y.slice(10);
        const mean = g1.reduce((s, v) => s + v, 0) / g1.length;
        const sd = Math.sqrt(g1.reduce((s, v) => s + (v - mean) ** 2, 0) / g1.length);
        assert.ok(Math.abs(mean) < 1e-10, `signal group mean should be 0, got ${mean}`);
        assert.ok(Math.abs(sd - 1) < 1e-10, `signal group sd should be 1, got ${sd}`);
        assert.notDeepStrictEqual(g1, before.slice(10), 'signal group should be changed');
    });

    test('outlier places nHigh large positive values in signal group', () => {
        const panel = makePanel(10);
        applySignal(panel, 'normal',
            {type: 'outlier', nHigh: 2, nLow: 0, magnitude: 5.0},
            mulberry32(1 >>> 0), 1);
        const group1 = panel.y.slice(10);
        assert.strictEqual(group1.filter(v => v >= 5.0).length, 2);
    });

    test('outlier: nLow places large negative values in signal group', () => {
        const panel = makePanel(10);
        applySignal(panel, 'normal',
            {type: 'outlier', nHigh: 0, nLow: 2, magnitude: 5.0},
            mulberry32(1 >>> 0), 1);
        const group1 = panel.y.slice(10);
        assert.strictEqual(group1.filter(v => v <= -5.0).length, 2);
    });

    test('unknown signal type throws', () => {
        const panel = makePanel(3);
        assert.throws(
            () => applySignal(panel, 'normal', {type: 'bogus'}, mulberry32(1 >>> 0)),
            /Unknown signal type/
        );
    });
});

// ---------------------------------------------------------------------------

describe('finalizePanel', () => {
    test('groups are sorted ascending', () => {
        const {groups} = finalizePanel([3, 1, 4, 2], [0, 0, 1, 1]);
        assert.deepStrictEqual(groups[0], [1, 3]);
        assert.deepStrictEqual(groups[1], [2, 4]);
    });

    test('group sizes match input distribution', () => {
        const {groups} = finalizePanel([1, 2, 3, 4, 5, 6], [0, 0, 0, 1, 1, 1]);
        assert.strictEqual(groups[0].length, 3);
        assert.strictEqual(groups[1].length, 3);
    });

    test('values routed to the correct group', () => {
        const {groups} = finalizePanel([10, 20, 30, 40], [1, 0, 1, 0]);
        assert.deepStrictEqual(groups[0], [20, 40]);
        assert.deepStrictEqual(groups[1], [10, 30]);
    });

    test('unequal group sizes handled correctly', () => {
        const {groups} = finalizePanel([5, 3, 1, 2, 4], [0, 0, 1, 1, 1]);
        assert.strictEqual(groups[0].length, 2);
        assert.strictEqual(groups[1].length, 3);
        assert.deepStrictEqual(groups[0], [3, 5]);
        assert.deepStrictEqual(groups[1], [1, 2, 4]);
    });
});

// ---------------------------------------------------------------------------

describe('generateBasePanel', () => {
    test('returns N_PER_GROUP values per group', () => {
        const {y, group} = generateBasePanel('normal', 12300000);
        assert.strictEqual(y.length, N_PER_GROUP * 2);
        assert.strictEqual(group.filter(g => g === 0).length, N_PER_GROUP);
        assert.strictEqual(group.filter(g => g === 1).length, N_PER_GROUP);
    });

    test('all values are finite for normal', () => {
        const {y} = generateBasePanel('normal', 12300000);
        assert.ok(y.every(Number.isFinite));
    });

    test('all values are finite for lognormal', () => {
        const {y} = generateBasePanel('lognormal', 12300000);
        assert.ok(y.every(Number.isFinite));
    });

    test('all values are finite for binomial', () => {
        const {y} = generateBasePanel('binomial', 12300000);
        assert.ok(y.every(Number.isFinite));
    });

    test('deterministic: same seed gives same output', () => {
        const p1 = generateBasePanel('normal', 99900000);
        const p2 = generateBasePanel('normal', 99900000);
        assert.deepStrictEqual(p1.y, p2.y);
    });

    test('different seeds give different output', () => {
        const p1 = generateBasePanel('normal', 12300000);
        const p2 = generateBasePanel('normal', 12400000);
        assert.notDeepStrictEqual(p1.y, p2.y);
    });

    test('only normal dist is supported; always returns N×2 panel', () => {
        const panel = generateBasePanel('normal', 12300000);
        assert.strictEqual(panel.y.length, panel.group.length);
        assert.ok(panel.y.length > 0);
    });
});

// ---------------------------------------------------------------------------

describe('makeDesign — structural constraints', () => {
    // 4 chart types, 1 variant each → 4 groups
    // distReps.normal=5 → 5×4=20 base conditions
    // nDups = min(N_DUPLICATE_SEEDS, 20)
    const catalog   = makeCatalog(4);
    const distReps  = {normal: 5, lognormal: 0, binomial: 0};
    const nBase     = distReps.normal * catalog.length;
    const nDups     = Math.min(N_DUPLICATE_SEEDS, nBase);

    function buildDesign(seed = 42) {
        return makeDesign({
            rng: mulberry32(seed >>> 0),
            catalog,
            nChartTypes:   4,
            nVariantTypes: 1,
            distReps,
            dataSeeds: TEST_SEEDS,
        });
    }

    test('deterministic: same seed produces identical condition sequence', () => {
        const d1 = buildDesign(7);
        const d2 = buildDesign(7);
        assert.strictEqual(d1.conditions.length, d2.conditions.length);
        d1.conditions.forEach((c, i) => {
            assert.strictEqual(c.chartType,  d2.conditions[i].chartType);
            assert.strictEqual(c.dataSeed,   d2.conditions[i].dataSeed);
            assert.strictEqual(c.signalGroup, d2.conditions[i].signalGroup);
        });
    });

    test('total condition count = base + duplicates', () => {
        const {conditions} = buildDesign();
        assert.strictEqual(conditions.length, nBase + nDups);
    });

    test('signalGroup is exactly floor(n/2) zeros and ceil(n/2) ones', () => {
        const {conditions} = buildDesign();
        const n  = conditions.length;
        const n0 = conditions.filter(c => c.signalGroup === 0).length;
        const n1 = conditions.filter(c => c.signalGroup === 1).length;
        assert.strictEqual(n0, Math.floor(n / 2));
        assert.strictEqual(n1, Math.ceil(n / 2));
    });

    test('jitter pool is balanced: each method appears floor or ceil times', () => {
        const {conditions} = buildDesign();
        const n = conditions.length;
        const counts = Object.fromEntries(JITTER_CATALOG.map(j => [j, 0]));
        for (const c of conditions)
            counts[c.jitter]++;
        const lo = Math.floor(n / JITTER_CATALOG.length);
        const hi = Math.ceil(n  / JITTER_CATALOG.length);
        for (const [method, count] of Object.entries(counts))
            assert.ok(count === lo || count === hi,
                `jitter '${method}': count=${count}, expected ${lo} or ${hi}`);
    });

    test('all dataSeeds come from the provided pool', () => {
        const {conditions} = buildDesign();
        const pool = new Set(TEST_SEEDS);
        for (const c of conditions)
            assert.ok(pool.has(c.dataSeed), `unexpected dataSeed: ${c.dataSeed}`);
    });

    test('duplicate pairs use a different chart type than their source', () => {
        // Any two conditions sharing the same (dataSeed, signal) must have different chartTypes.
        const {conditions} = buildDesign();
        const seen = new Map();
        for (const c of conditions) {
            const key = `${c.dataSeed}__${c.signal.type}__${JSON.stringify(c.signal)}`;
            if (!seen.has(key))
                seen.set(key, []);
            seen.get(key).push(c.chartType);
        }
        for (const [, types] of seen) {
            if (types.length > 1)
                assert.strictEqual(new Set(types).size, types.length,
                    `duplicate conditions share chartType: ${types}`);
        }
    });

    test('every condition has signalGroup 0 or 1', () => {
        const {conditions} = buildDesign();
        for (const c of conditions)
            assert.ok(c.signalGroup === 0 || c.signalGroup === 1,
                `unexpected signalGroup: ${c.signalGroup}`);
    });

    test('every condition has a jitter from JITTER_CATALOG', () => {
        const {conditions} = buildDesign();
        const catalog = new Set(JITTER_CATALOG);
        for (const c of conditions)
            assert.ok(catalog.has(c.jitter), `unexpected jitter: ${c.jitter}`);
    });
});

// ---------------------------------------------------------------------------
// Variant balance across many participants (seeds 1..100, real catalog)
// ---------------------------------------------------------------------------
// The real catalog has 4 chart type categories. With nChartTypes=4 and
// nVariantTypes=Infinity, every participant sees all 4 types. Variant selection
// within each type depends on the per-participant RNG shuffle:
//
//   box   — 3 variants: box-plain (non-solo), box+dots (non-solo), range bar (solo).
//            solo is selected alone only when it comes first in the shuffle (~1/3).
//            Otherwise 1 or 2 non-solo variants are selected.
//   bands — 4 variants: all solo. Exactly one is selected per participant (~1/4 each).
//   dot   — 2 variants: both non-solo → always selected together.
//   violin — 4 variants: all non-solo → always all 4 selected.
// ---------------------------------------------------------------------------

describe('makeDesign — variant balance across 100 participants', () => {
    // Stubs: explanation functions in the catalog call these at render time only;
    // makeDesign never invokes them, so plain stubs suffice.
    const catalog = buildCatalog(() => "vertical", () => ({design: {jitter: "random"}}));

    const designs = Array.from({length: 100}, (_, i) =>
        makeDesign({
            rng:           mulberry32((i + 1) >>> 0),
            catalog,
            nChartTypes:   4,
            nVariantTypes: Infinity,
            distReps:      DIST_REPS,
            dataSeeds:     TEST_SEEDS,
        })
    );

    // Helper: count how many designs include at least one selectedChartType matching pred.
    function countWith(pred) {
        return designs.filter(d => d.selectedChartTypes.some(pred)).length;
    }

    test('range bar appears in roughly 1/3 of participants (expected ~33, bounds [20, 47])', () => {
        const count = countWith(ct => ct.options.whiskers === 'range');
        assert.ok(count >= 20 && count <= 47,
            `range bar appeared in ${count}/100 participants, expected ~33`);
    });

    test('each bands variant appears in roughly 1/4 of participants (bounds [12, 40])', () => {
        const bandVariants = [
            {name: 'central bands (quantile)', pred: ct => ct.type === 'bands' && ct.options.bandType === 'quantile'},
            {name: 'density bands 50/90/99',   pred: ct => ct.type === 'bands' && ct.options.bandType === 'hdr' && ct.options.cutoffs[0] === 0.50},
            {name: 'density bands 5/50/90',    pred: ct => ct.type === 'bands' && ct.options.bandType === 'hdr' && ct.options.cutoffs[0] === 0.05},
            {name: 'density bands 33/67/100',  pred: ct => ct.type === 'bands' && ct.options.bandType === 'hdr' && ct.options.cutoffs[0] === 1/3},
        ];
        for (const {name, pred} of bandVariants) {
            const count = countWith(pred);
            assert.ok(count >= 12 && count <= 40,
                `${name}: appeared in ${count}/100 participants, expected ~25`);
        }
    });

    test('exactly one bands variant per participant (all bands variants are solo)', () => {
        for (const d of designs) {
            const bandsCount = d.selectedChartTypes.filter(ct => ct.type === 'bands').length;
            assert.strictEqual(bandsCount, 1,
                `expected exactly 1 bands variant, got ${bandsCount}`);
        }
    });

    test('all 4 violin variants appear in every participant design', () => {
        for (const d of designs) {
            const seen = new Set(
                d.selectedChartTypes
                    .filter(ct => ct.type === 'violin')
                    .map(ct => ct.options.description)
            );
            assert.strictEqual(seen.size, 4,
                `expected all 4 violin variants, got ${seen.size}: ${[...seen].join(', ')}`);
        }
    });

    test('both dot variants appear in every participant design', () => {
        for (const d of designs) {
            const dotCount = d.selectedChartTypes.filter(ct => ct.type === 'dot').length;
            assert.strictEqual(dotCount, 2,
                `expected 2 dot variants, got ${dotCount}`);
        }
    });

    test('all 4 chart type categories appear in every participant design', () => {
        const expected = new Set(['box', 'bands', 'dot', 'violin']);
        for (const d of designs) {
            const types = new Set(d.selectedChartTypes.map(ct => ct.type));
            for (const t of expected)
                assert.ok(types.has(t), `missing chart type '${t}'`);
        }
    });
});
