import { formatDescription, splitSentences } from '@vintrax/shared';
import { cn } from '@/lib/format';

/**
 * A listing description, rendered as the structure it turned out to have.
 *
 * The parsing lives in `@vintrax/shared` so this reads a dealer's text exactly
 * as the web application does; only the markup differs, and here it is a single
 * column because the screen is one.
 *
 * Everything is plain text placed as a React child, so a description containing
 * `<script>` is shown as those characters rather than run. There is no
 * `dangerouslySetInnerHTML` here and there should not be one: the text comes
 * from a seller and, through the importer, from a third-party system.
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
    <div
      className={cn(
        'flex flex-col gap-3.5 break-words text-sm leading-relaxed text-muted-foreground',
        className,
      )}
    >
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return (
            <h3
              key={index}
              className="text-xs font-semibold uppercase tracking-wide text-foreground"
            >
              {block.text}
            </h3>
          );
        }

        if (block.kind === 'list') {
          return (
            <ul key={index} className="flex flex-col gap-1.5">
              {block.items.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={index}>
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
