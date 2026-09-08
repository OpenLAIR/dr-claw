type WorkspaceModule = typeof import('./AuthenticatedWorkspace');

let workspacePromise: Promise<WorkspaceModule> | undefined;

export function loadAuthenticatedWorkspace(): Promise<WorkspaceModule> {
  // Share login preloading with React.lazy, but never cache a failed attempt.
  workspacePromise ??= import('./AuthenticatedWorkspace').catch((error) => {
    workspacePromise = undefined;
    throw error;
  });
  return workspacePromise;
}

export function preloadAuthenticatedWorkspace(): void {
  // Importing only evaluates modules; providers still mount under ProtectedRoute.
  // A speculative failure must not break login or prevent lazyWithRetry retrying.
  void loadAuthenticatedWorkspace().catch(() => {});
}
