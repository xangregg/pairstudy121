// app.js

import {renderChart} from "./renderers.js";
import {wassersteinStat, ksStat, csvField} from "./utils.js";
import {mulberry32, hashStringToUint32, randomNormal} from "./utils.js";
import {N_PER_GROUP, STORAGE_KEY, RATING_DELAY_MS, DIST_REPS, DIST_REPS_TESTING} from "./config.js";
import {buildCatalog} from "./catalog.js";
import {loadOrCreateSession, postResponse, postSession, postComment} from "./database.js";
import {yourTaskHTML, RATING_SCALE, TRIAL_QUESTION} from "./question.js";
import {generateBasePanel, finalizePanel, computeDataSeeds} from "./data.js";
import {applySignal, makeDesign} from "./design.js";

/** ---------- Config ---------- **/
const DEFAULT_TESTING = false;
const params = new URLSearchParams(window.location.search);
const TESTING = params.has("test")
    ? params.get("test") !== "false"
    : DEFAULT_TESTING;
const NOSUBMIT = params.has("nosubmit");

// Prolific appends these in uppercase; accept either case for local testing.
const PROLIFIC_PID = params.get("PROLIFIC_PID") ?? params.get("prolific_pid");
const PROLIFIC_STUDY_ID = params.get("STUDY_ID") ?? params.get("study_id");
const PROLIFIC_SESSION_ID = params.get("SESSION_ID") ?? params.get("session_id");
// Completion code is base64-encoded in the survey URL (?pg=...) so it isn't immediately
// readable to participants. Encode once with btoa("YOUR_CODE") when setting up the study URL.
const COMPLETION_CODE = (() => {
    const raw = params.get("pg");
    if (!raw)
        return null;
    try { return atob(raw + "=".repeat((4 - raw.length % 4) % 4)); }
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
    const fullLabel = r.subtitle
        ? `<span class="label-main">${r.label}</span><br/><span class="label-subtitle">${r.subtitle}</span>`
        : r.label;
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
    downloadSimulationBtn: document.getElementById("downloadSimulationBtn"),
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

const DATA_SEEDS = computeDataSeeds(distReps, NOSUBMIT);

// Each entry lists display variants for that chart type.
// At design time, N_CHART_TYPES types are chosen per participant (seeded shuffle),
// and one variant is picked per type — both are between-subjects factors.
// explanation must be a function (called at render time) so orientation words resolve correctly.
// Built after currentOrientation is defined (see below).
let CHART_TYPE_CATALOG;

// Compute per-group descriptive statistics from a panel for recording alongside ratings.


/** ---------- Trial building ---------- **/
function buildTrial(trialIdx, cond) {
    const conditionId = `${cond.chartType}|${JSON.stringify(cond.chartOptions)}|${cond.dist}|${JSON.stringify(cond.signal)}|${cond.dataSeed}`;
    const trialSeed = hashStringToUint32(`${session.participantSeed}|${trialIdx}|${conditionId}`);
    const rng = mulberry32(trialSeed);

    const raw = generateBasePanel(cond.dist, cond.dataSeed, cond.signal, cond.signalGroup);
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
    if (!session.skipIntro)
        steps.push({type: "sampling1"});
    steps.push(
        ...sortedTypes.map(chartType => ({type: "chartType", index: typeToFirstIdx.get(chartType)})),
    );
    if (!session.skipIntro) {
        for (let page = 0; page <= 4; page++) steps.push({type: "diffSources", page});
    }
    steps.push({type: "responseScale"});
    return steps;
}

// Fixed onboarding data — same for all participants.
let _onboardingPanels = null;

function getOnboardingPanels() {
    if (_onboardingPanels)
        return _onboardingPanels;
    const rng = mulberry32(35500913);
    const N_SRC = 500;
    const sort = arr => arr.slice().sort((a, b) => a - b);

    // Same-source data: one source, four samples
    const sameSrc = Array.from({length: N_SRC}, () => randomNormal(rng));
    const sameSamples = [0,1,2,3].map(() => Array.from({length: N_PER_GROUP}, () => randomNormal(rng)));

    function makeSample(rng, n, signal) {
        const ys = Array.from({length: n * 2}, () => randomNormal(rng));
        const groups = Array.from({length: n * 2}, (_, i) => i < n ? 0 : 1);
        const outPanel = applySignal({y: ys, group: groups}, "normal", signal, rng, 0);
        return outPanel.y.slice(0, n);
    }

    // Different-source data: four sources with distinct parameters, one sample each
    const diffParams = [
    {type: "location", delta_sd: 1.0},
        {type: "location", delta_sd: -0.5},
    {type: "spread", spread_factor: 0.7},
    // {type: "skew", base: 1.8},
    {type: "bimodal", separation: 4.0}];
    const diffSrcs    = diffParams.map((signal) => makeSample(rng, N_SRC, signal));
    const diffSamples = diffParams.map((signal) => makeSample(rng, N_PER_GROUP, signal));

    // panel1: source + first sample, used by sampling1 page
    const panel1 = finalizePanel(
        [...sameSrc, ...sameSamples[0]],
        [...sameSrc.map(() => 0), ...sameSamples[0].map(() => 1)]
    );

    _onboardingPanels = {
        panel1,
        sameSrc:     sort(sameSrc),
        sameSamples: sameSamples.map(sort),
        diffSrcs:    diffSrcs.map(sort),
        diffSamples: diffSamples.map(sort),
    };
    return _onboardingPanels;
}

// Fixed seeds for chart-type training examples, one per chart family.
const EXAMPLE_SEEDS = {box: 0xE0011, bands: 0xE0022, dot: 0xE0003, violin: 0xE0004};

function buildChartTypeExamplePanel(chartType) {
    const rng = mulberry32(EXAMPLE_SEEDS[chartType] ?? 0xE0001);
    const N = N_PER_GROUP * 2;
    const y = Array.from({length: N}, () => randomNormal(rng));
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


function renderSampling1WithChartTypes(panel1) {
    const sourceGroup = panel1.groups[0];
    const sampleGroup = panel1.groups[1];
    let mn = Math.min(sourceGroup[0], sampleGroup[0]);
    let mx = Math.max(sourceGroup[sourceGroup.length - 1], sampleGroup[sampleGroup.length - 1]);
    const span = (mx - mn) || 1;
    mn -= span * 0.08;
    mx += span * 0.18;

    const chartSteps = getOnboardingSteps().filter(s => s.type === "chartType");
    const chartTypes = chartSteps.map(s => session.design.selectedChartTypes[s.index]);

    const noGroupLabel = {groupLabels: [""], padB: 0, padL: 6, padR: 6};
    const items = [
        {label: "Source", flex: 1.2, chartType: "dot", panel: {groups: [sourceGroup]}, opts: {showMedian: false, forThumbnail: true, ...noGroupLabel}},
        ...chartTypes.map(ct => ({
            label: ct.type.charAt(0).toUpperCase() + ct.type.slice(1),
            flex: 0.8,
            chartType: ct.type,
            panel: {groups: [sampleGroup]},
            opts: {showMedian: false, violinScale: 7, forThumbnail: true, ...getPlainCatalogOptions(ct), ...noGroupLabel},
        })),
    ];

    const dpr = Math.min(window.devicePixelRatio || 1, 1);
    const containerW = Math.min(window.innerWidth - 48, 720);
    const SPACER_PX = 28;
    const gapPx = (items.length - 1) * 6 + SPACER_PX;
    const unitPx = Math.floor((containerW - gapPx) / 5) - 4; // fixed 5-column reference
    const thumbH = Math.round(unitPx * 3.6);

    UI.onboardingThumbnails.querySelectorAll(".onboardingThumb").forEach(el => el.style.display = "none");
    UI.onboardingThumbnails.querySelectorAll(".samplingThumb").forEach(el => el.remove());
    UI.onboardingThumbnails.style.cssText = "display:flex;gap:6px;justify-content:center;align-items:flex-start;margin:-30px 0";

    for (const {label, flex, chartType, panel, opts} of items) {
        if (label !== "Source" && !UI.onboardingThumbnails.querySelector("[data-spacer]")) {
            const spacer = document.createElement("div");
            spacer.dataset.spacer = "1";
            spacer.style.cssText = `width:${SPACER_PX}px;flex-shrink:0`;
            UI.onboardingThumbnails.appendChild(spacer);
        }
        const displayW = flex * unitPx;
        const wrapper = document.createElement("div");
        wrapper.className = "samplingThumb";
        wrapper.style.cssText = `display:flex;flex-direction:column;align-items:center;gap:1px;flex:${flex};min-width:0`;
        const c = document.createElement("canvas");
        c.width = Math.round(displayW * dpr);
        c.height = Math.round(thumbH * dpr);
        c.style.cssText = `width:${displayW}px;height:${thumbH}px;background:#ffffff;border-radius:4px`;
        renderChart(c.getContext("2d"), c, chartType, panel, mn, mx, {violinScale: 70, ...opts}, "vertical", "density random");
        const labelEl = document.createElement("div");
        labelEl.textContent = label;
        labelEl.style.cssText = "font-size:22px;text-align:center;line-height:1.2";
        wrapper.appendChild(c);
        wrapper.appendChild(labelEl);
        // if (label !== "Source") {
        //     const sublabelEl = document.createElement("div");
        //     sublabelEl.textContent = "Sample";
        //     sublabelEl.style.cssText = "font-size:22px;text-align:center;line-height:1.2";
        //     wrapper.appendChild(sublabelEl);
        // }
        UI.onboardingThumbnails.appendChild(wrapper);
    }
}

function renderFourGroupsRow(groups, chartType, labels, mn, mx, chartOpts = {}, aspectRatio = 3.2, sidePadding = 80) {
    const dpr = Math.min(window.devicePixelRatio || 1, 1);
    const containerW = Math.min(window.innerWidth - 48, 720) - sidePadding;
    const gapPx = 3 * 6;
    const unitPx = Math.floor((containerW - gapPx) / 4) - 30;
    const thumbH = Math.round(unitPx * aspectRatio);

    UI.onboardingThumbnails.querySelectorAll(".onboardingThumb").forEach(el => el.style.display = "none");
    UI.onboardingThumbnails.querySelectorAll(".samplingThumb").forEach(el => el.remove());
    UI.onboardingThumbnails.style.cssText = "display:flex;gap:6px;justify-content:center;align-items:flex-start;margin:-20px 0";
    UI.onboardingThumbnails.style.display = "flex";

    groups.forEach((group, i) => {
        const wrapper = document.createElement("div");
        wrapper.className = "samplingThumb";
        wrapper.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;min-width:0";
        const c = document.createElement("canvas");
        c.width = Math.round(unitPx * dpr);
        c.height = Math.round(thumbH * dpr);
        c.style.cssText = `width:${unitPx}px;height:${thumbH}px;background:#ffffff;border-radius:4px`;
        const opts = {showMedian: false, forThumbnail: true, padL: 6, padR: 6, padB: 0, groupLabels: [""], ...chartOpts};
        renderChart(c.getContext("2d"), c, chartType, {groups: [group]}, mn, mx, opts, "vertical", "density random");
        const labelEl = document.createElement("div");
        labelEl.textContent = labels[i];
        labelEl.style.cssText = "font-size:18px;text-align:center";
        wrapper.appendChild(c);
        wrapper.appendChild(labelEl);
        UI.onboardingThumbnails.appendChild(wrapper);
    });
}


// Look up the live catalog variant so explanation functions survive localStorage round-trips.
function getLiveCatalogOptions(ct) {
    const entry = CHART_TYPE_CATALOG.find(e => e.type === ct.type);
    return entry?.variants.find(v => v.description === ct.options.description) ?? ct.options;
}

// Return the display variant for training pages and thumbnails.
// For solo variants, the assigned variant is the only option, so use it directly.
// For non-solo variants, use the plain-marked variant (or first non-solo) from the catalog.
function getPlainCatalogOptions(ct) {
    const liveOpts = getLiveCatalogOptions(ct);
    if (liveOpts.solo)
        return liveOpts;
    const entry = CHART_TYPE_CATALOG.find(e => e.type === ct.type);
    if (!entry)
        return liveOpts;
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
    UI.onboardingThumbnails.querySelectorAll(".samplingThumb").forEach(el => el.remove());
    UI.onboardingThumbnails.querySelectorAll(".onboardingThumb").forEach(el => el.style.display = "");
    UI.onboardingContinueBtn.disabled = false;
    UI.onboardingBackBtn.style.visibility = session.onboardingStep > 0 ? "visible" : "hidden";

    // Reserve fixed heights within each section so the canvas and Continue button
    // stay at the same vertical position across pages within a section.
    const isChartTypeSection = step.type === "chartTypeIntro" || step.type === "chartType";
    const isSamplingSection = step.type === "sampling1" || step.type === "diffSources";
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
        UI.onboardingTitle.textContent = "Sources and Samples";
        UI.onboardingText.innerHTML =
            `<p>The charts you'll be comparing are each made from
            <strong>50 data values</strong> sampled from a larger source, which will not be shown.</p>
            <p>Below, one source (500 values) is shown alongside the same random sample rendered in each of the chart types you'll see.</p>`;
        const {panel1} = getOnboardingPanels();
        renderSampling1WithChartTypes(panel1);
        UI.onboardingThumbnails.style.display = "flex";

    }
    else if (step.type === "diffSources") {
        const {diffSrcs, diffSamples} = getOnboardingPanels();
        const chartSteps = getOnboardingSteps().filter(s => s.type === "chartType");
        const chartTypes = chartSteps.map(s => session.design.selectedChartTypes[s.index]);

        const allData = [...diffSrcs, ...diffSamples];
        let mn = Math.min(...allData.map(g => g[0]));
        let mx = Math.max(...allData.map(g => g[g.length - 1]));
        const span = (mx - mn) || 1;
        mn -= span * 0.08;
        mx += span * 0.08;

        if (step.page === 0) {
            UI.onboardingTitle.textContent = "Different Sources";
            UI.onboardingText.innerHTML =
                `<p>You've seen how the same source looks across chart types. Now here are four <strong>different</strong> sources — each with a different location, spread, or shape.</p>`;
            renderFourGroupsRow(diffSrcs, "dot", ["A","B","C","D"], mn, mx, {violinScale: 40}, 3.2, 20);
            UI.onboardingThumbnails.style.marginTop = "28px";
        }
        else {
            const ct = chartTypes[step.page - 1];
            const ctName = ct.type.charAt(0).toUpperCase() + ct.type.slice(1);
            const opts = getPlainCatalogOptions(ct);
            UI.onboardingTitle.textContent = "Different Sources, Different Samples";
            UI.onboardingText.innerHTML =
                `<p>One sample from each source, shown as <strong>${ctName}</strong> charts. Notice how A, B, C, D look more distinct than the same-source samples on the previous pages.</p>`;
            renderFourGroupsRow(diffSamples, ct.type, ["A","B","C","D"], mn, mx, {violinScale: 4, ...opts}, 3.2, 20);
            UI.onboardingChartLabel.textContent = opts.description;
            UI.onboardingThumbnails.style.marginTop = "28px";
        }
    }
    else if (step.type === "chartType") {
        const ct = session.design.selectedChartTypes[step.index];
        const opts = getPlainCatalogOptions(ct);
        UI.onboardingTitle.textContent = `How to read: ${opts.titleText ?? opts.description}`;
        const expl = typeof opts.explanation === "function" ? opts.explanation() : (opts.explanation ?? "");
        const chartSteps = getOnboardingSteps().filter(s => s.type === "chartType");
        const isFirstChartType = chartSteps[0]?.index === step.index;
        const samplingNote = isFirstChartType
            ? "Below are four samples from the same source — they look similar but not identical."
            : "Same source, four samples — similar but not identical.";
        UI.onboardingText.innerHTML = `<p>${expl}</p><p>${samplingNote}</p>`;
        const {sameSamples} = getOnboardingPanels();
        let mn = Math.min(...sameSamples.map(g => g[0]));
        let mx = Math.max(...sameSamples.map(g => g[g.length - 1]));
        const span = (mx - mn) || 1;
        renderFourGroupsRow(sameSamples, ct.type, ["A","B","C","D"],
            mn - span * 0.08, mx + span * 0.08,
            {violinScale: 7, ...opts});
        UI.onboardingChartLabel.textContent = opts.description;
        UI.onboardingThumbnails.style.marginTop = "28px";
    }
    else if (step.type === "responseScale") {
        const total = session.design.conditions.length;
        UI.onboardingTitle.textContent = "Your Task";
        UI.onboardingText.innerHTML = yourTaskHTML(total);
    }
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
        const opts = getPlainCatalogOptions(ct);
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

// Wasserstein thresholds (N=50 per group) mapping distance to expected bucket 1–4.
// Approximate boundaries — calibrated against round 1 — for entertainment only.
const W_THRESHOLDS = [0.19, 0.28, 0.42]; // boundaries between buckets 1/2, 2/3, 3/4

// Per-signal-type multipliers applied to Wasserstein before bucketing.
// Boost types where Wasserstein underestimates statistical difference.
const W_MULTIPLIERS = {
    location: 0.85,
    spread:   1.0,
    skew:     1.5,
    bimodal:  1.25,
    outlier:  1.0,
};

// Integer bucket (1–4) for table grouping.
function wToExpectedBucket(w, signalType) {
    const m = W_MULTIPLIERS[signalType] ?? 1.0;
    const adjusted = w * m;
    if (adjusted < W_THRESHOLDS[0])
        return 1;
    if (adjusted < W_THRESHOLDS[1])
        return 2;
    if (adjusted < W_THRESHOLDS[2])
        return 3;
    return 4;
}

function computeRatingStats() {
    const buckets = {1: [], 2: [], 3: [], 4: []};
    const ksValues = [], ratings = [];

    for (const r of session.results) {
        if (r.wasserstein == null)
            continue;
        buckets[wToExpectedBucket(r.wasserstein, r.condition.signal.type)].push(r.rating);
        ksValues.push(r.wasserstein);
        ratings.push(r.rating);
    }
    const byBucket = Object.fromEntries(
        Object.entries(buckets).map(([k, arr]) => {
            const n = arr.length;
            const nDifferent = arr.filter(r => r === 2).length;
            return [k, {n, nDifferent}];
        })
    );
    // Alignment: weighted % correct across buckets 1, 3, 4.
    // Bucket 1 → same (weight 1), bucket 3 → different (weight 0.5), bucket 4 → different (weight 1).
    const w3 = 0.5;
    const b1 = byBucket[1], b3 = byBucket[3], b4 = byBucket[4];
    const weightedTotal = b1.n + b3.n * w3 + b4.n;
    byBucket.alignmentScore = weightedTotal > 0
        ? ((b1.n - b1.nDifferent) + b3.nDifferent * w3 + b4.nDifferent) / weightedTotal
        : null;
    return byBucket;
}

function finishStudy() {
    session.finishedAtISO = new Date().toISOString();
    const ratingStats = computeRatingStats();
    localStorage.removeItem(STORAGE_KEY);  // clear so next visitor starts fresh
    setRatingEnabled(false);
    showCompletion();
    const statsEl = document.getElementById("ratingStats");
    const BUCKETS = [
        {key: "1", label: "Least different"},
        {key: "2", label: "A bit different"},
        {key: "3", label: "More different"},
        {key: "4", label: "Most different"},
    ];
    const rows = BUCKETS.map(({key, label}) => {
        const s = ratingStats[key];
        const pct = s.n > 0 ? Math.round(s.nDifferent / s.n * 100) + "%" : "--";
        return `<tr><td>${label}</td><td>${s.n}</td><td>${pct}</td></tr>`;
    }).join("");
    const scorePct = ratingStats.alignmentScore !== null
        ? Math.round(ratingStats.alignmentScore * 100) + "%"
        : "--";

    statsEl.innerHTML =
        `<p>The study aims to evaluate the charts, not the participants, but if you're curious, here are your response patterns.</p>` +
        `<table class="rating-stats-table">` +
        `<thead><tr><th>Expected difference</th><th>Count</th><th>% marked Different</th></tr></thead>` +
        `<tbody>${rows}</tbody>` +
        `</table>` +
        `<p style="margin-top:12px;">Alignment score (extreme buckets): <strong>${scorePct}</strong></p>`;
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
    const wasserstein = wassersteinStat(currentTrial.panel.groups[0], currentTrial.panel.groups[1]);
    // participantId/Seed and startedAtISO are session-level; not duplicated here.
    session.results.push({
        trialIdx: currentTrial.trialIdx,
        trialSeed: currentTrial.trialSeed,
        condition: currentTrial.condition,
        rating,   // 1..2
        rtMs,
        wasserstein,
        viewport: {w: window.innerWidth, h: window.innerHeight},
    });
    session.trialIndex = currentTrial.trialIdx + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    postResponse(session, currentTrial, rating, rtMs, finishedAt, currentTrial.panel, NOSUBMIT);
    setRatingEnabled(false);
    nextTrial();
}

function downloadResults() {
    const cols = [
        "participant_id", "trial_index", "trial_seed", "data_seed",
        "chart_type", "chart_variant", "orientation", "jitter",
        "distribution", "signal_group",
        "location", "spread", "skew", "bimodal", "outlier",
        "rating", "rt_ms", "finished_at",
    ];
    const nResults = session.results.length;
    const rows = [cols.join(",")];
    session.results.forEach((r, i) => {
        const cond = r.condition;
        const sig = cond.signal;
        const outlier = sig.nHigh != null
            ? (sig.nHigh > 0 && sig.nLow > 0) ? sig.nHigh * 100 + sig.nLow
                : sig.nHigh > 0 ? sig.nHigh : -sig.nLow
            : 0;
        const finishedAt = (i === nResults - 1) ? (session.finishedAtISO ?? "") : "";
        rows.push([
            session.participantId, r.trialIdx, r.trialSeed, cond.dataSeed,
            cond.chartType, JSON.stringify(cond.chartOptions ?? {}),
            session.design.orientation, cond.jitter,
            cond.dist, cond.signalGroup,
            sig.delta_sd ?? 0, sig.spread_factor ?? 1, sig.base ?? 1,
            sig.separation ?? 0, outlier,
            r.rating, r.rtMs, finishedAt,
        ].map(csvField).join(","));
    });
    const blob = new Blob([rows.join("\n")], {type: "text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${session.participantId}-results.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function downloadSimulation() {
    const N_SIM = 100;
    const cols = [
        "participant_id", "trial_index", "trial_seed", "data_seed",
        "chart_type", "chart_variant", "orientation", "jitter",
        "distribution", "signal_group",
        "location", "spread", "skew", "bimodal", "outlier",
        "wasserstein", "ks", "a_data", "b_data",
    ];
    const scaleData = arr => arr.map(v => Math.max(0, Math.min(1000, Math.round((v + 5) * 100))));
    const rows = [cols.join(",")];
    for (let p = 0; p < N_SIM; p++) {
        const participantId = `sim_${String(p + 1).padStart(4, "0")}`;
        const participantSeed = hashStringToUint32(participantId);
        const rng = mulberry32((participantSeed ^ 0xA5A5A5A5) >>> 0);
        const design = makeDesign({
            rng, catalog: CHART_TYPE_CATALOG,
            nChartTypes: N_CHART_TYPES, nVariantTypes: N_VARIANT_TYPES,
            distReps, dataSeeds: DATA_SEEDS,
        });
        design.conditions.forEach((cond, trialIdx) => {
            const conditionId = `${cond.chartType}|${JSON.stringify(cond.chartOptions)}|${cond.dist}|${JSON.stringify(cond.signal)}|${cond.dataSeed}`;
            const trialSeed = hashStringToUint32(`${participantSeed}|${trialIdx}|${conditionId}`);
            const trialRng = mulberry32(trialSeed);
            const raw = generateBasePanel(cond.dist, cond.dataSeed, cond.signal, cond.signalGroup);
            applySignal(raw, cond.dist, cond.signal, trialRng, cond.signalGroup);
            const panel = finalizePanel(raw.y, raw.group);
            const w = wassersteinStat(panel.groups[0], panel.groups[1]);
            const ks = ksStat(panel.groups[0], panel.groups[1]);
            const sig = cond.signal;
            const outlier = sig.nHigh != null
                ? (sig.nHigh > 0 && sig.nLow > 0) ? sig.nHigh * 100 + sig.nLow
                    : sig.nHigh > 0 ? sig.nHigh : -sig.nLow
                : 0;
            rows.push([
                participantId, trialIdx, trialSeed, cond.dataSeed,
                cond.chartType, JSON.stringify(cond.chartOptions ?? {}),
                design.orientation, cond.jitter,
                cond.dist, cond.signalGroup,
                sig.delta_sd ?? 0, sig.spread_factor ?? 1, sig.base ?? 1,
                sig.separation ?? 0, outlier,
                w, ks,
                JSON.stringify(scaleData(panel.groups[0])),
                JSON.stringify(scaleData(panel.groups[1])),
            ].map(csvField).join(","));
        });
    }
    const blob = new Blob([rows.join("\n")], {type: "text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "simulation.csv";
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
            rows.push([v, labels[g]].map(csvField).join(","));
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
        ].map(csvField).join(","));
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
UI.downloadSimulationBtn.addEventListener("click", downloadSimulation);

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

if (params.get("diagnostics") !== "true") {
    for (const id of ["trialFooter", "debugDetails", "completionActions"]) {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    }
}


if (PROLIFIC_PID && !COMPLETION_CODE) {
    document.getElementById("errorPage").style.display = "block";
    postComment(session, `Missing pg param. URL: ${window.location.href}`, NOSUBMIT);
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