// @vitest-environment node
import { describe, expect, it } from 'vitest';
import manifest from '../../../manifest.config';
import { LINKEDIN_MATCH_PATTERN } from './urls';

describe('LinkedIn manifest/runtime host contract', () => {
  it('uses the exact shared match pattern for permissions and content injection', async () => {
    const resolvedManifest = await manifest;
    if (typeof resolvedManifest === 'function') throw new Error('Expected a static manifest');
    const linkedinPermissions = resolvedManifest.host_permissions?.filter((value) =>
      value.includes('linkedin.com'),
    );
    const linkedinMatches = resolvedManifest.content_scripts
      ?.flatMap((script) => script.matches ?? [])
      .filter((value) => value.includes('linkedin.com'));

    expect(linkedinPermissions).toEqual([LINKEDIN_MATCH_PATTERN]);
    expect(linkedinMatches).toEqual([LINKEDIN_MATCH_PATTERN]);
  });
});
