'use client';

import { useState } from 'react';
import { Film, ImageIcon, Library, Smartphone, Monitor, X } from 'lucide-react';
import {
  DEFAULT_MEDIA_ANIMATION,
  MEDIA_ANIMATIONS,
  MEDIA_ANIMATION_LABELS,
  MEDIA_ANIMATION_LIMITS,
  MEDIA_POSITIONS,
  MEDIA_POSITION_LABELS,
  mediaSourceFromAsset,
  type MediaAnimation,
  type MediaAsset,
  type MediaKind,
  type MediaPresentation,
  type MediaSource,
} from '@vintrax/shared';
import { Button, Field, Input, Select } from '@/components/ui';
import { cn } from '@/lib/utils';
import { presentationFromAsset } from '@/lib/media-input';
import { MediaLibraryPicker } from './media-library-picker';
import { MediaThumb } from './media-thumb';

/** One slot — the computer's media or the phone's — with its choose and remove buttons. */
function SourceSlot({
  kind,
  source,
  label,
  hint,
  icon: Icon,
  onChoose,
  onRemove,
}: {
  kind: MediaKind;
  source: MediaSource | null;
  label: string;
  hint: string;
  icon: typeof Monitor;
  onChoose: () => void;
  onRemove: (() => void) | null;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border p-3">
      <MediaThumb kind={kind} source={source} className="h-16 w-28 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          {label}
        </p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        <Button type="button" variant="outline" size="sm" onClick={onChoose}>
          <Library className="h-4 w-4" aria-hidden />
          {source ? 'Change' : 'Choose'}
        </Button>
        {source && onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label={`Remove ${label.toLowerCase()}`}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Editing the media a piece of content shows — the hero, a post, a feature,
 * a home box — the same way everywhere:
 *
 * - a picture or a video, chosen from the media library or uploaded there;
 * - optionally a separate one for phones (a vertical crop, a lighter clip);
 * - how it is cropped (`cover` or `contain`) and which part stays in view;
 * - for a video, whether it plays by itself and loops;
 * - how it animates in: the effect, how long, after what delay, and whether
 *   on scroll or as the page loads.
 *
 * Holds a full presentation, URLs included, so previews draw it; the page
 * turns it into what the API takes with `toMediaInput`.
 */
export function MediaEditor({
  value,
  onChange,
  kinds = ['IMAGE', 'VIDEO'],
  idPrefix,
  required = false,
}: {
  value: MediaPresentation | null;
  onChange: (next: MediaPresentation | null) => void;
  kinds?: readonly MediaKind[];
  /** Unique per editor on the page, for the form fields' ids. */
  idPrefix: string;
  /** No remove button for the main media, e.g. a published post's picture. */
  required?: boolean;
}) {
  const [kind, setKind] = useState<MediaKind>(value?.kind ?? kinds[0]!);
  const [picking, setPicking] = useState<'desktop' | 'mobile' | null>(null);

  const set = <K extends keyof MediaPresentation>(key: K, next: MediaPresentation[K]) =>
    value && onChange({ ...value, [key]: next });
  const setAnimation = <K extends keyof MediaAnimation>(key: K, next: MediaAnimation[K]) =>
    value && onChange({ ...value, animation: { ...value.animation, [key]: next } });

  function chose(asset: MediaAsset) {
    if (picking === 'mobile' && value) {
      onChange({ ...value, mobile: mediaSourceFromAsset(asset) });
    } else if (value && value.kind === asset.kind) {
      onChange({ ...value, desktop: mediaSourceFromAsset(asset), alt: value.alt ?? asset.alt });
    } else {
      onChange(presentationFromAsset(asset));
    }
  }

  function switchKind(next: MediaKind) {
    setKind(next);
    // Media of the other kind cannot stay: a video slot showing a photo.
    if (value && value.kind !== next) onChange(null);
  }

  const id = (name: string) => `${idPrefix}-${name}`;
  const animation = value?.animation ?? DEFAULT_MEDIA_ANIMATION;

  return (
    <div className="flex flex-col gap-4">
      {kinds.length > 1 ? (
        <div
          className="inline-flex w-fit rounded-md border border-border p-0.5"
          role="radiogroup"
          aria-label="Picture or video"
        >
          {(
            [
              ['IMAGE', ImageIcon, 'Picture'],
              ['VIDEO', Film, 'Video'],
            ] as const
          )
            .filter(([option]) => kinds.includes(option))
            .map(([option, Icon, label]) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                onClick={() => switchKind(option)}
                className={cn(
                  'flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors',
                  kind === option
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </button>
            ))}
        </div>
      ) : null}

      <SourceSlot
        kind={kind}
        source={value?.kind === kind ? value.desktop : null}
        label={kind === 'IMAGE' ? 'Picture' : 'Video'}
        hint={
          value
            ? 'Shown on computers and tablets — and on phones too, unless a phone version is set.'
            : 'Nothing chosen yet.'
        }
        icon={Monitor}
        onChoose={() => setPicking('desktop')}
        onRemove={required ? null : () => onChange(null)}
      />

      {value ? (
        <>
          <SourceSlot
            kind={kind}
            source={value.mobile}
            label="Phone version (optional)"
            hint={
              kind === 'VIDEO'
                ? 'A vertical or lighter clip for phones. Without one, phones get a smaller copy of the main video, made automatically.'
                : 'A vertical crop for phones. Without one, phones get the main picture.'
            }
            icon={Smartphone}
            onChoose={() => setPicking('mobile')}
            onRemove={() => set('mobile', null)}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Description"
              htmlFor={id('alt')}
              hint="What the picture shows, read aloud by screen readers. Leave blank if it is only decoration."
              className="sm:col-span-2"
            >
              <Input
                id={id('alt')}
                maxLength={160}
                value={value.alt ?? ''}
                onChange={(event) => set('alt', event.target.value)}
              />
            </Field>
            <Field
              label="Fit"
              htmlFor={id('fit')}
              hint="Fill crops to the box; Whole shows all of it."
            >
              <Select
                id={id('fit')}
                value={value.fit}
                onChange={(event) => set('fit', event.target.value as MediaPresentation['fit'])}
              >
                <option value="COVER">Fill the box (crop)</option>
                <option value="CONTAIN">Whole picture (no crop)</option>
              </Select>
            </Field>
            <Field
              label="Keep in view"
              htmlFor={id('position')}
              hint="The part kept when it is cropped."
            >
              <Select
                id={id('position')}
                value={value.position}
                onChange={(event) =>
                  set('position', event.target.value as MediaPresentation['position'])
                }
              >
                {MEDIA_POSITIONS.map((position) => (
                  <option key={position} value={position}>
                    {MEDIA_POSITION_LABELS[position]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {kind === 'VIDEO' ? (
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={value.autoplay}
                  onChange={(event) => set('autoplay', event.target.checked)}
                />
                Play by itself when on screen
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={value.loop}
                  onChange={(event) => set('loop', event.target.checked)}
                />
                Loop
              </label>
              <p className="w-full text-xs text-muted-foreground">
                Always silent, with no player controls or download button. Visitors who ask for
                reduced motion, or save data, see the poster frame instead.
              </p>
            </div>
          ) : null}

          <fieldset className="rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">Animation</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Effect" htmlFor={id('animation')}>
                <Select
                  id={id('animation')}
                  value={animation.type}
                  onChange={(event) =>
                    setAnimation('type', event.target.value as MediaAnimation['type'])
                  }
                >
                  {MEDIA_ANIMATIONS.map((type) => (
                    <option key={type} value={type}>
                      {MEDIA_ANIMATION_LABELS[type]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={`Duration: ${animation.durationMs} ms`} htmlFor={id('duration')}>
                <input
                  id={id('duration')}
                  type="range"
                  min={MEDIA_ANIMATION_LIMITS.durationMs.min}
                  max={MEDIA_ANIMATION_LIMITS.durationMs.max}
                  step={50}
                  disabled={animation.type === 'NONE'}
                  value={animation.durationMs}
                  onChange={(event) => setAnimation('durationMs', Number(event.target.value))}
                  className="accent-primary"
                />
              </Field>
              <Field label={`Delay: ${animation.delayMs} ms`} htmlFor={id('delay')}>
                <input
                  id={id('delay')}
                  type="range"
                  min={MEDIA_ANIMATION_LIMITS.delayMs.min}
                  max={MEDIA_ANIMATION_LIMITS.delayMs.max}
                  step={50}
                  disabled={animation.type === 'NONE'}
                  value={animation.delayMs}
                  onChange={(event) => setAnimation('delayMs', Number(event.target.value))}
                  className="accent-primary"
                />
              </Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                disabled={animation.type === 'NONE'}
                checked={animation.onScroll}
                onChange={(event) => setAnimation('onScroll', event.target.checked)}
              />
              Animate when scrolled into view (off: as the page loads)
            </label>
          </fieldset>
        </>
      ) : null}

      <MediaLibraryPicker
        open={picking !== null}
        kind={kind}
        onClose={() => setPicking(null)}
        onSelect={chose}
      />
    </div>
  );
}
