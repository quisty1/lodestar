import type { InboundPerson } from './people';

export const INBOX_SNAPSHOT_KEY = 'inbox:snapshot';
export const INBOX_ACCEPTED_KEY = 'inbox:accepted';

export interface InboxSnapshot {
  capturedAt: string;
  viewers: InboundPerson[];
  viewersStatus: 'known' | 'unknown';
  messages: InboundPerson[];
  messagesStatus: 'known' | 'unknown';
  accepted: InboundPerson[];
  acceptedStatus: 'known' | 'unknown';
}

export interface AcceptedScan {
  scannedAt: string;
  memberIds: string[];
}

export function emptyInbox(capturedAt: string): InboxSnapshot {
  return {
    capturedAt,
    viewers: [],
    viewersStatus: 'unknown',
    messages: [],
    messagesStatus: 'unknown',
    accepted: [],
    acceptedStatus: 'unknown',
  };
}
