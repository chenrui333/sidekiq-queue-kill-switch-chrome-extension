/**
 * Sidekiq Queue Kill Switch - Content Script
 *
 * Adds "Pause All" and "Unpause All" controls to the Sidekiq Enterprise Queues page.
 * Safe for oncall use - never deletes queues, only pauses/unpauses.
 */

(function() {
  'use strict';

  const LOG_PREFIX = '[SQKS]';
  const DELAY_BETWEEN_REQUESTS_MS = 150;
  const MAX_CONCURRENT_REQUESTS = 3;

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
   * Get all queue forms from the table
   */
  function getQueueForms() {
    const table = document.querySelector('table.queues');
    if (!table) {
      return [];
    }

    const forms = table.querySelectorAll('form[action*="/sidekiq/queues/"]');
    return Array.from(forms);
  }

  /**
   * Extract queue name from form action URL
   */
  function getQueueName(form) {
    const action = form.getAttribute('action') || '';
    const match = action.match(/\/sidekiq\/queues\/([^/?]+)/);
    return match ? decodeURIComponent(match[1]) : 'unknown';
  }

  /**
   * Get the authenticity token from a form
   */
  function getAuthenticityToken(form) {
    const tokenInput = form.querySelector('input[name="authenticity_token"]');
    return tokenInput ? tokenInput.value : null;
  }

  /**
   * Find a submit button by action type (pause/unpause)
   * Detects from DOM - does not hardcode values
   */
  function findSubmitButton(form, actionType) {
    // Look for submit inputs with name matching the action type
    const submits = form.querySelectorAll('input[type="submit"]');

    for (const submit of submits) {
      const name = (submit.getAttribute('name') || '').toLowerCase();
      const value = (submit.getAttribute('value') || '').toLowerCase();

      // Skip delete buttons - SAFETY CHECK
      if (name === 'delete' || value === 'delete') {
        continue;
      }

      // Match pause or unpause based on name or value
      if (actionType === 'pause') {
        if (name === 'pause' || value === 'pause') {
          return submit;
        }
      } else if (actionType === 'unpause') {
        if (name === 'unpause' || value === 'unpause') {
          return submit;
        }
      }
    }

    return null;
  }

  /**
   * Submit a form action via fetch
   */
  async function submitFormAction(form, submitButton) {
    const action = form.getAttribute('action');
    const url = new URL(action, window.location.origin);
    const token = getAuthenticityToken(form);

    if (!token) {
      throw new Error('No authenticity token found');
    }

    const submitName = submitButton.getAttribute('name');
    const submitValue = submitButton.getAttribute('value');

    // SAFETY: Double-check we're not submitting a delete
    if (submitName.toLowerCase() === 'delete') {
      throw new Error('SAFETY: Refusing to submit delete action');
    }

    const body = new URLSearchParams();
    body.append('authenticity_token', token);
    body.append(submitName, submitValue);

    log(`Submitting ${submitName}=${submitValue} to ${url.pathname}`);

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
   * Process forms with rate limiting
   */
  async function processFormsWithRateLimit(forms, actionType, updateStatus) {
    const results = {
      success: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    const total = forms.length;
    let processed = 0;

    // Process sequentially with delay for safety and predictability
    for (const form of forms) {
      const queueName = getQueueName(form);
      const submitButton = findSubmitButton(form, actionType);

      if (!submitButton) {
        log(`Skipping ${queueName}: no ${actionType} button found`);
        results.skipped++;
        processed++;
        updateStatus(`${actionType === 'pause' ? 'Pausing' : 'Unpausing'} ${processed}/${total}... (skipped ${queueName})`);
        continue;
      }

      try {
        await submitFormAction(form, submitButton);
        results.success++;
        log(`Success: ${actionType} ${queueName}`);
      } catch (error) {
        results.failed++;
        results.errors.push({ queue: queueName, error: error.message });
        logError(`Failed to ${actionType} ${queueName}:`, error);
      }

      processed++;
      updateStatus(`${actionType === 'pause' ? 'Pausing' : 'Unpausing'} ${processed}/${total}...`);

      // Delay between requests
      if (processed < total) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS_MS));
      }
    }

    return results;
  }

  /**
   * Main action handler for pause/unpause all
   */
  async function handleBulkAction(actionType, statusElement, buttons) {
    const forms = getQueueForms();

    if (forms.length === 0) {
      statusElement.textContent = 'No queues found';
      statusElement.className = 'sqks-status sqks-status-error';
      return;
    }

    // Confirmation dialog
    const actionLabel = actionType === 'pause' ? 'Pause' : 'Unpause';
    const confirmMessage = actionType === 'pause'
      ? `Pause all ${forms.length} queues? This will stop all queue processing until unpaused.`
      : `Unpause all ${forms.length} queues?`;

    if (!confirm(confirmMessage)) {
      statusElement.textContent = 'Cancelled';
      statusElement.className = 'sqks-status';
      return;
    }

    // Disable buttons during operation
    buttons.forEach(btn => btn.disabled = true);
    statusElement.textContent = `${actionLabel}ing 0/${forms.length}...`;
    statusElement.className = 'sqks-status sqks-status-progress';

    try {
      const results = await processFormsWithRateLimit(
        forms,
        actionType,
        (msg) => { statusElement.textContent = msg; }
      );

      // Show results
      let resultMessage = `Done: ${results.success} ${actionType}d`;
      if (results.skipped > 0) {
        resultMessage += `, ${results.skipped} skipped`;
      }
      if (results.failed > 0) {
        resultMessage += `, ${results.failed} failed`;
      }

      statusElement.textContent = resultMessage;
      statusElement.className = results.failed > 0
        ? 'sqks-status sqks-status-error'
        : 'sqks-status sqks-status-success';

      if (results.errors.length > 0) {
        logError('Errors:', results.errors);
      }

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
