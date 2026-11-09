import { useEffect } from 'react';

/**
 * Calls onNearBottom() when the user has scrolled within `threshold` viewports
 * of the document bottom. Throttles via rAF to one call per frame.
 *
 * Re-checks immediately on mount in case the page is already short enough
 * that no scroll event ever fires.
 */
export default function useInfiniteScroll(onNearBottom, { threshold = 1, enabled = true } = {}) {
    useEffect(() => {
        if (!enabled) return;
        let scheduled = false;

        const check = () => {
            scheduled = false;
            const remaining = document.documentElement.scrollHeight
                - window.scrollY
                - window.innerHeight;
            if (remaining < threshold * window.innerHeight) {
                onNearBottom();
            }
        };

        const onScroll = () => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(check);
        };

        window.addEventListener('scroll', onScroll, { passive: true });
        // Initial check — page may already be short enough
        const initial = requestAnimationFrame(check);

        return () => {
            window.removeEventListener('scroll', onScroll);
            cancelAnimationFrame(initial);
        };
    }, [onNearBottom, threshold, enabled]);
}
