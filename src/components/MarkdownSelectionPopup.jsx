import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Zap, Brain, Search, X, Send, Loader2, ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark as prismOneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { authenticatedFetch, api } from '../utils/api';

const MIN_SELECTION_LENGTH = 2;

const popupStyles = `
@keyframes md-popup-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}
.md-selection-popup {
  animation: md-popup-in 0.15s ease-out;
}
`;

// Compact markdown components for popup rendering
const inlineMarkdownComponents = {
  h1: ({ children }) => <h1 className="text-sm font-bold my-1">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-bold my-1">{children}</h2>,
  h3: ({ children }) => <h3 className="text-xs font-semibold my-1">{children}</h3>,
  h4: ({ children }) => <h4 className="text-xs font-semibold my-0.5">{children}</h4>,
  p: ({ children }) => <p className="text-xs my-1 leading-relaxed">{children}</p>,
  li: ({ children }) => <li className="text-xs my-0.5 leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  code: ({ inline, className, children, ...props }) => {
    const raw = Array.isArray(children) ? children.join('') : String(children ?? '');
    if (inline || !/[\r\n]/.test(raw)) {
      return (
        <code className="font-mono text-[0.75em] px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700" {...props}>
          {children}
        </code>
      );
    }
    const match = /language-(\w+)/.exec(className || '');
    return (
      <SyntaxHighlighter
        language={match ? match[1] : 'text'}
        style={prismOneDark}
        customStyle={{ margin: 0, borderRadius: '0.375rem', fontSize: '0.7rem', padding: '0.5rem' }}
      >
        {raw}
      </SyntaxHighlighter>
    );
  },
};

const MODE_CONFIG = {
  fast: { icon: Zap, label: 'Fast', color: 'amber', title: 'Quick inline answer' },
  think: { icon: Brain, label: 'Think', color: 'blue', title: 'Detailed analysis' },
  research: { icon: Search, label: 'Deep Research', color: 'purple', title: 'Comprehensive research report' },
};

function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/**
 * Find the selected plain text inside the raw markdown source, accounting for
 * inline formatting characters (backticks, *, _, ~, \\) that appear in the
 * source but not in the rendered/selected text.
 *
 * Returns the matched raw markdown span, or null if not found.
 */
function findMarkdownSpan(mdContent, plainText) {
  // 1. Try exact match first (works for unformatted text)
  if (mdContent.includes(plainText)) return plainText;

  // 2. Split the selected text into fine-grained segments by character-type boundaries
  //    (letters, CJK, digits, punctuation, whitespace) so that markdown formatting
  //    chars like ** or ` that appear between segments can be matched.
  const segments = plainText.match(
    /[a-zA-Z0-9]+|[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]+|[^\sa-zA-Z0-9\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]+|\s+/g
  );
  if (!segments || segments.length === 0) return null;

  const MD = '[`*_~\\\\]{0,4}';
  const patternParts = segments.map((seg) => {
    if (/^\s+$/.test(seg)) return '[\\s\\n]+';
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });

  try {
    const regex = new RegExp(MD + patternParts.join(MD) + MD);
    const match = mdContent.match(regex);
    if (match) return match[0];
  } catch {
    // regex too complex or invalid – fall through
  }

  return null;
}

/**
 * When inline matching fails (e.g. tables, block elements), find the markdown
 * block that contains the selected text and return its end position so we can
 * append a link annotation after it.
 *
 * Strategy: extract distinctive tokens from the selected text, search for
 * markdown table rows (lines starting with |) that contain those tokens,
 * then return the full table block range.
 *
 * Returns { blockEnd: number, label: string } or null.
 */
