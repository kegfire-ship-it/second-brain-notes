import { useState, useRef, useEffect } from 'react';
import { Pin, Palette, Check, Youtube } from 'lucide-react';
import { COLOR_KEYS, COLOR_MAP, VIBRANT_COLOR_MAP } from '../utils/colors';
import { Card } from '@/components/ui/card';
import { CategoryChip } from '@/components/ui/category-chip';
import { cn } from '@/lib/utils';
import { notePreview } from '../utils/notePreview';

// Map a free-form note category (any user string, EN or RU) to one of the five
// semantic CategoryChip keys. Unknown / custom categories fall back to `misc`.
// The chip still shows the user's original label verbatim.
const CATEGORY_KEY_MAP = {
    ideas: 'ideas', идея: 'ideas', идеи: 'ideas',
    philosophy: 'philosophy', philo: 'philosophy', философия: 'philosophy',
    projects: 'projects', project: 'projects', проект: 'projects', проекты: 'projects',
    health: 'health', здоровье: 'health',
    misc: 'misc', other: 'misc', разное: 'misc', прочее: 'misc',
};

const categoryKey = (cat) => {
    if (!cat) return 'misc';
    return CATEGORY_KEY_MAP[cat.trim().toLowerCase()] || 'misc';
};

export default function NoteCard({ note, onClick, onTogglePin, onColorChange, readOnly = false }) {
    const bgColorClass = COLOR_MAP[note.color] || 'bg-surface';
    const [showColorPicker, setShowColorPicker] = useState(false);
    const pickerRef = useRef(null);

    const handlePinClick = (e) => {
        e.stopPropagation();
        onTogglePin(note);
    };

    const handleColorButtonClick = (e) => {
        e.stopPropagation();
        setShowColorPicker(prev => !prev);
    };

    const handleColorSelect = (e, colorKey) => {
        e.stopPropagation();
        if (onColorChange) onColorChange(note, colorKey);
        setShowColorPicker(false);
    };

    // Close picker on outside click and Escape key
    useEffect(() => {
        if (!showColorPicker) return;

        const handleOutside = (e) => {
            if (pickerRef.current && !pickerRef.current.contains(e.target)) {
                e.preventDefault();
                e.stopPropagation();
                setShowColorPicker(false);
                // Block the click event that follows this pointerdown,
                // so clicking outside the picker doesn't also open the note
                document.addEventListener('click', (clickE) => {
                    clickE.preventDefault();
                    clickE.stopPropagation();
                    clickE.stopImmediatePropagation();
                }, { capture: true, once: true });
            }
        };

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                setShowColorPicker(false);
            }
        };

        document.addEventListener('pointerdown', handleOutside, true);
        document.addEventListener('keydown', handleKeyDown, true);

        return () => {
            document.removeEventListener('pointerdown', handleOutside, true);
            document.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [showColorPicker]);

    const renderPreview = () => {
        return notePreview(note.content).map((part, i) => {
            if (part.href) {
                return (
                    <a
                        key={i}
                        href={part.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        aria-label={part.youtube ? 'Open on YouTube' : undefined}
                        title={part.youtube ? 'Open on YouTube' : undefined}
                        className={cn(
                            'text-accent-600 hover:text-[var(--accent)] transition-colors rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                            part.youtube ? '-my-1 inline-flex align-middle p-1' : 'underline decoration-1 underline-offset-2 break-all',
                        )}
                    >
                        {part.youtube ? <Youtube size={18} strokeWidth={1.8} aria-hidden="true" /> : part.text}
                    </a>
                );
            }
            return part.text;
        });
    };

    return (
        <Card
            onClick={onClick}
            role={readOnly ? 'button' : undefined}
            tabIndex={readOnly ? 0 : undefined}
            aria-label={readOnly ? (note.title || 'Untitled') : undefined}
            onKeyDown={readOnly ? event => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(); }
            } : undefined}
            aria-hidden={note._masked || undefined}
            className={cn(
                note._masked && 'pres-masked',
                'group relative w-full max-w-full min-h-[168px] cursor-pointer flex-col gap-0 rounded-xl border-line p-5 sm:p-6 outline-none transition-all duration-200',
                'shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:border-line-2 hover:shadow-[var(--shadow-md)]',
                bgColorClass,
            )}
        >
            {!readOnly && <button
                onClick={handlePinClick}
                className={cn(
                    'absolute top-3 right-3 z-10 flex items-center justify-center rounded-[11px] border p-2 transition-all duration-150',
                    note.pinned
                        ? 'border-accent-100 bg-accent-50 text-[var(--accent)] opacity-100'
                        : 'border-line text-ink-2 opacity-100 hover:bg-surface-soft hover:text-ink sm:opacity-0 sm:group-hover:opacity-100',
                    // Resting state blends into the note's color instead of a white chip
                    !note.pinned && bgColorClass,
                )}
            >
                <Pin size={17} strokeWidth={1.8} fill="none" className={note.pinned ? 'rotate-45' : ''} />
            </button>}

            {/* Top Title Group */}
            {note.title ? (
                <h3 className="mb-2 pr-9 text-[17px] font-semibold leading-snug text-ink line-clamp-2 break-words">{note.title}</h3>
            ) : (
                <h3 className="mb-2 pr-9 text-[17px] font-semibold leading-snug text-ink-3 line-clamp-1">Untitled</h3>
            )}

            {/* Content Preview */}
            <div className="mb-auto w-full max-w-full overflow-hidden">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2 line-clamp-[11] break-words [word-break:break-word]">
                    {renderPreview()}
                </p>
            </div>

            {/* Bottom Area */}
            <div className="mt-4 flex w-full items-center justify-between gap-2">
                {/* Left side: Color Picker + Category */}
                <div className="flex items-center gap-2 overflow-visible">
                    {/* Color picker trigger — shown on mobile permanently, and on desktop by hover OR when open */}
                    {!readOnly && onColorChange && (
                        <div className={`relative transition-opacity ${showColorPicker ? 'opacity-100 z-50' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'}`} ref={pickerRef}>
                            <button
                                onClick={handleColorButtonClick}
                                className={cn(
                                    'flex items-center justify-center rounded-[9px] border border-line p-1.5 text-ink-2 transition-all duration-150 hover:bg-surface-soft hover:text-ink focus:outline-none',
                                    bgColorClass,
                                )}
                                title="Change color"
                                type="button"
                            >
                                <Palette size={15} strokeWidth={1.8} />
                            </button>

                            {/* Color picker popover */}
                            {showColorPicker && (
                                <div
                                    className="absolute bottom-full left-0 z-50 mb-3 grid w-max grid-cols-5 gap-1.5 rounded-xl border border-line bg-surface p-2.5 shadow-[var(--shadow-md)] animate-in fade-in zoom-in-95 duration-150"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {COLOR_KEYS.map(c => (
                                        <button
                                            key={c}
                                            onClick={(e) => handleColorSelect(e, c)}
                                            className={cn(
                                                'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-line transition-transform sm:h-7 sm:w-7',
                                                VIBRANT_COLOR_MAP[c],
                                                (note.color || 'white') === c
                                                    ? 'scale-105 ring-2 ring-[var(--accent)] ring-offset-1'
                                                    : 'hover:scale-110',
                                            )}
                                            title={c}
                                            type="button"
                                        >
                                            {(note.color || 'white') === c && (
                                                <Check size={13} strokeWidth={2.5} className="text-ink" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Category */}
                    {note.category && note.category.trim() !== '' && (
                        <CategoryChip
                            category={categoryKey(note.category)}
                            className="max-w-[140px] flex-shrink-0 truncate"
                        >
                            {note.category}
                        </CategoryChip>
                    )}
                </div>

                {/* Right side: Date — hidden when color picker is open to match requested logic */}
                {!showColorPicker && (
                    <span className="ml-auto whitespace-nowrap text-[12.5px] text-ink-3 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                        {note.updatedAt}
                    </span>
                )}
            </div>
        </Card>
    );
}
