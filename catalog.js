// catalog.js
// Chart type catalog — one entry per chart type category, each with one or more display variants.
// Call buildCatalog(currentOrientation) once after currentOrientation is available.
// explanation must be a function (called at render time) so orientation words resolve correctly.

export function buildCatalog(currentOrientation, currentSession) {

    // Orientation-aware direction words — called at render time, not at catalog init time.
    // Function names match vertical chart orientation; values flip for horizontal.
    function verticalWord()   { return currentOrientation() === "vertical" ? "vertical"   : "horizontal"; }
    function horizontalWord() { return currentOrientation() === "vertical" ? "horizontal" : "vertical";   }
    function heightWord()     { return currentOrientation() === "vertical" ? "height"     : "width";      }

    function jitterDesc(jitter) {
        if (jitter === "wilkinson")
            return "Dots at similar values are aligned and stacked in a symmetric pattern.";
        if (jitter === "beeswarm")
            return "Dots spread to each side in a balanced pattern to minimize overlap.";
        if (jitter === "density random")
            return "Dots spread more widely where values are densely packed.";
        return "Dots at similar values are spread apart to reduce overlap."; // "random"
    }

    return [
        {
            type: "box", variants: [
                {
                    description: "Box plot",
                    explanation: () => `A box plot shows the middle 50% of values as a rectangle, with a ${horizontalWord()} line at the median.` +
                        ` Thin ${verticalWord()} lines (whiskers) extend to values within 1.5 times the box ${heightWord()}` +
                        `; more extreme values (outliers) appear as individual dots.`,
                    showDots: false
                },
                {
                    description: "Box plot with dots",
                    explanation: () => `A box plot shows the middle 50% of values as a rectangle, with a ${horizontalWord()} line at the median.` +
                        ` Thin ${verticalWord()} lines (whiskers) extend to values within 1.5 times the box ${heightWord()}` +
                        `; more extreme values are potential outliers.`,
                    showDots: true
                },
                {
                    description: "Range bar",
                    explanation: () => `A range bar shows the middle 50% of values as a rectangle, with a thick ${horizontalWord()} line at the median.` +
                        ` Thin ${verticalWord()} lines extend to cover the range of data values.`,
                    whiskers: "range", widerMedian: true, showDots: false
                },
            ]
        },
        {
            type: "bands", variants: [
                {
                    description: "Central bands (66%, 90%, 99%) with median",
                    explanation: () => `Nested bands show where the data falls: the darkest inner band contains the middle 66% of values, ` +
                        `the next contains 90%, and the outer band contains 99%. A ${horizontalWord()} line marks the median. ` +
                        `Any values beyond the outer 99% region are not shown.`,
                    bandType: "quantile", cutoffs: [0.66, 0.90, 0.99], showMedian: true, showMode: false, showDots: false
                },
                {
                    description: "Density bands (50%, 90%, 99%) with mode",
                    explanation: () => `Shaded bands show where values are most densely concentrated. ` +
                        `The darkest shade contains the densest 50% of values; ` +
                        `the next shade contains 90%, and the lightest shade contains 99%. ` +
                        `Shaded regions may be disconnected. A ${horizontalWord()} line marks the point of highest density. ` +
                        `Any values outside of those regions are shown as dots.`,
                    bandType: "hdr", cutoffs: [0.50, 0.90, 0.99], showMedian: false, showMode: true
                },
                {
                    description: "Density bands (5%, 50%, 90%)",
                    explanation: () => `Shaded bands show where values are most densely concentrated. ` +
                        `The darkest shade contains the densest 5% of values; ` +
                        `the next shade contains 50%, and the lightest shade contains 90%. ` +
                        `Shaded regions may be disconnected. ` +
                        `Any values outside of those regions are shown as dots.`,
                    bandType: "hdr", cutoffs: [0.05, 0.50, 0.90], showMedian: false, showMode: false
                },
                {
                    description: "Density bands (33%, 67%, 100%)",
                    explanation: () => `Shaded bands show where values are most densely concentrated. ` +
                        `The darkest shade contains the densest 33% of values; ` +
                        `the next shade contains 67%, and the lightest shade contains all remaining values. ` +
                        `Shaded regions may be disconnected.`,
                    bandType: "hdr", cutoffs: [1. / 3, 2. / 3, 1.00], showMedian: false, showMode: false
                },
            ]
        },
        {
            type: "dot", variants: [
                {
                    description: "Dot plot with median",
                    explanation: () => `Each dot represents one data value. ` +
                        `${jitterDesc(currentSession().design.jitter)} ` +
                        `A ${horizontalWord()} line marks the median.`,
                    showMedian: true
                },
                {
                    description: "Dot plot",
                    explanation: () => `Each dot represents one data value. ` +
                        `${jitterDesc(currentSession().design.jitter)}`,
                    showMedian: false
                },
            ]
        },
        {
            type: "violin", variants: [
                {
                    description: "Violin plot",
                    explanation: () => `A violin plot traces the full distribution shape as a smooth symmetric outline. ` +
                        `Wider sections indicate where values are more common.`,
                    showDots: false, showMedian: false
                },
                {
                    description: "Violin plot with box",
                    explanation: () => `A violin outline traces the full distribution shape as a smooth symmetric outline. ` +
                        `Wider sections indicate where values are more common. ` +
                        `A box plot is overlaid inside showing the median and middle 50% range.`,
                    showDots: false, showMedian: false, showBox: true
                },
                {
                    description: "Violin plot with dots",
                    explanation: () => `A violin outline traces the full distribution shape as a smooth symmetric outline. ` +
                        `Wider sections indicate where values are more common. ` +
                        `Individual data values are shown as dots.`,
                    showDots: true, showMedian: false
                },
                {
                    description: "Violin plot with median",
                    explanation: () => `A violin outline traces the full distribution shape as a smooth symmetric outline. ` +
                        `Wider sections indicate where values are more common. ` +
                        `A ${horizontalWord()} line shows the median value.`,
                    showDots: false, showMedian: true
                },
            ]
        },
    ];
}
