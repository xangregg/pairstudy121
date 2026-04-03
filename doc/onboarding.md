
# Onboarding Outline
*This document was provided to Claude Code for creating the training pages.*

This graphical perception study shows participants a series of chart pairs and asks them to assess any difference between them.
Some of the charts are less common statistical charts that need some explanation.
Participants likely have little or no technical background, so some upfront training is required to maximize the effectiveness of the study.

## Goals
* participants should learn how the study is structured
* participants should get a sense of sampled data with respect to source data
* participants should get a sense of how each chart type represents data
* participants should understand the response scale

## Proposed Structure
1. Introduction to the study
   * brief explanation of the study topic
   * structure: some training, some background questions, and 100 chart pairs for assessment
   * reminder that the study is testing the charts not the participants -- no wrong answers
1. Training about random sampling (first page)
   1. Page components: Text and a Continue button
   1. Text #1 (carries over to other random sampling pages): something like
      "The charts you'll be comparing are each made from 50 data values sampled from larger sources.
      Two samples of the same source may look slightly different due to random chance and may have unrelated outliers."
1. Training about random sampling (second page, for similar data)
   1. Page components: Two text areas, a canvas big enough for four charts, and a Continue button
   1. Text #1: same as in the first page
   1. Text #2: "Here's one source data set and random samples A, B, and C."
   1. Canvas: empty, wide if the participant is in the vertical chart mode; otherwise tall.
      That is, the normal study shows 2 charts in a 550x550 canvas; this one should be say 800x500 or 500x800
      Contains four charts side by side (e.g., in one row for vertical mode).
      1. source dot plot (random normal) uisng density random jitter with ~1000 dots
      1. Labeled "A", dot plot uisng density random jitter with 50 dots sampled from the source chart's data set
      1. Labeled "B", dot plot uisng density random jitter with 50 dots sampled from the source chart's data set
      1. Labeled "C", dot plot uisng density random jitter with 50 dots sampled from the source chart's data set
1. Training about random sampling (third page, for different data)
   1. Page components: Two text areas, a canvas big enough for four charts, and a Continue button
   1. Text #1: same as in the first page
   1. Text #2: "Here are two different sources and a random sample of each."
   1. Canvas: same size as before. Contains four charts side by side (e.g., in one row for vertical mode).
      1. source dot plot (random normal) uisng density random jitter with ~1000 dots
      1. Labeled "A", dot plot uisng density random jitter with 50 dots sampled from the first source chart's data set
      1. different (noticeably different mean and standard deviation) source dot plot uisng density random jitter with ~1000 dots
      1. Labeled "B", dot plot uisng density random jitter with 50 dots sampled from the second source chart's data set
1. Training about chart types
   1. Text: Over the course of the survey, you'll see four different chart types, which are briefly explained on the following pages.
   It's not critical to remember all the details. Each question will include a short reminder description.
   You'll only be assessing whether a pair of charts appear to be from different sources.
1. (4x) One page per chart type (based on variant in the current design). Page components:
   1. Explanation of the chart type and how it represents the data (possible new field in CHART_TYPE_CATALOG)
   1. Short reminder description that will be shown with each chart pair (description field from CHART_TYPE_CATALOG)
   1. Pair of example charts using 50 values each sampled from a lognormal distribution.
1. Training about response scale  
   Text: For each chart pair, you are to estimaste whether the two charts represent the same source or different sources
   using the following response scale. (*now using four-value scale*)

| Rating               | Meaning       |
| -------------------- |:--------------|
| Insufficient support | any difference is likely just chance |
| Some support         | leaning toward a real difference, but weak      |
| Strong support       | likely a real difference      |

## Open questions
* Do the "source" charts need labels? Assume yes,
* How many dots in the source charts? It should look crowded but not have enough points to badly distort the scale.
* Should/can the sampling from the source chart to the sample chart be emphasized? Moved to Future Ideas.
  For instance, when each sample appears, the corresponds dots in the source chart are highlighted.
* Should each page have a Back button? Moved to Future Ideas. (*now implemented*)

## Notes
* The chart training shows the four chart type variants that will be used in the study.
* Onboarding uses a single random number generator with the same seed for all participants.
* Every page as a Continue button.

## Clarifications
*These are clarifications after Claude Code's questions and initial coding efforts.*

1. Source chart rendering — the ~1000-dot source chart should use the existing density random jitter
   dot plot rendering just with a larger data set. Many overlapping dots are fine.
   It should give the impression of a virtually infinite data set.
   The scale should be the same as the other charts. However, being a larger random sample, it
   will have a larger range of values. We may have to clip values or choose a different seed to
   avoid a big scale difference.
2. Layout of the 4-panel canvas — any animation effect (now under Future Ideas) is cumulative
3. What "noticeably different" means for the second animation — yes, this should be a hard-coded effect difference. It will need to have a reduced scale to fit on the canvas.
4. Chart type training: which variant? — training must show the specific variant assigned to that participant (requires
   onboarding to run after design generation)
5. Response scale page — I'm thinking the current structure completely replaces the existing intro page.
6. Back button — moved to Future Ideas. (*now implemented*)
7. Study structure claim — should be the actual dynamic count based on the design.
1. Page 1 empty canvas — blank canvas removed -- I thought it might be useful to help the Continue button stay in the same place as the subsequent pages, but it may not matter.
2. 4-panel layout — start with 1x4 (for vertical mode) and 4x1 (for horizontal mode). I want respondents to get used to seeing charts side by side.
3. Third page source chart — All four panels should
   share a common y-axis scale (derived from the union of both sources). The second source should be created with a smaller spread/scale effect, so it should cause minimal disruption to the shared scale
4. Chart type example charts — yes, these are null-signal (same source, both samples) just to
   illustrate the chart type. I mentioned lognormal with hopes it would better illustrate some of the chart features with its asymetry.
5. Background questionnaire placement — I'm thinking after onboarding. (*now a beginning of onboarding*)
6. Source chart label — OK, let's label the source charts.

## Future ideas
1. Animation for sampling descriptions: reveal each chart one by one
2. Highlighting of the source dots in the source chart as the sample charts are revealed to reinforce the sampling mechanism.
3. Back button (*now implemented*)