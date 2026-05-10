import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { promises as fs } from 'fs';
import { extractProjectDirectory } from '../projects.js';
import { queryClaudeSDK } from '../claude-sdk.js';
import { spawnCursor } from '../cursor-cli.js';
import { safePath } from '../utils/safePath.js';

const router = express.Router();

function spawnAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
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

// Helper function to get the actual project path from the encoded project name
async function getActualProjectPath(projectName) {
  try {
    return await extractProjectDirectory(projectName);
  } catch (error) {
    console.error(`Error extracting project directory for ${projectName}:`, error);
    // Fallback to the old method
    return projectName.replace(/-/g, '/');
  }
}

// Helper function to strip git diff headers
function stripDiffHeaders(diff) {
  if (!diff) return '';

  const lines = diff.split('\n');
  const filteredLines = [];
  let startIncluding = false;

  for (const line of lines) {
    // Skip all header lines including diff --git, index, file mode, and --- / +++ file paths
    if (line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('new file mode') ||
        line.startsWith('deleted file mode') ||
        line.startsWith('---') ||
        line.startsWith('+++')) {
      continue;
    }

    // Start including lines from @@ hunk headers onwards
    if (line.startsWith('@@') || startIncluding) {
      startIncluding = true;
      filteredLines.push(line);
    }
  }

  return filteredLines.join('\n');
}

// Helper function to validate git repository
async function validateGitRepository(projectPath) {
  try {
    // Check if directory exists
    await fs.access(projectPath);
  } catch {
    throw new Error(`Project path not found: ${projectPath}`);
  }

  try {
    // Allow any directory that is inside a work tree (repo root or nested folder).
    const { stdout: insideWorkTreeOutput } = await spawnAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectPath });
    const isInsideWorkTree = insideWorkTreeOutput.trim() === 'true';
    if (!isInsideWorkTree) {
      throw new Error('Not inside a git work tree');
    }

    // Ensure git can resolve the repository root for this directory.
    await spawnAsync('git', ['rev-parse', '--show-toplevel'], { cwd: projectPath });
  } catch {
    throw new Error('Not a git repository. This directory does not contain a .git folder. Initialize a git repository with "git init" to use source control features.');
  }
}

async function initializeGitRepository(projectPath) {
  try {
    await spawnAsync('git', ['init', '-b', 'main'], { cwd: projectPath });
  } catch (error) {
    const stderr = String(error.stderr || '').toLowerCase();
    const stdout = String(error.stdout || '').toLowerCase();
    const output = `${stdout}\n${stderr}`;

    // Older git versions do not support `git init -b`.
    if (output.includes('unknown switch') || output.includes('invalid option') || output.includes('usage: git init')) {
      await spawnAsync('git', ['init'], { cwd: projectPath });

      try {
        await spawnAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: projectPath });
      } catch (symbolicRefError) {
        console.warn('Failed to rename default branch to main after git init:', symbolicRefError);
      }

      return;
    }

    throw error;
  }
}

function isGitRepositoryMissingError(message = '') {
  const msg = String(message || '').toLowerCase();
  return msg.includes('not a git repository') || 
         msg.includes('not a git work tree') ||
         msg.includes('project directory is not a git repository');
}

function getGitErrorText(error) {
  return [
    String(error?.message || ''),
    String(error?.stdout || ''),
    String(error?.stderr || ''),
  ].join('\n');
}

async function getCurrentBranchName(projectPath, fallback = 'main') {
  try {
    const { stdout } = await spawnAsync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: projectPath });
    return stdout.trim() || fallback;
  } catch {
    return fallback;
  }
}

async function repositoryHasCommits(projectPath) {
  try {
    await spawnAsync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: projectPath });
    return true;
  } catch {
    return false;
  }
}

async function getFileStatusOutput(projectPath, file) {
  const { stdout } = await spawnAsync('git', ['status', '--porcelain', '--', file], { cwd: projectPath });
  return stdout;
}

async function getHeadFileContent(projectPath, file) {
  const { stdout } = await spawnAsync('git', ['show', `HEAD:${file}`], { cwd: projectPath });
  return stdout;
}

async function getUnstagedDiff(projectPath, file) {
  const { stdout } = await spawnAsync('git', ['diff', '--', file], { cwd: projectPath });
  return stdout;
}

async function getStagedDiff(projectPath, file) {
  const { stdout } = await spawnAsync('git', ['diff', '--cached', '--', file], { cwd: projectPath });
  return stdout;
}

async function getDiffAgainstHead(projectPath, file) {
  const { stdout } = await spawnAsync('git', ['diff', 'HEAD', '--', file], { cwd: projectPath });
  return stdout;
}

async function checkoutBranch(projectPath, branch) {
  const { stdout } = await spawnAsync('git', ['checkout', branch], { cwd: projectPath });
  return stdout;
}

async function createBranchAndCheckout(projectPath, branch) {
  const { stdout } = await spawnAsync('git', ['checkout', '-b', branch], { cwd: projectPath });
  return stdout;
}

async function commitFiles(projectPath, message) {
  const { stdout } = await spawnAsync('git', ['commit', '-m', message], { cwd: projectPath });
  return stdout;
}

async function getUpstreamBranch(projectPath, branch) {
  const { stdout } = await spawnAsync('git', ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { cwd: projectPath });
  return stdout.trim();
}

async function pushWithUpstream(projectPath, remoteName, branch) {
  const { stdout } = await spawnAsync('git', ['push', '--set-upstream', remoteName, branch], { cwd: projectPath });
  return stdout;
}

