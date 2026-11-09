import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Edit2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function CategoriesModal({ categories, onClose, onAdd, onEdit, onDelete }) {
    const [newCat, setNewCat] = useState('');
    const [editId, setEditId] = useState(null);
    const [editName, setEditName] = useState('');

    const handleAdd = () => {
        if (newCat.trim() && !categories.find(c => c.id.toLowerCase() === newCat.trim().toLowerCase())) {
            onAdd(newCat.trim());
            setNewCat('');
        }
    };

    // Body scroll lock — shared "[data-modal]" counting contract with NoteEditor/ConfirmModal.
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

    const startEdit = (cat) => {
        setEditId(cat.id);
        setEditName(cat.id);
    };

    const saveEdit = (oldId) => {
        if (editName.trim() && editName.trim() !== oldId) {
            onEdit(oldId, editName.trim());
        }
        setEditId(null);
    };

    return (
        <div data-modal="true" className="fixed inset-0 z-50 flex h-[100dvh] items-center justify-center bg-black/40 p-4 animate-in fade-in duration-200">
            <div className="flex w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-modal)] animate-in zoom-in-95">
                <div className="flex items-center justify-between border-b border-line px-6 py-4">
                    <h2 className="text-[17px] font-semibold text-ink">Categories</h2>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="flex items-center justify-center rounded-[11px] border border-line p-2 text-ink-2 transition-colors hover:bg-surface-soft hover:text-ink focus:outline-none"
                    >
                        <X size={18} strokeWidth={1.8} />
                    </button>
                </div>

                <div className="flex max-h-[60vh] w-full flex-1 flex-col overflow-y-auto p-6">
                    <div className="mb-6 flex gap-2">
                        <Input
                            type="text"
                            placeholder="New category…"
                            value={newCat}
                            onChange={(e) => setNewCat(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck="false"
                            inputMode="text"
                        />
                        <Button onClick={handleAdd} size="icon" aria-label="Add category" className="flex-shrink-0">
                            <Plus size={18} strokeWidth={1.8} />
                        </Button>
                    </div>

                    <div className="flex flex-col gap-2">
                        {categories.map(cat => (
                            <div key={cat.id} className="group flex h-12 items-center justify-between rounded-xl border border-line bg-surface px-4 transition-colors hover:border-line-2">
                                {editId === cat.id ? (
                                    <div className="flex h-full w-full items-center gap-2 py-1.5">
                                        <Input
                                            type="text"
                                            value={editName}
                                            onChange={(e) => setEditName(e.target.value)}
                                            className="h-9"
                                            autoFocus
                                            onKeyDown={(e) => e.key === 'Enter' && saveEdit(cat.id)}
                                            autoComplete="off"
                                            autoCorrect="off"
                                            spellCheck="false"
                                            inputMode="text"
                                        />
                                        <Button onClick={() => saveEdit(cat.id)} size="icon" aria-label="Save" className="flex-shrink-0">
                                            <Check size={16} strokeWidth={1.8} />
                                        </Button>
                                    </div>
                                ) : (
                                    <>
                                        <span className="overflow-hidden text-ellipsis whitespace-nowrap pr-2 text-sm font-medium text-ink">{cat.id}</span>
                                        <div className="flex flex-shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                                            <Button onClick={() => startEdit(cat)} variant="ghost" size="icon-sm" aria-label="Rename">
                                                <Edit2 size={15} strokeWidth={1.8} />
                                            </Button>
                                            <Button onClick={() => onDelete(cat.id)} variant="ghost" size="icon-sm" aria-label="Delete">
                                                <Trash2 size={15} strokeWidth={1.8} />
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex justify-end border-t border-line bg-surface-soft px-6 py-4">
                    <Button onClick={onClose}>Done</Button>
                </div>
            </div>
        </div>
    );
}
