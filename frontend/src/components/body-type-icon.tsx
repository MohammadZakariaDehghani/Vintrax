import type { BodyType } from '@atlas/shared';
import { cn } from '@/lib/utils';

/**
 * Side profiles for the body-type shortcuts.
 *
 * Drawn rather than photographed. A rendered car is a licensing question and a
 * 40 KB image each; the thing that actually distinguishes an SUV from a wagon
 * from a hatchback at this size is the roofline and the overhangs, which a path
 * carries in a few hundred bytes and which stays sharp at any zoom.
 *
 * One viewBox and one wheelbase across all nine, so the shapes read as a set
 * and the difference the eye catches is the silhouette itself.
 */
const BODIES: Record<BodyType, string> = {
  // Three boxes: bonnet, cabin, a boot deck below the roofline.
  SEDAN:
    'M6 38V30c0-3 2-4 5-4.5L26 24l18-10h30l18 10 13 1.5c3 .5 4 1.5 4 4.5v8Z',
  // Roof peaks early and falls in one line to the tail — no boot step.
  COUPE:
    'M6 38V30c0-3 2-4 5-4.5L28 24l16-9h20l36 10 5 1c3 .5 4 1.5 4 4.5v8Z',
  // Short, and the cabin stops in a near-vertical hatch over the rear axle.
  HATCHBACK:
    'M12 38V30c0-3 2-4 5-4.5L30 24l16-11h34l6 13 8 .5c3 .5 4 1.5 4 4.5v8Z',
  // Sedan nose, but the roof is carried flat to a vertical tail.
  WAGON:
    'M6 38V30c0-3 2-4 5-4.5L26 24l16-11h58l6 11 3 .5c3 .5 4 1.5 4 4.5v8Z',
  // Tall and upright, with a short bonnet and a squared-off back.
  SUV: 'M8 38V26c0-4 2-5 6-5.5L26 19l12-11h52l8 12 8 1c3 .5 4 1.5 4 5v12Z',
  // One box: a long raked windscreen running from a low nose to the roof.
  MINIVAN:
    'M8 38V26c0-4 2-5 6-5.5L22 19 40 7h52l8 13 8 1c3 .5 4 1.5 4 5v12Z',
  // The tallest, bluntest shape — a cargo box with a stub bonnet.
  VAN: 'M8 38V22c0-4 2-5 6-5.5L22 16 32 4h74l6 3c2 1 2 2 2 5v26Z',
  // Cab in front, then a step down to an open bed.
  TRUCK:
    'M6 38V28c0-3 2-4 5-4.5L24 22l12-11h28l6 11h36v16Z',
  // Low, with a raked screen and nothing but deck behind it.
  CONVERTIBLE:
    'M6 38V30c0-3 2-4 5-4.5L28 24l16-10h4l-2 10h56l4 1.5c3 .5 4 1.5 4 4.5v8Z',
};

/** Where the wheels sit. Shared, so the shapes line up as a row. */
const WHEELS: Array<[number, number]> = [
  [32, 38],
  [92, 38],
];

export function BodyTypeIcon({
  bodyType,
  className,
}: {
  bodyType: BodyType;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 120 48"
      className={cn('h-11 w-auto', className)}
      fill="none"
      aria-hidden
      focusable="false"
    >
      <path d={BODIES[bodyType]} fill="currentColor" />
      {WHEELS.map(([cx, cy]) => (
        <g key={cx}>
          <circle cx={cx} cy={cy} r="7.5" fill="currentColor" />
          {/* Punched out in the surface colour so the wheel reads as a wheel
              rather than a bump on the body. */}
          <circle cx={cx} cy={cy} r="3.2" className="fill-card" />
        </g>
      ))}
    </svg>
  );
}
