import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';
import { LINKEDIN_MATCH_PATTERN } from './src/lib/linkedin/urls';

// MV3 manifest. Version and description come from package.json.
// Permissions kept minimal; host access scoped to LinkedIn only.
export default defineManifest({
  manifest_version: 3,
  name: 'Lodestar',
  short_name: 'Lodestar',
  description: pkg.description,
  version: pkg.version,
  icons: {
    16: 'public/icons/icon-16.png',
    48: 'public/icons/icon-48.png',
    128: 'public/icons/icon-128.png',
  },
  action: {
    default_title: 'Lodestar',
  },
  background: {
    service_worker: 'src/service-worker/index.ts',
    type: 'module',
  },
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  content_scripts: [
    {
      matches: [LINKEDIN_MATCH_PATTERN],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  permissions: ['sidePanel', 'storage', 'scripting', 'alarms', 'tabs', 'cookies', 'notifications'],
  host_permissions: [
    LINKEDIN_MATCH_PATTERN,
    'https://openrouter.ai/*',
    'https://generativelanguage.googleapis.com/*',
  ],
  minimum_chrome_version: '116',
});
