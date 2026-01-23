/**
 * Sidekiq Queue Kill Switch - Content Script
 *
 * Adds "Pause All" and "Unpause All" controls to the Sidekiq Enterprise Queues page.
 * Safe for oncall use - never deletes queues, only pauses/unpauses.
 *
 * Uses a convergence loop to handle Sidekiq UI eventual consistency:
 * - After each pass, re-fetches page state to verify which queues still need action
 * - Retries until all queues reach desired state or max passes reached
 */

(function() {
  'use strict';

  const LOG_PREFIX = '[SQKS]';
  const MAX_PASSES = 5;           // Maximum convergence attempts

  // Jittered delays for human-like behavior
  const POST_DELAY_MIN_MS = 250;      // Min delay between individual POST requests
  const POST_DELAY_MAX_MS = 900;      // Max delay between individual POST requests
  const PASS_DELAY_MIN_MS = 1500;     // Min delay between passes
  const PASS_DELAY_MAX_MS = 3500;     // Max delay between passes
  const ERROR_BACKOFF_MIN_MS = 2000;  // Min backoff after errors
  const ERROR_BACKOFF_MAX_MS = 4000;  // Max backoff after errors

  // Allowed action types - explicit allowlist for safety
  const ALLOWED_ACTIONS = ['pause', 'unpause'];

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
    console.log(LOG_PREFIX, ...args);
  }

  function logError(...args) {
    console.error(LOG_PREFIX, ...args);
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
   * Get the authenticity token from a form element
   */
  function getAuthenticityToken(form) {
    const tokenInput = form.querySelector('input[name="authenticity_token"]');
    return tokenInput ? tokenInput.value : null;
  }

  /**
   * Find a submit button by action type (pause/unpause) in a form element
   * Detects from DOM - does not hardcode values
   * Supports both <input type="submit"> and <button> elements
   * Returns null if no matching button found
   */
  function findSubmitButton(form, actionType) {
    // SAFETY: Only allow known action types
    if (!ALLOWED_ACTIONS.includes(actionType)) {
      logError(`Invalid action type: ${actionType}`);
      return null;
    }

    // Search both input[type="submit"] and button elements
    // HTML default button type is "submit" inside a form
    const candidates = form.querySelectorAll('input[type="submit"], button[type="submit"], button:not([type])');

    for (const el of candidates) {
      const name = (el.getAttribute('name') || '').trim().toLowerCase();
      const value = (el.getAttribute('value') || '').trim().toLowerCase();
      const text = (el.textContent || '').trim().toLowerCase();

      // SAFETY: Explicitly reject delete buttons by name, value, or text
      if (name.includes('delete') || value.includes('delete') || text.includes('delete')) {
        continue;
      }

      // Match if name, value, or text equals the action type
      if (name === actionType || value === actionType || text === actionType) {
        return el;
      }
    }

    return null;
  }

  /**
   * Fetch the queues page and parse it into a document
   * Returns a parsed Document for querying fresh DOM state
   */
  async function fetchQueuesPageDocument() {
    const response = await fetch(window.location.href, {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        'Accept': 'text/html',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch page: HTTP ${response.status}`);
    }

    const html = await response.text();
    const parser = new DOMParser();
    return parser.parseFromString(html, 'text/html');
  }

  /**
   * Get actionable queue forms from a document (live DOM or fetched)
   * Returns array of { queueName, form, action, token, submitName, submitValue }
   * for queues that still need the specified action
   */
  function getActionableQueues(doc, actionType, verbose = false) {
    const table = doc.querySelector('table.queues');
    if (!table) {
      if (verbose) log('No table.queues found in document');
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

      const token = getAuthenticityToken(form);
      if (!token) {
        logError(`No authenticity token for queue: ${queueName}`);
        formsNoToken++;
        continue;
      }

      // Get submitName and submitValue, with fallback to actionType for buttons
      const submitName = submitButton.getAttribute('name') || actionType;
      const submitValue = submitButton.getAttribute('value') || actionType;

      // SAFETY: Final check - reject delete
      if (submitName.toLowerCase() === 'delete') {
        logError(`SAFETY: Skipping delete button for queue: ${queueName}`);
        continue;
      }

      actionable.push({
        queueName,
        action,
        token,
        submitName,
        submitValue,
      });
    }

    if (verbose) {
      log(`Enumeration: ${forms.length} total forms, ${actionable.length} actionable for "${actionType}"`);
      log(`  - Already in desired state: ${formsNoMatchingAction}`);
      log(`  - Delete-only forms: ${formsWithDelete}`);
      log(`  - Missing token: ${formsNoToken}`);
    }

    return actionable;
  }

  /**
   * Submit an action for a single queue
   */
  async function submitQueueAction(queueInfo) {
    const { queueName, action, token, submitName, submitValue } = queueInfo;
    const url = new URL(action, window.location.origin);

    // SAFETY: Final guard against delete
    if (submitName.toLowerCase() === 'delete') {
      throw new Error('SAFETY: Refusing to submit delete action');
    }

    const body = new URLSearchParams();
    body.append('authenticity_token', token);
    body.append(submitName, submitValue);

    log(`Submitting ${submitName}=${submitValue} to ${url.pathname} (${queueName})`);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      credentials: 'same-origin',
      redirect: 'follow',
    });

    // Rails typically returns 302 redirect on success
    // fetch with redirect: 'follow' will follow it and return 200
    if (!response.ok && response.status !== 302) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return true;
  }

  /**
   * Convergence loop: keep processing until all queues reach desired state
   * or max passes reached
   */
  async function convergeQueues(actionType, updateStatus) {
    const results = {
      totalProcessed: 0,
      passesUsed: 0,
      success: false,
      errors: [],
      remainingQueues: [],
    };

    const actionLabel = actionType === 'pause' ? 'Pausing' : 'Unpausing';
    const doneLabel = actionType === 'pause' ? 'paused' : 'unpaused';

    for (let pass = 1; pass <= MAX_PASSES; pass++) {
      results.passesUsed = pass;

      // Fetch fresh page state (except first pass where we use live DOM)
      let doc;
      if (pass === 1) {
        doc = document;
        log(`Pass ${pass}/${MAX_PASSES}: Using live DOM`);
      } else {
        log(`Pass ${pass}/${MAX_PASSES}: Fetching fresh page state...`);
        updateStatus(`Pass ${pass}/${MAX_PASSES}: Checking remaining queues...`);
        try {
          doc = await fetchQueuesPageDocument();
        } catch (error) {
          logError(`Failed to fetch page state:`, error);
          // Fall back to live DOM
          doc = document;
        }
      }

      // Get queues that still need action (verbose logging on first pass)
      const actionable = getActionableQueues(doc, actionType, pass === 1);

      if (actionable.length === 0) {
        log(`Pass ${pass}/${MAX_PASSES}: All queues ${doneLabel}!`);
        updateStatus(`All queues ${doneLabel}`);
        results.success = true;
        results.remainingQueues = [];
        break;
      }

      log(`Pass ${pass}/${MAX_PASSES}: ${actionable.length} queues need ${actionType}`);
      updateStatus(`Pass ${pass}/${MAX_PASSES}: ${actionLabel} ${actionable.length} remaining...`);

      // Process each actionable queue
      for (let i = 0; i < actionable.length; i++) {
        const queueInfo = actionable[i];
        const progressMsg = `Pass ${pass}/${MAX_PASSES}: ${actionLabel} ${i + 1}/${actionable.length} (${queueInfo.queueName})`;
        updateStatus(progressMsg);

        try {
          await submitQueueAction(queueInfo);
          results.totalProcessed++;
          log(`Success: ${actionType} ${queueInfo.queueName}`);
        } catch (error) {
          results.errors.push({ queue: queueInfo.queueName, error: String(error.message || error), pass });
          logError(`Failed to ${actionType} ${queueInfo.queueName}:`, error);
          // Backoff after errors
          await sleepJitter(ERROR_BACKOFF_MIN_MS, ERROR_BACKOFF_MAX_MS);
        }

        // Jittered delay between requests (except after last one)
        if (i < actionable.length - 1) {
          await sleepJitter(POST_DELAY_MIN_MS, POST_DELAY_MAX_MS);
        }
      }

      // If not the last pass, wait with jitter for server state to settle before re-checking
      if (pass < MAX_PASSES) {
        log(`Waiting for server state to settle...`);
        await sleepJitter(PASS_DELAY_MIN_MS, PASS_DELAY_MAX_MS);
      }
    }

    // Final check if we exhausted all passes
    if (!results.success) {
      log(`Checking final state after ${MAX_PASSES} passes...`);
      try {
        const finalDoc = await fetchQueuesPageDocument();
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

    try {
      const results = await convergeQueues(
        actionType,
        (msg) => { statusElement.textContent = msg; }
      );

      // Build result message
      let resultMessage;
      if (results.success) {
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
      log(`Final results:`, results);

      // Refresh page after a brief delay to show the status
      setTimeout(() => {
        window.location.reload();
      }, 1500);

    } catch (error) {
      logError('Bulk action failed:', error);
      statusElement.textContent = `Error: ${error.message}`;
      statusElement.className = 'sqks-status sqks-status-error';
    } finally {
      buttons.forEach(btn => btn.disabled = false);
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
    injectControls();
  } catch (error) {
    logError('Failed to initialize:', error);
  }
})();
