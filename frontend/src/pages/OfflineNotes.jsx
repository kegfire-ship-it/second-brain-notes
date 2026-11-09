import { useMemo, useRef, useState } from 'react';
import { FileText, LogOut, RefreshCw, WifiOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Logo from '@/components/ui/logo';
import NoteCard from '../components/NoteCard';
import TipTapEditor from '../components/TipTapEditor';
import { clearSession, searchableNoteText } from '../services/offlineNotes';

export default function OfflineNotes({ snapshot, status, refresh }) {
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(null);
    const [readerOpen, setReaderOpen] = useState(false);
    const readerTrigger = useRef(null);
    const [limit, setLimit] = useState(50);
    const navigate = useNavigate();
    const indexed = useMemo(() => (snapshot?.notes || []).map(note => ({ note, text: searchableNoteText(note) })), [snapshot]);
    const results = useMemo(() => {
        const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
        return indexed.filter(item => words.every(word => item.text.includes(word))).map(item => item.note);
    }, [indexed, query]);

    return <div className="min-h-screen bg-background px-3 pb-12 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <main className="mx-auto max-w-[1120px]">
            <header className="mb-6 flex items-center gap-3">
                <Logo className="h-9 w-9" />
                <h1 className="font-display text-3xl text-ink">Notes</h1>
                <Button variant="ghost" size="icon" className="ml-auto" aria-label="Sign out" onClick={() => { clearSession(); navigate('/login'); }}>
                    <LogOut size={18} strokeWidth={1.8} />
                </Button>
            </header>
            <div role="status" className="mb-5 rounded-xl border border-line bg-surface-soft p-4 text-sm text-ink-2">
                <div className="flex items-center gap-2 font-semibold text-ink"><WifiOff size={18} strokeWidth={1.8} />Offline · Read only</div>
                <p className="mt-2">You can read and search your saved notes. Editing, video and AI come back once you’re online.</p>
                {snapshot && <p className="mt-2 text-xs">On this device: {snapshot.notes.length} notes. Updated {new Date(snapshot.savedAt).toLocaleString('en-US')}.</p>}
                <Button variant="outline" size="sm" className="mt-3" disabled={status === 'syncing'} onClick={refresh}>
                    <RefreshCw size={15} strokeWidth={1.8} className={status === 'syncing' ? 'animate-spin' : ''} />
                    {status === 'syncing' ? 'Checking…' : 'Check connection'}
                </Button>
            </div>
            {snapshot ? <>
                <Input type="search" aria-label="Search saved notes" placeholder="Search saved notes" value={query} onChange={event => { setQuery(event.target.value); setLimit(50); }} className="mb-3 h-11" />
                <p className="mb-4 text-xs text-ink-3" aria-live="polite">Found: {results.length}</p>
                <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {results.slice(0, limit).map(note => <NoteCard key={note.id} note={note} readOnly onClick={event => {
                        readerTrigger.current = event?.currentTarget || document.activeElement;
                        setSelected(note);
                        setReaderOpen(true);
                    }} />)}
                </div>
                {results.length > limit && <Button variant="outline" className="mx-auto mt-6 flex" onClick={() => setLimit(count => count + 50)}>Show more</Button>}
                {!results.length && <EmptyState icon={<FileText size={22} />} title={query ? 'Nothing found' : 'No saved notes yet'} description={query ? 'Try another word.' : 'Connect to the internet to update your copy.'} />}
            </> : <EmptyState icon={<FileText size={22} strokeWidth={1.8} />} title={status === 'loading' ? 'Opening saved notes…' : 'No saved copy'} description={status === 'storage-error' ? 'This device’s storage isn’t available. Connect to the internet and try again.' : 'Open the app while online and your notes will be saved on this device automatically.'} />}
        </main>
        {/* Keep the note intact while Radix runs the close animation. */}
        <Dialog open={readerOpen} onOpenChange={setReaderOpen}>
            <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-3xl" onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => {
                event.preventDefault();
                readerTrigger.current?.focus({ preventScroll: true });
            }}>
                {selected && <>
                    <DialogHeader className="shrink-0 pr-7 text-left">
                        <DialogTitle className="break-words font-display text-2xl leading-snug">{selected.title || 'Untitled'}</DialogTitle>
                        <DialogDescription>Saved copy · Read only</DialogDescription>
                    </DialogHeader>
                    <div className="min-h-0 overflow-y-auto">
                        <TipTapEditor key={selected.id} content={selected.content} readOnly offline onChange={() => {}} />
                    </div>
                </>}
            </DialogContent>
        </Dialog>
    </div>;
}
