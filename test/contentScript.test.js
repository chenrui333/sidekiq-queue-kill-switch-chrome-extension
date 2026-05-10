import { afterEach, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const CONTENT_SCRIPT_PATH = resolve('src/contentScript.js');
const originalGlobals = {
  console: globalThis.console,
  confirm: globalThis.confirm,
  document: globalThis.document,
  DOMParser: globalThis.DOMParser,
  performance: globalThis.performance,
  window: globalThis.window,
};

function buildPage(queueForms) {
  return `
    <!doctype html>
    <html>
      <head><title>Queues</title></head>
      <body>
        <div class="header-container"><h1>Queues</h1></div>
        <table class="queues"><tbody>${queueForms}</tbody></table>
      </body>
    </html>
  `;
}

async function loadContentScript(html) {
  const { window } = new JSDOM(html, {
    url: 'https://example.test/sidekiq/queues',
  });
  window.__SQKS_ENABLE_TEST_EXPORTS__ = true;

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.DOMParser = window.DOMParser;
  globalThis.confirm = () => true;
  globalThis.console = {
    ...originalGlobals.console,
    log() {},
    error() {},
  };

  const contentScriptSource = await Bun.file(CONTENT_SCRIPT_PATH).text();
  new Function(contentScriptSource)();
  return window.__SQKS_TEST__;
}

afterEach(() => {
  for (const [key, value] of Object.entries(originalGlobals)) {
    if (value === undefined) {
      delete globalThis[key];
    } else {
      globalThis[key] = value;
    }
  }
});

test('keeps pause form actionable when a delete-only form shares the queue action URL', async () => {
  const sqks = await loadContentScript(buildPage(`
    <tr>
      <td>
        <form action="/sidekiq/queues/default" method="post">
          <input type="hidden" name="authenticity_token" value="pause-token">
          <input type="submit" name="pause" value="Pause">
        </form>
        <form action="/sidekiq/queues/default" method="post">
          <input type="hidden" name="authenticity_token" value="delete-token">
          <input type="submit" name="delete" value="Delete">
        </form>
      </td>
    </tr>
  `));

  const index = sqks.buildFormIndex(document);
  const actionable = sqks.getActionableQueues(document, 'pause', false, index);

  expect(index.size).toBe(1);
  expect(actionable).toHaveLength(1);
  expect(actionable[0]).toMatchObject({
    action: '/sidekiq/queues/default',
    formToken: 'pause-token',
    queueName: 'default',
    submitName: 'pause',
    submitValue: 'Pause',
  });
  expect(sqks.getTotalQueueCount()).toBe(1);
});

test('indexes safe fallback submit buttons matched by value or text', async () => {
  const sqks = await loadContentScript(buildPage(`
    <tr>
      <td>
        <form action="/sidekiq/queues/mailers" method="post">
          <input type="hidden" name="authenticity_token" value="fallback-token">
          <button type="submit" name="commit" value="Pause">Pause</button>
        </form>
      </td>
    </tr>
  `));

  const actionable = sqks.getActionableQueues(document, 'pause');

  expect(actionable).toHaveLength(1);
  expect(actionable[0]).toMatchObject({
    action: '/sidekiq/queues/mailers',
    formToken: 'fallback-token',
    queueName: 'mailers',
    submitName: 'commit',
    submitValue: 'Pause',
  });
});

test('does not treat delete-only forms as pause or unpause actions', async () => {
  const sqks = await loadContentScript(buildPage(`
    <tr>
      <td>
        <form action="/sidekiq/queues/danger" method="post">
          <input type="hidden" name="authenticity_token" value="delete-token">
          <button type="submit" name="delete" value="Delete">Delete</button>
        </form>
      </td>
    </tr>
  `));

  const index = sqks.buildFormIndex(document);

  expect(index.size).toBe(1);
  expect(sqks.getActionableQueues(document, 'pause', false, index)).toEqual([]);
  expect(sqks.getActionableQueues(document, 'unpause', false, index)).toEqual([]);
  expect(sqks.getTotalQueueCount()).toBe(1);
});
