import Link from 'next/link';
import { Button, Card, CardContent } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="container py-20">
      <Card>
        <CardContent className="pt-6 text-center">
          <h1 className="text-2xl font-bold">Page not found</h1>
          <p className="mt-2 text-muted-foreground">
            The page you were looking for does not exist.
          </p>
          <Link href="/" className="mt-5 inline-block">
            <Button>Go home</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
