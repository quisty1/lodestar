import { CONTENT_PROTOCOL_VERSION } from '@lib/runtimeProtocol';
import type { LinkedInDomCapabilities } from '@lib/types';
import type { ContentPong } from './runTarget';

export const FEED_CAPABILITIES: LinkedInDomCapabilities = {
  feed: 'ready',
  like: 'ready',
  comment: 'ready',
  connect: 'absent',
  pagination: 'absent',
  profile: 'absent',
  ssi: 'absent',
};

type PongOverrides = Omit<Partial<ContentPong>, 'capabilities'> & {
  capabilities?: Partial<LinkedInDomCapabilities>;
};

export function contentPong(overrides: PongOverrides = {}): ContentPong {
  return {
    type: 'PONG',
    protocolVersion: CONTENT_PROTOCOL_VERSION,
    url: 'https://www.linkedin.com/feed/',
    surface: 'feed',
    activeRunId: null,
    ...overrides,
    capabilities: { ...FEED_CAPABILITIES, ...overrides.capabilities },
  };
}
