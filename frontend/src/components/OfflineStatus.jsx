import { useContext } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import OfflineContext from './OfflineContext';

export default function OfflineStatus() {
    const state = useContext(OfflineContext);
    if (!state) return null;
    const { status, refresh } = state;
    const failed = status === 'storage-error' || status === 'sync-error';
    if (!failed) return null;
    const message = status === 'storage-error'
        ? 'Couldn’t save notes on this device.'
        : 'Couldn’t update the saved copy of your notes.';
    return <div role="status" className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-soft px-3 py-2 text-xs text-ink-2">
        <Download size={16} strokeWidth={1.8} className="shrink-0 text-accent-600" />
        <span>{message}</span>
        <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw size={14} />Retry</Button>
    </div>;
}
