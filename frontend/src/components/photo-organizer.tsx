'use client';

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, GripVertical, Star, X } from 'lucide-react';
import { moveItem } from '@/lib/move-item';
import { cn } from '@/lib/utils';

export interface OrganizerImage {
  url: string;
  alt?: string;
}

/** How far the pointer travels before a press becomes a drag, so a click stays a click. */
const DRAG_THRESHOLD_PX = 6;

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  /** Where the dragged photo sits now; it moves as the pointer passes other photos. */
  index: number;
  active: boolean;
}

/**
 * A listing's photos as a row of tiles the seller can put in order: drag a
 * tile onto another's place, or use its arrows, and "Make main" to send one
 * to the front. The first photo is the listing's main photo — the one on
 * every search result and at the top of the gallery — and is labelled so.
 *
 * Dragging uses pointer events rather than the HTML drag-and-drop API, which
 * never fires for a finger on a phone. With a mouse or pen the whole tile is
 * the handle; with a finger only the grip is, so swiping across the photos
 * still scrolls the page.
 */
export function PhotoOrganizer({
  images,
  onChange,
}: {
  images: OrganizerImage[];
  onChange: (next: OrganizerImage[]) => void;
}) {
  const drag = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // The latest order, for the pointer handlers, which fire faster than a
  // re-render hands them fresh props.
  const latest = useRef(images);
  latest.current = images;

  const move = (from: number, to: number) => onChange(moveItem(latest.current, from, to));

  function onPointerDown(event: ReactPointerEvent<HTMLElement>, index: number) {
    const target = event.target as HTMLElement;
    if (target.closest('button')) return;
    if (event.pointerType === 'touch' && !target.closest('[data-drag-handle]')) return;
    if (event.button !== 0) return;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      index,
      active: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (!state.active) {
      const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
      if (distance < DRAG_THRESHOLD_PX) return;
      state.active = true;
      setDragging(latest.current[state.index]?.url ?? null);
    }
    event.preventDefault();
    const over = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-photo-index]');
    if (!over) return;
    const overIndex = Number(over.dataset.photoIndex);
    if (Number.isInteger(overIndex) && overIndex !== state.index) {
      move(state.index, overIndex);
      state.index = overIndex;
    }
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(null);
  }

  if (images.length === 0) return null;

  return (
    <>
      <p className="mt-4 text-xs text-muted-foreground">
        Drag a photo to change the order, or use its arrows. The first photo is the main photo.
      </p>
      <ol className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {images.map((image, index) => {
          const isMain = index === 0;
          const isDragged = dragging === image.url;
          return (
            <li
              // Keyed by address, not position, so a tile keeps its element —
              // and the pointer it has captured — as it moves along the row.
              key={image.url}
              data-photo-index={index}
              onPointerDown={(event) => onPointerDown(event, index)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className={cn(
                'group relative select-none overflow-hidden rounded-md border bg-muted transition-shadow',
                isMain ? 'border-primary ring-2 ring-primary' : 'border-border',
                isDragged ? 'z-10 cursor-grabbing opacity-70 shadow-lg' : 'cursor-grab',
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={`Photo ${index + 1}${isMain ? ' (main photo)' : ''}`}
                draggable={false}
                className="aspect-[4/3] w-full object-cover"
              />

              <span
                data-drag-handle
                aria-hidden
                className="absolute left-1 top-1 grid h-7 w-7 touch-none place-items-center rounded bg-black/55 text-white"
              >
                <GripVertical className="h-4 w-4" />
              </span>

              {isMain ? (
                <span className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                  <Star className="h-3 w-3 fill-current" aria-hidden />
                  Main photo
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => move(index, 0)}
                  className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                  aria-label={`Make photo ${index + 1} the main photo`}
                >
                  <Star className="h-3 w-3" aria-hidden />
                  Make main
                </button>
              )}

              <div className="absolute bottom-1 right-1 flex gap-1">
                <button
                  type="button"
                  onClick={() => move(index, index - 1)}
                  disabled={index === 0}
                  aria-label={`Move photo ${index + 1} earlier`}
                  className="grid h-6 w-6 place-items-center rounded bg-black/65 text-white hover:bg-black/80 disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, index + 1)}
                  disabled={index === images.length - 1}
                  aria-label={`Move photo ${index + 1} later`}
                  className="grid h-6 w-6 place-items-center rounded bg-black/65 text-white hover:bg-black/80 disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </div>

              <button
                type="button"
                aria-label={`Remove photo ${index + 1}`}
                onClick={() => onChange(latest.current.filter((_, i) => i !== index))}
                className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-destructive text-destructive-foreground"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}