async function fetchRemote(projectPath, remoteName) {
  const { stdout } = await spawnAsync('git', ['fetch', remoteName], { cwd: projectPath });
  return stdout;
}

async function pullRemoteBranch(projectPath, remoteName, remoteBranch) {
  const { stdout } = await spawnAsync('git', ['pull', remoteName, remoteBranch], { cwd: projectPath });
  return stdout;
}

async function pushRemoteBranch(projectPath, remoteName, remoteBranch) {
  const { stdout } = await spawnAsync('git', ['push', remoteName, remoteBranch], { cwd: projectPath });
  return stdout;
}

async function getRemoteTrackingCounts(projectPath, trackingBranch) {
  const { stdout } = await spawnAsync('git', ['rev-list', '--count', '--left-right', `${trackingBranch}...HEAD`], { cwd: projectPath });
  return stdout;
}

async function getCurrentHeadBranch(projectPath) {
  const { stdout } = await spawnAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectPath });
  return stdout.trim();
}

async function listGitRemotes(projectPath) {
  const { stdout } = await spawnAsync('git', ['remote'], { cwd: projectPath });
  return stdout.trim().split('\n').filter(r => r.trim());
}

// Get git status for a project
router.get('/status', async (req, res) => {
  const { project } = req.query;

  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);

    // Validate git repository
    await validateGitRepository(projectPath);

    // Get current branch - handle case where there are no commits yet
    let branch = 'main';
    let hasCommits = true;
    try {
      branch = await getCurrentBranchName(projectPath, 'main');
      hasCommits = await repositoryHasCommits(projectPath);
    } catch (error) {
      throw error;
    }

    // Get git status
    const { stdout: statusOutput } = await spawnAsync('git', ['status', '--porcelain'], { cwd: projectPath });

    const modified = [];
    const added = [];
    const deleted = [];
    const untracked = [];

    statusOutput.split('\n').forEach(line => {
      if (!line.trim()) return;

      const status = line.substring(0, 2);
      const file = line.substring(3);

      if (status === 'M ' || status === ' M' || status === 'MM') {
        modified.push(file);
      } else if (status === 'A ' || status === 'AM') {
        added.push(file);
      } else if (status === 'D ' || status === ' D') {
        deleted.push(file);
      } else if (status === '??') {
        untracked.push(file);
      }
    });

    res.json({
      branch,
      hasCommits,
      modified,
      added,
      deleted,
      untracked
    });
  } catch (error) {
    const isRepositoryMissing = isGitRepositoryMissingError(error.message);
    if (!isRepositoryMissing) {
      console.error('Git status error:', error);
    }
    res.json({
      error: isRepositoryMissing ? error.message : 'Git operation failed',
      details: isRepositoryMissing ? error.message : `Failed to get git status: ${error.message}`
    });
  }
});

// Get diff for a specific file
router.get('/diff', async (req, res) => {
  const { project, file } = req.query;
  
  if (!project || !file) {
    return res.status(400).json({ error: 'Project name and file path are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    
    // Validate git repository
    await validateGitRepository(projectPath);
    
    // Check if file is untracked or deleted
    const statusOutput = await getFileStatusOutput(projectPath, file);
    const isUntracked = statusOutput.startsWith('??');
    const isDeleted = statusOutput.trim().startsWith('D ') || statusOutput.trim().startsWith(' D');

    let diff;
    if (isUntracked) {
      // For untracked files, show the entire file content as additions
      const filePath = path.join(projectPath, file);
      const stats = await fs.stat(filePath);

      if (stats.isDirectory()) {
        // For directories, show a simple message
        diff = `Directory: ${file}\n(Cannot show diff for directories)`;
      } else {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const lines = fileContent.split('\n');
        diff = `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n` +
               lines.map(line => `+${line}`).join('\n');
      }
    } else if (isDeleted) {
      // For deleted files, show the entire file content from HEAD as deletions
      const fileContent = await getHeadFileContent(projectPath, file);
      const lines = fileContent.split('\n');
      diff = `--- a/${file}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n` +
             lines.map(line => `-${line}`).join('\n');
    } else {
      // Get diff for tracked files
      // First check for unstaged changes (working tree vs index)
      const unstagedDiff = await getUnstagedDiff(projectPath, file);

      if (unstagedDiff) {
        // Show unstaged changes if they exist
        diff = stripDiffHeaders(unstagedDiff);
      } else {
        // If no unstaged changes, check for staged changes (index vs HEAD)
        const stagedDiff = await getStagedDiff(projectPath, file);
        diff = stripDiffHeaders(stagedDiff) || '';
      }
    }

    res.json({ diff });
  } catch (error) {
    console.error('Git diff error:', error);
    res.json({ error: error.message });
  }
});

// Get file content with diff information for CodeEditor
router.get('/file-with-diff', async (req, res) => {
  const { project, file } = req.query;

  if (!project || !file) {
    return res.status(400).json({ error: 'Project name and file path are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);

    // Validate git repository
    await validateGitRepository(projectPath);

    // Check file status
    const statusOutput = await getFileStatusOutput(projectPath, file);
    const isUntracked = statusOutput.startsWith('??');
    const isDeleted = statusOutput.trim().startsWith('D ') || statusOutput.trim().startsWith(' D');

    let currentContent = '';
    let oldContent = '';

    if (isDeleted) {
      // For deleted files, get content from HEAD
      const headContent = await getHeadFileContent(projectPath, file);
      oldContent = headContent;
      currentContent = headContent; // Show the deleted content in editor
    } else {
      // Get current file content
      const filePath = path.join(projectPath, file);
      const stats = await fs.stat(filePath);

      if (stats.isDirectory()) {
        // Cannot show content for directories
        return res.status(400).json({ error: 'Cannot show diff for directories' });
      }

      currentContent = await fs.readFile(filePath, 'utf-8');

      if (!isUntracked) {
        // Get the old content from HEAD for tracked files
        try {
          const headContent = await getHeadFileContent(projectPath, file);
          oldContent = headContent;
        } catch (error) {
          // File might be newly added to git (staged but not committed)
          oldContent = '';
        }
      }
    }

    res.json({
      currentContent,
      oldContent,
      isDeleted,
      isUntracked
    });
  } catch (error) {
    console.error('Git file-with-diff error:', error);
    res.json({ error: error.message });
  }
});

// Initialize git repository for a project
router.post('/init', async (req, res) => {
  const { project } = req.body;

  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);

    try {
      await validateGitRepository(projectPath);
      return res.status(400).json({ error: 'Git is already enabled for this project.' });
    } catch (error) {
      if (!isGitRepositoryMissingError(error.message)) {
        throw error;
      }
    }

    await initializeGitRepository(projectPath);

    res.json({
      success: true,
      message: 'Git has been enabled for this project.'
    });
  } catch (error) {
    console.error('Git init error:', error);
    res.status(500).json({ error: error.message || 'Failed to initialize git repository' });
  }
});

// Create initial commit
router.post('/initial-commit', async (req, res) => {
  const { project } = req.body;

  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);

    // Validate git repository
    await validateGitRepository(projectPath);

    // Check if there are already commits
    if (await repositoryHasCommits(projectPath)) {
      return res.status(400).json({ error: 'Repository already has commits. Use regular commit instead.' });
    }

    // Add all files
    await spawnAsync('git', ['add', '.'], { cwd: projectPath });

    // Create initial commit
    const stdout = await commitFiles(projectPath, 'Initial commit');

    res.json({ success: true, output: stdout, message: 'Initial commit created successfully' });
  } catch (error) {
    console.error('Git initial commit error:', error);

    // Handle the case where there's nothing to commit
    const output = String(error.stdout || '') + String(error.stderr || '');
    if (output.toLowerCase().includes('nothing to commit')) {
      return res.status(400).json({
        error: 'Nothing to commit',
        details: 'No files found in the repository. Add some files first.'
      });
    }

    res.status(500).json({ error: error.message });
  }
});

