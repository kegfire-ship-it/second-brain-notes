import {
    SwipeableList,
    SwipeableListItem,
    SwipeAction,
    TrailingActions,
    Type,
} from 'react-swipeable-list';
import 'react-swipeable-list/dist/styles.css';
import { useRef } from 'react';
import { Trash2 } from 'lucide-react';
import NoteCard from './NoteCard';



export default function SwipeableNoteCard({ note, onClick, onTogglePin, onSwipeDelete, onColorChange }) {
    const itemRef = useRef(null);

    // The library only resets on `touchend`. iOS sends `touchcancel` instead when the
    // system takes over the gesture (scroll, edge-swipe back, notification) — the card
    // then stays stuck half-swiped over the red action. Snap it back without deleting.
    const handleTouchCancel = () => {
        const item = itemRef.current;
        if (!item) return;
        if (item.requestedAnimationFrame) {
            cancelAnimationFrame(item.requestedAnimationFrame);
            item.requestedAnimationFrame = null;
        }
        item.playReturnAnimation?.();
        item.resetState?.();
    };

    const trailingActions = () => (
        <TrailingActions>
            <SwipeAction
                destructive={true}
                onClick={() => onSwipeDelete(note)}
            >
                <div className="swipe-action-delete">
                    <Trash2 size={26} strokeWidth={1.8} color="white" />
                </div>
            </SwipeAction>
        </TrailingActions>
    );

    return (
        // optOutMouseEvents: disable mouse-drag swiping — touch events only
        <SwipeableList type={Type.ANDROID} threshold={0.4} optOutMouseEvents>
            <SwipeableListItem
                ref={itemRef}
                trailingActions={trailingActions()}
                destructiveCallbackDelay={200}
                optOutMouseEvents
            >
                <div className="w-full" style={{ touchAction: 'pan-y' }} onTouchCancel={handleTouchCancel}>
                    <NoteCard note={note} onClick={onClick} onTogglePin={onTogglePin} onColorChange={onColorChange} />
                </div>
            </SwipeableListItem>
        </SwipeableList>
    );
}
