import { describe, expect, it } from "vitest";

import {
  buildSessionScopeKey,
  isSessionScopeKeyTemporary,
  isTemporarySessionId,
  parseSessionScopeKey,
  scopeKeyMatchesScope,
} from "../sessionScope";
import { ALL_PROVIDERS, DEFAULT_PROVIDER } from "../providerPolicy";

describe("sessionScope", () => {
  it("builds and parses stable scope keys", () => {
    const scopeKey = buildSessionScopeKey("project-a", "codex", "session-1");
    expect(scopeKey).toBe("project-a::codex::session-1");

    expect(parseSessionScopeKey(scopeKey)).toEqual({
      projectName: "project-a",
      provider: "codex",
      sessionId: "session-1",
    });
  });

  it("normalizes provider and rejects cross-project or cross-provider matches", () => {
    const primaryProvider = ALL_PROVIDERS[0] || DEFAULT_PROVIDER;
    const alternateProvider = ALL_PROVIDERS.find(
      (provider) => provider !== primaryProvider,
    );
    const scopeKey = buildSessionScopeKey("project-a", primaryProvider, "same-id");

    expect(
      scopeKeyMatchesScope(scopeKey, "project-a", primaryProvider, "same-id"),
    ).toBe(true);
    expect(
      scopeKeyMatchesScope(scopeKey, "project-b", primaryProvider, "same-id"),
    ).toBe(false);

    if (alternateProvider) {
      expect(
        scopeKeyMatchesScope(scopeKey, "project-a", alternateProvider, "same-id"),
      ).toBe(false);
    }

    const fallbackScopeKey = buildSessionScopeKey("project-a", "UNKNOWN_PROVIDER", "same-id");
    expect(fallbackScopeKey).toBe(`project-a::${DEFAULT_PROVIDER}::same-id`);
  });

  it("treats same session id with different providers as different scopes", () => {
    const codexKey = buildSessionScopeKey("project-a", "codex", "shared-session");
    const claudeKey = buildSessionScopeKey("project-a", "claude", "shared-session");

    expect(codexKey).not.toBe(claudeKey);
    expect(
      scopeKeyMatchesScope(codexKey, "project-a", "codex", "shared-session"),
    ).toBe(true);
    expect(
      scopeKeyMatchesScope(codexKey, "project-a", "claude", "shared-session"),
    ).toBe(false);
  });

  it("supports session ids containing the scope separator", () => {
    const scopeKey = buildSessionScopeKey(
      "project-a",
      "codex",
      "session::with::separator",
    );

    expect(parseSessionScopeKey(scopeKey)).toEqual({
      projectName: "project-a",
      provider: "codex",
      sessionId: "session::with::separator",
    });
    expect(
      scopeKeyMatchesScope(
        scopeKey,
        "project-a",
        "codex",
        "session::with::separator",
      ),
    ).toBe(true);
  });

  it("returns false when scope fields are empty or undefined", () => {
    const scopeKey = buildSessionScopeKey("project-a", "codex", "session-1");

    expect(scopeKeyMatchesScope(scopeKey, "", "codex", "session-1")).toBe(false);
    expect(scopeKeyMatchesScope(scopeKey, undefined, "codex", "session-1")).toBe(false);
    expect(scopeKeyMatchesScope(scopeKey, "project-a", "codex", "")).toBe(false);
    expect(scopeKeyMatchesScope(scopeKey, "project-a", "codex", undefined)).toBe(false);
  });

  it("treats both new-session and temp session ids as temporary", () => {
    expect(isTemporarySessionId("new-session-1")).toBe(true);
    expect(isTemporarySessionId("temp-1")).toBe(true);
    expect(isTemporarySessionId("sess-1")).toBe(false);

    expect(isSessionScopeKeyTemporary("project-a::codex::new-session-2")).toBe(true);
    expect(isSessionScopeKeyTemporary("project-a::codex::temp-2")).toBe(true);
    expect(isSessionScopeKeyTemporary("project-a::codex::sess-2")).toBe(false);
  });
});
