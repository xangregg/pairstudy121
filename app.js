// app.js

import {renderChart} from "./renderers.js";
import {quantileSorted, ksStat, interpolate, spearmanCorrelation, kendallTauB, goodmanKruskalGamma} from "./utils.js";
import {mulberry32, hashStringToUint32, randomNormal, normalToSkewNormal} from "./utils.js";
import {N_PER_GROUP, STORAGE_KEY, RATING_DELAY_MS, DIST_REPS, DIST_REPS_TESTING} from "./config.js";
import {buildCatalog} from "./catalog.js";
import {loadOrCreateSession, postResponse, postSession, postComment} from "./database.js";
import {BG_QUESTIONS, yourTaskHTML, backgroundHTML, RATING_SCALE, TRIAL_QUESTION} from "./question.js";
import {generateBasePanel, finalizePanel, computeDataSeeds} from "./data.js";
import {applySignal, makeDesign} from "./design.js";

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
const PROLIFIC_PID = params.get("PROLIFIC_PID") ?? params.get("prolific_pid");
const PROLIFIC_STUDY_ID = params.get("STUDY_ID") ?? params.get("study_id");
const PROLIFIC_SESSION_ID = params.get("SESSION_ID") ?? params.get("session_id");
// Completion code is base64-encoded in the survey URL (?cc=...) so it isn't immediately
// readable to participants. Encode once with btoa("YOUR_CODE") when setting up the study URL.
const COMPLETION_CODE = (() => {
    const raw = params.get("pg");
    if (!raw)
        return null;
    try { return atob(raw); }
    catch { return raw; }
})();

const N_CHART_TYPES = TESTING ? Infinity : 4;
const N_VARIANT_TYPES = Infinity; // solo field in catalog limits variants where needed
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
    onboardingBackBtn: document.getElementById("onboardingBackBtn"),
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
    againBtn: document.getElementById("againBtn"),
    againNote: document.getElementById("againNote"),
};

let currentTrial = null;
let trialStartPerf = null;

/** ---------- Base data ---------- **/

const DATA_SEEDS = computeDataSeeds(distReps, !!SEEDREVIEW_DIST);

// Each entry lists display variants for that chart type.
// At design time, N_CHART_TYPES types are chosen per participant (seeded shuffle),
// and one variant is picked per type — both are between-subjects factors.
// explanation must be a function (called at render time) so orientation words resolve correctly.
// Built after currentOrientation is defined (see below).
let CHART_TYPE_CATALOG;

// Compute per-group descriptive statistics from a panel for recording alongside ratings.
function groupStats(panel) {
    // groups are pre-sorted by finalizePanel; no sort needed here.
    function stats(sorted) {
        const n = sorted.length;
        const mean = sorted.reduce((s, v) => s + v, 0) / n;
        const sd = Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
        return {
            mean,
            sd,
            min: sorted[0],
            q1: quantileSorted(sorted, 0.25),
            med: quantileSorted(sorted, 0.50),
            q3: quantileSorted(sorted, 0.75),
            max: sorted[n - 1]
        };
    }

    return {a: stats(panel.groups[0]), b: stats(panel.groups[1])};
}


