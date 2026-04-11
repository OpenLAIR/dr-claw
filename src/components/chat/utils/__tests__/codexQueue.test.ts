import { describe, expect, it } from "vitest";

import {
  buildQueuedTurn,
  enqueueSessionTurn,
  getNextDispatchableTurn,
  promoteQueuedTurnToSteer,
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
});