function findContainingBlock(mdContent, plainText) {
  // Extract ALL meaningful tokens from the selected text (not just first 8)
  const tokens = plainText
    .split(/[\s\t\n]+/)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return null;

  const lines = mdContent.split('\n');

  // 1. Identify all table blocks (groups of consecutive lines starting with |)
  const tableBlocks = [];
  let blockStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const isTableLine = lines[i].trim().startsWith('|');
    if (isTableLine && blockStart === -1) {
      blockStart = i;
    } else if (!isTableLine && blockStart !== -1) {
      tableBlocks.push({ start: blockStart, end: i - 1 });
      blockStart = -1;
    }
  }
  if (blockStart !== -1) {
    tableBlocks.push({ start: blockStart, end: lines.length - 1 });
  }

  if (tableBlocks.length === 0) return null;

  // 2. Score each table block by how many tokens it contains
  let bestBlock = null;
  let bestScore = 0;

  for (const block of tableBlocks) {
    // Combine all lines of this table into one string for matching
    let tableText = '';
    for (let i = block.start; i <= block.end; i++) {
      tableText += lines[i] + '\n';
    }

    let score = 0;
    for (const token of tokens) {
      if (tableText.includes(token)) score++;
    }

    if (score > bestScore) {
      bestScore = score;
      bestBlock = block;
    }
  }

  // Require at least 1 match (lower bar for short selections with few tokens)
  const minScore = tokens.length >= 3 ? 2 : 1;
  if (bestScore < minScore || !bestBlock) return null;

  // Compute the character offset of the end of the table block
  let blockEnd = 0;
  for (let i = 0; i <= bestBlock.end; i++) {
    blockEnd += lines[i].length + 1; // +1 for \n
  }

  const label = tokens.slice(0, 3).join(' ');
  return { blockEnd, label };
}

/**
 * Find the next available _XX.md suffix (01–99) for a given base path.
 * baseName: filename without extension, e.g. "notes"
 * dir: directory path, e.g. "docs/"
 * existingContent: the current markdown content (used to scan for existing links)
 */
function findNextSuffix(existingContent, baseName) {
  const used = new Set();
  // Scan for patterns like baseName_01.md, baseName_02.md, etc. in existing links
  const regex = new RegExp(`${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d{2})\\.md`, 'g');
  let match;
  while ((match = regex.exec(existingContent)) !== null) {
    used.add(parseInt(match[1], 10));
  }
  for (let i = 1; i <= 99; i++) {
    if (!used.has(i)) return String(i).padStart(2, '0');
  }
  return null; // all 99 used
}

