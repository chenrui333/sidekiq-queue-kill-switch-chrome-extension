// ==UserScript==
// @name         Sidekiq Queue Kill Switch
// @namespace    https://justworks.com/
// @version      1.0.0
// @description  Add Pause/Unpause all controls to Sidekiq Enterprise queues
// @match        *://*/sidekiq/queues*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/**
 * Sidekiq Queue Kill Switch - Tampermonkey Port
 *
 * Ported from the Chrome MV3 content script to a userscript so it can
 * run in-page and potentially avoid 403s caused by extension isolation.
 */

(function() {
  'use strict';

  const STYLE_ID = 'sqks-styles';
  const STYLE_TEXT = `
.sqks-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 15px 0;
  padding: 10px 15px;
  background-color: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 4px;
}

.sqks-btn {
  padding: 6px 12px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 4px;
  border: none;
  transition: opacity 0.2s ease;
}

.sqks-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.sqks-btn.btn-danger {
  background-color: #dc3545;
  color: white;
}

.sqks-btn.btn-danger:hover:not(:disabled) {
  background-color: #c82333;
}

.sqks-btn.btn-primary {
  background-color: #007bff;
  color: white;
}

.sqks-btn.btn-primary:hover:not(:disabled) {
  background-color: #0069d9;
}

.sqks-status {
  margin-left: 10px;
  font-size: 13px;
  color: #6c757d;
}

.sqks-status-progress {
  color: #007bff;
  font-weight: 500;
}

.sqks-status-success {
  color: #28a745;
  font-weight: 500;
}

.sqks-status-error {
  color: #dc3545;
  font-weight: 500;
}
`;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE_TEXT;
    document.head.appendChild(style);
  }

  const LOG_PREFIX = '[SQKS]';
  const DEBUG_LEVEL = 2; // 0=quiet, 1=summary/errors, 2=verbose per-queue
  const MAX_PASSES = 5;           // Maximum convergence attempts
  const MAX_TOKEN_REFRESH_PER_PASS = 1;

  // Jittered delays for human-like behavior
  const POST_DELAY_MIN_MS = 250;      // Min delay between individual POST requests
  const POST_DELAY_MAX_MS = 900;      // Max delay between individual POST requests
  const PASS_DELAY_MIN_MS = 1500;     // Min delay between passes
  const PASS_DELAY_MAX_MS = 3500;     // Max delay between passes
  const ERROR_BACKOFF_MIN_MS = 2000;  // Min backoff after errors
  const ERROR_BACKOFF_MAX_MS = 4000;  // Max backoff after errors
  const RECENT_403_WINDOW_MS = 2000;
  const RECENT_403_EXTRA_DELAY_MIN_MS = 1200;
  const RECENT_403_EXTRA_DELAY_MAX_MS = 1800;
  const LIVE_DOM_RECHECK_INTERVAL = 4;
  const ENABLE_LIVE_DOM_RECHECK = true;
  const REQUEST_CREDENTIALS = 'include';
  const REQUEST_REDIRECT = 'manual';
  const INLINE_SCRIPT_SCAN_LIMIT = 200000;
  const TOKEN_PATTERN = /^[A-Za-z0-9+/_=-]{20,200}$/;
  const NATIVE_FORM_ACTIONS = ['pause', 'unpause'];
  const IFRAME_SUBMIT_TIMEOUT_MS = 6000;

  // Allowed action types - explicit allowlist for safety
  const ALLOWED_ACTIONS = ['pause', 'unpause'];
  const LOGIN_MARKERS = [
    'type="password"',
    'name="password"',
    'action="/users/sign_in"',
    'action="/login"',
    'sign in',
    'log in',
  ];

  let bulkActionInProgress = false;
  let currentRun = null;

  /**
   * Sleep helper
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Random integer in range [min, max] inclusive
   */
  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Sleep with jitter - random duration between minMs and maxMs
   */
  function sleepJitter(minMs, maxMs) {
    const duration = randomInt(minMs, maxMs);
    return sleep(duration);
  }

  /**
   * Log helper with consistent prefix
   */
  function log(...args) {
    if (DEBUG_LEVEL >= 1) {
      console.log(LOG_PREFIX, ...args);
    }
    appendRunLog('info', args);
  }

  function logVerbose(...args) {
    if (DEBUG_LEVEL >= 2) {
      console.log(LOG_PREFIX, ...args);
    }
    appendRunLog('debug', args);
  }

  function logError(...args) {
    if (DEBUG_LEVEL >= 1) {
      console.error(LOG_PREFIX, ...args);
    }
    appendRunLog('error', args);
  }

  function tokenPrefix(token) {
    if (!token) return 'missing';
    return token.slice(0, 8);
  }

  function normalizeActionPathKey(action) {
    try {
      const url = new URL(action, window.location.origin);
      return `${url.pathname}${url.search}`;
    } catch (e) {
      return action;
    }
  }

  function ensureHiddenIframe() {
    let iframe = document.querySelector('iframe[name="sqks_target"]');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.name = 'sqks_target';
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
    }
    return iframe;
  }

  function findLiveFormForQueue(actionPathKey, actionType) {
    const forms = document.querySelectorAll('form[action*="/sidekiq/queues/"]');
    for (const form of forms) {
      const action = form.getAttribute('action') || '';
      if (normalizeActionPathKey(action) !== actionPathKey) {
        continue;
      }
      const submitButton = findSubmitButton(form, actionType);
      return { form, submitButton };
    }
    return null;
  }

  async function submitViaNativeForm(queueInfo, actionType) {
    const live = findLiveFormForQueue(queueInfo.actionPathKey, actionType);
    if (!live) {
      return { ok: false, mode: 'native', reason: 'form_missing', hasQueuesTable: false };
    }

    const { form, submitButton } = live;
    if (!submitButton) {
      return { ok: false, mode: 'native', reason: 'submit_missing', hasQueuesTable: false };
    }

    const iframe = ensureHiddenIframe();
    const originalTarget = form.getAttribute('target');
    form.setAttribute('target', 'sqks_target');

    const waitForLoad = new Promise((resolve) => {
      const onLoad = () => {
        iframe.removeEventListener('load', onLoad);
        resolve(true);
      };
      iframe.addEventListener('load', onLoad, { once: true });
      setTimeout(() => {
        iframe.removeEventListener('load', onLoad);
        resolve(false);
      }, IFRAME_SUBMIT_TIMEOUT_MS);
    });

    try {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit(submitButton);
      } else {
        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = submitButton.getAttribute('name');
        hidden.value = submitButton.getAttribute('value') || hidden.name;
        form.appendChild(hidden);
        form.submit();
        hidden.remove();
      }
    } catch (error) {
      if (originalTarget) {
        form.setAttribute('target', originalTarget);
      } else {
        form.removeAttribute('target');
      }
      return { ok: false, mode: 'native', reason: 'submit_error', error: String(error), hasQueuesTable: false };
    }

    const loaded = await waitForLoad;
    if (originalTarget) {
      form.setAttribute('target', originalTarget);
    } else {
      form.removeAttribute('target');
    }

    let hasQueuesTable = false;
    let loginPage = false;
    let diagKind = 'NONE';
    let doc = null;
    let bodyText = '';
    try {
      doc = iframe.contentDocument;
      if (doc) {
        hasQueuesTable = !!doc.querySelector('table.queues');
        loginPage = looksLikeLoginPageFromDoc(doc);
        bodyText = (doc.body && doc.body.textContent) ? doc.body.textContent : '';
        if (!loginPage && !hasQueuesTable) {
          diagKind = classify403(bodyText, { location: '' });
        }
      }
    } catch (e) {
      // Ignore iframe access errors
    }

    const ok = loaded && !loginPage && hasQueuesTable;
    const forbidden = !ok && loaded && !loginPage && !hasQueuesTable;
    return {
      ok,
      mode: 'native',
      hasQueuesTable,
      loginPage,
      reason: loaded ? 'loaded' : 'timeout',
      doc,
      diagKind: forbidden ? diagKind : 'NONE',
      forbidden,
      bodyText,
    };
  }

  function looksLikeLoginPageFromText(htmlText) {
    if (!htmlText) return false;
    const lower = htmlText.toLowerCase();
    return LOGIN_MARKERS.some(marker => lower.includes(marker));
  }

  function looksLikeLoginPageFromDoc(doc) {
    if (!doc) return false;
    if (doc.querySelector('input[type="password"]')) return true;
    const loginForm = doc.querySelector('form[action*="login"], form[action*="sign_in"]');
    if (loginForm) return true;
    const title = doc.querySelector('title');
    if (title && looksLikeLoginPageFromText(title.textContent || '')) return true;
    return false;
  }

  function isTokenLike(value) {
    if (!value) return false;
    const trimmed = value.trim();
    return TOKEN_PATTERN.test(trimmed);
  }

  function extractTokenFromInlineScripts(doc, paramName) {
    const scripts = doc.querySelectorAll('script:not([src])');
    let total = 0;

    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text) continue;
      total += text.length;
      if (total > INLINE_SCRIPT_SCAN_LIMIT) break;

      if (paramName) {
        const paramRegex = new RegExp(`${paramName}\\s*[:=]\\s*["']([^"']+)["']`, 'i');
        const paramMatch = text.match(paramRegex);
        if (paramMatch && isTokenLike(paramMatch[1])) {
          return { token: paramMatch[1], source: `script-inline-${paramName}` };
        }
      }

      let match = text.match(/csrf.*token\s*[:=]\s*["']([^"']+)["']/i);
      if (match && isTokenLike(match[1])) {
        return { token: match[1], source: 'script-inline-csrf' };
      }

      match = text.match(/(?:window\.)?(?:_token|csrf|csrfToken|_csrf|gon\.csrf|gon\.csrf_token)\s*=\s*["']([^"']+)["']/i);
      if (match && isTokenLike(match[1])) {
        return { token: match[1], source: 'script-inline-global' };
      }
    }

    return null;
  }

  function classify403(bodyText, headers) {
    const lower = (bodyText || '').toLowerCase();
    const location = (headers.location || '').toLowerCase();

    if (looksLikeLoginPageFromText(bodyText) || location.includes('login') || location.includes('sign_in')) {
      return 'LOGIN';
    }
    if (lower.includes('actioncontroller::invalidauthenticitytoken')
      || lower.includes('invalid authenticity token')
      || lower.includes('csrf')) {
      return 'CSRF';
    }
    if (lower.includes('not authorized')
      || lower.includes('forbidden')
      || lower.includes('permission')
      || lower.includes('policy')
      || lower.includes('pundit')
      || lower.includes('cancan')) {
      return 'RBAC';
    }
    return 'UNKNOWN';
  }

  function redactSecrets(text) {
    if (!text) return '';
    let redacted = text;
    redacted = redacted.replace(/(authenticity_token[^"']*value=["'])([^"']+)/gi, '$1[REDACTED]');
    redacted = redacted.replace(/(csrf-token["']?\s+content=["'])([^"']+)/gi, '$1[REDACTED]');
    redacted = redacted.replace(/(csrfToken\s*[:=]\s*["'])([^"']+)/gi, '$1[REDACTED]');
    redacted = redacted.replace(/(window\._csrf\s*=\s*["'])([^"']+)/gi, '$1[REDACTED]');
    redacted = redacted.replace(/(window\.csrfToken\s*=\s*["'])([^"']+)/gi, '$1[REDACTED]');
    return redacted;
  }

  function sanitizeValue(value) {
    if (typeof value === 'string') {
      const redacted = redactSecrets(value);
      if (isTokenLike(redacted)) {
        return tokenPrefix(redacted);
      }
      return redacted.length > 500 ? `${redacted.slice(0, 500)}...` : redacted;
    }
    if (value && typeof value === 'object') {
      if (value instanceof Error) {
        return { message: value.message, stack: value.stack };
      }
      return value;
    }
    return value;
  }

  function sanitizeData(data) {
    if (!data) return null;
    try {
      return JSON.parse(JSON.stringify(data, (key, value) => {
        if (/token/i.test(key)) {
          if (typeof value === 'string') return tokenPrefix(value);
        }
        return sanitizeValue(value);
      }));
    } catch (e) {
      return { value: String(data) };
    }
  }

  function appendRunLog(level, args) {
    if (!currentRun) return;
    const items = Array.from(args || []);
    let data = null;
    if (items.length > 0 && typeof items[items.length - 1] === 'object') {
      data = items.pop();
    }
    const message = items.map(item => String(item)).join(' ');
    currentRun.logs.push({
      ts: new Date().toISOString(),
      level,
      message,
      data: sanitizeData(data),
    });
  }

  function startRun(actionType, meta) {
    const id = `${actionType}-${Date.now()}`;
    currentRun = {
      id,
      actionType,
      startedAt: new Date().toISOString(),
      pageUrl: window.location.href,
      meta: meta || {},
      logs: [],
      refreshes: [],
      submissions: [],
      results: null,
    };
    return currentRun;
  }

  function endRun(results) {
    if (!currentRun) return;
    currentRun.endedAt = new Date().toISOString();
    currentRun.results = results || null;
    currentRun.harTrace = collectHarLikeTrace();
    downloadRunLog(currentRun);
    currentRun = null;
  }

  function collectHarLikeTrace() {
    if (!performance || typeof performance.getEntriesByType !== 'function') {
      return [];
    }
    try {
      const entries = performance.getEntriesByType('resource') || [];
      return entries
        .filter(entry => entry.name && entry.name.includes('/sidekiq/queues/'))
        .map(entry => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          startTime: entry.startTime,
          duration: entry.duration,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize,
        }));
    } catch (e) {
      return [];
    }
  }

  function downloadRunLog(run) {
    try {
      const payload = JSON.stringify(run, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sqks-run-${run.id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error(LOG_PREFIX, 'Failed to download run log', e);
    }
  }

  /**
   * Check if we're on the expected Sidekiq Queues page
   */
  function isQueuesPage() {
    return document.querySelector('table.queues') !== null;
  }

  /**
   * Find the header container to inject our controls
   */
  function findHeaderContainer() {
    // Try to find the header container with the Queues h1
    const headerContainer = document.querySelector('.header-container');
    if (headerContainer) {
      return headerContainer;
    }

    // Fallback: find h1 containing "Queues" and use its parent
    const h1Elements = document.querySelectorAll('h1');
    for (const h1 of h1Elements) {
      if (h1.textContent.trim().toLowerCase().includes('queue')) {
        return h1.parentElement;
      }
    }

    // Last resort: just use the first h1's parent or body
    const firstH1 = document.querySelector('h1');
    return firstH1 ? firstH1.parentElement : document.body;
  }

  /**
   * Extract queue name from form action URL
   */
  function getQueueNameFromAction(action) {
    const match = action.match(/\/sidekiq\/queues\/([^/?]+)/);
    return match ? decodeURIComponent(match[1]) : 'unknown';
  }

  /**
   * Get the authenticity token from a form element (hidden input)
   * This is ONLY for the POST body param - not for headers
   */
  function getAuthenticityToken(form) {
    const tokenInput = form.querySelector('input[name="authenticity_token"]');
    return tokenInput ? tokenInput.value : null;
  }

  /**
   * Get CSRF token for the X-CSRF-Token header
   *
   * IMPORTANT: This must come from a "page-global" source that Rails validates
   * against. Hidden form inputs are per-form masked tokens and MUST NOT be used
   * for the header (they cause mismatches).
   *
   * Search order:
   * 1. meta[name="csrf-token"] - Standard Rails approach
   * 2. Script-embedded tokens - Some apps embed in inline JS
   *
   * @param {Document} doc - Document to search
   * @returns {{ token: string|null, source: string }}
   */
  function getHeaderCsrfTokenExtended(doc, htmlText, responseHeaders) {
    // 1. Standard Rails meta tag (preferred, most reliable)
    const meta = doc.querySelector('meta[name="csrf-token"]');
    if (meta) {
      const content = meta.getAttribute('content');
      if (content && isTokenLike(content)) {
        return { token: content.trim(), source: 'meta' };
      }
    }

    // 2. meta[name="csrf-param"] + inline scripts
    const metaParam = doc.querySelector('meta[name="csrf-param"]');
    const paramName = metaParam ? metaParam.getAttribute('content') : null;
    if (paramName) {
      const fromParamScript = extractTokenFromInlineScripts(doc, paramName);
      if (fromParamScript) {
        return fromParamScript;
      }
    }

    // 3. rails-ujs data attributes
    const dataEl = doc.querySelector('a[data-method][data-remote][data-csrf], button[data-method][data-remote][data-csrf]');
    if (dataEl) {
      const dataToken = dataEl.getAttribute('data-csrf');
      if (isTokenLike(dataToken)) {
        return { token: dataToken.trim(), source: 'data-csrf-attr' };
      }
    }

    // 4. Inline script assignments (conservative patterns only)
    const fromScripts = extractTokenFromInlineScripts(doc, null);
    if (fromScripts) {
      return fromScripts;
    }

    // 5. Response header fallback (rare)
    if (responseHeaders && responseHeaders.xCsrfToken && isTokenLike(responseHeaders.xCsrfToken)) {
      return { token: responseHeaders.xCsrfToken.trim(), source: 'header-x-csrf-token' };
    }

    // 6. No valid header token source found
    // IMPORTANT: We do NOT fall back to hidden form inputs - they are for body only
    return { token: null, source: 'missing' };
  }

  /**
   * Find a submit control by action type (pause/unpause) in a form element
   * PRIMARY: Selects by name attribute (most reliable for Rails forms)
   * FALLBACK: Selects by value or text content
   * Supports both <input type="submit"> and <button> elements
   * Returns null if no matching control found
   */
  function findSubmitButton(form, actionType) {
    // SAFETY: Only allow known action types
    if (!ALLOWED_ACTIONS.includes(actionType)) {
      logError(`Invalid action type: ${actionType}`);
      return null;
    }

    // PRIMARY: Direct name-based selection (most reliable for Rails)
    // This is how browsers identify which submit button was clicked
    const byName = form.querySelector(
      `input[type="submit"][name="${actionType}"], button[name="${actionType}"]`
    );
    if (byName) {
      // SAFETY: Double-check it's not a delete button
      const name = (byName.getAttribute('name') || '').toLowerCase();
      if (!name.includes('delete')) {
        return byName;
      }
    }

    // FALLBACK: Search by value or text content for non-standard forms
    const candidates = form.querySelectorAll('input[type="submit"], button[type="submit"], button:not([type])');

    for (const el of candidates) {
      const name = (el.getAttribute('name') || '').trim().toLowerCase();
      const value = (el.getAttribute('value') || '').trim().toLowerCase();
      const text = (el.textContent || '').trim().toLowerCase();

      // SAFETY: Explicitly reject delete buttons by name, value, or text
      if (name.includes('delete') || value.includes('delete') || text.includes('delete')) {
        continue;
      }

      // Match by value or text (fallback only)
      if (value === actionType || text === actionType) {
        return el;
      }
    }

    return null;
  }

  /**
   * Fetch the queues page and parse it into a document
   * Returns a parsed Document for querying fresh DOM state
   */
  async function fetchQueuesPageDocument(contextLabel = 'refresh') {
    const response = await fetch(window.location.href, {
      method: 'GET',
      credentials: REQUEST_CREDENTIALS,
      headers: {
        'Accept': 'text/html',
      },
    });

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const loginPage = looksLikeLoginPageFromDoc(doc) || looksLikeLoginPageFromText(html);
    const hasQueuesTable = !!doc.querySelector('table.queues');
    const responseHeaders = {
      xCsrfToken: response.headers.get('x-csrf-token'),
    };
    const { token: headerToken, source: tokenSource } = getHeaderCsrfTokenExtended(doc, html, responseHeaders);

    log(
      `[${contextLabel}] GET status=${response.status} loginPage=${loginPage} table.queues=${hasQueuesTable}`,
      `headerCsrf=${tokenSource}:${tokenPrefix(headerToken)}`
    );
    if (currentRun) {
      currentRun.refreshes.push({
        ts: new Date().toISOString(),
        label: contextLabel,
        status: response.status,
        loginPage,
        hasQueuesTable,
        headerCsrfSource: tokenSource,
        headerCsrfPrefix: tokenPrefix(headerToken),
      });
    }
    if (!response.ok) {
      logError(`[${contextLabel}] GET non-OK status=${response.status}`);
    }

    return { doc, htmlText: html, loginPage, status: response.status, ok: response.ok, responseHeaders };
  }

  /**
   * Get actionable queue forms from a document (live DOM or fetched)
   * Returns array of queue info objects for queues that still need the specified action
   */
  function getActionableQueues(doc, actionType, verbose = false) {
    const table = doc.querySelector('table.queues');
    if (!table) {
      if (verbose) logVerbose('No table.queues found in document');
      return [];
    }

    const forms = table.querySelectorAll('form[action*="/sidekiq/queues/"]');
    const actionable = [];

    // Counters for observability
    let formsWithDelete = 0;
    let formsNoMatchingAction = 0;
    let formsNoToken = 0;

    for (const form of forms) {
      const action = form.getAttribute('action');
      const queueName = getQueueNameFromAction(action);
      const submitButton = findSubmitButton(form, actionType);

      // If no submit button for this action, queue is already in desired state
      if (!submitButton) {
        // Check if form has delete but no pause/unpause (for debugging)
        const hasDelete = form.querySelector('input[name="delete"], button[name="delete"]');
        if (hasDelete) {
          formsWithDelete++;
        } else {
          formsNoMatchingAction++;
        }
        continue;
      }

      const formToken = getAuthenticityToken(form);
      if (!formToken) {
        logError(`No authenticity token for queue: ${queueName}`);
        formsNoToken++;
        continue;
      }

      // Get exact submitName and submitValue from DOM attributes
      // Rails forms require the exact name=value pair the browser would send
      const submitName = submitButton.getAttribute('name');
      const submitValue = submitButton.getAttribute('value');

      // SAFETY: Require name attribute (essential for Rails form submission)
      if (!submitName) {
        logError(`Submit button has no name attribute for queue: ${queueName}`);
        continue;
      }

      // SAFETY: Final check - reject delete
      if (submitName.toLowerCase() === 'delete') {
        logError(`SAFETY: Skipping delete button for queue: ${queueName}`);
        continue;
      }

      // Log the exact name=value pair we'll submit (helps debugging)
      if (verbose) {
        logVerbose(`  Queue "${queueName}": will submit ${submitName}=${submitValue}`);
      }

      actionable.push({
        queueName,
        action,
        actionPathKey: normalizeActionPathKey(action), // Used to re-find form after page refetch
        formToken,             // For POST body authenticity_token param
        submitName,
        submitValue: submitValue || submitName, // Fallback to name if value missing
        actionType,
      });
    }

    if (verbose) {
      logVerbose(`Enumeration: ${forms.length} total forms, ${actionable.length} actionable for "${actionType}"`);
      logVerbose(`  - Already in desired state: ${formsNoMatchingAction}`);
      logVerbose(`  - Delete-only forms: ${formsWithDelete}`);
      logVerbose(`  - Missing token: ${formsNoToken}`);
    }

    return actionable;
  }

  /**
   * Build a map of actionPathKey -> queue info from a document
   * Used to update tokens for remaining queues after a refresh
   */
  function buildQueueTokenMap(doc, actionType) {
    const actionable = getActionableQueues(doc, actionType, false);
    const map = new Map();
    for (const q of actionable) {
      map.set(q.actionPathKey, q);
    }
    return map;
  }

  /**
   * Build headers for Rails-compatible form submission
   *
   * @param {string|null} headerCsrfToken - CSRF token for X-CSRF-Token header
   * @returns {Object} Headers object for fetch
   */
  function buildRailsHeaders(headerCsrfToken) {
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': 'text/html, */*;q=0.1',
      'Cache-Control': 'no-cache',
      'X-Requested-With': 'XMLHttpRequest', // Rails expects this for AJAX requests
    };

    // Always include X-CSRF-Token if we have a valid header token
    if (headerCsrfToken) {
      headers['X-CSRF-Token'] = headerCsrfToken;
    }

    // Try to set Origin header (may be restricted in some contexts)
    try {
      headers['Origin'] = window.location.origin;
    } catch (e) {
      // Origin header restricted, proceed without
    }

    // Some headers (like Referer) are forbidden to set; rely on fetch referrer.
    return headers;
  }

  function buildFormLikeHeaders(headerCsrfToken) {
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Cache-Control': 'no-cache',
    };

    if (headerCsrfToken) {
      headers['X-CSRF-Token'] = headerCsrfToken;
    }

    return headers;
  }

  /**
   * Perform a single POST request for a queue action
   * Uses redirect: 'manual' to properly detect 302 redirects as success
   *
   * @param {URL} url - Target URL
   * @param {string} formToken - Token for POST body (from form hidden input)
   * @param {string} submitName - Form field name
   * @param {string} submitValue - Form field value
   * @param {Object} csrfContext - { headerToken, tokenSource }
   * @param {string} attemptLabel - Label for logging
   * @returns {Object} { ok, status, is403, bodySnippet, headers, loginPage }
   */
  async function doQueuePost(url, formToken, submitName, submitValue, csrfContext, attemptLabel, requestMode) {
    // Build POST body with form token (as browser would send)
    const body = new URLSearchParams();
    body.append('authenticity_token', formToken);
    body.append(submitName, submitValue);

    const headers = requestMode === 'form'
      ? buildFormLikeHeaders(csrfContext.headerToken)
      : buildRailsHeaders(csrfContext.headerToken);
    const headerTokenPrefix = tokenPrefix(csrfContext.headerToken);
    const bodyTokenPrefix = tokenPrefix(formToken);
    const referrer = window.location.href;
    const redirectMode = requestMode === 'form' ? 'follow' : REQUEST_REDIRECT;
    const referrerPolicy = requestMode === 'form'
      ? 'no-referrer-when-downgrade'
      : 'strict-origin-when-cross-origin';

    logVerbose(
      `[${attemptLabel}] POST ${url.pathname} -> ${submitName}=${submitValue}`,
      `(bodyToken=${bodyTokenPrefix}, headerToken=${headerTokenPrefix}, headerSource=${csrfContext.tokenSource})`
    );
    logVerbose(
      `[${attemptLabel}] req mode=${requestMode}, credentials=${REQUEST_CREDENTIALS}, referrer=${referrer}, redirect=${redirectMode}`
    );

    if (url.origin !== window.location.origin) {
      throw new Error('SAFETY: Refusing to POST cross-origin request');
    }

    let response;
    try {
      response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: body.toString(),
        mode: 'same-origin',
        credentials: REQUEST_CREDENTIALS,
        redirect: redirectMode,
        referrer,
        referrerPolicy,
      });
    } catch (fetchError) {
      logError(`Fetch error for ${url.pathname}:`, fetchError);
      return { ok: false, status: 0, is403: false, bodySnippet: fetchError.message, headers: {}, loginPage: false, diagKind: 'UNKNOWN', hasQueuesTable: false };
    }

    // Extract response metadata for diagnostics
    const respHeaders = {
      contentType: response.headers.get('content-type'),
      location: response.headers.get('location'),
      xRequestId: response.headers.get('x-request-id'),
      setCookie: response.headers.get('set-cookie') ? 'present' : 'absent',
    };

    let bodySnippet = '';
    let loginPage = false;
    let bodyText = '';
    let hasQueuesTable = false;
    const isHtml = (respHeaders.contentType || '').includes('text/html');

    const shouldReadBody = response.type !== 'opaqueredirect'
      && (isHtml || response.status >= 400 || (response.status >= 200 && response.status < 300));

    if (shouldReadBody) {
      try {
        bodyText = await response.text();
        if (isHtml) {
          loginPage = looksLikeLoginPageFromText(bodyText);
          if (!loginPage) {
            const parsed = new DOMParser().parseFromString(bodyText, 'text/html');
            hasQueuesTable = !!parsed.querySelector('table.queues');
          }
        }
      } catch (e) {
        // Ignore read errors
      }
    }

    const redirectIsSafe = (() => {
      if (!respHeaders.location) return false;
      try {
        const redirectUrl = new URL(respHeaders.location, window.location.origin);
        return redirectUrl.origin === window.location.origin || redirectUrl.pathname.startsWith('/sidekiq/queues');
      } catch (e) {
        return false;
      }
    })();

    const ok = (response.status === 302 && redirectIsSafe)
      || (response.status >= 200 && response.status < 300 && !loginPage)
      || (requestMode === 'form' && response.status === 200 && hasQueuesTable);
    const is403 = response.status === 403;
    const diagKind = is403 ? classify403(bodyText, respHeaders) : 'NONE';

    if (!ok) {
      const rawSnippet = bodyText || '';
      const scrubbed = redactSecrets(rawSnippet);
      bodySnippet = scrubbed.substring(0, 200);
    }

    const classifier = ok ? 'SUCCESS' : 'FAILURE';
    logVerbose(
      `[${attemptLabel}] ${classifier} status=${response.status} loginPage=${loginPage} diag=${diagKind}`,
      `location=${respHeaders.location || 'none'} contentType=${respHeaders.contentType || 'none'} xRequestId=${respHeaders.xRequestId || 'none'}`
    );
    if (!ok && bodySnippet) {
      logVerbose(`[${attemptLabel}] bodySnippet="${bodySnippet}"`);
    }

    return {
      ok,
      status: response.status,
      is403,
      bodySnippet,
      headers: respHeaders,
      loginPage,
      diagKind,
      hasQueuesTable,
      requestMode,
    };
  }

  /**
   * Submit an action for a single queue
   * Returns { ok, status, is403, bodySnippet } - caller handles refresh logic
   */
  async function submitQueueAction(queueInfo, csrfContext, actionTypeOverride) {
    const { queueName, action, formToken, submitName, submitValue } = queueInfo;
    const url = new URL(action, window.location.origin);

    // SAFETY: Final guard against delete
    if (submitName.toLowerCase() === 'delete') {
      throw new Error('SAFETY: Refusing to submit delete action');
    }

    const effectiveActionType = actionTypeOverride || queueInfo.actionType;
    const useNativeForm = NATIVE_FORM_ACTIONS.includes(effectiveActionType);
    let res;

    if (useNativeForm) {
      const nativeRes = await submitViaNativeForm(queueInfo, effectiveActionType);
      logVerbose(
        `[native] ${effectiveActionType} ${queueName} mode=${nativeRes.mode} reason=${nativeRes.reason} hasQueuesTable=${nativeRes.hasQueuesTable}`
      );
      if (currentRun) {
        const nativeStatus = nativeRes.forbidden ? 403 : (nativeRes.ok ? 200 : 0);
        currentRun.submissions.push({
          ts: new Date().toISOString(),
          queueName,
          actionType: effectiveActionType,
          actionPath: url.pathname,
          requestMode: 'native',
          request: {
            method: 'POST',
            body: {
              authenticity_token_prefix: tokenPrefix(formToken),
              submitName,
              submitValue,
            },
          },
          response: {
            status: nativeStatus,
            loginPage: nativeRes.loginPage || false,
            hasQueuesTable: nativeRes.hasQueuesTable || false,
            reason: nativeRes.reason,
            diagKind: nativeRes.diagKind || 'NONE',
          },
        });
      }
      if (nativeRes.loginPage) {
        return { ok: false, status: 200, is403: false, bodySnippet: '', loginPage: true, diagKind: 'LOGIN', hasQueuesTable: nativeRes.hasQueuesTable };
      }
      if (nativeRes.ok) {
        return {
          ok: true,
          status: 200,
          is403: false,
          bodySnippet: '',
          loginPage: false,
          diagKind: 'NONE',
          hasQueuesTable: nativeRes.hasQueuesTable,
          freshDoc: nativeRes.doc,
          freshDocSource: 'iframe',
        };
      }
      if (nativeRes.forbidden) {
        return {
          ok: false,
          status: 403,
          is403: true,
          bodySnippet: nativeRes.bodyText ? redactSecrets(nativeRes.bodyText).slice(0, 200) : '',
          loginPage: false,
          diagKind: nativeRes.diagKind || 'UNKNOWN',
          hasQueuesTable: nativeRes.hasQueuesTable,
        };
      }
    } else if (!effectiveActionType) {
      logVerbose(`[native] skip ${queueName} missing actionType`);
    }

    const requestMode = csrfContext.headerToken ? 'xhr' : 'form';
    res = await doQueuePost(url, formToken, submitName, submitValue, csrfContext, 'attempt', requestMode);
    if (currentRun) {
      currentRun.submissions.push({
        ts: new Date().toISOString(),
        queueName,
        actionType: queueInfo.actionType,
        actionPath: url.pathname,
        requestMode: res.requestMode,
        request: {
          method: 'POST',
          body: {
            authenticity_token_prefix: tokenPrefix(formToken),
            submitName,
            submitValue,
          },
        },
        response: {
          status: res.status,
          location: res.headers ? res.headers.location : null,
          contentType: res.headers ? res.headers.contentType : null,
          xRequestId: res.headers ? res.headers.xRequestId : null,
          diagKind: res.diagKind,
          loginPage: res.loginPage,
          hasQueuesTable: res.hasQueuesTable,
        },
      });
    }

    if (!res.ok) {
      // Enhanced diagnostics for failures
      const diagInfo = {
        queue: queueName,
        status: res.status,
        headerCsrfPresent: !!csrfContext.headerToken,
        headerCsrfSource: csrfContext.tokenSource,
        responseHeaders: res.headers,
        bodySnippet: res.bodySnippet,
        diagKind: res.diagKind,
        submissionMode: res.requestMode || 'fetch',
      };

      if (res.is403) {
        logError(`403 Forbidden for "${queueName}" - diagnostics:`, diagInfo);
      } else {
        logError(`HTTP ${res.status} for "${queueName}":`, diagInfo);
      }
    }

    return {
      ok: res.ok,
      status: res.status,
      is403: res.is403,
      bodySnippet: res.bodySnippet,
      loginPage: res.loginPage,
      diagKind: res.diagKind,
      hasQueuesTable: res.hasQueuesTable,
    };
  }

  /**
   * Convergence loop: keep processing until all queues reach desired state
   * or max passes reached
   *
   * Token refresh strategy (1.0.5 model with hardening):
   * - On first 403 in a pass: refresh page, update all tokens, retry that queue
   * - Subsequent 403s in same pass: do NOT refresh again, leave to next pass
   */
  async function convergeQueues(actionType, updateStatus) {
    const results = {
      totalProcessed: 0,
      passesUsed: 0,
      success: false,
      errors: [],
      remainingQueues: [],
      aborted: false,
      abortReason: '',
      stats: {
        initial403Count: 0,
        retrySuccessCount: 0,
        tokenRefreshCount: 0,
        headerCsrfSource: 'unknown',
      },
    };

    const actionLabel = actionType === 'pause' ? 'Pausing' : 'Unpausing';
    const doneLabel = actionType === 'pause' ? 'paused' : 'unpaused';

    for (let pass = 1; pass <= MAX_PASSES; pass++) {
      results.passesUsed = pass;

      // Fetch fresh page state (except first pass where we use live DOM)
      let doc;
      let htmlText = null;
      let responseHeaders = null;
      if (pass === 1) {
        doc = document;
        log(`Pass ${pass}/${MAX_PASSES}: Using live DOM`);
      } else {
        log(`Pass ${pass}/${MAX_PASSES}: Fetching fresh page state...`);
        updateStatus(`Pass ${pass}/${MAX_PASSES}: Checking remaining queues...`);
        try {
          const fetchResult = await fetchQueuesPageDocument(`pass-${pass}`);
          doc = fetchResult.doc;
          htmlText = fetchResult.htmlText;
          responseHeaders = fetchResult.responseHeaders;
          if (fetchResult.loginPage) {
            results.aborted = true;
            results.abortReason = 'Session expired / not authorized (login page detected)';
            logError(results.abortReason);
            break;
          }
        } catch (error) {
          logError(`Failed to fetch page state:`, error);
          doc = document;
        }
      }

      // Get header CSRF token (page-global source only, never from form inputs)
      let { token: headerToken, source: tokenSource } = getHeaderCsrfTokenExtended(doc, htmlText, responseHeaders);
      const csrfContext = {
        headerToken,
        tokenSource,
      };

      results.stats.headerCsrfSource = tokenSource;
      log(`Pass ${pass} CSRF: headerToken=${headerToken ? tokenPrefix(headerToken) : 'MISSING'}, source=${tokenSource}`);

      if (!headerToken && pass === 1) {
        log('Pass 1 preflight: header CSRF missing, refreshing page before POSTs...');
        try {
          const fetchResult = await fetchQueuesPageDocument('preflight-pass1');
          doc = fetchResult.doc;
          htmlText = fetchResult.htmlText;
          responseHeaders = fetchResult.responseHeaders;
          if (fetchResult.loginPage) {
            results.aborted = true;
            results.abortReason = 'Session expired / not authorized (login page detected)';
            logError(results.abortReason);
            break;
          }
          const updated = getHeaderCsrfTokenExtended(doc, htmlText, responseHeaders);
          headerToken = updated.token;
          tokenSource = updated.source;
          csrfContext.headerToken = headerToken;
          csrfContext.tokenSource = tokenSource;
          results.stats.headerCsrfSource = tokenSource;
          log(`Preflight CSRF: headerToken=${headerToken ? tokenPrefix(headerToken) : 'MISSING'}, source=${tokenSource}`);
        } catch (error) {
          logError('Preflight refresh failed:', error);
        }
      }

      if (!headerToken) {
        log('  WARNING: No header CSRF token found - running in body-only mode (higher 403 rate expected)');
      }

      // Get queues that still need action (verbose logging on first pass)
      let actionable = getActionableQueues(doc, actionType, pass === 1 && DEBUG_LEVEL >= 2);
      const alreadySucceededKeys = new Set();

      if (actionable.length === 0) {
        log(`Pass ${pass}/${MAX_PASSES}: All queues ${doneLabel}!`);
        updateStatus(`All queues ${doneLabel}`);
        results.success = true;
        results.remainingQueues = [];
        break;
      }

      log(`Pass ${pass}/${MAX_PASSES}: ${actionable.length} queues need ${actionType}`);
      updateStatus(`Pass ${pass}/${MAX_PASSES}: ${actionLabel} ${actionable.length} remaining...`);

      // Track token refresh for this pass (at most one refresh per pass)
      let tokenRefreshedThisPass = false;

      // Process each actionable queue
      let last403At = 0;

      for (let i = 0; i < actionable.length; i++) {
        const queueInfo = actionable[i];
        const progressMsg = `Pass ${pass}/${MAX_PASSES}: ${actionLabel} ${i + 1}/${actionable.length} (${queueInfo.queueName})`;
        updateStatus(progressMsg);

        if (ENABLE_LIVE_DOM_RECHECK && i > 0 && i % LIVE_DOM_RECHECK_INTERVAL === 0) {
          const liveActionable = getActionableQueues(document, actionType, false);
          const liveKeys = new Set(liveActionable.map(q => q.actionPathKey));
          if (!liveKeys.has(queueInfo.actionPathKey)) {
            logVerbose(`Skipping ${queueInfo.queueName} (already in desired state per live DOM)`);
            continue;
          }
        }

        const since403 = Date.now() - last403At;
        if (last403At > 0 && since403 < RECENT_403_WINDOW_MS) {
          await sleepJitter(RECENT_403_EXTRA_DELAY_MIN_MS, RECENT_403_EXTRA_DELAY_MAX_MS);
        }

        try {
          const result = await submitQueueAction(queueInfo, csrfContext, actionType);

          if (result.ok) {
            results.totalProcessed++;
            logVerbose(`OK ${actionType} ${queueInfo.queueName}`);
            alreadySucceededKeys.add(queueInfo.actionPathKey);

            if (result.freshDoc) {
              const updated = getHeaderCsrfTokenExtended(result.freshDoc, null, null);
              if (updated.token !== csrfContext.headerToken) {
                csrfContext.headerToken = updated.token;
                csrfContext.tokenSource = updated.source;
                results.stats.headerCsrfSource = updated.source;
              }
              actionable = getActionableQueues(result.freshDoc, actionType, false)
                .filter(q => !alreadySucceededKeys.has(q.actionPathKey));
              i = -1;
            }
          } else if (result.is403) {
            results.stats.initial403Count++;
            last403At = Date.now();

            if (result.loginPage || result.diagKind === 'LOGIN') {
              results.aborted = true;
              results.abortReason = 'Session expired / not authorized (login page detected on POST)';
              logError(results.abortReason);
              break;
            }

            // On first 403 of this pass, refresh tokens and retry this one queue
            if (!tokenRefreshedThisPass) {
              log(`First 403 this pass - refreshing tokens and retrying "${queueInfo.queueName}"...`);

              try {
                const fetchResult = await fetchQueuesPageDocument('token-refresh');
                const freshDoc = fetchResult.doc;
                const freshHtmlText = fetchResult.htmlText;
                const freshHeaders = fetchResult.responseHeaders;
                if (fetchResult.loginPage) {
                  results.aborted = true;
                  results.abortReason = 'Session expired / not authorized (login page detected on refresh)';
                  logError(results.abortReason);
                  break;
                }
                const { token: freshHeaderToken, source: freshSource } = getHeaderCsrfTokenExtended(
                  freshDoc,
                  freshHtmlText,
                  freshHeaders
                );
                csrfContext.headerToken = freshHeaderToken;
                csrfContext.tokenSource = freshSource;
                results.stats.tokenRefreshCount++;
                results.stats.headerCsrfSource = freshSource;

                log(`Token refresh: headerToken=${freshHeaderToken ? tokenPrefix(freshHeaderToken) : 'MISSING'}, source=${freshSource}`);

                tokenRefreshedThisPass = true;

                // Retry this queue with fresh tokens (if still actionable)
                const freshMap = buildQueueTokenMap(freshDoc, actionType);
                const fresh = freshMap.get(queueInfo.actionPathKey);
                if (fresh) {
                  queueInfo.formToken = fresh.formToken;
                }
                const retryResult = await submitQueueAction(queueInfo, csrfContext, actionType);
                if (retryResult.ok) {
                  results.totalProcessed++;
                  results.stats.retrySuccessCount++;
                  logVerbose(`OK ${actionType} ${queueInfo.queueName} (after token refresh)`);
                  alreadySucceededKeys.add(queueInfo.actionPathKey);
                } else if (retryResult.is403 && (retryResult.loginPage || retryResult.diagKind === 'LOGIN')) {
                  results.aborted = true;
                  results.abortReason = 'Session expired / not authorized (login page detected after retry)';
                  logError(results.abortReason);
                  break;
                } else {
                  // Still failed after refresh - likely RBAC, not CSRF
                  results.errors.push({
                    queue: queueInfo.queueName,
                    error: `HTTP ${retryResult.status} after token refresh (likely RBAC/permission)`,
                    pass,
                  });
                  logError(`Still failed after refresh: ${queueInfo.queueName} - HTTP ${retryResult.status}`);
                }

                // Rebuild actionable list after refresh to reduce drift
                actionable = getActionableQueues(freshDoc, actionType, false)
                  .filter(q => !alreadySucceededKeys.has(q.actionPathKey));
                i = -1;
              } catch (refreshErr) {
                tokenRefreshedThisPass = true; // Don't retry refresh on error
                results.errors.push({
                  queue: queueInfo.queueName,
                  error: `403 + refresh failed: ${refreshErr.message}`,
                  pass,
                });
                logError(`Token refresh failed for ${queueInfo.queueName}:`, refreshErr);
              }
            } else {
              // Already refreshed this pass - don't refresh again, defer to next pass
              log(`403 for "${queueInfo.queueName}" - deferred to next pass (already refreshed this pass)`);
              // Don't add to errors - will be retried next pass
            }
          } else {
            // Non-403 error
            results.errors.push({
              queue: queueInfo.queueName,
              error: `HTTP ${result.status}`,
              pass,
            });
            logError(`Failed: ${queueInfo.queueName} - HTTP ${result.status}`);
          }
        } catch (error) {
          results.errors.push({
            queue: queueInfo.queueName,
            error: String(error.message || error),
            pass,
          });
          logError(`Error processing ${queueInfo.queueName}:`, error);
          await sleepJitter(ERROR_BACKOFF_MIN_MS, ERROR_BACKOFF_MAX_MS);
        }

        // Jittered delay between requests (except after last one)
        if (i < actionable.length - 1) {
          await sleepJitter(POST_DELAY_MIN_MS, POST_DELAY_MAX_MS);
        }
      }

      if (results.aborted) {
        break;
      }

      // If not the last pass, wait with jitter for server state to settle
      if (pass < MAX_PASSES) {
        log('Waiting for server state to settle...');
        await sleepJitter(PASS_DELAY_MIN_MS, PASS_DELAY_MAX_MS);
      }
    }

    // Final check if we exhausted all passes
    if (!results.success) {
      log(`Checking final state after ${MAX_PASSES} passes...`);
      try {
        const fetchResult = await fetchQueuesPageDocument('final-check');
        const finalDoc = fetchResult.doc;
        const remaining = getActionableQueues(finalDoc, actionType);
        results.remainingQueues = remaining.map(q => q.queueName);

        if (remaining.length === 0) {
          results.success = true;
          log('All queues reached desired state after final check');
        } else {
          logError(`Incomplete: ${remaining.length} queues still not ${doneLabel}:`, results.remainingQueues);
        }
      } catch (error) {
        logError('Failed to perform final state check:', error);
      }
    }

    // Summary line for easy log analysis
    log(`Summary: passes=${results.passesUsed}, ok=${results.totalProcessed}, initial403=${results.stats.initial403Count}, retriedOk=${results.stats.retrySuccessCount}, refreshes=${results.stats.tokenRefreshCount}, headerCsrfSource=${results.stats.headerCsrfSource}`);

    return results;
  }

  /**
   * Count total queues on the page
   */
  function getTotalQueueCount() {
    const table = document.querySelector('table.queues');
    if (!table) return 0;
    return table.querySelectorAll('form[action*="/sidekiq/queues/"]').length;
  }

  /**
   * Main action handler for pause/unpause all
   */
  async function handleBulkAction(actionType, statusElement, buttons) {
    const totalQueues = getTotalQueueCount();

    if (totalQueues === 0) {
      statusElement.textContent = 'No queues found';
      statusElement.className = 'sqks-status sqks-status-error';
      return;
    }

    // Get initial actionable count
    const initialActionable = getActionableQueues(document, actionType);
    const actionLabel = actionType === 'pause' ? 'Pause' : 'Unpause';
    const doneLabel = actionType === 'pause' ? 'paused' : 'unpaused';

    if (initialActionable.length === 0) {
      statusElement.textContent = `All ${totalQueues} queues already ${doneLabel}`;
      statusElement.className = 'sqks-status sqks-status-success';
      return;
    }

    if (bulkActionInProgress) {
      statusElement.textContent = 'Already running...';
      statusElement.className = 'sqks-status';
      return;
    }

    // Confirmation dialog
    const confirmMessage = actionType === 'pause'
      ? `Pause ${initialActionable.length} queue(s)? This will stop queue processing until unpaused.`
      : `Unpause ${initialActionable.length} queue(s)?`;

    if (!confirm(confirmMessage)) {
      statusElement.textContent = 'Cancelled';
      statusElement.className = 'sqks-status';
      return;
    }

    // Disable buttons during operation
    buttons.forEach(btn => btn.disabled = true);
    statusElement.textContent = `${actionLabel}ing...`;
    statusElement.className = 'sqks-status sqks-status-progress';
    bulkActionInProgress = true;
    startRun(actionType, { totalQueues, initialActionable: initialActionable.length });

    let finalResults = null;
    try {
      const results = await convergeQueues(
        actionType,
        (msg) => { statusElement.textContent = msg; }
      );
      finalResults = results;

      // Build result message
      let resultMessage;
      if (results.aborted) {
        resultMessage = results.abortReason || 'Session expired / not authorized';
        statusElement.className = 'sqks-status sqks-status-error';
      } else if (results.success) {
        resultMessage = `Done: All queues ${doneLabel}`;
        if (results.passesUsed > 1) {
          resultMessage += ` (${results.passesUsed} passes)`;
        }
        statusElement.className = 'sqks-status sqks-status-success';
      } else {
        resultMessage = `Incomplete after ${results.passesUsed} passes: ${results.remainingQueues.length} queue(s) still not ${doneLabel}`;
        statusElement.className = 'sqks-status sqks-status-error';
        logError('Remaining queues:', results.remainingQueues);
      }

      if (results.errors.length > 0) {
        resultMessage += ` (${results.errors.length} error(s))`;
        logError('Errors during processing:', results.errors);
      }

      statusElement.textContent = resultMessage;
      log('Final results:', results);

      // Refresh page after a brief delay to show the status
      setTimeout(() => {
        window.location.reload();
      }, 1500);

    } catch (error) {
      logError('Bulk action failed:', error);
      statusElement.textContent = `Error: ${error.message}`;
      statusElement.className = 'sqks-status sqks-status-error';
      finalResults = { error: String(error.message || error) };
    } finally {
      buttons.forEach(btn => btn.disabled = false);
      bulkActionInProgress = false;
      endRun(finalResults);
    }
  }

  /**
   * Create and inject the UI controls
   */
  function injectControls() {
    if (!isQueuesPage()) {
      log('Not on Sidekiq Queues page, skipping injection');
      return;
    }

    log('Injecting controls...');

    const headerContainer = findHeaderContainer();
    if (!headerContainer) {
      logError('Could not find header container');
      return;
    }

    // Create control container
    const controlContainer = document.createElement('div');
    controlContainer.className = 'sqks-controls';

    // Create Pause All button
    const pauseButton = document.createElement('button');
    pauseButton.type = 'button';
    pauseButton.className = 'btn btn-danger sqks-btn';
    pauseButton.textContent = 'Pause All Queues';

    // Create Unpause All button
    const unpauseButton = document.createElement('button');
    unpauseButton.type = 'button';
    unpauseButton.className = 'btn btn-primary sqks-btn';
    unpauseButton.textContent = 'Unpause All Queues';

    // Create status element
    const statusElement = document.createElement('span');
    statusElement.className = 'sqks-status';
    statusElement.textContent = 'Ready';

    // Wire up event handlers
    const buttons = [pauseButton, unpauseButton];

    pauseButton.addEventListener('click', () => {
      handleBulkAction('pause', statusElement, buttons);
    });

    unpauseButton.addEventListener('click', () => {
      handleBulkAction('unpause', statusElement, buttons);
    });

    // Assemble and inject
    controlContainer.appendChild(pauseButton);
    controlContainer.appendChild(unpauseButton);
    controlContainer.appendChild(statusElement);

    // Insert after the header or at the beginning of the container
    const h1 = headerContainer.querySelector('h1');
    if (h1 && h1.nextSibling) {
      headerContainer.insertBefore(controlContainer, h1.nextSibling);
    } else {
      headerContainer.appendChild(controlContainer);
    }

    log('Controls injected successfully');
  }

  // Initialize
  try {
    injectStyles();
    injectControls();
  } catch (error) {
    logError('Failed to initialize:', error);
  }
})();
