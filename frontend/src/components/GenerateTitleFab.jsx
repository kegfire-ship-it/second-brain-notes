import { WandSparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Kept at its existing import path; the title action now lives beneath the field.
export default function GenerateTitleFab({ visible, loading, onClick }) {
    if (!visible) return null;

    // Keep an already-open iOS title keyboard in place while clicking the action.
    const preventBlur = (event) => event.preventDefault();

    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Suggest a title"
            aria-busy={loading}
            onClick={onClick}
            onMouseDown={preventBlur}
            onTouchStart={preventBlur}
            disabled={loading}
            className="mt-1.5 min-h-11 sm:min-h-9 max-w-full justify-start gap-1.5 px-0 has-[>svg]:px-0 text-xs text-accent-600 hover:text-accent-600"
        >
            {loading ? <Loader2 size={15} strokeWidth={1.8} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <WandSparkles size={15} strokeWidth={1.8} aria-hidden="true" />}
            <span>{loading ? 'Thinking…' : 'Suggest a title'}</span>
        </Button>
    );
}
