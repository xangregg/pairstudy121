# Development Notes: Design Decisions and Refinements

Notes on interesting choices, tradeoffs, and iterations made during development.
Intended as material for a future blog post.

---

## Question and Response Framing

**The core question is the EDA question: "Is this anything?"**
The study is designed around the everyday task of an analyst looking at two groups
and deciding whether the difference is real or just noise,
or whether the difference is worth investigating further.

**The scale is intentionally asymmetric.**
In the spirit of the null hypothesis,
you can only accumulate evidence *against* the null (that the groups are the same),
not evidence *for* it.
A rating of 1 ("Not surprising") doesn't mean the groups are definitely from the same source —
it means the chart provides no reason to think otherwise.
The scale therefore runs from no signal to strong signal, with no negative end.
This asymmetry is explicitly conveyed in the description of the lowest response level:
"what you'd expect even if A and B come from the same source."

**Two framings were considered and both fully implemented.**
The "evidence" framing asks "How much evidence do these charts provide that A and B are genuinely different?"
The "surprise" framing asks "How surprising would it be if samples A and B were from the same source?"
Both framings have full question text, response labels, descriptions, and training text in `question.js`,
switchable via the `QUESTION_FRAMING` constant.
The surprise framing was chosen as the default because it more naturally positions the participant
as an observer evaluating a specific hypothesis (same source) rather than as a judge issuing a verdict.
It also makes the lowest response feel less absolute —
"not surprising" is softer than "no evidence."

**Some framings were rejected.**
Asking about "worth investigating" depends on knowing the cost of investigating.
Using the word "difference" was avoided since it might focus attention toward location differences
as the mathematical difference of two means.
Similarly asking about the magnitude of the difference was avoided.
Another possible angle is to create a scenario as context
("Imagine you're a scientist evaluating two drug effects", ...),
but it seemed hard to find a neutral scenario without a directional component (e.g., higher is better).

**The response descriptions deliberately reference sampling variation, not the signal.**
Each label description is worded in terms of what random sampling alone would or wouldn't produce,
rather than describing the visual appearance of the chart.
The goal is to anchor participants to the right mental model (these are random samples)
rather than to cue specific visual features.
For example, level 2 says "could still easily be due to random sampling"
rather than "the difference looks small."

**Four levels rather than more.**
A 4-point scale was chosen over 5, 6, or 7 points for a few reasons:
the question is already cognitively demanding (judging distributional differences is hard),
more levels would create false precision,
and the response is inherently ordinal with no meaningful "neutral" midpoint.
The four levels map loosely to the analyst's internal states:
ignore it, note it, investigate it, act on it.
Labels use natural adverbs (not / slightly / quite / very)
rather than pseudo-numeric anchors to avoid implying equal spacing.

**Short labels for buttons, full descriptions in training.**
The response buttons show a short two-word label (e.g., "Not surprising")
with the first word bold and the second in lighter text on a second line.
The full explanatory descriptions are shown during the "Your Task" training page,
formatted identically to reinforce the connection.
Participants ideally internalize the descriptions during training
and use the short labels as memory cues during trials.

---

## Study Design

**Signal levels replaced by K-S for completion scoring.**
The original alignment score compared participant ratings against preset signal levels
(null/weak/moderate/strong) that were hand-assigned based on gut feel.
This was replaced by computing the actual two-sample Kolmogorov-Smirnov statistic D
from the realized data per trial,
then mapping it to an expected rating via piecewise-linear interpolation.
The realized data is a better benchmark than the intended signal
because participants see the actual sample, not the underlying parameters.

**K-S interpolation anchors extend beyond the [1,4] rating range.**
The anchor points allow expected ratings slightly below 1 and above 4.
Given that responses are limited to integers 1-4, the error calculation
applies a 0.25 grace region and ignores excess at the extremes
for responses that are already at the extreme.

**Bimodal separation capped to limit axis range as a detection cue.**
When bimodal separation is large,
the signal group's data range can become noticeably wider than the reference group's,
making the difference detectable from the axis scale alone rather than the distribution shape.
A span ratio cap (1.2×) scales down the signal group's values around their center
when this threshold is exceeded,
preserving the bimodal shape while limiting the range difference.

**Skew signals median-centered and spread-normalized.**
The skew transform (probability integral transform to a skew-normal distribution)
shifts the mean and changes the spread.
To keep the two groups comparable in location and scale —
leaving only the asymmetry as the signal —
the signal group is re-centered to its median and rescaled to SD ≈ 1 after the transform.