function MarkdownSelectionPopup({ containerRef, onStartSession, onOpenOverlay, projectName, mdContent, onContentChange, filePath, onSaveFile }) {
  const [popupState, setPopupState] = useState('hidden'); // hidden | ready | answering | answered
  const [selectedText, setSelectedText] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [fullResult, setFullResult] = useState('');
  const [queryId, setQueryId] = useState(null);
  const [activeMode, setActiveMode] = useState('fast');
  const [expanded, setExpanded] = useState(false);
  const [startTime, setStartTime] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const popupRef = useRef(null);
  const inputRef = useRef(null);
  const answerRef = useRef(null);
  const [highlightRects, setHighlightRects] = useState([]);
  const popupStateRef = useRef(popupState);
  const selectedTextRef = useRef(selectedText);
  popupStateRef.current = popupState;
  selectedTextRef.current = selectedText;

  const isBackgroundMode = activeMode === 'think' || activeMode === 'research';

  // Timer for background modes
  useEffect(() => {
    if (!startTime || popupState !== 'answering') return;
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime, popupState]);

  // Detect text selection inside the markdown preview container
  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return;

    const handleMouseUp = () => {
      setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString()?.trim();

        if (!text || text.length < MIN_SELECTION_LENGTH) return;
        if (!selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        if (!container.contains(range.commonAncestorContainer)) return;

        // Don't re-trigger if popup is already showing for this text
        if (popupStateRef.current !== 'hidden' && text === selectedTextRef.current) return;

        const rect = range.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        // Compute highlight overlay rects
        const clientRects = range.getClientRects();
        const rects = [];
        for (let i = 0; i < clientRects.length; i++) {
          const r = clientRects[i];
          if (r.width === 0 || r.height === 0) continue;
          rects.push({
            top: r.top - containerRect.top + container.scrollTop,
            left: r.left - containerRect.left,
            width: r.width,
            height: r.height,
          });
        }
        setHighlightRects(rects);

        const POPUP_WIDTH = 320;
        const POPUP_MARGIN = 8;
        const selectionCenter = rect.left - containerRect.left + rect.width / 2;
        const clampedLeft = Math.max(
          POPUP_MARGIN + POPUP_WIDTH / 2,
          Math.min(selectionCenter, containerRect.width - POPUP_MARGIN - POPUP_WIDTH / 2)
        );

        setSelectedText(text);
        setPosition({
          top: rect.bottom - containerRect.top + container.scrollTop + 8,
          left: clampedLeft,
        });
        setPopupState('ready');
        setAnswer('');
        setFullResult('');
        setQuestion('');
        setActiveMode('fast');
        setExpanded(false);
        setStartTime(null);
        setElapsed(0);
      }, 10);
    };

    container.addEventListener('mouseup', handleMouseUp);
    return () => container.removeEventListener('mouseup', handleMouseUp);
  }, [containerRef]);

  // Close popup on click outside (only in ready state)
  useEffect(() => {
    if (popupState !== 'ready') return;

    const handleClickOutside = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        handleClose();
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [popupState]);

  // Auto-focus input only when the user switches mode tabs (not on initial popup)
  const hasInteracted = useRef(false);
  useEffect(() => {
    if (popupState === 'ready' && inputRef.current && hasInteracted.current) {
      inputRef.current.focus();
    }
  }, [popupState, activeMode]);

  // Reset interaction flag when popup opens fresh
  useEffect(() => {
    if (popupState === 'hidden') {
      hasInteracted.current = false;
    }
  }, [popupState]);

  // Auto-scroll answer container while streaming (Fast mode only)
  useEffect(() => {
    if (answerRef.current && popupState === 'answering' && !isBackgroundMode) {
      answerRef.current.scrollTop = answerRef.current.scrollHeight;
    }
  }, [answer, popupState, isBackgroundMode]);

  // Auto-expand when Fast mode answer completes and overflows
  useEffect(() => {
    if (popupState === 'answered' && answerRef.current && !expanded && !isBackgroundMode) {
      if (answerRef.current.scrollHeight > answerRef.current.clientHeight) {
        setExpanded(true);
      }
    }
  }, [popupState, expanded, isBackgroundMode]);

  const handleClose = useCallback(() => {
    if (queryId) {
      authenticatedFetch('/api/quick-qa/abort', {
        method: 'POST',
        body: JSON.stringify({ queryId }),
      }).catch(() => {});
    }
    setHighlightRects([]);
    setPopupState('hidden');
    setSelectedText('');
    setAnswer('');
    setFullResult('');
    setQuestion('');
    setQueryId(null);
    setActiveMode('fast');
    setExpanded(false);
    setStartTime(null);
    setElapsed(0);
  }, [queryId]);

  /**
   * Stream an SSE response from /api/quick-qa for all modes.
   * For Fast mode, streams answer inline.
   * For Think/Research, runs in background and captures fullContent for overlay.
   */
  const runSSEQuery = useCallback(async (mode, selectedTxt, userQuestion) => {
    setPopupState('answering');
    setAnswer('');
    setFullResult('');
    setStartTime(Date.now());
    setElapsed(0);

    try {
      const response = await authenticatedFetch('/api/quick-qa', {
        method: 'POST',
        body: JSON.stringify({
          selectedText: selectedTxt,
          question: userQuestion || null,
          mode,
        }),
      });

      if (!response.ok) {
        let errMsg = `Server error (${response.status})`;
        try {
          const errBody = await response.json();
          errMsg = errBody.error || errMsg;
        } catch {}
        setAnswer(`**Error:** ${errMsg}`);
        setPopupState('answered');
        return;
      }

      const id = response.headers.get('X-Query-Id');
      if (id) setQueryId(id);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'text') {
              if (mode === 'fast') {
                setAnswer((prev) => prev + data.content);
              }
              // For think/research we don't show streaming text in popup
            } else if (data.type === 'error') {
              setAnswer((prev) => prev + `\n\n**Error:** ${data.message}`);
            } else if (data.type === 'done') {
              if (data.fullContent) {
                setFullResult(data.fullContent);
              }
              setPopupState('answered');
            }
          } catch {
            // skip malformed JSON
          }
        }
      }

      setPopupState('answered');
    } catch (error) {
      if (error.name !== 'AbortError') {
        setAnswer(`**Error:** ${error.message}`);
        setPopupState('answered');
      }
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!selectedText) return;
    const userQuestion = question.trim();
    await runSSEQuery(activeMode, selectedText, userQuestion);
  }, [selectedText, question, activeMode, runSSEQuery]);

  /**
   * Auto-save: when Think/Research mode completes, immediately save the result
   * as a _XX.md file and insert a hyperlink on the selected text.
   * Uses a ref to ensure it only fires once per query.
   */
  const autoSavedRef = useRef(false);
  const savedFileNameRef = useRef(null);

  useEffect(() => {
    // Reset the flag when popup reopens
    if (popupState === 'hidden' || popupState === 'ready') {
      autoSavedRef.current = false;
      savedFileNameRef.current = null;
    }
  }, [popupState]);

  useEffect(() => {
    if (
      popupState !== 'answered' ||
      !fullResult ||
      !isBackgroundMode ||
      autoSavedRef.current
    ) return;
    if (!filePath || mdContent === undefined || !onContentChange || !onSaveFile || !projectName) return;

    autoSavedRef.current = true;

    (async () => {
      try {
        const modeLabel = activeMode === 'think' ? 'Think' : 'Deep Research';

        // Compute directory and base name from filePath
        const lastSlash = filePath.lastIndexOf('/');
        const dir = lastSlash >= 0 ? filePath.substring(0, lastSlash + 1) : '';
        const fileName = lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
        const dotIdx = fileName.lastIndexOf('.');
        const baseName = dotIdx > 0 ? fileName.substring(0, dotIdx) : fileName;

        const suffix = findNextSuffix(mdContent, baseName);
        if (!suffix) return;

        const newFileName = `${baseName}_${suffix}.md`;
        const newFilePath = `${dir}${newFileName}`;
        savedFileNameRef.current = newFileName;

        // Build content for the new file
        const header = question.trim()
          ? `# ${modeLabel}: ${question.trim()}\n\n`
          : `# ${modeLabel} Result\n\n`;
        const newFileContent = header + fullResult;

        // Save the new .md file
        await api.saveFile(projectName, newFilePath, newFileContent);

        // Insert hyperlink on the selected text in the original content
        const matchedSpan = findMarkdownSpan(mdContent, selectedText);
        if (matchedSpan) {
          // Inline match: wrap the matched text with a link
          const linkMarkdown = `[${matchedSpan}](${newFileName})`;
          const updatedContent = mdContent.replace(matchedSpan, linkMarkdown);
          if (updatedContent !== mdContent) {
            onContentChange(updatedContent);
            await onSaveFile(updatedContent);
          }
        } else {
          // Block-level fallback (tables, code blocks, etc.):
          // insert a link annotation line after the block
          const block = findContainingBlock(mdContent, selectedText);
          if (block) {
            // Extract a one-line summary: find the first real sentence from the result
            // Skip headings, empty lines, bold-only labels (ending with : or ：), and short fragments
            const stripMd = (s) => s.replace(/[*_`~>#\-]+/g, '').trim();
            const summaryLine = fullResult
              .split('\n')
              .map((l) => l.trim())
              .map(stripMd)
              .find((l) => l.length > 15 && !l.endsWith(':') && !l.endsWith('：'));
            const linkLabel = summaryLine
              ? summaryLine.slice(0, 80) + (summaryLine.length > 80 ? '...' : '')
              : question.trim() || `${modeLabel} Note`;
            const annotation = `\n> 📎 [${linkLabel}](${newFileName})\n`;
            const updatedContent =
              mdContent.slice(0, block.blockEnd) +
              annotation +
              mdContent.slice(block.blockEnd);
            onContentChange(updatedContent);
            await onSaveFile(updatedContent);
          }
        }
      } catch (err) {
        console.error('Failed to auto-save Think Mode result:', err);
      }
    })();
  }, [popupState, fullResult, isBackgroundMode, filePath, mdContent, onContentChange, onSaveFile, projectName, activeMode, question, selectedText]);

  /**
   * Open button: just show the result in the overlay (file already saved automatically).
   */
  const handleOpenResult = useCallback(() => {
    if (!fullResult || !onOpenOverlay) return;
    const modeLabel = activeMode === 'think' ? 'Think' : 'Deep Research';
    const title = question.trim()
      ? `${modeLabel}: ${question.trim()}`
      : `${modeLabel} Result`;
    onOpenOverlay({ content: fullResult, title });
    handleClose();
  }, [fullResult, activeMode, question, onOpenOverlay, handleClose]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      handleClose();
    }
  }, [handleSubmit, handleClose]);

  if (popupState === 'hidden') return null;

  const currentModeColor = MODE_CONFIG[activeMode].color;
  const ModeIcon = MODE_CONFIG[activeMode].icon;

  return (
    <>
    <style>{popupStyles}</style>
    {/* Highlight overlays */}
    {highlightRects.map((rect, i) => (
      <div
        key={i}
        className="absolute pointer-events-none z-40"
        style={{
          top: `${rect.top}px`,
          left: `${rect.left}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          backgroundColor: 'rgba(251, 191, 36, 0.3)',
          borderRadius: '2px',
        }}
      />
    ))}
    <div
      ref={popupRef}
      className="absolute z-50 md-selection-popup"
      style={expanded ? {
        top: `${position.top}px`,
        left: '8px',
        right: '8px',
        transform: 'none',
      } : {
        top: `${position.top}px`,
        left: `${position.left}px`,
        transform: 'translateX(-50%)',
      }}
    >
      {/* Arrow */}
      <div
        className="absolute -top-1.5 w-3 h-3 rotate-45 bg-white dark:bg-gray-800 border-l border-t border-gray-200 dark:border-gray-600"
        style={expanded ? { left: `${Math.max(16, position.left - 8)}px` } : { left: '50%', transform: 'translateX(-50%)' }}
      />

      <div className={`relative bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 overflow-hidden ${expanded ? 'w-full' : 'min-w-[320px] max-w-[420px]'}`}>
        {/* Row 1: Input / Status header */}
        <div className="px-2 pt-2 pb-1">
          {popupState === 'ready' ? (
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onFocus={() => { hasInteracted.current = true; }}
                onKeyDown={handleKeyDown}
                placeholder={
                  activeMode === 'fast'
                    ? 'Ask a question (optional, press Enter)'
                    : activeMode === 'think'
                      ? 'What to think about? (optional, press Enter)'
                      : 'Research focus? (optional, press Enter)'
                }
                className={`flex-1 px-2.5 py-1.5 text-xs rounded-md border
                  bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100
                  placeholder-gray-400 dark:placeholder-gray-500
                  focus:outline-none focus:ring-1
                  ${currentModeColor === 'amber' ? 'border-gray-200 dark:border-gray-600 focus:ring-amber-400 dark:focus:ring-amber-500 focus:border-amber-400' : ''}
                  ${currentModeColor === 'blue' ? 'border-gray-200 dark:border-gray-600 focus:ring-blue-400 dark:focus:ring-blue-500 focus:border-blue-400' : ''}
                  ${currentModeColor === 'purple' ? 'border-gray-200 dark:border-gray-600 focus:ring-purple-400 dark:focus:ring-purple-500 focus:border-purple-400' : ''}`}
              />
              <button
                onClick={handleSubmit}
                className={`p-1.5 rounded-md text-white transition-colors flex-shrink-0
                  ${currentModeColor === 'amber' ? 'bg-amber-500 hover:bg-amber-600' : ''}
                  ${currentModeColor === 'blue' ? 'bg-blue-500 hover:bg-blue-600' : ''}
                  ${currentModeColor === 'purple' ? 'bg-purple-500 hover:bg-purple-600' : ''}`}
                title="Send"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {question || MODE_CONFIG[activeMode].title}
              </span>
              <button
                onClick={handleClose}
                className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors flex-shrink-0"
              >
                <X className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </div>
          )}
        </div>

        {/* Row 2: Mode toggle tabs */}
        {popupState === 'ready' && (
          <div className="flex items-center gap-0.5 px-2 pb-2">
            {Object.entries(MODE_CONFIG).map(([mode, config]) => {
              const Icon = config.icon;
              const isActive = activeMode === mode;
              const colorMap = {
                amber: isActive
                  ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50',
                blue: isActive
                  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50',
                purple: isActive
                  ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50',
              };
              return (
                <button
                  key={mode}
                  onClick={() => {
                    hasInteracted.current = true;
                    if (activeMode === mode) {
                      handleSubmit();
                    } else {
                      setActiveMode(mode);
                    }
                  }}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors whitespace-nowrap cursor-pointer
                    ${colorMap[config.color]}`}
                  title={config.title}
                >
                  <Icon className="w-3 h-3" />
                  {config.label}
                </button>
              );
            })}
            <button
              onClick={handleClose}
              className="ml-auto p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors flex-shrink-0"
            >
              <X className="w-3.5 h-3.5 text-gray-400" />
            </button>
          </div>
        )}

        {/* Content area: depends on mode */}
        {(popupState === 'answering' || popupState === 'answered') && (
          <div className="px-3 pb-3">
            {isBackgroundMode ? (
              /* Think / Deep Research: background progress or result */
              popupState === 'answering' ? (
                <div className="flex items-center gap-2 py-1">
                  <Loader2 className={`w-3.5 h-3.5 animate-spin ${currentModeColor === 'blue' ? 'text-blue-500' : 'text-purple-500'}`} />
                  <span className="text-xs text-gray-600 dark:text-gray-300">
                    {activeMode === 'think' ? 'Thinking...' : 'Researching...'}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums ml-auto">
                    {formatElapsed(elapsed)}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 py-1">
                  <ModeIcon className={`w-3.5 h-3.5 ${currentModeColor === 'blue' ? 'text-blue-500' : 'text-purple-500'}`} />
                  <span className="text-xs text-gray-600 dark:text-gray-300">
                    Done in {formatElapsed(elapsed)}
                  </span>
                  {fullResult && onOpenOverlay && (
                    <button
                      onClick={handleOpenResult}
                      className={`ml-auto flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-white transition-colors
                        ${currentModeColor === 'blue' ? 'bg-blue-500 hover:bg-blue-600' : 'bg-purple-500 hover:bg-purple-600'}`}
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open
                    </button>
                  )}
                </div>
              )
            ) : (
              /* Fast mode: inline streaming answer */
              <>
                {popupState === 'answering' && !answer && (
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Thinking...</span>
                  </div>
                )}
                {answer && (
                  <div
                    ref={answerRef}
                    className={`overflow-y-auto text-xs text-gray-800 dark:text-gray-200 max-w-none transition-[max-height] duration-200 ${expanded ? 'max-h-[60vh]' : 'max-h-[120px]'}`}
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={inlineMarkdownComponents}
                    >
                      {answer}
                    </ReactMarkdown>
                    {popupState === 'answering' && (
                      <span className="inline-block w-1.5 h-4 bg-amber-500 animate-pulse ml-0.5 align-middle" />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
    </>
  );
}

export default MarkdownSelectionPopup;
