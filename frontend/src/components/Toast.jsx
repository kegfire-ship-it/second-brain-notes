import { useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';

export default function Toast({ message, onUndo, onDismiss, duration = 5000, actionLabel = 'Undo' }) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        // Trigger enter animation on next frame
        requestAnimationFrame(() => setVisible(true));

        const timer = setTimeout(() => {
            setVisible(false);
            setTimeout(onDismiss, 300); // wait for exit animation
        }, duration);

        return () => clearTimeout(timer);
    }, []);

    const handleUndo = () => {
        onUndo();
        setVisible(false);
        setTimeout(onDismiss, 300);
    };

    return (
        <div
            className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                }`}
        >
            <div className="flex items-center gap-3 rounded-full border border-line bg-surface px-5 py-3 shadow-[var(--shadow-modal)] min-w-[280px] max-w-[90vw]">
                <span className="flex-1 text-sm font-medium text-ink whitespace-nowrap">{message}</span>
                {onUndo && (
                <button
                    onClick={handleUndo}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-accent-600 transition-colors hover:bg-accent-50 focus:outline-none whitespace-nowrap"
                >
                    <Undo2 size={16} strokeWidth={1.8} />
                    {actionLabel}
                </button>
                )}
            </div>
        </div>
    );
}
