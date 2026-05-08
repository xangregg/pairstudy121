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
    const prolificPid = p.get("PROLIFIC_PID") ?? p.get("prolific_pid");
    const forcedPid   = p.get("pid");
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
        try {
            const saved = JSON.parse(raw);
            // Resume logic: pid= param matches participantId (testing/reproduce);
            // Prolific mode matches on prolificPid; plain mode always resumes.
            if (forcedPid ? saved.participantId === forcedPid
                          : !prolificPid || saved.prolificPid === prolificPid)
                return saved;
        } catch {
        }
    }
    // Always generate a fresh random participant ID — never use the Prolific PID as the
    // seed source, so participants get independent randomization across studies.
    const participantId = forcedPid ?? newParticipantId();
    const participantSeed = hashStringToUint32(participantId);
    const session = {
        participantId, participantSeed,
        startedAtISO: null, finishedAtISO: null,
        design: null, onboardingStep: 0, trialIndex: 0, results: []
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    return session;
}

// Scale raw data values (in SD units) to integers 0–1000 over a ±5 SD range.
// Invertible: value = i / 100 - 5
function scaleData(values) {
    return values.map(v => Math.max(0, Math.min(1000, Math.round((v + 5) / 10 * 1000))));
}

export function postResponse(session, trial, rating, rtMs, finishedAt = null, panel = null, noSubmit = false) {
    const cond = trial.condition;
    const sig = cond.signal;

    const row = {
        participant_id: session.participantId,
        trial_index:    trial.trialIdx,
        trial_seed:     trial.trialSeed,
        data_seed:      cond.dataSeed,
        chart_type:     cond.chartType,
        chart_variant:  JSON.stringify(cond.chartOptions ?? {}),
        orientation:    session.design.orientation,
        jitter:         cond.jitter,
        distribution:   cond.dist,
        signal_group:   cond.signalGroup,
        // independent signal factors; neutral values when not applied
        location: sig.delta_sd      ?? 0,
        spread:   sig.spread_factor ?? 1,
        skew:     sig.alpha         ?? 0,
        bimodal:  sig.separation    ?? 0,
        // outlier: +n = n high, -n = n low, m*100+n = m high and n low (mixed, conspicuous)
        outlier:  sig.nHigh != null
            ? (sig.nHigh > 0 && sig.nLow > 0) ? sig.nHigh * 100 + sig.nLow
            : sig.nHigh > 0 ? sig.nHigh : -sig.nLow
            : 0,
        rating,
        rt_ms:       rtMs,
        finished_at: finishedAt,
    };
    if (panel) {
        row.a_data = scaleData(panel.groups[0]);
        row.b_data = scaleData(panel.groups[1]);
    }
    if (noSubmit)
        return;
    fetch(`${SUPA_URL}/rest/v1/trials`, {
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
    const row = {
        participant_id: session.participantId,
        started_at: session.startedAtISO,
        participant_group: group ?? null,
        prolific_pid:        session.prolificPid        ?? null,
        prolific_study_id:   session.prolificStudyId   ?? null,
        prolific_session_id: session.prolificSessionId ?? null,
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