// Commit changes
router.post('/commit', async (req, res) => {
  const { project, message, files } = req.body;
  
  if (!project || !message || !files || files.length === 0) {
    return res.status(400).json({ error: 'Project name, commit message, and files are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    
    // Validate git repository
    await validateGitRepository(projectPath);
    
    // Stage selected files
    for (const file of files) {
      await spawnAsync('git', ['add', '--', file], { cwd: projectPath });
    }
    
    // Commit with message
    const stdout = await commitFiles(projectPath, message);
    
    res.json({ success: true, output: stdout });
  } catch (error) {
    console.error('Git commit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get list of branches
router.get('/branches', async (req, res) => {
  const { project } = req.query;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    
    // Validate git repository
    await validateGitRepository(projectPath);

    if (!(await repositoryHasCommits(projectPath))) {
      return res.json({ branches: [await getCurrentBranchName(projectPath, 'main')] });
    }
    
    // Get all branches
    const { stdout } = await spawnAsync('git', ['branch', '-a'], { cwd: projectPath });
    
    // Parse branches
    const branches = stdout
      .split('\n')
      .map(branch => branch.trim())
      .filter(branch => branch && !branch.includes('->')) // Remove empty lines and HEAD pointer
      .map(branch => {
        // Remove asterisk from current branch
        if (branch.startsWith('* ')) {
          return branch.substring(2);
        }
        // Remove remotes/ prefix
        if (branch.startsWith('remotes/origin/')) {
          return branch.substring(15);
        }
        return branch;
      })
      .filter((branch, index, self) => self.indexOf(branch) === index); // Remove duplicates
    
    res.json({ branches });
  } catch (error) {
    if (!isGitRepositoryMissingError(error.message)) {
      console.error('Git branches error:', error);
    }
    res.json({ error: error.message });
  }
});

// Checkout branch
router.post('/checkout', async (req, res) => {
  const { project, branch } = req.body;
  
  if (!project || !branch) {
    return res.status(400).json({ error: 'Project name and branch are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    
    // Checkout the branch
    const stdout = await checkoutBranch(projectPath, branch);
    
    res.json({ success: true, output: stdout });
  } catch (error) {
    console.error('Git checkout error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new branch
router.post('/create-branch', async (req, res) => {
  const { project, branch } = req.body;
  
  if (!project || !branch) {
    return res.status(400).json({ error: 'Project name and branch name are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    
    // Create and checkout new branch
    const stdout = await createBranchAndCheckout(projectPath, branch);
    
    res.json({ success: true, output: stdout });
  } catch (error) {
    console.error('Git create branch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get recent commits
router.get('/commits', async (req, res) => {
  const { project, limit = 10 } = req.query;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);
    const parsedLimit = Number.parseInt(String(limit), 10);
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 10;
    
    // Get commit log with stats
    const { stdout } = await spawnAsync(
      'git',
      ['log', '--pretty=format:%H|%an|%ae|%ad|%s', '--date=relative', '-n', String(safeLimit)],
      { cwd: projectPath },
    );
    
    const commits = stdout
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [hash, author, email, date, ...messageParts] = line.split('|');
        return {
          hash,
          author,
          email,
          date,
          message: messageParts.join('|')
        };
      });
    
    // Get stats for each commit
    for (const commit of commits) {
      try {
        const { stdout: stats } = await spawnAsync(
          'git', ['show', '--stat', '--format=', commit.hash],
          { cwd: projectPath }
        );
        commit.stats = stats.trim().split('\n').pop(); // Get the summary line
      } catch (error) {
        commit.stats = '';
      }
    }
    
    res.json({ commits });
  } catch (error) {
    console.error('Git commits error:', error);
    res.json({ error: error.message });
  }
});

// Get diff for a specific commit
router.get('/commit-diff', async (req, res) => {
  const { project, commit } = req.query;
  
  if (!project || !commit) {
    return res.status(400).json({ error: 'Project name and commit hash are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    
    // Get diff for the commit
    const { stdout } = await spawnAsync(
      'git', ['show', commit],
      { cwd: projectPath }
    );
    
    res.json({ diff: stdout });
  } catch (error) {
    console.error('Git commit diff error:', error);
    res.json({ error: error.message });
  }
});

// Generate commit message based on staged changes using AI
router.post('/generate-commit-message', async (req, res) => {
  const { project, files, provider = 'claude' } = req.body;

  if (!project || !files || files.length === 0) {
    return res.status(400).json({ error: 'Project name and files are required' });
  }

  // Validate provider
  if (!['claude', 'cursor'].includes(provider)) {
    return res.status(400).json({ error: 'provider must be "claude" or "cursor"' });
  }

  try {
    const projectPath = await getActualProjectPath(project);

    // Get diff for selected files
    let diffContext = '';
    for (const file of files) {
      try {
        const diffOutput = await getDiffAgainstHead(projectPath, file);
        if (diffOutput) {
          diffContext += `\n--- ${file} ---\n${diffOutput}`;
        }
      } catch (error) {
        console.error(`Error getting diff for ${file}:`, error);
      }
    }

    // If no diff found, might be untracked files
    if (!diffContext.trim()) {
      // Try to get content of untracked files
      for (const file of files) {
        try {
          const filePath = path.join(projectPath, file);
          const stats = await fs.stat(filePath);

          if (!stats.isDirectory()) {
            const content = await fs.readFile(filePath, 'utf-8');
            diffContext += `\n--- ${file} (new file) ---\n${content.substring(0, 1000)}\n`;
          } else {
            diffContext += `\n--- ${file} (new directory) ---\n`;
          }
        } catch (error) {
          console.error(`Error reading file ${file}:`, error);
        }
      }
    }

    // Generate commit message using AI
    const message = await generateCommitMessageWithAI(files, diffContext, provider, projectPath);

    res.json({ message });
  } catch (error) {
    console.error('Generate commit message error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generates a commit message using AI (Claude SDK or Cursor CLI)
 * @param {Array<string>} files - List of changed files
 * @param {string} diffContext - Git diff content
 * @param {string} provider - 'claude' or 'cursor'
 * @param {string} projectPath - Project directory path
 * @returns {Promise<string>} Generated commit message
 */
async function generateCommitMessageWithAI(files, diffContext, provider, projectPath) {
  // Create the prompt
  const prompt = `Generate a conventional commit message for these changes.

REQUIREMENTS:
- Format: type(scope): subject
- Include body explaining what changed and why
- Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore
- Subject under 50 chars, body wrapped at 72 chars
- Focus on user-facing changes, not implementation details
- Consider what's being added AND removed
- Return ONLY the commit message (no markdown, explanations, or code blocks)

FILES CHANGED:
${files.map(f => `- ${f}`).join('\n')}

DIFFS:
${diffContext.substring(0, 4000)}

Generate the commit message:`;

  try {
    // Create a simple writer that collects the response
    let responseText = '';
    const writer = {
      send: (data) => {
        try {
          const parsed = typeof data === 'string' ? JSON.parse(data) : data;
          console.log('🔍 Writer received message type:', parsed.type);

          // Handle different message formats from Claude SDK and Cursor CLI
          // Claude SDK sends: {type: 'claude-response', data: {message: {content: [...]}}}
          if (parsed.type === 'claude-response' && parsed.data) {
            const message = parsed.data.message || parsed.data;
            console.log('📦 Claude response message:', JSON.stringify(message, null, 2).substring(0, 500));
            if (message.content && Array.isArray(message.content)) {
              // Extract text from content array
              for (const item of message.content) {
                if (item.type === 'text' && item.text) {
                  console.log('✅ Extracted text chunk:', item.text.substring(0, 100));
                  responseText += item.text;
                }
              }
            }
          }
          // Cursor CLI sends: {type: 'cursor-output', output: '...'}
          else if (parsed.type === 'cursor-output' && parsed.output) {
            console.log('✅ Cursor output:', parsed.output.substring(0, 100));
            responseText += parsed.output;
          }
          // Also handle direct text messages
          else if (parsed.type === 'text' && parsed.text) {
            console.log('✅ Direct text:', parsed.text.substring(0, 100));
            responseText += parsed.text;
          }
        } catch (e) {
          // Ignore parse errors
          console.error('Error parsing writer data:', e);
        }
      },
      setSessionId: () => {}, // No-op for this use case
    };

    console.log('🚀 Calling AI agent with provider:', provider);
    console.log('📝 Prompt length:', prompt.length);

    // Call the appropriate agent
    if (provider === 'claude') {
      await queryClaudeSDK(prompt, {
        cwd: projectPath,
        permissionMode: 'bypassPermissions',
        model: 'sonnet'
      }, writer);
    } else if (provider === 'cursor') {
      await spawnCursor(prompt, {
        cwd: projectPath,
        skipPermissions: true
      }, writer);
    }

    console.log('📊 Total response text collected:', responseText.length, 'characters');
    console.log('📄 Response preview:', responseText.substring(0, 200));

    // Clean up the response
    const cleanedMessage = cleanCommitMessage(responseText);
    console.log('🧹 Cleaned message:', cleanedMessage.substring(0, 200));

    return cleanedMessage || 'chore: update files';
  } catch (error) {
    console.error('Error generating commit message with AI:', error);
    // Fallback to simple message
    return `chore: update ${files.length} file${files.length !== 1 ? 's' : ''}`;
  }
}

/**
 * Cleans the AI-generated commit message by removing markdown, code blocks, and extra formatting
 * @param {string} text - Raw AI response
 * @returns {string} Clean commit message
 */
function cleanCommitMessage(text) {
  if (!text || !text.trim()) {
    return '';
  }

  let cleaned = text.trim();

  // Remove markdown code blocks
  cleaned = cleaned.replace(/```[a-z]*\n/g, '');
  cleaned = cleaned.replace(/```/g, '');

  // Remove markdown headers
  cleaned = cleaned.replace(/^#+\s*/gm, '');

  // Remove leading/trailing quotes
  cleaned = cleaned.replace(/^["']|["']$/g, '');

  // If there are multiple lines, take everything (subject + body)
  // Just clean up extra blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Remove any explanatory text before the actual commit message
  // Look for conventional commit pattern and start from there
  const conventionalCommitMatch = cleaned.match(/(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\(.+?\))?:.+/s);
  if (conventionalCommitMatch) {
    cleaned = cleaned.substring(cleaned.indexOf(conventionalCommitMatch[0]));
  }

  return cleaned.trim();
}

// Get remote status (ahead/behind commits with smart remote detection)
router.get('/remote-status', async (req, res) => {
  const { project } = req.query;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    const branch = await getCurrentBranchName(projectPath, 'main');

    if (!(await repositoryHasCommits(projectPath))) {
      let remoteName = null;
      try {
        const remotes = await listGitRemotes(projectPath);
        remoteName = remotes.includes('origin') ? 'origin' : (remotes[0] || null);
      } catch {
        remoteName = null;
      }

      return res.json({
        hasRemote: Boolean(remoteName),
        hasUpstream: false,
        branch,
        remoteName,
        hasCommits: false,
        message: 'No commits yet'
      });
    }

    // Check if there's a remote tracking branch (smart detection)
    let trackingBranch;
    let remoteName;
    try {
      trackingBranch = await getUpstreamBranch(projectPath, branch);
      remoteName = trackingBranch.split('/')[0]; // Extract remote name (e.g., "origin/main" -> "origin")
    } catch (error) {
      // No upstream branch configured - but check if we have remotes
      let hasRemote = false;
      let remoteName = null;
      try {
        const remotes = await listGitRemotes(projectPath);
        if (remotes.length > 0) {
          hasRemote = true;
          remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
        }
      } catch (remoteError) {
        // No remotes configured
      }
      
      return res.json({ 
        hasRemote,
        hasUpstream: false,
        branch,
        remoteName,
        message: 'No remote tracking branch configured'
      });
    }

    // Get ahead/behind counts
    const countOutput = await getRemoteTrackingCounts(projectPath, trackingBranch);
    
    const [behind, ahead] = countOutput.trim().split('\t').map(Number);

    res.json({
      hasRemote: true,
      hasUpstream: true,
      branch,
      remoteBranch: trackingBranch,
      remoteName,
      ahead: ahead || 0,
      behind: behind || 0,
      isUpToDate: ahead === 0 && behind === 0
    });
  } catch (error) {
    if (!isGitRepositoryMissingError(error.message)) {
      console.error('Git remote status error:', error);
    }
    res.json({ error: error.message });
  }
});

// Fetch from remote (using smart remote detection)
router.post('/fetch', async (req, res) => {
  const { project } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    // Get current branch and its upstream remote
    const branch = await getCurrentHeadBranch(projectPath);

    let remoteName = 'origin'; // fallback
    try {
      remoteName = (await getUpstreamBranch(projectPath, branch)).split('/')[0]; // Extract remote name
    } catch (error) {
      // No upstream, try to fetch from origin anyway
      console.log('No upstream configured, using origin as fallback');
    }

    const stdout = await fetchRemote(projectPath, remoteName);
    
    res.json({ success: true, output: stdout || 'Fetch completed successfully', remoteName });
  } catch (error) {
    console.error('Git fetch error:', error);
    const errorText = getGitErrorText(error);
    res.status(500).json({ 
      error: 'Fetch failed', 
      details: errorText.includes('Could not resolve hostname') 
        ? 'Unable to connect to remote repository. Check your internet connection.'
        : errorText.includes('fatal: \'origin\' does not appear to be a git repository')
        ? 'No remote repository configured. Add a remote with: git remote add origin <url>'
        : errorText
    });
  }
});

// Pull from remote (fetch + merge using smart remote detection)
router.post('/pull', async (req, res) => {
  const { project } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    // Get current branch and its upstream remote
    const branch = await getCurrentHeadBranch(projectPath);

    let remoteName = 'origin'; // fallback
    let remoteBranch = branch; // fallback
    try {
      const tracking = await getUpstreamBranch(projectPath, branch);
      remoteName = tracking.split('/')[0]; // Extract remote name
      remoteBranch = tracking.split('/').slice(1).join('/'); // Extract branch name
    } catch (error) {
      // No upstream, use fallback
      console.log('No upstream configured, using origin/branch as fallback');
    }

    const stdout = await pullRemoteBranch(projectPath, remoteName, remoteBranch);
    
    res.json({ 
      success: true, 
      output: stdout || 'Pull completed successfully', 
      remoteName,
      remoteBranch
    });
  } catch (error) {
    console.error('Git pull error:', error);
    const errorText = getGitErrorText(error);
    
    // Enhanced error handling for common pull scenarios
    let errorMessage = 'Pull failed';
    let details = errorText;
    
    if (errorText.includes('CONFLICT')) {
      errorMessage = 'Merge conflicts detected';
      details = 'Pull created merge conflicts. Please resolve conflicts manually in the editor, then commit the changes.';
    } else if (errorText.includes('Please commit your changes or stash them')) {
      errorMessage = 'Uncommitted changes detected';  
      details = 'Please commit or stash your local changes before pulling.';
    } else if (errorText.includes('Could not resolve hostname')) {
      errorMessage = 'Network error';
      details = 'Unable to connect to remote repository. Check your internet connection.';
    } else if (errorText.includes('fatal: \'origin\' does not appear to be a git repository')) {
      errorMessage = 'Remote not configured';
      details = 'No remote repository configured. Add a remote with: git remote add origin <url>';
    } else if (errorText.includes('diverged')) {
      errorMessage = 'Branches have diverged';
      details = 'Your local branch and remote branch have diverged. Consider fetching first to review changes.';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: details
    });
  }
});

// Push commits to remote repository
router.post('/push', async (req, res) => {
  const { project } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    // Get current branch and its upstream remote
    const branch = await getCurrentHeadBranch(projectPath);

    let remoteName = 'origin'; // fallback
    let remoteBranch = branch; // fallback
    try {
      const tracking = await getUpstreamBranch(projectPath, branch);
      remoteName = tracking.split('/')[0]; // Extract remote name
      remoteBranch = tracking.split('/').slice(1).join('/'); // Extract branch name
    } catch (error) {
      // No upstream, use fallback
      console.log('No upstream configured, using origin/branch as fallback');
    }

    const stdout = await pushRemoteBranch(projectPath, remoteName, remoteBranch);
    
    res.json({ 
      success: true, 
      output: stdout || 'Push completed successfully', 
      remoteName,
      remoteBranch
    });
  } catch (error) {
    console.error('Git push error:', error);
    const errorText = getGitErrorText(error);
    
    // Enhanced error handling for common push scenarios
    let errorMessage = 'Push failed';
    let details = errorText;
    
    if (errorText.includes('rejected')) {
      errorMessage = 'Push rejected';
      details = 'The remote has newer commits. Pull first to merge changes before pushing.';
    } else if (errorText.includes('non-fast-forward')) {
      errorMessage = 'Non-fast-forward push';
      details = 'Your branch is behind the remote. Pull the latest changes first.';
    } else if (errorText.includes('Could not resolve hostname')) {
      errorMessage = 'Network error';
      details = 'Unable to connect to remote repository. Check your internet connection.';
    } else if (errorText.includes('fatal: \'origin\' does not appear to be a git repository')) {
      errorMessage = 'Remote not configured';
      details = 'No remote repository configured. Add a remote with: git remote add origin <url>';
    } else if (errorText.includes('Permission denied')) {
      errorMessage = 'Authentication failed';
      details = 'Permission denied. Check your credentials or SSH keys.';
    } else if (errorText.includes('no upstream branch')) {
      errorMessage = 'No upstream branch';
      details = 'No upstream branch configured. Use: git push --set-upstream origin <branch>';
    } else if (errorText.includes('src refspec') && errorText.includes('does not match any')) {
      errorMessage = 'No commits to push';
      details = 'Create an initial commit before publishing or pushing this branch.';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: details
    });
  }
});

// Publish branch to remote (set upstream and push)
router.post('/publish', async (req, res) => {
  const { project, branch } = req.body;
  
  if (!project || !branch) {
    return res.status(400).json({ error: 'Project name and branch are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    // Get current branch to verify it matches the requested branch
    const currentBranchName = await getCurrentHeadBranch(projectPath);
    
    if (currentBranchName !== branch) {
      return res.status(400).json({ 
        error: `Branch mismatch. Current branch is ${currentBranchName}, but trying to publish ${branch}` 
      });
    }

    // Check if remote exists
    let remoteName = 'origin';
    try {
      const remotes = await listGitRemotes(projectPath);
      if (remotes.length === 0) {
        return res.status(400).json({ 
          error: 'No remote repository configured. Add a remote with: git remote add origin <url>' 
        });
      }
      remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
    } catch (error) {
      return res.status(400).json({ 
        error: 'No remote repository configured. Add a remote with: git remote add origin <url>' 
      });
    }

    // Publish the branch (set upstream and push)
    const stdout = await pushWithUpstream(projectPath, remoteName, branch);
    
    res.json({ 
      success: true, 
      output: stdout || 'Branch published successfully', 
      remoteName,
      branch
    });
  } catch (error) {
    console.error('Git publish error:', error);
    const errorText = getGitErrorText(error);
    
    // Enhanced error handling for common publish scenarios
    let errorMessage = 'Publish failed';
    let details = errorText;
    
    if (errorText.includes('rejected')) {
      errorMessage = 'Publish rejected';
      details = 'The remote branch already exists and has different commits. Use push instead.';
    } else if (errorText.includes('Could not resolve hostname')) {
      errorMessage = 'Network error';
      details = 'Unable to connect to remote repository. Check your internet connection.';
    } else if (errorText.includes('Permission denied')) {
      errorMessage = 'Authentication failed';
      details = 'Permission denied. Check your credentials or SSH keys.';
    } else if (errorText.includes('fatal:') && errorText.includes('does not appear to be a git repository')) {
      errorMessage = 'Remote not configured';
      details = 'Remote repository not properly configured. Check your remote URL.';
    } else if (errorText.includes('src refspec') && errorText.includes('does not match any')) {
      errorMessage = 'No commits to publish';
      details = 'Create an initial commit before publishing this branch.';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: details
    });
  }
});

// Discard changes for a specific file
router.post('/discard', async (req, res) => {
  const { project, file } = req.body;
  
  if (!project || !file) {
    return res.status(400).json({ error: 'Project name and file path are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    // Check file status to determine correct discard command
    const statusOutput = await getFileStatusOutput(projectPath, file);
    
    if (!statusOutput.trim()) {
      return res.status(400).json({ error: 'No changes to discard for this file' });
    }

    const status = statusOutput.substring(0, 2);

    if (status === '??') {
      // Untracked file or directory - delete it
      const filePath = path.join(projectPath, file);
      const stats = await fs.stat(filePath);

      if (stats.isDirectory()) {
        await fs.rm(filePath, { recursive: true, force: true });
      } else {
        await fs.unlink(filePath);
      }
    } else if (status.includes('M') || status.includes('D')) {
      // Modified or deleted file - restore from HEAD
      await spawnAsync('git', ['restore', '--', file], { cwd: projectPath });
    } else if (status.includes('A')) {
      // Added file - unstage it
      await spawnAsync('git', ['reset', 'HEAD', '--', file], { cwd: projectPath });
    }
    
    res.json({ success: true, message: `Changes discarded for ${file}` });
  } catch (error) {
    console.error('Git discard error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete untracked file
router.post('/delete-untracked', async (req, res) => {
  const { project, file } = req.body;
  
  if (!project || !file) {
    return res.status(400).json({ error: 'Project name and file path are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    // Check if file is actually untracked
    const statusOutput = await getFileStatusOutput(projectPath, file);
    
    if (!statusOutput.trim()) {
      return res.status(400).json({ error: 'File is not untracked or does not exist' });
    }

    const status = statusOutput.substring(0, 2);
    
    if (status !== '??') {
      return res.status(400).json({ error: 'File is not untracked. Use discard for tracked files.' });
    }

    // Delete the untracked file or directory
    const filePath = path.join(projectPath, file);
    const stats = await fs.stat(filePath);

    if (stats.isDirectory()) {
      // Use rm with recursive option for directories
      await fs.rm(filePath, { recursive: true, force: true });
      res.json({ success: true, message: `Untracked directory ${file} deleted successfully` });
    } else {
      await fs.unlink(filePath);
      res.json({ success: true, message: `Untracked file ${file} deleted successfully` });
    }
  } catch (error) {
    console.error('Git delete untracked error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Revert a list of files in a validated git project back to their last
 * committed (HEAD) state, file-by-file.
 *
 * Semantics — intentionally conservative:
 *   - Each file is handled independently; errors on one do not affect others.
 *   - Untracked regular files the agent created are deleted.  Directories
 *     and symlinks are *not* recursively removed even if listed — the caller
 *     would have to opt in explicitly (not currently exposed), because
 *     recursive deletion of an agent-chosen path is too dangerous to trigger
 *     from a single UI click.
 *   - Tracked modifications are restored with `git restore -- <file>`.  This
 *     overwrites the working-tree copy with HEAD; any user edits the agent
 *     did NOT trigger will be lost if they touched one of these same files.
 *     The UI must warn the user before calling this endpoint.
 *   - Rename (`R`) and copy (`C`) entries are currently skipped rather than
 *     guessed at — git's porcelain output would require additional parsing.
 *
 * Path traversal is blocked via `safePath()`; symlinked paths inside the
 * project are additionally re-validated with `realpath()` so a symlink that
 * points outside the repo cannot be used to unlink an external file.
 *
 * @returns {Promise<{success: boolean, reverted: string[], skipped: string[], errors: Array<{file: string, reason: string}>}>}
 */
export async function revertFilesAtProjectPath(projectPath, files) {
  if (!Array.isArray(files) || files.length === 0) {
    return { success: true, reverted: [], skipped: [], errors: [] };
  }

  const uniqueFiles = Array.from(new Set(files.filter(f => typeof f === 'string' && f.length > 0)));
  const reverted = [];
  const skipped = [];
  const errors = [];
  const normalizedRoot = path.resolve(projectPath);

  // Single porcelain snapshot of the whole repo so rename detection and
  // per-file status are taken from the same instant.  Uses -z so NUL
  // delimits records and rename pairs — this means a filename containing
  // a literal " -> " cannot confuse the parser.
  const statusByPath = new Map(); // path -> 2-char status (XY)
  const renamedPaths = new Set();
  let snapshotError = null;
  try {
    const { stdout: fullStatus } = await spawnAsync(
      'git',
      ['status', '--porcelain', '-z'],
      { cwd: projectPath },
    );

    // In -z output, each record is "XY path\0", and for rename/copy entries
    // the SOURCE path comes as an additional NUL-terminated record immediately
    // after: "R. new\0old\0".  We have to stream through the tokens instead of
    // splitting once.
    const tokens = fullStatus.split('\0');
    for (let i = 0; i < tokens.length; i++) {
      const record = tokens[i];
      if (!record) continue;
      if (record.length < 4) continue; // "XY " + path
      const xy = record.slice(0, 2);
      const newPath = record.slice(3).replace(/\/+$/, '');
      if ((xy[0] === 'R' || xy[0] === 'C') && i + 1 < tokens.length) {
        const oldPath = (tokens[i + 1] || '').replace(/\/+$/, '');
        if (oldPath) renamedPaths.add(oldPath);
        if (newPath) {
          renamedPaths.add(newPath);
          statusByPath.set(newPath, xy);
        }
        i += 1; // consume the source path token
        continue;
      }
      if (newPath) statusByPath.set(newPath, xy);
    }
  } catch (err) {
    snapshotError = err;
  }

  // If the repo-wide snapshot failed, don't silently downgrade every
  // input to "skipped" — that hides real breakage like a corrupt repo.
  // Surface a single error per file so the caller can show a useful
  // message.  Individual file safety checks still run afterwards for
  // the traversal-protection path so malicious inputs still get rejected.
  if (snapshotError) {
    for (const file of uniqueFiles) {
      try {
        safePath(file, projectPath);
      } catch (safeErr) {
        errors.push({ file, reason: safeErr.message || String(safeErr) });
        continue;
      }
      errors.push({ file, reason: `git status failed: ${getGitErrorText(snapshotError).trim()}` });
    }
    return { success: false, reverted, skipped, errors };
  }

  for (const file of uniqueFiles) {
    try {
      const resolved = safePath(file, projectPath);
      const relFile = path.relative(projectPath, resolved);
      if (!relFile || relFile.startsWith('..')) {
        errors.push({ file, reason: 'Path outside project root' });
        continue;
      }

      if (renamedPaths.has(relFile)) {
        // Part of a rename/copy pair.  Reverting one side of a detected
        // rename would leave the other side inconsistent; bail instead.
        skipped.push(file);
        continue;
      }

      const xy = statusByPath.get(relFile) ?? '';
      if (!xy) {
        skipped.push(file);
        continue;
      }

      const status = xy;

      if (status === '??') {
        // Untracked — agent created this path.  Use lstat so we see the
        // symlink itself rather than its target, then revalidate after
        // realpath for any regular files we intend to unlink.
        let lstats;
        try {
          lstats = await fs.lstat(resolved);
        } catch (statError) {
          if (statError.code === 'ENOENT') {
            skipped.push(file);
            continue;
          }
          throw statError;
        }

        if (lstats.isDirectory()) {
          errors.push({ file, reason: 'Refusing to delete untracked directory via revert' });
          continue;
        }
        if (lstats.isSymbolicLink()) {
          // Delete the symlink itself; do not follow it.  The safePath
          // check already bound the link path to the project root.
          await fs.unlink(resolved);
        } else {
          // Regular file — re-check realpath points inside the repo in
          // case the filesystem has cross-boundary symlinks we missed.
          try {
            const real = await fs.realpath(resolved);
            if (real !== normalizedRoot && !real.startsWith(normalizedRoot + path.sep)) {
              errors.push({ file, reason: 'Resolved path escapes project root via symlink' });
              continue;
            }
          } catch (realpathError) {
            if (realpathError.code !== 'ENOENT') throw realpathError;
          }
          await fs.unlink(resolved);
        }
      } else {
        const indexChar = status[0];
        const worktreeChar = status[1];

        if (indexChar === 'A' && worktreeChar !== 'D') {
          // Agent staged a new file (may or may not be further modified in
          // worktree).  Unstage the add and remove the working-tree copy.
          await spawnAsync('git', ['reset', 'HEAD', '--', relFile], { cwd: projectPath });
          try {
            await fs.unlink(resolved);
          } catch (unlinkError) {
            if (unlinkError.code !== 'ENOENT') throw unlinkError;
          }
        } else if ('MDT'.includes(indexChar) || 'MDT'.includes(worktreeChar) || status === 'AD') {
          // Anything that existed at HEAD and has staged and/or worktree
          // modifications, deletions, or type changes.  --staged --worktree
          // together restore BOTH the index and the working tree to HEAD
          // so mixed states like MM / AM / AD / MD / DM all land back
          // at the committed state.
          await spawnAsync('git', ['restore', '--source=HEAD', '--staged', '--worktree', '--', relFile], {
            cwd: projectPath,
          });
        } else {
          // Unrecognized porcelain code — skip rather than guess.
          skipped.push(file);
          continue;
        }
      }

      reverted.push(file);
    } catch (fileError) {
      errors.push({ file, reason: fileError.message || String(fileError) });
    }
  }

  return { success: errors.length === 0, reverted, skipped, errors };
}

// Revert multiple files modified by a specific agent interaction.
router.post('/revert-agent-changes', async (req, res) => {
  const { project, files } = req.body;

  if (!project || !Array.isArray(files)) {
    return res.status(400).json({ error: 'Project name and files array are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project);
    await validateGitRepository(projectPath);

    const result = await revertFilesAtProjectPath(projectPath, files);
    res.json(result);
  } catch (error) {
    console.error('Git revert-agent-changes error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
