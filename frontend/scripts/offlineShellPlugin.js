import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setupOfflineWorker } from '../src/offline/serviceWorker.js';

export async function createPrecacheEntries(directory, relative = '') {
  const entries = [];
  for (const file of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, file.name);
    if (file.isDirectory()) {
      entries.push(...await createPrecacheEntries(directory, name));
    } else if (name === 'index.html' || name === 'manifest.webmanifest'
      || name.startsWith('assets/') || /\.(png|svg|webp|ico|woff2?|ttf|otf)$/.test(name)) {
      const bytes = await readFile(path.join(directory, name));
      entries.push({ url: `/${name}`, integrity: `sha256-${createHash('sha256').update(bytes).digest('base64')}` });
    }
  }
  return entries.sort((a, b) => a.url.localeCompare(b.url));
}

export default function offlineShellPlugin() {
  let outputDirectory;
  return {
    name: 'second-brain-offline-shell',
    apply: 'build',
    configResolved(config) {
      outputDirectory = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const entries = await createPrecacheEntries(outputDirectory);
      const version = createHash('sha256').update(JSON.stringify(entries))
        .update(setupOfflineWorker.toString()).digest('hex').slice(0, 20);
      const config = { cacheName: `second-brain-shell-${version}`, entries };
      await writeFile(path.join(outputDirectory, 'sw.js'),
        `/* Generated app shell. Updates activate after all old clients close. */\n(${setupOfflineWorker.toString()})(self, ${JSON.stringify(config)});\n`);
    },
  };
}
