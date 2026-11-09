import { X, AlertTriangle } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function ConfirmModal({ title, message, confirmText = 'Delete', cancelText = 'Cancel', onConfirm, onCancel }) {

    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            setTimeout(() => {
                if (document.querySelectorAll('[data-modal="true"]').length === 0) {
                    document.body.style.overflow = 'unset';
                }
            }, 10);
        };
    }, []);

    return (
        <div data-modal="true" className="fixed inset-0 z-[60] flex h-[100dvh] items-center justify-center bg-black/40 p-4 animate-in fade-in duration-200">
            <div className="flex w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-modal)] animate-in zoom-in-95">
                <div className="flex items-center justify-between border-b border-line px-6 py-4">
                    <div className="flex items-center gap-2.5 text-ink">
                        <AlertTriangle size={20} strokeWidth={1.8} className="text-[var(--danger)]" />
                        <h2 className="text-[17px] font-semibold">{title}</h2>
                    </div>
                    <button
                        onClick={onCancel}
                        aria-label="Close"
                        className="flex items-center justify-center rounded-[11px] border border-line p-2 text-ink-2 transition-colors hover:bg-surface-soft hover:text-ink focus:outline-none"
                    >
                        <X size={18} strokeWidth={1.8} />
                    </button>
                </div>

                <div className="px-6 py-5">
                    <p className="text-sm leading-relaxed text-ink-2">{message}</p>
                </div>

                <div className="flex justify-end gap-2.5 border-t border-line bg-surface-soft px-6 py-4">
                    <Button variant="outline" onClick={onCancel}>{cancelText}</Button>
                    <Button variant="destructive" onClick={onConfirm}>{confirmText}</Button>
                </div>
            </div>
        </div>
    );
}
