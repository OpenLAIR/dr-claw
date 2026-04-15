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

  it("preserves order under concurrent temp→settled promotions from multiple temp sessions", () => {
    const settledId = "session-settled";
    const tempA = "new-session-aaa";
    const tempB = "new-session-bbb";

    const initialQueue: SessionQueueMap = {
      [settledId]: [
        buildQueuedTurn({
          id: "settled-1",
          sessionId: settledId,
          text: "settled turn",
          kind: "normal",
        }),
      ],
      [tempA]: [
        buildQueuedTurn({
          id: "tempA-1",
          sessionId: tempA,
          text: "temp A first",
          kind: "normal",
        }),
        buildQueuedTurn({
          id: "tempA-2",
          sessionId: tempA,
          text: "temp A second",
          kind: "steer",
        }),
      ],
      [tempB]: [
        buildQueuedTurn({
          id: "tempB-1",
          sessionId: tempB,
          text: "temp B first",
          kind: "normal",
        }),
      ],
    };

    // Simulate two sequential temp→settled promotions (the order they arrive)
    const afterA = reconcileSettledSessionQueue(initialQueue, settledId, tempA);
    const afterBoth = reconcileSettledSessionQueue(afterA, settledId, tempB);

    // tempA and tempB queues should be gone
    expect(afterBoth[tempA]).toBeUndefined();
    expect(afterBoth[tempB]).toBeUndefined();

    // Settled queue should contain all turns in order:
    // existing settled → tempA turns → tempB turns
    const ids = afterBoth[settledId].map((t) => t.id);
    expect(ids).toEqual([
      "settled-1",
      "tempA-1",
      "tempA-2",
      "tempB-1",
    ]);

    // All turns should have the settled sessionId
    expect(
      afterBoth[settledId].every((t) => t.sessionId === settledId),
    ).toBe(true);

    // Steer kind should be preserved through reconciliation
    const steerTurn = afterBoth[settledId].find((t) => t.id === "tempA-2");
    expect(steerTurn?.kind).toBe("steer");
  });

  it("preserves order when promotion and reconciliation interleave", () => {
    const tempId = "new-session-xyz";
    const settledId = "session-final";

    let queue: SessionQueueMap = {
      [tempId]: [
        buildQueuedTurn({
          id: "t-1",
          sessionId: tempId,
          text: "first",
          kind: "normal",
        }),
        buildQueuedTurn({
          id: "t-2",
          sessionId: tempId,
          text: "second",
          kind: "normal",
        }),
        buildQueuedTurn({
          id: "t-3",
          sessionId: tempId,
          text: "third",
          kind: "normal",
        }),
      ],
    };

    // Promote t-3 to steer (moves to front) before reconciliation
    queue = promoteQueuedTurnToSteer(queue, tempId, "t-3");
    expect(queue[tempId].map((t) => t.id)).toEqual(["t-3", "t-1", "t-2"]);

    // Now reconcile temp → settled
    queue = reconcileSettledSessionQueue(queue, settledId, tempId);

    expect(queue[tempId]).toBeUndefined();
    const ids = queue[settledId].map((t) => t.id);
    // Promoted steer turn stays at front, then remaining in original order
    expect(ids).toEqual(["t-3", "t-1", "t-2"]);
    expect(queue[settledId][0].kind).toBe("steer");
    expect(queue[settledId].every((t) => t.sessionId === settledId)).toBe(true);
  });
});
