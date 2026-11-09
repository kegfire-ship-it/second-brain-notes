import { useEffect, useState } from 'react';
import '../extensions/videoPresentation.css';

// Presentation only: the textarea and note state already contain the full title.
export default function TitleReveal({ title, onComplete }) {
    const characters = Array.from(title);
    const [visible, setVisible] = useState(1);

    useEffect(() => {
        const started = performance.now();
        const timer = setInterval(() => {
            const elapsed = performance.now() - started;
            setVisible(Math.min(characters.length, 1 + Math.floor(Math.min(1, elapsed / 1000) * (characters.length - 1))));
            if (elapsed >= 1380) onComplete(null);
        }, 16);
        return () => clearInterval(timer);
    }, [characters.length, onComplete]);

    return (
        <div aria-hidden="true" data-title-reveal className="pointer-events-none absolute inset-0 whitespace-pre-wrap [overflow-wrap:anywhere] font-display text-[30px] font-medium leading-tight tracking-[-0.02em] text-ink">
            {characters.slice(0, visible).map((character, index) => <span key={index} className="video-ink" style={{ animationDuration: '380ms' }}>{character}</span>)}
            {visible < characters.length && <span className="video-cursor" style={{ animationDuration: '450ms' }} />}
        </div>
    );
}
