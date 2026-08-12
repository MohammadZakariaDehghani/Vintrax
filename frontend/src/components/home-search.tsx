'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui';

export function HomeSearch() {
  const [term, setTerm] = useState('');
  const router = useRouter();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = term.trim();
    router.push(trimmed ? `/vehicles?q=${encodeURIComponent(trimmed)}` : '/vehicles');
  }

  return (
    <form onSubmit={handleSubmit} role="search" className="mt-8 flex max-w-xl gap-2">
      <label htmlFor="hero-search" className="sr-only">
        Search vehicles by make, model or keyword
      </label>
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          id="hero-search"
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Try “RAV4”, “electric AWD” or “F-150”"
          className="h-12 w-full rounded-md border-0 bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>
      <Button type="submit" size="lg" variant="accent">
        Search
      </Button>
    </form>
  );
}
