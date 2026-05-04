// question.js
// Background questionnaire structure
// Trial question and response scale

export const BG_FAM_OPTIONS = [
    { value: 1, label: "Unfamiliar" },
    { value: 2, label: "Somewhat" },
    { value: 3, label: "Very familiar" },
];

export const BG_SECTIONS = [
    {
        heading: "How familiar are you with...",
        questions: [
            { key: "vizFrequency",     label: "Bar charts" },
            { key: "chartFrequency",   label: "Scatter plots" },
            { key: "boxPlot",          label: "Box plots" },
            { key: "mean",             label: "Mean" },
            { key: "sd",               label: "Standard deviation" },
            { key: "median",           label: "Median" },
            { key: "quartile",         label: "Quartile" },
            { key: "linearRegression", label: "Linear regression" },
        ],
        options: BG_FAM_OPTIONS,
    },
];

export const BG_QUESTIONS = BG_SECTIONS.flatMap(s => s.questions);

// Switch between question framings here.
// "confidence" — "Do these two samples come from the same source?"
// "evidence"   — "How much evidence do these charts provide that A and B are genuinely different?"
// "surprise"   — "If A and B are random samples from the same source, how surprising is this difference?"
const QUESTION_FRAMING = "confidence";

export const TRIAL_QUESTION = QUESTION_FRAMING === "confidence"
    ? "Do these two samples come from the same source?"
    : QUESTION_FRAMING === "surprise"
    ? "How surprising would it be if samples A and B were from the same source?"
    : "How much evidence do these charts provide that A and B are genuinely different?";

// The rating levels shown in training and used during trials.
// label: main button text; subtitle: secondary line; description: full explanation shown to participants.
export const RATING_SCALE = QUESTION_FRAMING === "confidence"
    ? [
        {
            label: "Same source", subtitle: "likely random variation", shortLabel: "Same",
            description: "The charts look consistent with random sampling from the same source. " +
                "The difference is likely just noise.",
        },
        {
            label: "Different sources", subtitle: "a real difference", shortLabel: "Different",
            description: "The charts look more different than random sampling alone would typically produce.",
        },
    ]
    : QUESTION_FRAMING === "surprise"
    ? [
        {
            label: "Not surprising", shortLabel: "Not",
            description: "The difference looks like normal sampling variation — " +
                "what you’d expect even if A and B come from the same source.",
        },
        {
            label: "Slightly surprising", shortLabel: "Slight",
            description: "The difference is a little more than typical, but could still easily be due to random sampling.",
        },
        {
            label: "Quite surprising", shortLabel: "Quite",
            description: "The difference seems more than you’d usually expect from random sampling alone.",
        },
        {
            label: "Very surprising", shortLabel: "Very",
            description: "The difference would be very unusual if A and B were random samples from the same source.",
        },
    ]
    : [
        {
            label: "No evidence", shortLabel: "None",
            description: "The charts look like they could easily come from the same source." +
                " Any visible difference is well within what random sampling alone would produce.",
        },
        {
            label: "Weak evidence", shortLabel: "Weak",
            description: "The charts look similar, but there’s a slight difference which might be real or random.",
        },
        {
            label: "Moderate evidence", shortLabel: "Moderate",
            description: "The charts look noticeably different in some way," +
                " but there’s still meaningful uncertainty about whether it’s real.",
        },
        {
            label: "Strong evidence", shortLabel: "Strong",
            description: "The charts look clearly different." +
                " It would be surprising if random sampling alone produced this much of a difference.",
        },
    ];

// HTML for the "Your Task" onboarding step.
export function yourTaskHTML(total) {
    const rows = RATING_SCALE.map(r => {
        const cellLabel = r.subtitle
            ? `${r.label}<br/><span class="label-dim">${r.subtitle}</span>`
            : r.label;
        return `<tr><td><strong>${cellLabel}</strong></td><td>${r.description}</td></tr>`;
    }).join("");
    const intro = QUESTION_FRAMING === "confidence"
        ? `<p>You will see <strong>${total} pairs</strong> of charts. Recall that each chart
            represents 50 values randomly sampled a larger source. For each pair, indicate whether
            you think the two samples come from the <strong>same source</strong> or
            <strong>different sources</strong>.</p>`
        : QUESTION_FRAMING === "surprise"
        ? `<p>You will see <strong>${total} pairs</strong> of charts. Recall that each chart
            represents 50 values sampled from some source. For each pair, rate how surprising
            it would be if both samples were from the same source.</p>`
        :`<p>You will see <strong>${total} pairs</strong> of charts. Recall that each chart
            represents 50 values sampled from some source. For each pair, rate how much evidence
            they provide that the two samples come from <strong>genuinely different sources</strong>.</p>`;
    return `${intro}&nbsp;<p/>
        <table class="ob-scale-table">
            <thead><tr><th>Rating</th><th>Meaning</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
}

// HTML for the "About You" background questionnaire onboarding step.
export function backgroundHTML() {
    return `<p>Before we start, a few quick questions about your prior knowledge.</p>` +
        BG_SECTIONS.map(sec => `
        <p class="ob-section-head">${sec.heading}</p>
        <div class="bg-grid">
            ${sec.questions.map(q => `
            <div class="bg-row">
                <span class="bg-term">${q.label}</span>
                <div class="bg-options">
                    ${sec.options.map(o =>
                        `<button class="bg-btn" data-key="${q.key}" data-value="${o.value}">${o.label}</button>`
                    ).join("")}
                </div>
            </div>`).join("")}
        </div>`).join("");
}
