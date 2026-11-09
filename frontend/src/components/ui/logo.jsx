import { useId } from 'react';
import './logo.css';

/**
 * The app's brand mark — the SINGLE SOURCE OF TRUTH for the logo.
 *
 * ⭐ Drawn as inline SVG (line art + one vertical gradient), so it stays sharp
 *    at any size and follows the theme by itself: in `.dark` the tile turns
 *    graphite and the gradient brightens (CSS vars in `logo.css`).
 *
 * The same paths live in three more places — keep them in sync if the mark
 * ever changes:
 *   - `public/logo.svg`  — favicon;
 *   - `public/logo.png`, `public/logo-512.png` — apple-touch / PWA icons
 *     (rendered from logo.svg, see the comment in that file);
 *   - `index.html` `#app-loading` — the animated loading screen.
 *
 * Rule: never hardcode a different logo inside a component — import this one.
 */

export const LOGO_STROKES = [
    // half of the brain: outline, midline, folds
    'M128 40 C121 28 101 27 95 40 C80 36 66 47 70 62 C56 66 50 82 58 95 C46 104 45 124 56 132 C46 144 50 164 64 169 C62 185 75 198 90 195 C96 211 117 219 128 210',
    'M128 40 V210',
    'M95 40 C98 50 106 56 114 56',
    'M70 62 C80 64 86 72 86 80',
    'M100 96 L106 103 L112 96',
    'M56 132 C68 130 78 136 80 146',
    'M98 140 C108 140 114 148 112 156',
    'M90 195 C92 182 102 176 112 178',
    // circuit
    'M128 70 H146 L166 50 H172',
    'M128 100 H158 L172 86 H186',
    'M128 128 H198',
    'M128 156 H158 L172 170 H186',
    'M128 186 H146 L166 206 H172',
];

export const LOGO_NODES = [
    [181, 50], [195, 86], [207, 128], [195, 170], [181, 206],
];

export default function Logo({ className, alt = 'Second Brain', tile = true, ...props }) {
    const gid = `sb-logo-g${useId().replace(/:/g, '')}`;
    return (
        <svg
            viewBox="0 0 256 256"
            role="img"
            aria-label={alt}
            className={`sb-logo${className ? ` ${className}` : ''}`}
            {...props}
        >
            <defs>
                <linearGradient id={gid} x1="0" y1="28" x2="0" y2="228" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="var(--sb-logo-g1)" />
                    <stop offset=".5" stopColor="var(--sb-logo-g2)" />
                    <stop offset="1" stopColor="var(--sb-logo-g3)" />
                </linearGradient>
            </defs>
            {tile && <rect className="sb-logo-tile" width="256" height="256" rx="56" />}
            <g
                fill="none"
                stroke={`url(#${gid})`}
                strokeWidth="9"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                {LOGO_STROKES.map((d) => <path key={d} d={d} />)}
                {LOGO_NODES.map(([cx, cy]) => <circle key={cx + cy} cx={cx} cy={cy} r="9" />)}
            </g>
        </svg>
    );
}
