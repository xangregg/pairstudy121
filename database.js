// database.js
// localStorage session management and Supabase submission helpers.

import {STORAGE_KEY} from "./config.js";
import {hashStringToUint32} from "./utils.js";

const SUPA_URL = "https://pidcedqlfqtvfqncaysc.supabase.co";
const SUPA_KEY = "sb_publishable_Xfi2G-RyjGXc8PhGOu2YWA_iQfbnpyE"; // publishable key

export function newParticipantId() {
    return "P" + Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

export function loadOrCreateSession() {
    const p = new URLSearchParams(window.location.search);
    const urlPid = p.get("pid") ?? p.get("PROLIFIC_PID") ?? p.get("prolific_pid");
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
        try {
            const saved = JSON.parse(raw);
            // Resume saved session unless a different pid was requested via URL
            if (!urlPid || saved.participantId === urlPid)
                return saved;
        } catch {
        }
    }
    const participantId = urlPid ?? newParticipantId();
    const participantSeed = hashStringToUint32(participantId);
    const session = {
        participantId, participantSeed,
        startedAtISO: null, finishedAtISO: null,
        design: null, onboardingStep: 0, trialIndex: 0, results: []
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    return session;
}

export function postResponse(session, trial, rating, rtMs, finishedAt = null, stats = null, noSubmit = false) {
    const cond = trial.condition;
    const row = {
        participant_id: session.participantId,
        trial_index: trial.trialIdx,
        trial_seed: trial.trialSeed,
        data_seed: cond.dataSeed,
        chart_type: cond.chartType,
        chart_variant: JSON.stringify(cond.chartOptions ?? {}),
        orientation: session.design.orientation,
        jitter: session.design.jitter,
        distribution: cond.dist,
        effect_type: cond.signal.type,
        effect: cond.signal,
        effect_group: cond.signalGroup,
        rating,
        rt_ms: rtMs,
        viewport_w: window.innerWidth,
        viewport_h: window.innerHeight,
        finished_at: finishedAt,
    };
    if (stats) {
        row.a_mean = stats.a.mean; row.a_sd = stats.a.sd;
        row.a_min = stats.a.min; row.a_q1 = stats.a.q1; row.a_med = stats.a.med; row.a_q3 = stats.a.q3; row.a_max = stats.a.max;
        row.b_mean = stats.b.mean; row.b_sd = stats.b.sd;
        row.b_min = stats.b.min; row.b_q1 = stats.b.q1; row.b_med = stats.b.med; row.b_q3 = stats.b.q3; row.b_max = stats.b.max;
    }
    if (noSubmit)
        return;
    fetch(`${SUPA_URL}/rest/v1/responses`, {
        method: "POST",
        headers: {
            "apikey": SUPA_KEY,
            "Authorization": `Bearer ${SUPA_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        },
        body: JSON.stringify(row)
    }).catch(() => {
    }); // fire-and-forget; silently ignore network errors
}

export function postSession(session, group, noSubmit = false) {
    const bg = session.background ?? {};
    const row = {
        participant_id: session.participantId,
        started_at: session.startedAtISO,
        participant_group: group ?? null,
        prolific_pid:        session.prolificPid        ?? null,
        prolific_study_id:   session.prolificStudyId   ?? null,
        prolific_session_id: session.prolificSessionId ?? null,
        // background questionnaire — frequency (1=Rarely, 2=Occasionally, 3=Regularly)
        bg_viz_frequency:   bg.vizFrequency   ?? null,
        bg_chart_frequency: bg.chartFrequency ?? null,
        // background questionnaire — familiarity (1=Unfamiliar, 2=Somewhat familiar, 3=Very familiar)
        bg_mean:         bg.mean         ?? null,
        bg_sd:           bg.sd           ?? null,
        bg_median:       bg.median       ?? null,
        bg_quartile:     bg.quartile     ?? null,
        bg_box_plot:     bg.boxPlot      ?? null,
        bg_sampling:     bg.sampling     ?? null,
        bg_significance: bg.linearRegression ?? null,
        // between-subjects design factors
        orientation: session.design.orientation,
        jitter: session.design.jitter,
        // browser / device metadata
        user_agent: navigator.userAgent,
        language: navigator.language,
        languages: JSON.stringify([...navigator.languages]),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        screen_w: screen.width,
        screen_h: screen.height,
        color_depth: screen.colorDepth,
        pixel_ratio: devicePixelRatio,
        platform: navigator.userAgentData?.platform ?? navigator.platform,
        touch: navigator.maxTouchPoints > 0,
        prefers_dark: window.matchMedia("(prefers-color-scheme: dark)").matches,
        viewport_w: window.innerWidth,
        viewport_h: window.innerHeight,
    };
    if (noSubmit)
        return;
    fetch(`${SUPA_URL}/rest/v1/sessions`, {
        method: "POST",
        headers: {
            "apikey": SUPA_KEY,
            "Authorization": `Bearer ${SUPA_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        },
        body: JSON.stringify(row)
    }).catch(() => {
    });
}

export function postComment(session, text, noSubmit = false) {
    if (noSubmit)
        return;
    fetch(`${SUPA_URL}/rest/v1/comments`, {
        method: "POST",
        headers: {
            "apikey": SUPA_KEY,
            "Authorization": `Bearer ${SUPA_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        },
        body: JSON.stringify({
            participant_id: session.participantId,
            comment: text,
            submitted_at: new Date().toISOString()
        })
    }).catch(() => {});
}
