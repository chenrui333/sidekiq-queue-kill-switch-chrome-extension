import { defineConfig } from 'vite';
import { resolve } from 'path';

const shouldMinify = process.env.BUILD_MINIFY === '1';

export default defineConfig({
  build: {
    // Output directory for built assets
    outDir: 'dist/build',

    // Empty outDir on each build for clean output
    emptyOutDir: true,

    // Minification: disabled by default, enable with BUILD_MINIFY=1
    minify: shouldMinify ? 'esbuild' : false,

    // Target modern Chromium (Chrome 88+, es2020)
    target: 'es2020',

    // Library mode for content script
    lib: {
      entry: resolve(__dirname, 'src/contentScript.js'),
      name: 'SQKS',
      // IIFE format for content scripts (not ESM)
      formats: ['iife'],
      // Deterministic filename (no hash)
      fileName: () => 'contentScript.js',
    },

    rollupOptions: {
      output: {
        // No code splitting for content scripts
        inlineDynamicImports: true,
      },
    },

    // Generate sourcemaps for debugging (disabled in minified builds)
    sourcemap: !shouldMinify,

    // Don't report compressed size (not relevant for extensions)
    reportCompressedSize: false,
  },

  // Logging
  logLevel: 'info',
});