/** ---------- Trial building ---------- **/
function buildTrial(trialIdx, cond) {
    const conditionId = `${cond.chartType}|${JSON.stringify(cond.chartOptions)}|${cond.dist}|${JSON.stringify(cond.signal)}|${cond.dataSeed}`;
    const trialSeed = hashStringToUint32(`${session.participantSeed}|${trialIdx}|${conditionId}`);
    const rng = mulberry32(trialSeed);

    const raw = generateBasePanel(cond.dist, cond.dataSeed, cond.signal, cond.signalGroup);
    // Binomial signals are baked into generateBasePanel via binomialGroupParams; all others are post-hoc.
    if (cond.dist !== "binomial")
        applySignal(raw, cond.dist, cond.signal, rng, cond.signalGroup);

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

function showPage(page) {
    for (const p of PAGES()) p.style.display = p === page ? "block" : "none";
}

function showIntro() {
    showPage(UI.introPage);
    document.getElementById("introTrialCount").textContent = session.design.conditions.length;
}

function showOnboarding() {
    showPage(UI.onboardingPage);
    renderOnboardingStep();
}

function showTrial() {
    showPage(UI.trialPage);
}

function showCompletion() {
    showPage(UI.completionPage);
}

/** ---------- Onboarding ---------- **/
function getOnboardingSteps() {
    // One training page per unique chart type, using the first variant of that type.
    // Sort by first trial appearance so training order matches study order.
    const typeToFirstIdx = new Map();
    for (let i = 0; i < session.design.selectedChartTypes.length; i++) {
        const type = session.design.selectedChartTypes[i].type;
        if (!typeToFirstIdx.has(type))
            typeToFirstIdx.set(type, i);
    }
    const typeFirstTrial = new Map([...typeToFirstIdx.keys()].map(t => [t, Infinity]));
    session.design.conditions.forEach((cond, trialIdx) => {
        if (trialIdx < typeFirstTrial.get(cond.chartType))
            typeFirstTrial.set(cond.chartType, trialIdx);
    });
    const sortedTypes = [...typeToFirstIdx.keys()]
        .sort((a, b) => typeFirstTrial.get(a) - typeFirstTrial.get(b));

    const steps = [];
    if (!session.skipIntro) {
        steps.push({type: "background"});
        steps.push({type: "sampling1"}, {type: "sampling2"}, {type: "sampling3"});
    }
    steps.push(
        {type: "chartTypeIntro"},
        ...sortedTypes.map(chartType => ({type: "chartType", index: typeToFirstIdx.get(chartType)})),
        {type: "responseScale"},
    );
    return steps;
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
    const src3b = Array.from({length: N_SRC}, () => randomNormal(rng) * 0.65 + 0.2);
    const s3b = Array.from({length: N_PER_GROUP}, () => randomNormal(rng) * 0.65 + 0.2);

    const panel1 = finalizePanel(
        [...src1, ...s2a],
        [...src1.map(() => 0), ...s2a.map(() => 1)]
    );
    const panel2 = finalizePanel(
        [...src1, ...s2a, ...s2b, ...s2c],
        [...src1.map(() => 0), ...s2a.map(() => 1), ...s2b.map(() => 2), ...s2c.map(() => 3)]
    );
    const panel3 = finalizePanel(
        [...src3a, ...src3b, ...s3a, ...s3b],
        [...src3a.map(() => 0), ...src3b.map(() => 1), ...s3a.map(() => 2), ...s3b.map(() => 3)]
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

const WIDTH_2_UP = 450;
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
        {violinScale: 7, ...getPlainCatalogOptions(ct.type)}, currentOrientation(), session.design.jitter);
}

// Look up the live catalog variant so explanation functions survive localStorage round-trips.
function getLiveCatalogOptions(ct) {
    const entry = CHART_TYPE_CATALOG.find(e => e.type === ct.type);
    return entry?.variants.find(v => v.description === ct.options.description) ?? ct.options;
}

// Return the plain variant for a chart type (the one marked plain:true, or the first non-solo variant).
// Used for training pages and thumbnails so the display doesn't depend on which variants were assigned.
function getPlainCatalogOptions(chartType) {
    const entry = CHART_TYPE_CATALOG.find(e => e.type === chartType);
    if (!entry)
        return {};
    const plain = entry.variants.find(v => v.plain);
    if (plain)
        return plain;
    const nonSolo = entry.variants.find(v => !v.solo);
    return nonSolo ?? entry.variants[0];
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
    const isSamplingSection = step.type === "sampling1" || step.type === "sampling2" || step.type === "sampling3";
    const horiz = currentOrientation() === "horizontal";
    UI.onboardingText.style.minHeight = isChartTypeSection ? "150px" : isSamplingSection ? "150px" : "";
    const naturalCanvasH = isChartTypeSection ? (horiz ? WIDTH_2_UP : HEIGHT_2_UP) - (step.type === "chartTypeIntro" ? 10 : 0)
        : isSamplingSection ? (horiz ? WIDTH_4_UP_TRAINING : HEIGHT_4_UP_TRAINING) : 0;
    UI.onboardingCanvasArea.style.minHeight = naturalCanvasH
        ? Math.min(naturalCanvasH, onboardingCanvasMaxHeight()) + "px" : "";
    UI.onboardingCanvasArea.style.display = step.type === "chartTypeIntro" ? "flex" : "";
    UI.onboardingCanvasArea.style.flexDirection = step.type === "chartTypeIntro" ? "column" : "";
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
            Sources can differ in <strong>location</strong>, <strong>spread</strong>, or <strong>shape</strong>.
            Source 2 has a slightly offset central location and less spread.
            Notice how samples A and B also look different from each other.</p>`;
        const {panel3} = getOnboardingPanels();
        renderSamplingCanvas(panel3, ["Source 1", "Source 2", "A", "B"]);

    }
    else if (step.type === "chartTypeIntro") {
        const n = new Set(session.design.selectedChartTypes.map(ct => ct.type)).size;
        UI.onboardingTitle.textContent = "Chart Types";
        UI.onboardingText.innerHTML =
            `<p>Over the course of the study you'll see <strong>${n} main chart ${n === 1 ? "type" : "types"}</strong>,
            briefly explained on the following pages.
            Some charts will show a combination of elements from different chart types, such as overlaid dots.
            </p><p>Each page will include a short summary of the chart details above the trial pair.</p>`;
        UI.onboardingThumbnails.style.display = "flex";
        renderChartTypeThumbs(UI.onboardingThumbnails.querySelectorAll(".onboardingThumb"));
    }
    else if (step.type === "chartType") {
        const ct = session.design.selectedChartTypes[step.index];
        const opts = getPlainCatalogOptions(ct.type);
        UI.onboardingTitle.textContent = `How to read: ${opts.titleText ?? opts.description}`;
        const expl = typeof opts.explanation === "function" ? opts.explanation() : (opts.explanation ?? "");
        UI.onboardingText.innerHTML =
            `<p>${expl}</p>
            <p>Below is one example pair where both samples come from the same source.</p>`;
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
    if (window.innerWidth <= 480)
        return "vertical";
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
    renderChart(ctx, UI.chart, trial.condition.chartType, trial.panel, trial.yMin, trial.yMax, trial.condition.chartOptions, orientation, trial.condition.jitter);

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
    session.design = makeDesign({
        rng,
        catalog: CHART_TYPE_CATALOG,
        nChartTypes: N_CHART_TYPES,
        nVariantTypes: N_VARIANT_TYPES,
        distReps,
        dataSeeds: DATA_SEEDS
    });
    const orientOverride = params.get("orientation");
    if (orientOverride === "horizontal" || orientOverride === "vertical")
        session.design.orientation = orientOverride;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function renderChartTypeThumbs(thumbs) {
    const steps = getOnboardingSteps();
    const chartSteps = steps.filter(s => s.type === "chartType");
    const thumbW = 140;
    const thumbH = 300;
    chartSteps.forEach((step, i) => {
        if (i >= thumbs.length)
            return;
        const c = thumbs[i];
        c.width = thumbW * 2;   // 2× for crisp rendering
        c.height = thumbH * 2;
        const ct = session.design.selectedChartTypes[step.index];
        const opts = getPlainCatalogOptions(ct.type);
        const panel = buildChartTypeExamplePanel(ct.type);
        let mn = Infinity, mx = -Infinity;
        for (const g of panel.groups) {
            if (g[0] < mn)
                mn = g[0];
            if (g[g.length - 1] > mx)
                mx = g[g.length - 1];
        }
        const span = (mx - mn) || 1;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, c.width, c.height);
        renderChart(ctx, c, ct.type, panel,
            mn - span * 0.12, mx + span * 0.12,
            {forThumbnail: true, violinScale: 7, ...opts}, "vertical", "density random");
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

// K-S thresholds (N=50 per group) mapping realized D to expected rating 1–4.
//  for N=50 per group, the K-S critical values (p=0.05 ≈ 0.27, p=0.01 ≈ 0.32) give rough anchors.
const KS_THRESHOLDS = [0.15, 0.24, 0.32]; // boundaries between ratings 1/2, 2/3, 3/4

// Integer bucket (1–4) for table grouping.
function ksToExpectedRating(ks) {
    if (ks < KS_THRESHOLDS[0])
        return 1;
    if (ks < KS_THRESHOLDS[1])
        return 2;
    if (ks < KS_THRESHOLDS[2])
        return 3;
    return 4;
}

// Piecewise-linear interpolation of ks → continuous expected rating.
// Anchors extend below 1 and above 4 to allow overage at the endpoints,
// so extreme KS values don't produce artificially large penalties.
function ksInterpolated(ks) {
    const anchors = [0, 0.05, ...KS_THRESHOLDS, 0.44, 1.0];
    const ratings = [0.5, 1, 1.5, 2.5, 3.5, 4.4, 4.5]; // allow overage
    return interpolate(ks, anchors, ratings);
}

function computeRatingStats() {
    const buckets = {1: [], 2: [], 3: [], 4: []};
    let totalSqErr = 0;
    const ksValues = [], ratings = [];
    const grace = 0.25; // no penalty within this much

    for (const r of session.results) {
        if (r.ks == null)
            continue;
        buckets[ksToExpectedRating(r.ks)].push(r.rating);
        let ksInterpolatedRating = ksInterpolated(r.ks);
        if ((r.rating === 4 && ksInterpolatedRating >= 4) || (r.rating === 1 && ksInterpolatedRating <= 1))
            ;   // no error -- can't get any closer
        else {
            const rDiff = Math.max(0, Math.abs(r.rating - ksInterpolatedRating) - grace);
            totalSqErr += rDiff ** 2;
        }
        ksValues.push(r.ks);
        ratings.push(r.rating);
    }
    const n = ksValues.length;
    const avg = arr => arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length;
    const byBucket = Object.fromEntries(
        Object.entries(buckets).map(([k, arr]) => [k, {mean: avg(arr), n: arr.length}])
    );
    // Score: 1 − MSE/9, where 9 = max possible squared error (1−4)²
    byBucket.alignmentScore = n > 0 ? Math.max(0, 1 - (totalSqErr / n) / ((3 - grace) ** 2)) : null;
    byBucket.spearman = spearmanCorrelation(ksValues, ratings);
    byBucket.kendall = kendallTauB(ksValues, ratings);
    byBucket.gamma   = goodmanKruskalGamma(ksValues, ratings);
    return byBucket;
}

function finishStudy() {
    session.finishedAtISO = new Date().toISOString();
    const ratingStats = computeRatingStats();
    localStorage.removeItem(STORAGE_KEY);  // clear so next visitor starts fresh
    setRatingEnabled(false);
    showCompletion();
    const statsEl = document.getElementById("ratingStats");
    const [s1, s2, s3, s4] = RATING_SCALE;
    const BUCKETS = [
        {key: "1", label: s1.shortLabel},
        {key: "2", label: s2.shortLabel},
        {key: "3", label: s3.shortLabel},
        {key: "4", label: s4.shortLabel},
    ];
    const rows = BUCKETS.map(({key, label}) => {
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
        `<thead><tr><th>Expected</th><th>Your average</th><th>Count</th></tr></thead>` +
        `<tbody>${rows}</tbody>` +
        `</table>` +
        `<p style="margin-top:12px;">Alignment score: <strong>${scorePct}</strong></p>`;
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
    else {
        UI.againBtn.style.display = "inline-block";
        UI.againNote.style.display = "block";
    }
}


function recordResponse(rating) {
    const rtMs = Math.round(performance.now() - trialStartPerf);
    const isLast = currentTrial.trialIdx + 1 >= session.design.conditions.length;
    const finishedAt = isLast ? new Date().toISOString() : null;
    const stats = groupStats(currentTrial.panel);
    const ks = ksStat(currentTrial.panel.groups[0], currentTrial.panel.groups[1]);
    // participantId/Seed and startedAtISO are session-level; not duplicated here.
    session.results.push({
        trialIdx: currentTrial.trialIdx,
        trialSeed: currentTrial.trialSeed,
        condition: currentTrial.condition,
        rating,   // 1..4
        rtMs,
        ks,
        viewport: {w: window.innerWidth, h: window.innerHeight},
        groupStats: stats
    });
    session.trialIndex = currentTrial.trialIdx + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    postResponse(session, currentTrial, rating, rtMs, finishedAt, currentTrial.panel, NOSUBMIT);
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
    const cols = ["participantId", "trialIdx", "orientation", "jitter", "chartType", "chartVariant", "dist", "signalType",
        "delta_sd", "ratio", "spread_factor", "alpha", "separation", "n", "p",
        "nHigh", "nLow", "magnitude", "dataSeed"];
    const rows = [cols.join(",")];
    session.design.conditions.forEach((c, i) => {
        const e = c.signal;
        rows.push([
            session.participantId, i, session.design.orientation, c.jitter, c.chartType, JSON.stringify(c.chartOptions ?? {}), c.dist, e.type,
            e.delta_sd ?? "", e.ratio ?? "", e.spread_factor ?? "",
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

function resetAndRerun() {
    const savedBackground = session.background;
    resetSession();
    if (savedBackground) {
        session.background = savedBackground;
        session.skipIntro = true;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    }
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
UI.againBtn.addEventListener("click", resetAndRerun);

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
    const ALPHAS = [-7, -5, -3, 3, 5, 7];
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
        const sigma = Math.sqrt(1 - 2 * delta * delta / Math.PI);
        const median = normalToSkewNormal(0, alpha);

        // Generate skewed group B, median-centered and spread-normalized.
        // Seed per alpha: spread them out so each alpha gets an independent sequence.
        const skewSeed = (0xA1B2C3D4 + (alpha < 0 ? 0x10000 : 0) + Math.abs(alpha) * 0x1000) >>> 0;
        const skewedRng = mulberry32(skewSeed);
        const skewData = Array.from({length: N}, () => {
            const z = randomNormal(skewedRng);
            return (normalToSkewNormal(z, alpha) - median) / sigma;
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
        heading.textContent = `α = ${alpha}  (median=${median.toFixed(3)}, sigma=${sigma.toFixed(3)})`;
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
            renderChart(c.getContext("2d"), c, chartType, panel, yMin - pad, yMax + pad, {
                showDots: false,
                maxHalfW: 500
            }, "vertical", "wilkinson");
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
    // Seed review mode: one trial per DATA_SEED in order, fixed distribution, null signal, dot plot
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
                dist: SEEDREVIEW_DIST, signal: {type: "null"},
                dataSeed: seed, signalGroup: 0,
            })),
            selectedChartTypes: [{type: "dot", options: dotOptions}],
            orientation: "vertical", jitter: "wilkinson",
            distSignals: {}, distReps: {}, dataSeeds: DATA_SEEDS,
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