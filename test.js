// ==UserScript==
// @name         Clockwork UI Automator
// @namespace    https://example.internal
// @version      0.1
// @match        https://clockwork-tour-internal.nonprod.vibe.justworks.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  function waitFor(selector, timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    var start = Date.now();

    return new Promise(function (resolve, reject) {
      (function tick() {
        var el = document.querySelector(selector);
        if (el) return resolve(el);
        if (Date.now() - start > timeoutMs) return reject(new Error('Timeout waiting for ' + selector));
        requestAnimationFrame(tick);
      })();
    });
  }

  async function run() {
    // Example: wait for a button then click it
    var btn = await waitFor('[data-testid="approve-button"]');
    btn.click();

    // Example: fill an input and submit
    var input = await waitFor('input[name="reason"]');
    input.value = 'Automated entry';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    var submit = await waitFor('button[type="submit"]');
    submit.click();
  }

  run().catch(function (e) {
    console.warn('Automation failed:', e);
  });
})();
