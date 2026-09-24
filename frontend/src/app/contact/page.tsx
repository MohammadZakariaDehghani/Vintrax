import type { Metadata } from 'next';
import { Clock, Mail, MapPin, Phone } from 'lucide-react';
import type { SiteSettings } from '@vintrax/shared';
import { serverFetch } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui';
import { ContactForm } from '@/components/contact-form';

export const metadata: Metadata = {
  title: 'Contact us',
  description:
    'Get in touch with Vintrax: our address, phone, email and a form to send us a message.',
};

/** Keeps the line breaks an administrator typed into an address or opening hours. */
function Lines({ text }: { text: string }) {
  return (
    <>
      {text.split(/\r?\n/).map((line, index) => (
        <span key={index} className="block">
          {line}
        </span>
      ))}
    </>
  );
}

/**
 * The Contact page. Its address, phone, email, hours, introduction and map
 * are all set under Admin → Contact; anything left blank is left out rather
 * than shown empty. The map is the image an administrator uploaded, or,
 * without one, a Google map of the address.
 */
export default async function ContactPage() {
  const settings = await serverFetch<SiteSettings>('/admin/site-settings/public');
  const address = settings?.contactAddress ?? null;
  const details = [
    address ? { icon: MapPin, label: 'Address', value: <Lines text={address} /> } : null,
    settings?.contactPhone
      ? {
          icon: Phone,
          label: 'Phone',
          value: (
            <a
              href={`tel:${settings.contactPhone.replace(/[^\d+]/g, '')}`}
              className="hover:underline"
            >
              {settings.contactPhone}
            </a>
          ),
        }
      : null,
    settings?.contactEmail
      ? {
          icon: Mail,
          label: 'Email',
          value: (
            <a href={`mailto:${settings.contactEmail}`} className="hover:underline">
              {settings.contactEmail}
            </a>
          ),
        }
      : null,
    settings?.contactHours
      ? { icon: Clock, label: 'Hours', value: <Lines text={settings.contactHours} /> }
      : null,
  ].filter((entry) => entry !== null);

  return (
    <div className="container py-10">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">Contact us</h1>
        {settings?.contactIntro ? (
          <p className="mt-2 text-muted-foreground">{settings.contactIntro}</p>
        ) : null}
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-6">
          {details.length > 0 ? (
            <dl className="flex flex-col gap-5">
              {details.map((entry) => (
                <div key={entry.label} className="flex gap-3">
                  <entry.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <div>
                    <dt className="text-sm font-semibold">{entry.label}</dt>
                    <dd className="text-sm text-muted-foreground">{entry.value}</dd>
                  </div>
                </div>
              ))}
            </dl>
          ) : null}

          {settings?.contactMapImageUrl ? (
            // An operator upload served from the API origin.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={settings.contactMapImageUrl}
              alt={address ? `Map showing ${address.replace(/\s+/g, ' ')}` : 'Map'}
              className="w-full rounded-lg border border-border object-cover"
              loading="lazy"
            />
          ) : address ? (
            <iframe
              title={`Map of ${address.replace(/\s+/g, ' ')}`}
              src={`https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`}
              className="aspect-[4/3] w-full rounded-lg border border-border"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          ) : null}
        </div>

        <Card>
          <CardContent className="p-6">
            <h2 className="mb-4 text-lg font-semibold">Send us a message</h2>
            <ContactForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
