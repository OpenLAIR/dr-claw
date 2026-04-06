/**
 * Centralized Model Definitions
 * Single source of truth for all supported AI models
 */

/**
 * Claude (Anthropic) Models
 *
 * Note: Claude uses two different formats:
 * - SDK format ('sonnet', 'opus') - used by the UI and claude-sdk.js
 * - API format ('claude-sonnet-4.5') - used by slash commands for display
 */
export const CLAUDE_MODELS = {
  // Models in SDK format (what the actual SDK accepts)
  OPTIONS: [
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'opus', label: 'Opus' },
    { value: 'haiku', label: 'Haiku' },
    { value: 'opusplan', label: 'Opus (Plan Mode Only)' },
    { value: 'sonnet[1m]', label: 'Sonnet [1M]' },
    { value: 'claude-opus-4-6', label: 'Opus 4.6' }
  ],

  DEFAULT: (typeof process !== 'undefined' && process.env?.ANTHROPIC_MODEL) || 'claude-opus-4-6'
};

/**
 * Cursor Models
 */
export const CURSOR_MODELS = {
  OPTIONS: [
    { value: 'gpt-5.2-high', label: 'GPT-5.2 High' },
    { value: 'gemini-3-pro', label: 'Gemini 3 Pro' },
    { value: 'opus-4.5-thinking', label: 'Claude 4.5 Opus (Thinking)' },
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'gpt-5.1', label: 'GPT-5.1' },
    { value: 'gpt-5.1-high', label: 'GPT-5.1 High' },
    { value: 'composer-1', label: 'Composer 1' },
    { value: 'auto', label: 'Auto' },
    { value: 'sonnet-4.5', label: 'Claude 4.5 Sonnet' },
    { value: 'sonnet-4.5-thinking', label: 'Claude 4.5 Sonnet (Thinking)' },
    { value: 'opus-4.5', label: 'Claude 4.5 Opus' },
    { value: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
    { value: 'gpt-5.1-codex-high', label: 'GPT-5.1 Codex High' },
    { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
    { value: 'gpt-5.1-codex-max-high', label: 'GPT-5.1 Codex Max High' },
    { value: 'opus-4.1', label: 'Claude 4.1 Opus' },
    { value: 'grok', label: 'Grok' }
  ],

  DEFAULT: 'gpt-5'
};

/**
 * Codex (OpenAI) Models
 */
export const CODEX_MODELS = {
  OPTIONS: [
    { value: 'gpt-5.4', label: 'GPT-5.4' },
    { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
    { value: 'o3', label: 'O3' },
    { value: 'o4-mini', label: 'O4-mini' }
  ],

  DEFAULT: 'gpt-5.4'
};

/**
 * OpenRouter Models
 * Users can also type any model slug from https://openrouter.ai/models
 */
export const OPENROUTER_MODELS = {
  OPTIONS: [
    // Anthropic
    { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (Anthropic)' },
    { value: 'anthropic/claude-opus-4', label: 'Claude Opus 4 (Anthropic)' },
    { value: 'anthropic/claude-haiku-3.5', label: 'Claude 3.5 Haiku (Anthropic)' },
    // OpenAI
    { value: 'openai/gpt-5', label: 'GPT-5 (OpenAI)' },
    { value: 'openai/gpt-4.1', label: 'GPT-4.1 (OpenAI)' },
    { value: 'openai/gpt-4.1-mini', label: 'GPT-4.1 Mini (OpenAI)' },
    { value: 'openai/o3', label: 'O3 (OpenAI)' },
    { value: 'openai/o4-mini', label: 'O4 Mini (OpenAI)' },
    // Google
    { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro (Google)' },
    { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (Google)' },
    // DeepSeek
    { value: 'deepseek/deepseek-r1', label: 'DeepSeek R1' },
    { value: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek V3 0324' },
    // Meta
    { value: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick (Meta)' },
    { value: 'meta-llama/llama-4-scout', label: 'Llama 4 Scout (Meta)' },
    // Mistral
    { value: 'mistralai/mistral-large', label: 'Mistral Large' },
    { value: 'mistralai/codestral', label: 'Codestral (Mistral)' },
    // Qwen
    { value: 'qwen/qwen3-235b-a22b', label: 'Qwen3 235B' },
    { value: 'qwen/qwen3-32b', label: 'Qwen3 32B' },
    // xAI
    { value: 'x-ai/grok-3', label: 'Grok 3 (xAI)' },
    { value: 'x-ai/grok-3-mini', label: 'Grok 3 Mini (xAI)' },
    // Cohere
    { value: 'cohere/command-a', label: 'Command A (Cohere)' },
  ],

  ALLOWS_CUSTOM: true,

  DEFAULT: (typeof process !== 'undefined' && process.env?.OPENROUTER_MODEL) || 'anthropic/claude-sonnet-4'
};

/**
 * Local GPU Models (open-source models for self-hosted deployment)
 */
export const LOCAL_MODELS = {
  OPTIONS: [],

  IS_LOCAL: true,

  DEFAULT: ''
};

/**
 * Gemini (Google) Models
 */
export const GEMINI_MODELS = {
  OPTIONS: [
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
    { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite Preview' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' }
  ],

  DEFAULT: 'gemini-2.5-flash'
};
