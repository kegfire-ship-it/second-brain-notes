import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';

const FALLBACK_HEIGHT = 200;

/**
 * Estimate a card's rendered height from its text length. Used for items
 * that haven't been measured yet (off-screen virtualized items, or initial
 * mount before ResizeObserver has fired).
 *
 * Constants tuned empirically against ~900 real notes; recalibrate if cards
 * visibly jump on first scroll.
 */
function estimateHeight(item) {
    if (!item) return FALLBACK_HEIGHT;
    const BASE = 100;       // padding + title row + footer (color/category/date)
    const PER_CHAR = 0.45;  // approx px of vertical content per character at 290px width
    const MAX = 480;        // cap at line-clamp limit (~14 lines × ~32px + extras)
    const text = (item.content ?? '').replace(/<[^>]*>/g, '');
    const len = text.length + (item.title ?? '').length * 2;
    return Math.min(BASE + len * PER_CHAR, MAX);
}

/**
 * Absolute-positioned masonry. DOM is stable — only `transform` changes,
 * so CSS transitions animate every layout shift on the GPU.
 *
 * Props:
 *   items      Array<{ id: string, render: () => ReactNode }>
 *   cols       number
 *   gap        number (px)
 *   gridWidth  number | string (CSS width value for the container)
 */
export default function AbsoluteMasonry({ items, cols, gap, gridWidth }) {
    const containerRef = useRef(null);
    const heightObserverRef = useRef(null);
    const cardRefs = useRef(new Map());

    const [containerWidth, setContainerWidth] = useState(0);
    const [heights, setHeights] = useState(() => new Map());
    const [transitionsEnabled, setTransitionsEnabled] = useState(false);
    const [scrollY, setScrollY] = useState(typeof window !== 'undefined' ? window.scrollY : 0);
    const [containerOffsetTop, setContainerOffsetTop] = useState(0);

    // Measure container width via dedicated ResizeObserver
    useEffect(() => {
        if (!containerRef.current) return;
        const co = new ResizeObserver(([entry]) => {
            setContainerWidth(entry.contentRect.width);
        });
        co.observe(containerRef.current);
        return () => co.disconnect();
    }, []);

    // Track window scroll position (rAF-throttled) for viewport virtualization.
    // Also re-measure container's offsetTop on each scroll — it may shift due to
    // dynamic content above (header collapsing, pinned section growing).
    useEffect(() => {
        let scheduled = false;
        let initialRafId = null;
        const measure = () => {
            scheduled = false;
            setScrollY(window.scrollY);
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                setContainerOffsetTop(rect.top + window.scrollY);
            }
        };
        const onScroll = () => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(measure);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        // Initial measurement — capture the rAF id so we can cancel on unmount
        initialRafId = requestAnimationFrame(measure);
        return () => {
            window.removeEventListener('scroll', onScroll);
            cancelAnimationFrame(initialRafId);
        };
    }, []);

    // ONE shared ResizeObserver for all cards. Created on mount, disposed on unmount.
    useEffect(() => {
        heightObserverRef.current = new ResizeObserver(entries => {
            setHeights(prev => {
                const next = new Map(prev);
                for (const entry of entries) {
                    const id = entry.target.dataset.id;
                    if (id) next.set(id, entry.contentRect.height);
                }
                return next;
            });
        });
        return () => heightObserverRef.current?.disconnect();
    }, []);

    // Measure the container and the first cards before the first paint, so a
    // (re)opened grid shows its cards in its very first frame instead of
    // waiting a few frames for the ResizeObservers, which keep them current.
    /* eslint-disable react-hooks/set-state-in-effect -- pre-paint layout measurement */
    useLayoutEffect(() => {
        if (containerWidth === 0) {
            const w = containerRef.current?.getBoundingClientRect().width;
            if (w) setContainerWidth(w);
            return;
        }
        if (heights.size > 0) return;
        const measured = new Map();
        cardRefs.current.forEach((el, id) => measured.set(id, el.getBoundingClientRect().height));
        if (measured.size > 0) setHeights(measured);
    }, [containerWidth, heights, items]);
    /* eslint-enable react-hooks/set-state-in-effect */

    // Enable transitions once all current items have been measured at least once.
    // Before that, cards render with `transition: none` so they snap to their
    // initial positions instead of flying in from (0, 0).
    useEffect(() => {
        if (transitionsEnabled) return;
        if (items.length === 0) return;
        if (heights.size === 0) return;
        const id = requestAnimationFrame(() => setTransitionsEnabled(true));
        return () => cancelAnimationFrame(id);
    }, [transitionsEnabled, items, heights]);

    // Compute card width and per-item position (shortest-column-first).
    const { positions, totalHeight, cardWidth } = useMemo(() => {
        if (containerWidth === 0) {
            return { positions: new Map(), totalHeight: 0, cardWidth: 0 };
        }
        const cardW = cols === 1
            ? containerWidth
            : (containerWidth - (cols - 1) * gap) / cols;
        const colHeights = new Array(cols).fill(0);
        const pos = new Map();
        for (const item of items) {
            let minCol = 0;
            for (let i = 1; i < cols; i++) {
                if (colHeights[i] < colHeights[minCol]) minCol = i;
            }
            const x = minCol * (cardW + gap);
            const y = colHeights[minCol];
            pos.set(item.id, { x, y });
            const h = heights.get(item.id) ?? estimateHeight(item);
            colHeights[minCol] += h + gap;
        }
        const maxColH = colHeights.reduce((a, b) => Math.max(a, b), 0);
        return {
            positions: pos,
            totalHeight: Math.max(0, maxColH - gap),
            cardWidth: cardW,
        };
    }, [items, cols, gap, containerWidth, heights]);

    // Virtualization: only render items whose [y, y+h] overlaps
    // [scrollY - containerOffsetTop ± 1 viewport buffer].
    const BUFFER_VIEWPORTS = 1;
    const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
    const yMin = scrollY - containerOffsetTop - BUFFER_VIEWPORTS * viewportH;
    const yMax = scrollY - containerOffsetTop + viewportH + BUFFER_VIEWPORTS * viewportH;

    const visibleItemIds = new Set();
    for (const item of items) {
        const pos = positions.get(item.id);
        if (!pos) continue;
        const h = heights.get(item.id) ?? estimateHeight(item);
        if (pos.y + h >= yMin && pos.y <= yMax) {
            visibleItemIds.add(item.id);
        }
    }

    return (
        <div
            ref={containerRef}
            className="mx-auto"
            style={{
                position: 'relative',
                width: gridWidth,
                height: totalHeight,
                // Hidden until measured, so cards never show at estimated spots.
                visibility: transitionsEnabled || heights.size > 0 || items.length === 0 ? 'visible' : 'hidden',
            }}
        >
            {items.map(item => {
                if (!visibleItemIds.has(item.id)) return null;
                const p = positions.get(item.id) ?? { x: 0, y: 0 };
                return (
                    <div
                        key={item.id}
                        ref={el => {
                            const old = cardRefs.current.get(item.id);
                            if (old && old !== el) {
                                heightObserverRef.current?.unobserve(old);
                            }
                            if (el) {
                                cardRefs.current.set(item.id, el);
                                heightObserverRef.current?.observe(el);
                            } else {
                                cardRefs.current.delete(item.id);
                            }
                        }}
                        data-id={item.id}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: cardWidth || 'auto',
                            transform: `translate(${p.x}px, ${p.y}px)`,
                            transition: transitionsEnabled ? 'transform 375ms ease-out' : 'none',
                        }}
                    >
                        {item.render()}
                    </div>
                );
            })}
        </div>
    );
}
