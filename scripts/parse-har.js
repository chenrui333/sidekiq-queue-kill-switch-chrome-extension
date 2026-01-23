#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const harPath = process.argv[2];
if (!harPath) {
  console.error('Usage: node scripts/parse-har.js /path/to/file.har');
  process.exit(1);
}

const raw = fs.readFileSync(harPath, 'utf8');
const har = JSON.parse(raw);
const entries = (har.log && har.log.entries) || [];

const queueEntries = entries.filter((e) => /\/sidekiq\/queues\//.test(e.request.url));
const endpoints = new Set();
const actionParams = new Set();
const headerPresence = new Set();
const statuses = {};

for (const entry of queueEntries) {
  const url = new URL(entry.request.url);
  endpoints.add(url.pathname);

  const postText = entry.request.postData && entry.request.postData.text || '';
  if (/\bpause=/.test(postText)) actionParams.add('pause');
  if (/\bunpause=/.test(postText)) actionParams.add('unpause');

  const hasXCsrf = entry.request.headers.some((h) => h.name.toLowerCase() === 'x-csrf-token');
  headerPresence.add(hasXCsrf ? 'present' : 'absent');

  statuses[entry.response.status] = (statuses[entry.response.status] || 0) + 1;
}

const result = {
  file: path.basename(harPath),
  queueEntryCount: queueEntries.length,
  uniqueQueueEndpoints: endpoints.size,
  actionParams: Array.from(actionParams),
  xCsrfTokenHeader: Array.from(headerPresence),
  statuses,
};

console.log(JSON.stringify(result, null, 2));
