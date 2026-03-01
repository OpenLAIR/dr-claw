#!/usr/bin/env node
// Format a static PR review comment from report.json + comment-template.md
// Used as fallback when cliwrapper is unavailable.
// No external dependencies.

import { readFileSync, writeFileSync } from 'fs';

function main() {
  const args = process.argv.slice(2);
  const getArg = (flag) => args.find((_, i) => args[i - 1] === flag) || '';

  const reportPath = getArg('--report');
  const templatePath = getArg('--template');
  const prNumber = getArg('--pr-number') || '0';
  const prSha = getArg('--pr-sha') || 'unknown';
  const outputPath = getArg('--output');

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  let template = readFileSync(templatePath, 'utf8');

  const icon = (status) => status === 'pass' ? '\\u2705' : '\\u274C';
  const verdictMap = {
    all_clear: { icon: '\\u2705', text: 'All Clear — no issues detected' },
    issues_found: { icon: '\\u26A0\\uFE0F', text: 'Issues Found — review failures below' },
    critical_failure: { icon: '\\u274C', text: 'Critical Failure — build or install broken' },
  };

  const verdict = verdictMap[report.verdict] || verdictMap.issues_found;
  const e2e = report.steps.e2e || {};

  // Build failures section
  let failuresSection = '';
  if (e2e.failures && e2e.failures.length > 0) {
    failuresSection = '### Failed Tests\n\n';
    for (const f of e2e.failures) {
      failuresSection += `<details>\n<summary>${icon('fail')} ${f.title} (${f.file})</summary>\n\n`;
      failuresSection += '```\n' + (f.error || 'No error details') + '\n```\n';
      if (f.screenshot) {
        failuresSection += `\nScreenshot: \`${f.screenshot}\`\n`;
      }
      failuresSection += '</details>\n\n';
    }
  }

  // Typecheck errors
  if (report.steps.typecheck?.errors?.length > 0) {
    failuresSection += '### TypeScript Errors\n\n```\n';
    failuresSection += report.steps.typecheck.errors.join('\n');
    failuresSection += '\n```\n\n';
  }

  // Replace template placeholders
  const replacements = {
    '{{PR_SHA}}': prSha,
    '{{PR_TYPE}}': report.prType || 'unknown',
    '{{TIMESTAMP}}': report.timestamp || new Date().toISOString(),
    '{{INSTALL_ICON}}': icon(report.steps.install?.status),
    '{{INSTALL_EXIT}}': String(report.steps.install?.exitCode ?? -1),
    '{{TYPECHECK_ICON}}': icon(report.steps.typecheck?.status),
    '{{TYPECHECK_EXIT}}': String(report.steps.typecheck?.exitCode ?? -1),
    '{{BUILD_ICON}}': icon(report.steps.build?.status),
    '{{BUILD_EXIT}}': String(report.steps.build?.exitCode ?? -1),
    '{{E2E_ICON}}': icon(e2e.status),
    '{{E2E_PASSED}}': String(e2e.passed ?? 0),
    '{{E2E_TOTAL}}': String(e2e.total ?? 0),
    '{{E2E_FAILED}}': String(e2e.failed ?? 0),
    '{{FAILURES_SECTION}}': failuresSection,
    '{{VERDICT_ICON}}': verdict.icon,
    '{{VERDICT_TEXT}}': verdict.text,
  };

  for (const [key, value] of Object.entries(replacements)) {
    template = template.replaceAll(key, value);
  }

  writeFileSync(outputPath, template);
  console.log(`Fallback comment written to ${outputPath}`);
}

main();
