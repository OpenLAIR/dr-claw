#!/usr/bin/env node
// Parse Playwright JSON reporter output + exit code files into a structured report.json
// No external dependencies — uses only Node.js builtins.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

function readExitCode(filePath) {
  try {
    return parseInt(readFileSync(filePath, 'utf8').trim(), 10);
  } catch {
    return -1; // file not found = unknown
  }
}

function readLog(filePath, maxLines = 50) {
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    if (lines.length > maxLines) {
      return lines.slice(-maxLines).join('\n');
    }
    return content;
  } catch {
    return '';
  }
}

function parsePlaywrightResults(jsonPath) {
  try {
    const raw = readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(raw);
    const failures = [];
    let total = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let durationMs = 0;

    function walkSuites(suites) {
      for (const suite of suites || []) {
        for (const spec of suite.specs || []) {
          for (const test of spec.tests || []) {
            for (const result of test.results || []) {
              total++;
              durationMs += result.duration || 0;

              if (result.status === 'passed' || result.status === 'expected') {
                passed++;
              } else if (result.status === 'skipped') {
                skipped++;
              } else {
                failed++;
                // Extract failure info
                const screenshot = (result.attachments || [])
                  .find(a => a.name === 'screenshot')?.path || null;

                failures.push({
                  title: spec.title || test.title || 'Unknown test',
                  file: spec.file || suite.file || 'unknown',
                  error: (result.errors || []).map(e =>
                    e.message || e.value || String(e)
                  ).join('\n').slice(0, 1000),
                  screenshot,
                  duration: result.duration || 0,
                });
              }
            }
          }
        }
        // Recurse into nested suites
        if (suite.suites) {
          walkSuites(suite.suites);
        }
      }
    }

    walkSuites(data.suites);

    // Handle top-level errors (e.g., config errors)
    const topErrors = (data.errors || []).map(e =>
      typeof e === 'string' ? e : (e.message || JSON.stringify(e))
    );
    if (topErrors.length > 0 && total === 0) {
      failed = 1;
      total = 1;
      failures.push({
        title: 'Playwright Configuration Error',
        file: 'playwright.config.ts',
        error: topErrors.join('\n').slice(0, 1000),
        screenshot: null,
        duration: 0,
      });
    }

    return { total, passed, failed, skipped, durationMs, failures };
  } catch (err) {
    return {
      total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0,
      failures: [{
        title: 'Result Parse Error',
        file: 'parse-results.js',
        error: `Failed to parse Playwright JSON: ${err.message}`,
        screenshot: null,
        duration: 0,
      }],
    };
  }
}

function main() {
  const args = process.argv.slice(2);
  const workDir = args.find((_, i) => args[i - 1] === '--work-dir') || '/tmp/auto-pr-review';
  const prNumber = args.find((_, i) => args[i - 1] === '--pr-number') || '0';
  const prSha = args.find((_, i) => args[i - 1] === '--pr-sha') || 'unknown';
  const outputPath = args.find((_, i) => args[i - 1] === '--output') || join(workDir, 'report.json');

  // Read exit codes
  const npmExit = readExitCode(join(workDir, 'npm-ci.exit'));
  const typecheckExit = readExitCode(join(workDir, 'typecheck.exit'));
  const buildExit = readExitCode(join(workDir, 'build.exit'));
  const playwrightExit = readExitCode(join(workDir, 'playwright.exit'));

  // Read changed files
  let changedFiles = [];
  const changedFilesPath = join(workDir, 'changed-files.txt');
  if (existsSync(changedFilesPath)) {
    changedFiles = readFileSync(changedFilesPath, 'utf8').trim().split('\n').filter(Boolean);
  }

  // Read PR type
  let prType = 'backend';
  const prTypePath = join(workDir, 'pr-type.txt');
  if (existsSync(prTypePath)) {
    prType = readFileSync(prTypePath, 'utf8').trim();
  }

  // Parse Playwright results
  const e2e = parsePlaywrightResults(join(workDir, 'results.json'));

  // Extract typecheck errors (last few lines of log if failed)
  let typecheckErrors = [];
  if (typecheckExit !== 0) {
    const log = readLog(join(workDir, 'typecheck.log'), 20);
    typecheckErrors = log.split('\n').filter(l => l.includes('error TS')).slice(0, 10);
  }

  // Build report
  const report = {
    prNumber: parseInt(prNumber, 10),
    prSha,
    prType,
    timestamp: new Date().toISOString(),
    changedFiles,
    steps: {
      install: {
        status: npmExit === 0 ? 'pass' : 'fail',
        exitCode: npmExit,
      },
      typecheck: {
        status: typecheckExit === 0 ? 'pass' : 'fail',
        exitCode: typecheckExit,
        errors: typecheckErrors,
      },
      build: {
        status: buildExit === 0 ? 'pass' : 'fail',
        exitCode: buildExit,
      },
      e2e: {
        status: e2e.failed > 0 || playwrightExit !== 0 ? 'fail' : 'pass',
        exitCode: playwrightExit,
        total: e2e.total,
        passed: e2e.passed,
        failed: e2e.failed,
        skipped: e2e.skipped,
        durationMs: e2e.durationMs,
        failures: e2e.failures,
      },
    },
    verdict: determineVerdict(npmExit, typecheckExit, buildExit, e2e),
  };

  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`Report written to ${outputPath}`);
  console.log(`Verdict: ${report.verdict}`);
}

function determineVerdict(npmExit, typecheckExit, buildExit, e2e) {
  // Critical: npm ci or build fails entirely
  if (npmExit !== 0 || buildExit !== 0) {
    return 'critical_failure';
  }
  // Issues: typecheck fails or E2E failures
  if (typecheckExit !== 0 || e2e.failed > 0) {
    return 'issues_found';
  }
  return 'all_clear';
}

main();
