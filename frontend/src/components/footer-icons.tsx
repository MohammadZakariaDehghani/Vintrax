import { Instagram, Linkedin, Mail, Phone, Youtube } from 'lucide-react';
import type { FooterLinkIcon } from '@vintrax/shared';
import { cn } from '@/lib/utils';

type Glyph = React.ComponentType<{ className?: string }>;

/** A 24-unit glyph filled in the current colour. */
function filled(path: string, label: string): Glyph {
  const Component = ({ className }: { className?: string }) => (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
  Component.displayName = label;
  return Component;
}

const FacebookGlyph = filled(
  'M14 8.5V6.6c0-.9.6-1.1 1-1.1h2.6V1.6L14 1.6c-4 0-4.9 3-4.9 4.9v2H6.8v4h2.3V22.4H14V12.5h3.3l.4-4Z',
  'FacebookGlyph',
);

const XGlyph = filled(
  'M18.9 1.2h3.7l-8 9.2L24 22.8h-7.4l-5.8-7.6-6.6 7.6H.5l8.6-9.8L0 1.2h7.6l5.2 6.9Zm-1.3 19.5h2L6.5 3.2H4.3Z',
  'XGlyph',
);

const TikTokGlyph = filled(
  'M16.6 1h-3.8v14.6a3.2 3.2 0 1 1-3.2-3.2c.3 0 .6 0 .9.1V8.6a7 7 0 1 0 6.1 7V8.3a8.6 8.6 0 0 0 5 1.6V6.1a5 5 0 0 1-5-5.1Z',
  'TikTokGlyph',
);

const AppleGlyph = filled(
  'M16.4 12.7c0-2.7 2.2-4 2.3-4.1a5 5 0 0 0-3.9-2.1c-1.7-.2-3.2 1-4.1 1s-2.1-1-3.5-.9A5.2 5.2 0 0 0 2.9 9.3c-1.9 3.2-.5 8 1.3 10.6.9 1.3 2 2.7 3.4 2.7 1.4-.1 1.9-.9 3.5-.9s2.1.9 3.5.9c1.5 0 2.4-1.3 3.3-2.6a11 11 0 0 0 1.5-3.1 4.7 4.7 0 0 1-3-4.2ZM13.7 4.6a4.7 4.7 0 0 0 1.1-3.4 4.8 4.8 0 0 0-3.1 1.6 4.5 4.5 0 0 0-1.1 3.3 4 4 0 0 0 3.1-1.5Z',
  'AppleGlyph',
);

const AndroidGlyph = filled(
  'M6 9h12v8.5a1.5 1.5 0 0 1-1.5 1.5H15v3a1.5 1.5 0 0 1-3 0v-3h0v3a1.5 1.5 0 0 1-3 0v-3H7.5A1.5 1.5 0 0 1 6 17.5Zm-2.5 0A1.5 1.5 0 0 1 5 10.5v5a1.5 1.5 0 0 1-3 0v-5A1.5 1.5 0 0 1 3.5 9Zm17 0a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-3 0v-5A1.5 1.5 0 0 1 20.5 9ZM6 8a6 6 0 0 1 3.2-5.2L8.1 1.1a.4.4 0 0 1 .7-.4l1.1 1.8a6.5 6.5 0 0 1 4.2 0l1.1-1.8a.4.4 0 0 1 .7.4l-1.1 1.7A6 6 0 0 1 18 8Zm3.5-3a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Zm5 0a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Z',
  'AndroidGlyph',
);

/** The glyph for each icon, in the network's own mark where there is one. */
export const FOOTER_GLYPHS: Record<FooterLinkIcon, Glyph> = {
  FACEBOOK: FacebookGlyph,
  INSTAGRAM: Instagram,
  TWITTER: XGlyph,
  YOUTUBE: Youtube,
  LINKEDIN: Linkedin,
  EMAIL: Mail,
  PHONE: Phone,
  TIKTOK: TikTokGlyph,
  APPLE: AppleGlyph,
  ANDROID: AndroidGlyph,
};

/** Each network's own colour, as the round badges on the reference footer use. */
const BADGE_BACKGROUNDS: Partial<Record<FooterLinkIcon, string>> = {
  FACEBOOK: 'bg-[#1877f2]',
  TWITTER: 'bg-black',
  INSTAGRAM:
    'bg-[radial-gradient(circle_at_30%_107%,#fdf497_0%,#fdf497_5%,#fd5949_45%,#d6249f_60%,#285aeb_90%)]',
  YOUTUBE: 'bg-[#ff0000]',
  TIKTOK: 'bg-black',
  LINKEDIN: 'bg-[#0a66c2]',
};

/**
 * A round social badge: the uploaded image when an administrator set one,
 * otherwise the network's glyph on its own colour.
 */
export function SocialBadge({
  icon,
  imageUrl,
  className,
}: {
  icon: FooterLinkIcon | null;
  imageUrl: string | null;
  className?: string;
}) {
  if (imageUrl) {
    return (
      // Operator uploads served from the API origin; next/image adds nothing.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt=""
        className={cn('h-10 w-10 rounded-full object-cover', className)}
        loading="lazy"
        decoding="async"
      />
    );
  }

  const Glyph = icon ? FOOTER_GLYPHS[icon] : null;
  return (
    <span
      className={cn(
        'grid h-10 w-10 place-items-center rounded-full text-white',
        (icon && BADGE_BACKGROUNDS[icon]) ?? 'bg-white/15',
        className,
      )}
    >
      {Glyph ? <Glyph className="h-5 w-5" /> : null}
    </span>
  );
}
