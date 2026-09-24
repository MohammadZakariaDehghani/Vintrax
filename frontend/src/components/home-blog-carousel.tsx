import type { ArticleSummary } from '@vintrax/shared';
import { ItemCarousel } from '@/components/item-carousel';
import { BlogCard } from '@/components/blog-card';

/**
 * The last few posts, as a carousel near the top of the home page (issue
 * #67 — moved up from the bottom, and from a single-slide rotator to a
 * multi-card strip using the same `ItemCarousel` Popular Makes and Partners
 * use). Desktop shows several cards at once; `itemClassName` is the same
 * fractional-width trick that drives every other carousel's "how many show."
 * Text-only cards, without the post photos (issue #76), the date or the
 * author: a title and its standfirst.
 */
export function HomeBlogCarousel({ posts }: { posts: ArticleSummary[] }) {
  if (posts.length === 0) return null;

  return (
    <section className="container pt-10">
      <h2 className="mb-3 text-xl font-bold tracking-tight">Read stories from Vintrax</h2>
      <ItemCarousel
        items={posts.map((post) => ({
          key: post.id,
          content: <BlogCard article={post} showImage={false} showMeta={false} />,
        }))}
        ariaLabel="Stories from Vintrax"
        itemClassName="w-[85%] sm:w-1/2 lg:w-1/4"
      />
    </section>
  );
}
