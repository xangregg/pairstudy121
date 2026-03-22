// question.js
// Background questionnaire structure
// Trial question and response scale

export const BG_FREQ_OPTIONS = [
    { value: 1, label: "Rarely" },
    { value: 2, label: "Occasionally" },
    { value: 3, label: "Regularly" },
];

export const BG_FAM_OPTIONS = [
    { value: 1, label: "Unfamiliar" },
    { value: 2, label: "Somewhat" },
    { value: 3, label: "Very familiar" },
];

export const BG_SECTIONS = [
    {
        heading: "How often do you read...",
        questions: [
            { key: "vizFrequency",      label: "Bar charts / infographics" },
            { key: "chartFrequency",    label: "Statistical charts" },
        ],
        options: BG_FREQ_OPTIONS,
    },
    {
        heading: "How familiar are you with...",
        questions: [
            { key: "mean",             label: "Mean" },
            { key: "sd",               label: "Standard deviation" },
            { key: "median",           label: "Median" },
            { key: "quartile",         label: "Quartile" },
            { key: "boxPlot",          label: "Box plot" },
            { key: "sampling",         label: "Population sampling" },
            { key: "linearRegression", label: "Linear regression" },
        ],
        options: BG_FAM_OPTIONS,
    },
];

export const BG_QUESTIONS = BG_SECTIONS.flatMap(s => s.questions);

// The question shown above the rating buttons on every trial.
export const TRIAL_QUESTION = "How much evidence do these charts provide that A and B are genuinely different?";

// The four rating levels shown in training and used during trials.
// label: short display text; description: the full explanation shown to participants.
export const RATING_SCALE = [
    {
        label: "No evidence",
        description: "The charts look like they could easily come from the same source." +
            " Any visible difference is well within what random sampling alone would produce.",
    },
    {
        label: "Weak evidence",
        description: "The charts look similar, but there’s a slight difference which might be real or random."
    },
    {
        label: "Moderate evidence",
        description: "The charts look noticeably different in some way," +
            " but there’s still meaningful uncertainty about whether it’s real.",
    },
    {
        label: "Strong evidence",
        description: "The charts look clearly different." +
            " It would be surprising if random sampling alone produced this much of a difference.",
    },
];

// HTML for the "Your Task" onboarding step.
export function yourTaskHTML(total) {
    const rows = RATING_SCALE.map(r =>
        `<tr><td><strong>${r.label.replace(" ", "<br/>")}</strong></td><td>${r.description}</td></tr>`
    ).join("");
    return `<p>For each of the <strong>${total} chart pairs</strong>, rate how much evidence
        they provide that groups A and B come from <strong>genuinely different sources</strong>
         with different underlying locations, spreads, or shapes.</p>&nbsp;<p/>
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
