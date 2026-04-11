import { describe, expect, it } from "vitest";

import {
  buildSessionScopeKey,
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
});
