import { useEffect, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import api from '../services/api';
import { Button } from '@/components/ui/button';

export default function ConnectClaudeModal({ onClose }) {
    const [message, setMessage] = useState('');
    const [failed, setFailed] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        document.body.style.overflow = 'hidden';
        api.get('/auth/claude-connection')
            .then((response) => setMessage(response.data.message))
            .catch(() => setFailed(true));
        return () => {
            setTimeout(() => {
                if (document.querySelectorAll('[data-modal="true"]').length === 0) {
                    document.body.style.overflow = 'unset';
                }
            }, 10);
        };
    }, []);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(message);
            setCopied(true);
        } catch {
            setFailed(true);
        }
    };

    return (
        <div data-modal="true" className="fixed inset-0 z-[60] flex h-[100dvh] items-center justify-center bg-black/40 p-4">
            <div className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-surface">
                <div className="flex items-center justify-between border-b border-line px-6 py-4">
                    <h2 className="text-[17px] font-semibold text-ink">Connect to Claude</h2>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="flex items-center justify-center rounded-[11px] border border-line p-2 text-ink-2"
                    >
                        <X size={18} strokeWidth={1.8} />
                    </button>
                </div>

                <div className="space-y-3 px-6 py-5 text-sm leading-relaxed text-ink-2">
                    <p>Once connected, you can ask Claude to find your notes, summarize them or save new ones.</p>
                    <p>Do this on the computer where you have the Claude app. Press the button below to copy a ready-made message, paste it into the Code tab of the Claude app and send it. Claude will set up the connection by itself.</p>
                    <p>The message contains a private key that opens your notes, so paste it only into your own Claude app.</p>
                    {failed && <p className="text-[var(--danger)]">That didn’t work. Close this window and try again.</p>}
                </div>

                <div className="flex justify-end border-t border-line bg-surface-soft px-6 py-4">
                    <Button onClick={copy} disabled={!message}>
                        {copied ? <Check size={16} strokeWidth={1.8} /> : <Copy size={16} strokeWidth={1.8} />}
                        {copied ? 'Copied' : 'Copy message'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
