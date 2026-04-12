import { describe, expect, it } from "vitest";

import {
  buildQueuedTurn,
  enqueueSessionTurn,
  getNextDispatchableTurn,
  promoteQueuedTurnToSteer,
  reconcileSessionQueueId,
  reconcileSettledSessionQueue,
  type SessionQueueMap,
} from "../codexQueue";

describe("codexQueue", () => {
  it("prepends steer turns when enqueueing", () => {
    const sessionId = "session-1";
    const initialQueue: SessionQueueMap = {
      [sessionId]: [
        buildQueuedTurn({
          id: "normal-1",
          sessionId,
          text: "normal one",
          kind: "normal",
        }),
      ],
    };

    const next = enqueueSessionTurn(
      initialQueue,
      buildQueuedTurn({
        id: "steer-1",
        sessionId,
        text: "steer one",
        kind: "steer",
      }),
    );

    expect(next[sessionId].map((turn) => turn.id)).toEqual([
      "steer-1",
      "normal-1",
    ]);
  });

  it("chooses a queued steer turn before normal turns", () => {
    const queue = [
      buildQueuedTurn({
        id: "normal-1",
        sessionId: "session-1",
        text: "normal one",
        kind: "normal",
      }),
      buildQueuedTurn({
        id: "steer-1",
        sessionId: "session-1",
        text: "steer one",
        kind: "steer",
      }),
    ];

    const next = getNextDispatchableTurn(queue);
    expect(next?.id).toBe("steer-1");
  });

  it("promotes a queued turn to steer and moves it to the top", () => {
    const sessionId = "session-1";
    const initialQueue: SessionQueueMap = {
      [sessionId]: [
        buildQueuedTurn({
          id: "normal-1",
          sessionId,
          text: "normal one",
          kind: "normal",
        }),
        buildQueuedTurn({
          id: "normal-2",
          sessionId,
          text: "normal two",
          kind: "normal",
        }),
      ],
    };

    const next = promoteQueuedTurnToSteer(
      initialQueue,
      sessionId,
      "normal-2",
    );

    expect(next[sessionId][0].id).toBe("normal-2");
    expect(next[sessionId][0].kind).toBe("steer");
    expect(next[sessionId][1].id).toBe("normal-1");
  });

  it("reconciles temporary session queues into the settled session while preserving order", () => {
    const tempSessionId = "new-session-123";
    const settledSessionId = "session-42";
    const initialQueue: SessionQueueMap = {
      [settledSessionId]: [
        buildQueuedTurn({
          id: "existing-1",
          sessionId: settledSessionId,
          text: "existing queued turn",
          kind: "normal",
        }),
      ],
      [tempSessionId]: [
        buildQueuedTurn({
          id: "temp-1",
          sessionId: tempSessionId,
          text: "first temp turn",
          kind: "normal",
        }),
        buildQueuedTurn({
          id: "temp-2",
          sessionId: tempSessionId,
          text: "second temp turn",
          kind: "steer",
        }),
      ],
    };

    const reconciled = reconcileSessionQueueId(
      initialQueue,
      tempSessionId,
      settledSessionId,
    );

    expect(reconciled[tempSessionId]).toBeUndefined();
    expect(reconciled[settledSessionId].map((turn) => turn.id)).toEqual([
      "existing-1",
      "temp-1",
      "temp-2",
    ]);
    expect(reconciled[settledSessionId].map((turn) => turn.sessionId)).toEqual([
      settledSessionId,
      settledSessionId,
      settledSessionId,
    ]);
  });

  it("treats reconciliation as a no-op when the source queue is empty", () => {
    const initialQueue: SessionQueueMap = {
      "session-1": [
        buildQueuedTurn({
          id: "turn-1",
          sessionId: "session-1",
          text: "only turn",
          kind: "normal",
        }),
      ],
    };

    const reconciled = reconcileSessionQueueId(
      initialQueue,
      "new-session-404",
      "session-1",
    );

    expect(reconciled).toBe(initialQueue);
  });

  it("does not reconcile settled queues for non-temporary fallback ids", () => {
    const queueBySession: SessionQueueMap = {
      "session-real": [
        buildQueuedTurn({
          id: "real-1",
          sessionId: "session-real",
          text: "real turn",
          kind: "normal",
        }),
      ],
      "session-fallback": [
        buildQueuedTurn({
          id: "fallback-1",
          sessionId: "session-fallback",
          text: "fallback turn",
          kind: "normal",
        }),
      ],
    };

    const reconciled = reconcileSettledSessionQueue(
      queueBySession,
      "session-real",
      "session-fallback",
    );

    expect(reconciled).toBe(queueBySession);
  });
});
