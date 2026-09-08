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
    dispatch(url = 'https://dr-claw.test/', mode = 'navigate') {
      let response;
      const lifetime = [];
      listeners.get('fetch')({
        request: { url, mode },
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
