import { Sparkles, Loader2 } from 'lucide-react';

export default function PolishTextFab({ visible, loading, onClick, bgColorClass }) {
    if (!visible) return null;

    // preventDefault on mouse/touch start keeps the editor text selection intact
    // (otherwise clicking the FAB blurs the editor / collapses the selection).
    const preventBlur = (e) => e.preventDefault();

    return (
        <div className="absolute right-4 bottom-[72px] sm:bottom-[80px] z-30 animate-in fade-in zoom-in-95 duration-150">
            <button
                type="button"
                aria-label="Make readable"
                title="Make readable"
                onClick={onClick}
                onMouseDown={preventBlur}
                onTouchStart={preventBlur}
                disabled={loading}
                style={{ boxShadow: 'var(--glow-accent)' }}
                className={`
                    flex items-center gap-1.5 rounded-full border border-accent-100 px-3.5 py-2.5
                    text-accent-600 transition-all hover:bg-accent-50 focus:outline-none
                    ${loading ? 'opacity-60 cursor-not-allowed' : ''}
                    ${bgColorClass}
                `}
            >
                <Sparkles size={18} strokeWidth={1.8} />
                {loading && <Loader2 size={16} strokeWidth={1.8} className="animate-spin" />}
            </button>
        </div>
    );
}
