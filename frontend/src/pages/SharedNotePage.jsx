import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { SearchX } from 'lucide-react';
import { CategoryChip } from '@/components/ui/category-chip';
const COLOR_MAP = {
    white: 'bg-surface',
    red: 'bg-red-50',
    orange: 'bg-orange-50',
    yellow: 'bg-yellow-50',
    lime: 'bg-lime-50',
    green: 'bg-green-50',
    teal: 'bg-teal-50',
    blue: 'bg-blue-50',
    purple: 'bg-purple-50',
    pink: 'bg-pink-50'
};

// Map a free-form note category to one of the five CategoryChip keys (mirrors NoteCard).
const CATEGORY_KEY_MAP = {
    ideas: 'ideas', идея: 'ideas', идеи: 'ideas',
    philosophy: 'philosophy', philo: 'philosophy', философия: 'philosophy',
    projects: 'projects', project: 'projects', проект: 'projects', проекты: 'projects',
    health: 'health', здоровье: 'health',
    misc: 'misc', other: 'misc', разное: 'misc', прочее: 'misc',
};
const categoryKey = (cat) => (cat ? (CATEGORY_KEY_MAP[cat.trim().toLowerCase()] || 'misc') : 'misc');

const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function SharedNotePage() {
    const { token } = useParams();
    const [note, setNote] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        const fetchNote = async () => {
            try {
                const { data } = await axios.get(`${API_URL}/shared/${token}`);
                setNote(data);
            } catch {
                setError(true);
            } finally {
                setLoading(false);
            }
        };
        fetchNote();
    }, [token]);

    if (loading) {
        return (
            <div className="min-h-screen bg-surface-cool flex items-center justify-center">
                <div className="h-10 w-10 rounded-full border-2 border-line border-t-accent animate-spin" />
            </div>
        );
    }

    if (error || !note) {
        return (
            <div className="min-h-screen bg-surface-cool flex items-center justify-center p-6">
                <div className="w-full max-w-md rounded-lg border border-line bg-card p-10 text-center shadow-[var(--shadow-md)]">
                    <div className="mb-4 flex justify-center text-ink-3"><SearchX size={56} strokeWidth={1.8} /></div>
                    <h1 className="mb-2 text-2xl font-semibold text-ink">Note Not Found</h1>
                    <p className="text-ink-2">This link may have expired or the note has been deleted.</p>
                </div>
            </div>
        );
    }

    const bgColorClass = COLOR_MAP[note.color] || 'bg-surface';

    return (
        <div className="min-h-screen bg-surface-cool flex flex-col">
            {/* Main Content */}
            <main className="flex-1 flex items-start justify-center px-4 sm:px-6 py-8 sm:py-16">
                <article className={`w-full max-w-2xl rounded-lg border border-line shadow-[var(--shadow-md)] ${bgColorClass}`}>
                    {/* Header */}
                    <div className="px-6 sm:px-10 pt-8 sm:pt-10 pb-4">
                        {note.title ? (
                            <h1 className="text-3xl sm:text-4xl font-semibold text-ink leading-tight break-words">
                                {note.title}
                            </h1>
                        ) : (
                            <h1 className="text-3xl sm:text-4xl font-semibold text-ink-3 leading-tight italic">
                                Untitled
                            </h1>
                        )}

                        {/* Meta — category & date */}
                        <div className="flex items-center gap-3 mt-4 flex-wrap">
                            {note.category && note.category.trim() !== '' && (
                                <CategoryChip
                                    category={categoryKey(note.category)}
                                    className="max-w-[200px] truncate"
                                >
                                    {note.category}
                                </CategoryChip>
                            )}
                            {note.updatedAt && (
                                <span className="text-xs font-medium text-ink-3">{note.updatedAt}</span>
                            )}
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="mx-6 sm:mx-10 border-t border-line" />

                    {/* Content */}
                    <div className="px-6 sm:px-10 py-6 sm:py-8">
                        <div
                            data-rich-copy
                            className="note-content prose prose-sm sm:prose-base prose-a:text-accent-600 prose-a:font-semibold prose-a:underline prose-a:underline-offset-2 max-w-none text-ink whitespace-pre-wrap leading-relaxed break-words [word-break:break-word]"
                            dangerouslySetInnerHTML={{ __html: note.content }}
                        />
                    </div>
                </article>
            </main>

            {/* Footer */}
            <footer className="py-6 text-center">
                <p className="text-xs font-medium text-ink-3">
                    Powered by <span className="text-ink">Second Brain</span>
                </p>
            </footer>
        </div>
    );
}
