import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

// Plugin: treat 'geolingua' as optional — if not installed, resolve to an
// empty module so the build succeeds and the app falls back to the dropdown.
function optionalDep(name) {
  const virtualId = `\0optional:${name}`;
  let isInstalled = false;
  try { require.resolve(name); isInstalled = true; } catch { /* not installed */ }
  return {
    name: `optional-dep-${name}`,
    resolveId(id) {
      if (id === name && !isInstalled) return virtualId;
    },
    load(id) {
      if (id === virtualId) return 'export default null;';
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [optionalDep('geolingua'), react()],
  base: command === 'build' ? '/protoviz/' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
}));
