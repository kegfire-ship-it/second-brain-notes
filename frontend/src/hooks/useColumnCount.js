import { useState, useEffect } from 'react';

const CARD_WIDTH = 290;
const GAP = 16;
// On phones, align notes with the 12px mobile AppHeader gutter instead of
// capping them at 360px (which wasted 40px per side on a 440px iPhone).
// Keep a landscape cap so reading lines do not become uncomfortably long.
const ONE_COL_CARD_WIDTH = 'min(520px, calc(100vw - 24px))';

// Notes top out at 3 columns: the content column is capped at max-width 1120px
// (DESIGN_SYSTEM §6), and a 4-column grid (4×290 + 3×16 = 1208px) can't fit inside
// it — a 4th column overflowed the viewport by ~32px. 3 cols (902px) is the spec max.
const THRESHOLDS = [
    { min: 960, cols: 3 },
    { min: 640, cols: 2 },
];

// Google Keep-style "relaxed" timing.
const DEBOUNCE_WAIT = 150;   // settle ms after last resize event
const MAX_WAIT = 2000;       // forced flush after this many ms of continuous drag

export function computeColumnLayout(windowWidth) {
    for (const t of THRESHOLDS) {
        if (windowWidth >= t.min) {
            return {
                cols: t.cols,
                cardWidth: `${CARD_WIDTH}px`,
                gridWidth: t.cols * CARD_WIDTH + (t.cols - 1) * GAP,
            };
        }
    }
    return {
        cols: 1,
        cardWidth: ONE_COL_CARD_WIDTH,
        gridWidth: ONE_COL_CARD_WIDTH,
    };
}

export default function useColumnCount() {
    const [value, setValue] = useState(() => computeColumnLayout(window.innerWidth));

    useEffect(() => {
        let debounceTimer = null;
        let maxWaitTimer = null;

        const apply = () => {
            if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
            if (maxWaitTimer)  { clearTimeout(maxWaitTimer);  maxWaitTimer = null; }
            const next = computeColumnLayout(window.innerWidth);
            setValue(prev => prev.cols === next.cols ? prev : next);
        };

        const onResize = () => {
            // Start the maxWait timer on the first event of a burst.
            if (!maxWaitTimer) {
                maxWaitTimer = setTimeout(apply, MAX_WAIT);
            }
            // Reset the debounce on every event.
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(apply, DEBOUNCE_WAIT);
        };

        window.addEventListener('resize', onResize);
        return () => {
            window.removeEventListener('resize', onResize);
            if (debounceTimer) clearTimeout(debounceTimer);
            if (maxWaitTimer) clearTimeout(maxWaitTimer);
        };
    }, []);

    return value;
}
