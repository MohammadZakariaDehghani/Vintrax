'use client';

import { use } from 'react';
import { ConversationThread } from '@/components/messenger/conversation-thread';

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ConversationThread id={id} />;
}