**Seed screening with two independent null-balance checks.**
Base data seeds are screened before use to avoid seeds where the two groups
happen to look conspicuously different even with no signal treatment.
Two criteria are checked:
an extremes check (max and min differences as a fraction of combined range)
and a Cohen's d check on the means.
Both are needed because the extremes check catches deceptive tail placement
while the Cohen's d check catches systematic mean offsets.
About 3–13% of candidate seeds are rejected depending on distribution.

**Signal group balanced globally, not per chart type.**
Exactly 50 of each participant's 100 trials assign the signal to group A; 50 to group B.
This balance is enforced across all trials via a shuffled binary vector
rather than within each chart type separately.
Per-chart-type balance would require more complex allocation
and would constrain the already-random trial order.

**Jitter moved from between-subjects to per-trial.**
Originally each participant was randomly assigned one jitter method for all dot-based charts.
This was changed to a balanced per-trial pool
(each of the four jitter methods appears approximately 25 times per participant),
making jitter a within-subjects factor.
This increases power for jitter-related analysis without increasing trial count.
A session-level jitter is still drawn once per participant,
used only for the training page displays.

---

## Chart Variants and Training

**Training is important for a general audience.**
Extra effort, such as including images,
was put into the training pages in hopes of improving response quality.
Training has to be brief out of respect for the participant's time and attention.
Additionally, every survey trial page includes a one line reminder
about the components of the current chart pair.

**Solo variants for chart types that can't share training.**
Some catalog variants (range bar, all band variants) are fundamentally different enough
that they can't meaningfully share a training page with other variants of the same category.
These are marked `solo: true` and always appear alone.
Non-solo variants within a category always appear together,
giving multi-variant categories proportionally more trials.

**Plain variant concept for training thumbnails.**
For non-solo variant categories, training always shows the simplest form of the chart type —
the "plain" variant (marked `plain: true` in the catalog) —
regardless of which specific variants a participant was randomly assigned.
This ensures training is consistent and uncluttered,
while the actual study may include additional overlays (dots, boxes, median lines).
Solo variants show their assigned variant since there is no simpler alternative.

**Chart type training pages ordered to match trial order.**
The onboarding pages explaining each chart type are presented in the same sequence
as each chart type's first appearance in that participant's randomized trial list.
This means training feels immediately relevant —
the first chart type explained is also the first one encountered in the study.

**Training thumbnails on a single overview page before individual explanations.**
A "Chart Types" overview page shows small thumbnails of all assigned chart types together,
giving participants a visual preview before the detailed per-type pages.
This helps orient participants who would otherwise encounter the first individual explanation page
with no context about how many chart types are coming.

**Sampling training page 3 reordered: sources first, then samples.**
The "Different Sources, Different Samples" page originally interleaved sources and samples
(Source 1, A, Source 2, B).
The layout was changed to show both sources first (Source 1, Source 2)
followed by both samples (A, B),
making the comparison between the two sources more visually direct before seeing the samples.

---

## Randomization and Reproducibility

**Data seeds are screened once and reused.**
The same 100 screened data seeds are computed deterministically for all participants.
Though the charts and signals vary between participants,
they all use distributions with the same inherent characteristics.

**All other randomization derived deterministically from a participant seed.**
Chart type assignments, variant selection, jitter pool, trial order, signal draws,
and signal group assignments are all derived from one seeded PRNG (mulberry32).
This means any participant's full session can be reproduced exactly from their participant ID alone,
which is useful for debugging and for regenerating trial data from stored metadata.


---

## User Interface

**Response buttons styled consistently with the "Your Task" training page.**
The rating buttons use bold text for the short label
and plain text for the description on a second line,
matching exactly the formatting used in the response scale training page.
This reduces the chance that the scale feels unfamiliar during the study
even if participants skim the training.

**Extra right margin on response buttons for visual centering.**
Because the trial question doesn't occupy the entire width of a default display,
a page-centered row of buttons below it looked off-center,
so a small extra right margin was added so the button group appears visually centered
under the question.

**Hover highlight suppressed until mouse moves.**
After each trial, the hover highlight on rating buttons is disabled
until the participant moves the mouse.
This reduces anchoring —
without this, the button nearest the previous response might appear pre-highlighted,
nudging the participant toward the same rating.

**Rating buttons suppressed briefly at trial start.**
Buttons are disabled for 500ms after each trial loads.
This prevents accidental double-clicks registering as two responses
and discourages impulsive responses before the participant has had time to look at the chart.
Participants should spend more time than 500ms per question,
but a longer delay might be frustrating,
and if someone is trying to click through quickly,
it will be easier to detect later from the short response times.


---

## Code Architecture

