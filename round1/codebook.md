# Round 1 Data Codebook

Three files linked by the `participant` and `trial_index` fields:
* `participants.csv`: one row per participant
* `trials.csv`: one row per trial (each pair of charts is a "trial")
* `trials_ab_data.csv`: raw group data for each trial (joinable to `trials.csv`)

---

## participants.csv

| Field | Description                                                                                                                                                                                                                                       |
|---|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `participant` | Unique participant identifier generated at session start (random token, timestamp stripped). Links to `trials.csv`.                                                                                                                               |
| `group` | Recruitment channel: `prolific` (Prolific platform), `self` (my test runs), or `friends` (social media and colleagues).                                                                                                                           |
| `orientation` | Chart orientation assigned to this participant: `vertical` or `horizontal`. All Prolific participants received `vertical`; earlier `friends` and `self` runs include both.                                                                        |
| `region` | Broad geographic region derived from the browser-reported timezone: `North America`, `Central/South America`, `Europe`, `Africa`, `Asia`, or `Oceania`.                                                                                           |
| `view size` | Device size category derived from browser viewport width at session start: `small` (< 768 px), `medium` (768–1024 px), or `large` (> 1024 px).                                                                                                    |
| `prefers_dark` | Whether the browser reported a dark-mode preference (`true`/`false`).                                                                                                                                                                             |
| `n pairs` | Number of trials completed. Most participants completed 100; some stopped early or had incomplete sessions.                                                                                                                                       |
| `duration` | Total session duration in minutes (from first trial to last response). Blank for sessions that did not finish.                                                                                                                                    |
| `bg_mean` | Self-reported familiarity with the concept of mean (1 = not familiar, 3 = very familiar).                                                                                                                                                  |
| `bg_sd` | Self-reported familiarity with standard deviation. Same 1–3 scale.                                                                                                                                                                                |
| `bg_median` | Self-reported familiarity with median. Same 1–3 scale.                                                                                                                                                                                            |
| `bg_quartile` | Self-reported familiarity with quartiles. Same 1–3 scale.                                                                                                                                                                                         |
| `bg_box_plot` | Self-reported familiarity with box plots. Same 1–3 scale.                                                                                                                                                                                         |
| `bg_bar_chart` | Self-reported familiarity with bar charts. Same 1–3 scale.                                                                                                                                                                                        |
| `bg_scatter_plot` | Self-reported familiarity with scatter plots. Same 1–3 scale.                                                                                                                                                                                     |
| `bg_regression` | Self-reported familiarity with linear regression. Same 1–3 scale.                                                                                                                                                                                 |
| `Wasserstein spearman` | Spearman rank correlation between the Wasserstein distances of each trial pair and the participant's ratings across all their trials. A higher value indicates the participant's ratings tracked the actual difference more closely. |

---

## trials.csv

One row per completed trial (one chart comparison per row).
All distance and p-value statistics are computed on the original N(0,1)-scale data,
not the integer-encoded values in `trials_ab_data.csv`.

| Field | Description                                                                                                                                                                 |
|---|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `participant` | Links to `participants.csv` and `trials_ab_data.csv`.                                                                                                                       |
| `trial_index` | Sequential index of this trial within the participant's session (0-based).                                                                                                  |
| `chart category` | Broad category of the chart shown: `Bands`, `Box`, `Dot`, `Violin`.                                                                                                         |
| `chart name` | Unique short name for the chart variant shown. Details below.                                                                                                               |
| `has dots` | Whether individual data points were overlaid on the chart (`1` = yes, `0` = no).                                                                                            |
| `has median` | Whether a median marker was shown on the chart (`1` = yes, `0` = no).                                                                                                       |
| `jitter` | Dot-placement algorithm used for this trial: `beeswarm`, `wilkinson`, `random`, or `density random`. Varies within participant.                                             |
| `group` | Participant recruitment group (`prolific`, `self`, `friends`), joined from the participants table.                                                                          |
| `response time (s)` | Time from when the chart was displayed to when the participant clicked a rating button, in seconds.                                                                         |
| `rating` | Participant's response on a 1–4 scale of surprisingness of a different data source: 1 = not surprising, 2 = slightly surprising, 3 = quite surprising, 4 = very surprising. |
| `location pvalue` | P-value from a statistical test for a location (mean) difference between the two groups. Using Welch t-test (unequal means).                                                |
| `spread pvalue` | P-value from a statistical test for a spread (variance) difference between the two groups. Levene's test (unequal variance).                                                |
| `nonnormality pvalue` | P-value from a test for departure from normality (minimum for the two groups). Anderson-Darling normality test.                                                             |
| `Kolmogorov-Smirnov distance` | KS D statistic: the maximum difference between the two empirical CDFs. Ranges 0–1; larger values indicate more separation.                                                  |
| `Wasserstein distance` | Earth mover's distance (first Wasserstein distance) between the two groups, in original N(0,1) units.                                                                       |
| `Wasserstein spearman` | Participant-level Spearman correlation (same value as in `participants.csv`) repeated on every trial row for convenience in per-trial analyses — useful as a filter.        |

---

## trials_ab_data.csv

One row per completed trial. Contains the raw data values shown to the participant.
Join to `trials.csv` on `participant` + `trial_index`.

Values are integer-encoded for CSV compactness: `stored = round(x × 100 + 500)`, where x is the
original N(0,1)-scale value. To recover the original: `x = (stored − 500) / 100`.
Stored values range from 0 to 1000, corresponding to roughly −5 to +5 in N(0,1) units.
Each group has exactly 50 values, stored in ascending order.

| Field | Description |
|---|---|
| `participant` | Links to `trials.csv`. |
| `trial_index` | Links to `trials.csv`. |
| `a01`–`a50` | The 50 data values for group A, sorted ascending (integer-encoded). |
| `b01`–`b50` | The 50 data values for group B, sorted ascending (integer-encoded). |

---

## Chart names

| Chart name              | Chart type | Description                                                                    |
|-------------------------|------------|--------------------------------------------------------------------------------|
| box plot                | box        | Box plot: median, quartiles, and outlier range lines                           |
| box plot with dots      | box        | Box plot with dots: median, quartiles, and outlier range lines, with dots      |
| central bands           | bands      | Central bands (66%, 90%, 99%) with median line                                 |
| density bands 5-50-90   | bands      | Highest Density Region bands (5%, 50%, 90%)                                    |
| density bands 50-90-99  | bands      | Highest Density Region bands (50%, 90%, 99%) with mode                         |
| density bands thirds    | bands      | Highest Density Region bands (33%, 67%, 100%)                                  |
| dot plot                | dot        | Dot plot                                                                       |
| dot plot with median    | dot        | Dot plot with median line                                                      |
| range bar               | box        | Range bar: median, quartiles, and data range lines                             |
| violin plot             | violin     | smoothed distribution using Silverman's rule bandwidth with min(σ, IQR/1.34)   |
| violin plot with box    | violin     | smoothed distribution with median and quartiles                                |
| violin plot with dots   | violin     | smoothed distribution with dots                                                |
| violin plot with median | violin     | smoothed distribution with median line                                         |
