/**
 * Renders a post's text.
 *
 * The stored body is plain text and stays plain text: blank lines become
 * paragraphs and nothing is interpreted as markup. React escapes it on the way
 * out, so there is no path from the editor to a script tag on the busiest page
 * of the site. That is a deliberate ceiling — rich text here would need a
 * sanitiser, and a sanitiser is a dependency that has to stay correct forever.
 */
export function ArticleBody({ body }: { body: string }) {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <div className="space-y-4 text-[1.0625rem] leading-relaxed text-foreground/90">
      {paragraphs.map((paragraph, index) => (
        // Paragraph text is the only identity a paragraph has, and two
        // identical ones are possible, so the index is the honest key here.
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}
