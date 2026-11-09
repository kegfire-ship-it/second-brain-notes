import { useEffect, useState } from 'react';
import { animate, motion as Motion, useReducedMotion } from 'framer-motion';
import { Image, Images, Play, Video } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const pluralRules = new Intl.PluralRules('en');
const plural = (n, forms) => forms[pluralRules.select(n)] || forms.many;
const SLIDES = { one: 'slide', many: 'slides' };
// Instagram post kinds from the server: reel (video), photo, carousel.
const KIND = {
    photo: { label: () => 'Photo', title: 'Instagram photo', icon: Image, open: 'Open the photo on Instagram' },
    carousel: { label: n => `Carousel · ${n} ${plural(n, SLIDES)}`, title: 'Instagram carousel', icon: Images, open: 'Open the carousel on Instagram' },
};
const EASE = [0.2, 0.8, 0.2, 1];
const SPRING = { type: 'spring', stiffness: 420, damping: 22 };
// Data elements reveal as a wave: cover → title → author → views.
const WAVE = 0.08;

function useCountUp(target, run) {
    const [value, setValue] = useState(0);
    useEffect(() => {
        if (!run || !Number.isFinite(target)) return undefined;
        const controls = animate(0, target, { duration: 0.6, ease: 'easeOut', onUpdate: v => setValue(Math.round(v)) });
        return () => controls.stop();
    }, [target, run]);
    return run ? value : target;
}

function Bar({ className, delay, play }) {
    return <Motion.div className={`video-skeleton h-3 origin-left rounded-full ${className}`}
        initial={play ? { scaleX: 0, opacity: 0 } : false} animate={{ scaleX: 1, opacity: 1 }}
        transition={{ delay, duration: 0.35, ease: EASE }} />;
}

/**
 * Video link card. Mounted while loading, it assembles itself (height, frame, cover
 * slot, label, placeholder bars, play button), shimmers while waiting, then reveals
 * the real data. Mounted with data already known (note reopened), it shows at once.
 * status: 'loading' | 'ready' | 'failed'.
 */
export default function VideoCard({ url, platform, meta, thumbnail, status }) {
    const reduce = useReducedMotion();
    const [live] = useState(status === 'loading');
    const play = live && !reduce;
    const [imageLoaded, setImageLoaded] = useState(false);
    // Reels and YouTube show views; photos and carousels have only likes.
    const metric = Number.isFinite(meta?.views) ? { value: meta.views, unit: 'views' }
        : Number.isFinite(meta?.likes) ? { value: meta.likes, unit: 'likes' } : null;
    const counted = useCountUp(metric?.value, play && status === 'ready');
    const kind = platform === 'Instagram' ? KIND[meta?.kind] : null;
    const fallbackTitle = kind?.title || (platform === 'Instagram' ? 'Instagram video' : 'YouTube video');
    const label = kind ? `${platform} · ${kind.label(meta.slides_count || 1)}` : platform;
    const OpenIcon = kind?.icon || Play;
    const host = new URL(url).host;
    const reveal = delay => ({
        initial: play ? { opacity: 0, y: 4 } : false,
        animate: { opacity: 1, y: 0 },
        transition: { delay, duration: 0.35, ease: EASE },
    });
    return <Motion.div className="overflow-hidden" initial={play ? { height: 0, opacity: 0 } : false}
        animate={{ height: 'auto', opacity: 1 }} transition={{ duration: 0.3, ease: EASE }}>
        <Motion.div className="px-px py-4" initial={play ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.35, ease: EASE }}>
            <Card className="flex-row items-center gap-3 border-line p-3" data-video-card-status={status}>
                <Motion.div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-inset text-primary"
                    initial={play ? { scale: 0.6, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }}
                    transition={{ ...SPRING, delay: 0.15 }}>
                    {status === 'loading' && <div className="video-skeleton absolute inset-0" />}
                    {status !== 'loading' && !thumbnail && <Motion.div {...reveal(0)}><Video size={30} strokeWidth={1.8} /></Motion.div>}
                    {thumbnail && <>
                        {!imageLoaded && <div className="video-skeleton absolute inset-0" />}
                        <Motion.img src={thumbnail} alt="" referrerPolicy="no-referrer" onLoad={() => setImageLoaded(true)}
                            className="absolute inset-0 h-full w-full object-cover"
                            initial={play ? { opacity: 0, scale: 1.08 } : false}
                            animate={imageLoaded ? { opacity: 1, scale: 1 } : undefined}
                            transition={{ duration: 0.45, ease: EASE }} />
                    </>}
                </Motion.div>
                <div className="min-w-0 flex-1">
                    <Motion.span className="block text-xs text-ink-3" initial={play ? { opacity: 0, x: -8 } : false}
                        animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2, duration: 0.3, ease: EASE }}>{label}</Motion.span>
                    {status === 'loading' ? <div className="mt-2 space-y-2" aria-label="Loading video details">
                        <Bar className="w-[85%]" delay={0.25} play={play} />
                        <Bar className="w-[55%]" delay={0.3} play={play} />
                        <Bar className="mt-3 h-2.5 w-[40%]" delay={0.35} play={play} />
                    </div> : <>
                        <Motion.p className="my-1 line-clamp-2 text-sm font-semibold text-ink" {...reveal(WAVE)}>{meta?.title || fallbackTitle}</Motion.p>
                        <p className="m-0 break-words text-xs text-ink-3">
                            <Motion.span {...reveal(WAVE * 2)}>{meta?.author || (metric ? '' : host)}</Motion.span>
                            {metric && <Motion.span {...reveal(WAVE * 3)}>{meta?.author ? ' · ' : ''}{compactNumber.format(counted)} {metric.unit}</Motion.span>}
                        </p>
                    </>}
                </div>
                <Motion.div className="shrink-0" initial={play ? { scale: 0.5, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }}
                    transition={{ ...SPRING, delay: 0.4 }}>
                    <Button asChild variant="outline" size="icon" className="border-line-2"><a href={url} target="_blank" rel="noopener noreferrer" aria-label={kind?.open || (platform === 'Instagram' ? 'Open the video on Instagram' : 'Open the video on YouTube')}><OpenIcon size={17} strokeWidth={1.8} /></a></Button>
                </Motion.div>
            </Card>
        </Motion.div>
    </Motion.div>;
}
