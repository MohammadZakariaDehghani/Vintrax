import { formatDescription, splitSentences } from '@vintrax/shared';
import { cn } from '@/lib/utils';

/**
 * A listing description, rendered as the structure it turned out to have.
 *
 * The parsing is in `@vintrax/shared` so the mobile application reads the same
 * text the same way; this is only the markup for it. Everything rendered is
 * plain text placed as a React child, so a description containing `<script>` is
 * shown as those characters rather than run — there is no `dangerouslySetInnerHTML`
 * here and there should not be one, since the text comes from a seller and,
 * through the importer, from a third-party system.
 */
export function DescriptionBody({
  description,
  className,
}: {
  description: string;
  className?: string;
}) {
  const blocks = formatDescription(description);

  if (blocks.length === 0) {
    return <p className={cn('text-sm text-muted-foreground', className)}>No description.</p>;
  }

  return (
    <div className={cn('flex flex-col gap-4 leading-relaxed text-muted-foreground', className)}>
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return (
            <h3
              key={index}
              className="text-sm font-semibold uppercase tracking-wide text-foreground"
            >
              {block.text}
            </h3>
          );
        }

        if (block.kind === 'list') {
          return (
            // Two columns from `sm` up: two dozen short feature names in one
            // column is a scroll, and they read as a spec sheet side by side.
            <ul key={index} className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
              {block.items.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={index} className="text-sm">
            {splitSentences(block.text).map((sentence, sentenceIndex) => (
              <span key={sentenceIndex} className="block">
                {sentence}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
