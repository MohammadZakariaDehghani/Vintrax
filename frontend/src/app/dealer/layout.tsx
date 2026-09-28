import type { ReactNode } from 'react';
import { DealerHelpAssistant } from '@/components/dealer-help-assistant';

/**
 * Every dealer portal page. The pages bring their own container and guards;
 * this adds the help assistant, which renders only for a signed-in seller.
 */
export default function DealerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <DealerHelpAssistant />
    </>
  );
}
