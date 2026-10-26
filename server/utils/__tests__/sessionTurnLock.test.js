import { expect, it } from 'vitest';
import { providerForCommand, reserveSessionTurn } from '../sessionTurnLock.js';

it('reserves a session synchronously before asynchronous provider setup', async () => {
  let finish;
  const release = reserveSessionTurn('claude', 'resume');
  const turn = new Promise(resolve => { finish = resolve; }).finally(release);
  expect(reserveSessionTurn('claude', 'resume')).toBeNull();
  const otherProvider = reserveSessionTurn('codex', 'resume');
  const otherSession = reserveSessionTurn('claude', 'another');
  expect(otherProvider).toBeTypeOf('function');
  expect(otherSession).toBeTypeOf('function');
  otherProvider();
  otherSession();
  finish();
  await turn;
  const retry = reserveSessionTurn('claude', 'resume');
  expect(retry).toBeTypeOf('function');
  release(); // A late duplicate release must not clear the newer reservation.
  expect(reserveSessionTurn('claude', 'resume')).toBeNull();
  retry();
});

it('releases a failed turn and permits unrelated new sessions concurrently', async () => {
  const release = reserveSessionTurn('gemini', 'failed');
  await expect(Promise.reject(new Error('setup failed')).finally(release)).rejects.toThrow('setup failed');
  const retry = reserveSessionTurn('gemini', 'failed');
  expect(retry).toBeTypeOf('function');
  retry();
  const first = reserveSessionTurn('gemini', null);
  const second = reserveSessionTurn('gemini', null);
  expect(first).toBeTypeOf('function');
  expect(second).toBeTypeOf('function');
  first();
  second();
});

it('uses the same lock for legacy cursor resume and leaves control messages unblocked', () => {
  expect(providerForCommand('cursor-resume')).toBe(providerForCommand('cursor-command'));
  expect(providerForCommand('abort-session')).toBeUndefined();
  expect(providerForCommand('check-session-status')).toBeUndefined();
});
