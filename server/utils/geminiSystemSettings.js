/**
 * Build the system-settings override Dr. Claw hands to the Gemini CLI via
 * GEMINI_CLI_SYSTEM_SETTINGS_PATH for one session.
 *
 * Two concerns live here:
 *
 * - Thinking: the CLI has no flag for a thinking level or budget, so the
 *   session model is wrapped in a custom alias whose generateContentConfig
 *   carries the thinking config.
 * - Auth: since 2026-06-18 the Gemini CLI no longer serves individual Google
 *   accounts (OAuth) and exits with IneligibleTierError, pointing users at
 *   Antigravity. A user who has saved an API key in Dr. Claw can still use the
 *   CLI, but only if the CLI is told to use the key: with `oauth-personal`
 *   still selected in their own settings.json the key in the environment is
 *   ignored. System settings outrank user settings, so select the key here.
 *
 * Returns null when there is nothing to override.
 */
export const GEMINI_SESSION_MODEL_ALIAS = '__dr_claw_session_model';

export function buildGeminiSystemSettingsOverride({ model, thinkingConfig, apiKey } = {}) {
  const override = {};
  let cliModel = null;

  if (model && thinkingConfig) {
    cliModel = GEMINI_SESSION_MODEL_ALIAS;
    override.modelConfigs = {
      customAliases: {
        [GEMINI_SESSION_MODEL_ALIAS]: {
          extends: model,
          modelConfig: {
            model,
            generateContentConfig: { thinkingConfig },
          },
        },
      },
    };
  }

  if (apiKey) {
    override.security = { auth: { selectedType: 'gemini-api-key' } };
  }

  if (Object.keys(override).length === 0) {
    return null;
  }

  return { override, cliModel };
}
