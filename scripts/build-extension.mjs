#!/usr/bin/env bun
/**
 * Build Extension Assembly Script
 *
 * Assembles the Chrome extension from built assets:
 * 1. Creates dist/extension/ directory
 * 2. Copies built JS from dist/build/
 * 3. Copies CSS from src/ (unchanged)
 * 4. Copies icons, README, LICENSE
 * 5. Generates manifest.json with updated asset paths
 *
 * Usage: bun scripts/build-extension.mjs
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = dirname(__dirname);

// Paths
const DIST_DIR = join(PROJECT_ROOT, 'dist');
const BUILD_DIR = join(DIST_DIR, 'build');
const EXTENSION_DIR = join(DIST_DIR, 'extension');
const ASSETS_DIR = join(EXTENSION_DIR, 'assets');
const ICONS_SRC = join(PROJECT_ROOT, 'icons');
const ICONS_DEST = join(EXTENSION_DIR, 'icons');

// Source manifest (in repo root)
const MANIFEST_SRC = join(PROJECT_ROOT, 'manifest.json');

function log(msg) {
  console.log(`[build-extension] ${msg}`);
}

function error(msg) {
  console.error(`[build-extension] ERROR: ${msg}`);
  process.exit(1);
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function copyDir(src, dest) {
  ensureDir(dest);
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function main() {
  log('Assembling Chrome extension...');

  // Verify build output exists
  const builtJs = join(BUILD_DIR, 'contentScript.js');
  if (!existsSync(builtJs)) {
    error(`Built JS not found at ${builtJs}. Run 'bun run build' first.`);
  }

  // Clean and create extension directory
  if (existsSync(EXTENSION_DIR)) {
    rmSync(EXTENSION_DIR, { recursive: true });
  }
  ensureDir(EXTENSION_DIR);
  ensureDir(ASSETS_DIR);

  // Copy built JS
  log('Copying built JavaScript...');
  copyFileSync(builtJs, join(ASSETS_DIR, 'contentScript.js'));

  // Copy sourcemap if exists
  const builtJsMap = join(BUILD_DIR, 'contentScript.js.map');
  if (existsSync(builtJsMap)) {
    copyFileSync(builtJsMap, join(ASSETS_DIR, 'contentScript.js.map'));
  }

  // Copy CSS from source (unchanged)
  log('Copying CSS...');
  const cssSrc = join(PROJECT_ROOT, 'src', 'contentScript.css');
  if (!existsSync(cssSrc)) {
    error(`CSS not found at ${cssSrc}`);
  }
  copyFileSync(cssSrc, join(ASSETS_DIR, 'contentScript.css'));

  // Copy icons
  log('Copying icons...');
  if (!existsSync(ICONS_SRC)) {
    error(`Icons directory not found at ${ICONS_SRC}`);
  }
  copyDir(ICONS_SRC, ICONS_DEST);

  // Copy README and LICENSE
  log('Copying documentation...');
  const readmeSrc = join(PROJECT_ROOT, 'README.md');
  const licenseSrc = join(PROJECT_ROOT, 'LICENSE');

  if (existsSync(readmeSrc)) {
    copyFileSync(readmeSrc, join(EXTENSION_DIR, 'README.md'));
  }
  if (existsSync(licenseSrc)) {
    copyFileSync(licenseSrc, join(EXTENSION_DIR, 'LICENSE'));
  }

  // Generate manifest with updated paths
  log('Generating manifest.json...');
  if (!existsSync(MANIFEST_SRC)) {
    error(`Source manifest not found at ${MANIFEST_SRC}`);
  }

  const manifest = JSON.parse(readFileSync(MANIFEST_SRC, 'utf-8'));

  // Update content_scripts paths to point to assets/
  if (manifest.content_scripts && manifest.content_scripts.length > 0) {
    manifest.content_scripts = manifest.content_scripts.map(cs => ({
      ...cs,
      js: cs.js ? cs.js.map(path => path.replace(/^src\//, 'assets/')) : cs.js,
      css: cs.css ? cs.css.map(path => path.replace(/^src\//, 'assets/')) : cs.css,
    }));
  }

  // Write generated manifest
  const manifestDest = join(EXTENSION_DIR, 'manifest.json');
  writeFileSync(manifestDest, JSON.stringify(manifest, null, 2) + '\n');

  // Summary
  log('');
  log('Extension assembled successfully!');
  log(`  Output: ${EXTENSION_DIR}`);
  log('');
  log('Contents:');
  log('  manifest.json');
  log('  assets/contentScript.js');
  log('  assets/contentScript.css');
  log('  icons/icon{16,32,48,128}.png');
  log('  README.md');
  log('  LICENSE');
  log('');
  log('To load in Chrome:');
  log('  1. Go to chrome://extensions/');
  log('  2. Enable Developer mode');
  log('  3. Click "Load unpacked" and select dist/extension/');
}

main();
