/**
 * Safe child_process.spawn wrapper — shell: false, bounded output.
 *
 * When stdout exceeds maxBuffer the child is killed via SIGTERM.  If the
 * child is terminated by our SIGTERM (signal === 'SIGTERM'), the promise
 * **resolves** with the truncated data and `truncated: true`.  If the child
 * exits non-zero for any other reason, the promise rejects normally.
 */

import { spawn } from 'child_process';

/**
 * @param {string}   command
 * @param {string[]} args
 * @param {object}   [options]
 * @param {number}   [options.maxBuffer=1048576]  Max JS string length to keep (default ~1M chars)
 * @returns {Promise<{stdout: string, stderr: string, truncated: boolean}>}
 */
export default function spawnAsync(command, args, options = {}) {
  const maxBuffer = options.maxBuffer || 1024 * 1024; // 1 MB default
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let truncated = false;

    child.stdout.on('data', (data) => {
      if (!truncated) {
        stdout += data.toString();
        if (stdout.length > maxBuffer) {
          stdout = stdout.slice(0, maxBuffer);
          // Trim the last partial line so callers never see a phantom entry
          const lastNewline = stdout.lastIndexOf('\n');
          if (lastNewline > 0) stdout = stdout.slice(0, lastNewline);
          truncated = true;
          child.kill('SIGTERM');
        }
      }
    });

    child.stderr.on('data', (data) => {
      if (stderr.length < maxBuffer) {
        stderr += data.toString();
        if (stderr.length > maxBuffer) {
          stderr = stderr.slice(0, maxBuffer);
        }
      }
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr, truncated });
        return;
      }

      // We killed the child ourselves because stdout exceeded maxBuffer.
      // Resolve with the truncated data so callers get partial results.
      if (truncated && signal === 'SIGTERM') {
        resolve({ stdout, stderr, truncated });
        return;
      }

      const error = new Error(`Command failed: ${command} ${args.join(' ')}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}
