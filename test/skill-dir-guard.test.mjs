import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Test the EISDIR error detection logic added to the tool_result handler.
 * We test the pattern matching directly since the handler is deeply embedded
 * in the WebSocket stream processing.
 */

function applySkillDirGuard(isError, rawToolName, outputText) {
  // Same logic as in gemini-cli.js tool_result handler
  if (isError && rawToolName === 'run_shell_command' && /is a directory|EISDIR/i.test(outputText)) {
    return outputText + '\n\nThis path is a skill directory, not an executable. Use activate_skill to invoke it, or read its SKILL.md for instructions.';
  }
  return outputText;
}

test('EISDIR error from run_shell_command gets guidance appended', () => {
  const result = applySkillDirGuard(
    true,
    'run_shell_command',
    'bash: .gemini/skills/inno-pipeline-planner: Is a directory'
  );
  assert.ok(result.includes('Use activate_skill'), 'Should include activate_skill guidance');
  assert.ok(result.includes('SKILL.md'), 'Should mention SKILL.md');
});

test('EISDIR variant with different casing is detected', () => {
  const result = applySkillDirGuard(
    true,
    'run_shell_command',
    'Error: EISDIR: illegal operation on a directory'
  );
  assert.ok(result.includes('Use activate_skill'));
});

test('Non-EISDIR errors are not modified', () => {
  const original = 'command not found: foo';
  const result = applySkillDirGuard(true, 'run_shell_command', original);
  assert.equal(result, original, 'Non-EISDIR errors should pass through unchanged');
});

test('Non-error results are not modified', () => {
  const original = 'success: is a directory listing';
  const result = applySkillDirGuard(false, 'run_shell_command', original);
  assert.equal(result, original, 'Non-error results should pass through unchanged');
});

test('Other tool errors are not modified', () => {
  const original = 'Is a directory';
  const result = applySkillDirGuard(true, 'read_file', original);
  assert.equal(result, original, 'Only run_shell_command errors should be enriched');
});
