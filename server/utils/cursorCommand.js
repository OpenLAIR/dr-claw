import { isCommandAvailable, getCliCommandCandidates } from './cliResolution.js';

let cachedCursorCommand = null;

function getCursorCommandCandidates() {
  return getCliCommandCandidates({
    envVarName: 'CURSOR_CLI_PATH',
    defaultCommands: ['cursor-agent', 'agent']
  });
}

function resolveCursorCliCommand(options = {}) {
  const { refresh = false } = options;

  if (!refresh && cachedCursorCommand) {
    return cachedCursorCommand;
  }

  const candidates = getCursorCommandCandidates();

  for (const candidate of candidates) {
    if (isCommandAvailable(candidate)) {
      cachedCursorCommand = candidate;
      return candidate;
    }
  }

  return null;
}

function isCursorLoginCommand(command = '') {
  return /^\s*(cursor-agent|agent)\s+login(?:\s|$)/.test(command);
}

function isGeminiLoginCommand(command = '') {
  return /^\s*gemini\s+login(?:\s|$)/.test(command);
}

function normalizeCursorLoginCommand(command = '') {
  if (isGeminiLoginCommand(command)) {
    return command;
  }

  if (!isCursorLoginCommand(command)) {
    return command;
  }

  const resolvedCommand = resolveCursorCliCommand();
  if (!resolvedCommand) {
    return command;
  }

  return command.replace(/^\s*(cursor-agent|agent)\b/, resolvedCommand);
}

export {
  resolveCursorCliCommand,
  isCursorLoginCommand,
  isGeminiLoginCommand,
  normalizeCursorLoginCommand
};
