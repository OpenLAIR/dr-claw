import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

function createWorker() {
  const listeners = new Map();
  const entries = new Map();
  let networkResponse = new Response('healthy HTML');
  let offline = false;
  let writeError;
  let releaseWrite;
  let writeGate = Promise.resolve();

  vm.runInNewContext(source, {
    URL,
    self: { addEventListener: (name, listener) => listeners.set(name, listener) },
    fetch: async () => {
      if (offline) throw new TypeError('Offline');
      return networkResponse;
    },
    caches: {
      open: async () => ({
        put: async (request, response) => {
          await writeGate;
          if (writeError) throw writeError;
          entries.set(request.url, response);
        },
      }),
      match: async (request) => entries.get(request.url)?.clone(),
    },
  });

  return {
    entries,
    setResponse: (response) => { networkResponse = response; },
    goOffline: () => { offline = true; },
    failWrites: () => { writeError = new Error('Cache quota exceeded'); },
    pauseWrites: () => {
      writeGate = new Promise((resolve) => { releaseWrite = resolve; });
      return () => releaseWrite();
    },
    dispatch(url = 'https://dr-claw.test/', mode = 'navigate', method = 'GET') {
      let response;
      const lifetime = [];
      listeners.get('fetch')({
        request: { url, mode, method },
        respondWith: (promise) => { response = promise; },
        waitUntil: (promise) => { lifetime.push(promise); },
      });
      return { response, lifetime };
    },
  };
}

test('successful navigation refreshes the cached HTML for an offline retry', async () => {
  const worker = createWorker();
  const event = worker.dispatch();
  assert.equal(await (await event.response).text(), 'healthy HTML');
  await Promise.all(event.lifetime);

  worker.goOffline();
  assert.equal(await (await worker.dispatch().response).text(), 'healthy HTML');
});

for (const status of [404, 502]) {
  test(`HTTP ${status} does not replace the last successful HTML`, async () => {
    const worker = createWorker();
    const first = worker.dispatch();
    await first.response;
    await Promise.all(first.lifetime);

    worker.setResponse(new Response('proxy error', { status }));
    const failed = worker.dispatch();
    assert.equal((await failed.response).status, status);
    await Promise.all(failed.lifetime);

    worker.goOffline();
    assert.equal(await (await worker.dispatch().response).text(), 'healthy HTML');
  });
}

test('a failed direct HTML request does not populate an empty cache', async () => {
  const worker = createWorker();
  worker.setResponse(new Response('proxy error', { status: 502 }));
  const event = worker.dispatch('https://dr-claw.test/index.html', 'same-origin');
  assert.equal((await event.response).status, 502);
  await Promise.all(event.lifetime);
  assert.equal(worker.entries.size, 0);
});

test('navigation cache writes extend the worker lifetime without blocking the response', async () => {
  const worker = createWorker();
  const releaseWrite = worker.pauseWrites();
  const event = worker.dispatch();
  assert.equal(await (await event.response).text(), 'healthy HTML');
  assert.equal(worker.entries.size, 0);
  releaseWrite();
  assert.equal(event.lifetime.length, 1);
  await Promise.all(event.lifetime);
  assert.equal(worker.entries.size, 1);
});

test('cache failures do not reject a successful network response or worker lifetime', async () => {
  const worker = createWorker();
  worker.failWrites();
  const event = worker.dispatch();
  assert.equal(await (await event.response).text(), 'healthy HTML');
  await Promise.all(event.lifetime);
  assert.equal(worker.entries.size, 0);
});

// API calls and static assets must reach the network directly: on a cold
// desktop launch they are slow, and a worker in the middle turned failures into
// "TypeError: Failed to fetch" and served stale precached files after upgrades.
for (const [url, mode, method] of [
  ['https://dr-claw.test/api/projects', 'cors', 'GET'],
  ['https://dr-claw.test/api/projects/p/sessions/s/messages?limit=50', 'cors', 'GET'],
  ['https://dr-claw.test/icons/claude-ai-icon.svg', 'no-cors', 'GET'],
  ['https://dr-claw.test/assets/index-abc123.js', 'cors', 'GET'],
  ['https://dr-claw.test/manifest.json', 'cors', 'GET'],
  ['https://dr-claw.test/api/projects', 'cors', 'POST'],
  ['https://dr-claw.test/', 'navigate', 'POST'],
]) {
  test(`${method} ${new URL(url).pathname} (${mode}) is not intercepted`, () => {
    const worker = createWorker();
    const event = worker.dispatch(url, mode, method);
    assert.equal(event.response, undefined);
    assert.equal(event.lifetime.length, 0);
  });
}