**Catalog explanations are functions, not strings.**
Chart type explanations in the catalog reference orientation-aware words
("horizontal"/"vertical", "height"/"width") that depend on the participant's assigned orientation.
Storing explanations as functions called at render time —
rather than strings computed at catalog initialization —
ensures the words resolve correctly even if orientation were to change or differ between participants.

**Modules split for separation of concerns.**
The original monolithic `app.js` was split into
`data.js` (base data generation and seed screening),
`design.js` (trial design construction and signal application),
`catalog.js` (chart type variant definitions),
and `config.js` (tunable constants).
Functions that were previously closures over module-level variables
were parameterized to accept those values as arguments,
making them independently testable.

**`quantileSorted`, `boxStats`, `ksStat`, `interpolate`, and correlation functions in utils.js.**
Statistical utilities were consolidated into `utils.js`
rather than scattered across files or defined inline at use sites.
The interpolation function (`interpolate(x, xs, ys)`) was extracted from the K-S-to-rating mapping
once it became clear the piecewise-linear logic was general enough to reuse.
Three correlation measures (Spearman ρ, Kendall τ-b, Goodman-Kruskal γ) were implemented and compared;
γ was added specifically because it ignores tied pairs entirely,
which is appropriate when one variable is a coarse 4-level ordinal.

**`verbose` flag on `computeDataSeeds`.**
When data.js was split from app.js,
the seed computation lost access to `SEEDREVIEW_DIST`,
a debug flag that controlled whether seed rejection statistics were logged.
Rather than re-coupling the modules,
a `verbose` parameter was added to `computeDataSeeds`
and the caller passes `!!SEEDREVIEW_DIST`.
This keeps the utility function clean while preserving the debug output path.

**localStorage key versioned.**
The `STORAGE_KEY` constant includes a version suffix (e.g., `single_panel_study_v21`).
Bumping the version invalidates any saved session from a prior format,
preventing crashes or silent data corruption when the session schema changes incompatibly.
This came up multiple times during development as fields were added and renamed.

---

## Changes from Iterative Refinement

**Canvas and margins adjusted for consistency.**
Some effort was made so that the bottom row of buttons didn't
move too much during training, so participants can focus on
the content instead of searching for a moving button.
That meant keeping the text of similar length,
adding HTML minimum size constraints.

**Thumbnail row drawn with tighter packing.**
In its natural state (matching the trial pages),
the row of thumbnail pairs is wide and short
and creates a conspicuous gap when the button row is kept aligned with other pages.

---

## Tester Feedback

The survey's last page provides a place for participants to submit feedback.
That was the source of the final score addition (mainly to attract more testers on social media),
and better phone size support (though the final survey is not targeted at phone displays).

Another commenter asked for 5-10 test pairs so they could calibrate their responses,
but that would partially defeat the goal of relating their perception to the surprise amounts.

---

## URL Parameters

The app reads several URL parameters at startup.
Parameters intended for production use are set by Prolific or the study administrator;
developer parameters are for local testing and debugging.

**Production parameters:**

| Parameter | Description |
|-----------|-------------|
| `PROLIFIC_PID` | Prolific participant ID. Stored in `prolific_pid`; the session's `participant_id` is always a separately generated random ID. Also accepted lowercase as `prolific_pid`. |
| `STUDY_ID` | Prolific study ID, stored in `prolific_study_id`. Also accepted as `study_id`. |
| `SESSION_ID` | Prolific session ID, stored in `prolific_session_id`. Also accepted as `session_id`. |
| `pg` | Completion code, Base64-encoded (decoded with `atob`). Stored as `participant_group` in the session. Used to identify which Prolific run a participant belongs to, and to construct the "Return to Prolific" link on the completion page. If decoding fails, the raw value is used. |

**Developer parameters:**

| Parameter | Description |
|-----------|-------------|
| `pid` | Forces a specific `participant_id` for the session, overriding the randomly generated one. Useful for reproducing a prior session exactly. Also resumes an existing session with that ID if one is in localStorage. |
| `test` | Enables testing mode (fewer chart types, faster completion). Set to `?test=false` to disable when `DEFAULT_TESTING` is true in source. |
| `nosubmit` | Disables all Supabase writes. Useful for local runs where database credentials may not be configured. |
| `diagnostics=true` | Shows hidden diagnostic UI elements (trial footer, debug details, completion actions). Also enabled implicitly by `seedreview` and `skewpreview`. |
| `seedreview` | Renders a diagnostic view of data seeds for the specified distribution (e.g., `?seedreview=normal`). Implies `nosubmit` and `diagnostics`. |
| `skewpreview` | Renders a diagnostic preview of skew signal shapes. Implies `nosubmit` and `diagnostics`. |
