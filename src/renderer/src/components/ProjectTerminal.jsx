import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal as TerminalIcon, Play, Square, Trash2, Copy, Check, Maximize2, X } from 'lucide-react';
import clsx from 'clsx';

// Try to use XTerminal if available, fallback to simple terminal
let XTerminal = null;
try {
  XTerminal = require('./XTerminal').default;
} catch (e) {
  // XTerminal not available, using simple terminal
}

// ANSI escape code to HTML converter
const ansiToHtml = (text) => {
  if (!text) return '';

  const ansiColors = {
    '30': '#4a4a4a', '31': '#f7768e', '32': '#9ece6a', '33': '#e0af68',
    '34': '#7aa2f7', '35': '#bb9af7', '36': '#7dcfff', '37': '#c0caf5',
    '90': '#6b7089', '91': '#ff7a93', '92': '#b9f27c', '93': '#ff9e64',
    '94': '#7da6ff', '95': '#c49fd6', '96': '#89ddff', '97': '#ffffff',
    // Background colors
    '40': '#1a1b26', '41': '#f7768e', '42': '#9ece6a', '43': '#e0af68',
    '44': '#7aa2f7', '45': '#bb9af7', '46': '#7dcfff', '47': '#c0caf5',
  };

  // Replace ANSI codes with HTML spans
  let result = text
    // Handle ESC[ sequences
    .replace(/\x1b\[(\d+(?:;\d+)*)m/g, (match, codes) => {
      const codeList = codes.split(';');
      let style = '';

      for (const code of codeList) {
        if (code === '0' || code === '39') {
          return '</span>';
        } else if (code === '1') {
          style += 'font-weight:bold;';
        } else if (code === '3') {
          style += 'font-style:italic;';
        } else if (code === '4') {
          style += 'text-decoration:underline;';
        } else if (ansiColors[code]) {
          if (parseInt(code) >= 40) {
            style += `background-color:${ansiColors[code]};`;
          } else {
            style += `color:${ansiColors[code]};`;
          }
        }
      }

      return style ? `<span style="${style}">` : '';
    })
    // Remove any remaining escape sequences
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    // Handle carriage returns
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  return result;
};

// Component to render ANSI-formatted text
const AnsiText = ({ text }) => {
  const html = ansiToHtml(text);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
};

// Constants for auto-cleanup
const MAX_OUTPUT_LINES = 500;  // Limit output to prevent memory bloat
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;  // 10 minutes

function ProjectTerminal({ projectId, projectPath, phpVersion = '8.4', autoFocus = false, useXterm = false, onClose }) {
  const [output, setOutput] = useState([]);
  const [command, setCommand] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [commandHistory, setCommandHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [copied, setCopied] = useState(false);
  const [waitingForInput, setWaitingForInput] = useState(false);
  const outputRef = useRef(null);
  const inputRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const inactivityTimerRef = useRef(null);

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  // Focus input on mount if autoFocus
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  // Listen for terminal output events
  useEffect(() => {
    const handleOutput = (data) => {
      // Add null check for data since different terminal events have different structures
      if (!data || !data.projectId) return;
      if (data.projectId === projectId) {
        addOutput(data.text, data.type || 'stdout');

        // Detect if command is waiting for input (prompts typically end with ? or :)
        const text = data.text || '';
        if (text.includes('?') || text.includes('(yes/no)') || text.includes('(y/n)') || text.includes('[yes]') || text.includes('[no]')) {
          setWaitingForInput(true);
        }
      }
    };

    window.devbox?.terminal?.onOutput?.(handleOutput);

    return () => {
      window.devbox?.terminal?.offOutput?.(handleOutput);
    };
  }, [projectId]);

  const addOutput = useCallback((text, type = 'stdout') => {
    const timestamp = new Date().toLocaleTimeString();
    lastActivityRef.current = Date.now();  // Track activity
    setOutput((prev) => {
      const newOutput = [...prev, { text, type, timestamp }];
      // Limit output to prevent memory bloat
      if (newOutput.length > MAX_OUTPUT_LINES) {
        return newOutput.slice(-MAX_OUTPUT_LINES);
      }
      return newOutput;
    });
  }, []);

  // Inactivity timeout - auto-close after 10 minutes of no activity
  useEffect(() => {
    if (!onClose) return;  // No close handler, skip timeout

    const checkInactivity = () => {
      const now = Date.now();
      const timeSinceActivity = now - lastActivityRef.current;
      if (timeSinceActivity >= INACTIVITY_TIMEOUT_MS && !isRunning) {
        onClose();  // Close this terminal
      }
    };

    // Check every minute
    inactivityTimerRef.current = setInterval(checkInactivity, 60000);

    return () => {
      if (inactivityTimerRef.current) {
        clearInterval(inactivityTimerRef.current);
      }
    };
  }, [onClose, isRunning]);

  const sendInputToProcess = async (input) => {
    if (!input.trim()) return;

    // Show input in output
    addOutput(`> ${input}`, 'command');
    setCommand('');

    try {
      const result = await window.devbox?.terminal?.sendInput(projectId, input + '\n');
      if (!result?.success) {
        // Failed to send input to process
      }
    } catch (error) {
      addOutput(`Error sending input: ${error.message}`, 'error');
    }

    setWaitingForInput(false);
    inputRef.current?.focus();
  };

  const runCommand = async (cmd) => {
    if (!cmd.trim()) return;

    // If a command is running and waiting for input, send input instead
    if (isRunning) {
      await sendInputToProcess(cmd);
      return;
    }

    // Add to history
    setCommandHistory((prev) => [cmd, ...prev.slice(0, 49)]);
    setHistoryIndex(-1);

    // Show command in output
    addOutput(`$ ${cmd}`, 'command');
    setCommand('');
    setIsRunning(true);
    setWaitingForInput(false);

    try {
      const result = await window.devbox?.terminal?.runCommand(projectId, cmd, {
        cwd: projectPath,
        phpVersion,
      });

      if (result?.stdout) {
        addOutput(result.stdout, 'stdout');
      }
      if (result?.stderr) {
        addOutput(result.stderr, 'stderr');
      }
      if (result?.error) {
        addOutput(result.error, 'error');
      }
    } catch (error) {
      addOutput(error.message, 'error');
    } finally {
      setIsRunning(false);
      setWaitingForInput(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      runCommand(command);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      // Only navigate history when not running
      if (!isRunning && commandHistory.length > 0) {
        const newIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
        setHistoryIndex(newIndex);
        setCommand(commandHistory[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      // Only navigate history when not running
      if (!isRunning && historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setCommand(commandHistory[newIndex]);
      } else if (!isRunning) {
        setHistoryIndex(-1);
        setCommand('');
      }
    } else if (e.key === 'c' && e.ctrlKey) {
      // Cancel running command
      if (isRunning) {
        window.devbox?.terminal?.cancelCommand(projectId);
        addOutput('^C', 'error');
        setIsRunning(false);
        setWaitingForInput(false);
      }
    }
  };

  const clearOutput = () => {
    setOutput([]);
  };

  const copyOutput = async () => {
    const text = output.map((o) => o.text).join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Quick command buttons for common operations
  const quickCommands = [
    { label: 'artisan list', cmd: 'php artisan list', type: 'laravel' },
    { label: 'migrate', cmd: 'php artisan migrate', type: 'laravel' },
    { label: 'tinker', cmd: 'php artisan tinker', type: 'laravel' },
    { label: 'composer install', cmd: 'composer install', type: 'all' },
    { label: 'npm install', cmd: 'npm install', type: 'all' },
    { label: 'npm run dev', cmd: 'npm run dev', type: 'all' },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <TerminalIcon className="w-4 h-4 text-green-400" />
          <span className="text-sm font-medium text-gray-300">Terminal</span>
          <span className="text-xs text-gray-500">PHP {phpVersion}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copyOutput}
            className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
            title="Copy output"
          >
            {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
          </button>
          <button
            onClick={clearOutput}
            className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
            title="Clear terminal"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          {onClose && (
            <button
              onClick={() => {
                // Clear output to free memory
                setOutput([]);
                setCommandHistory([]);
                setCommand('');
                // Then notify parent
                onClose();
              }}
              className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
              title="Close terminal (free memory)"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Quick Commands */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-800/50 border-b border-gray-700 overflow-x-auto">
        <span className="text-xs text-gray-500 shrink-0">Quick:</span>
        {quickCommands.map((qc) => (
          <button
            key={qc.cmd}
            onClick={() => runCommand(qc.cmd)}
            disabled={isRunning}
            className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors whitespace-nowrap disabled:opacity-50"
          >
            {qc.label}
          </button>
        ))}
      </div>

      {/* Output */}
      <div
        ref={outputRef}
        className="flex-1 p-4 overflow-auto font-mono text-sm leading-relaxed"
        onClick={() => inputRef.current?.focus()}
      >
        {output.length === 0 ? (
          <div className="text-gray-500">
            <p>Terminal ready. Type a command or use quick commands above.</p>
            <p className="mt-2 text-gray-600">
              Working directory: <span className="text-gray-400">{projectPath}</span>
            </p>
          </div>
        ) : (
          output.map((line, index) => (
            <div
              key={index}
              className={clsx(
                'whitespace-pre-wrap break-all',
                line.type === 'command' && 'text-yellow-400 font-semibold mt-2',
                line.type === 'stdout' && 'text-gray-300',
                line.type === 'stderr' && 'text-orange-400',
                line.type === 'error' && 'text-red-400',
                line.type === 'info' && 'text-blue-400',
                line.type === 'success' && 'text-green-400'
              )}
            >
              {line.type === 'stdout' || line.type === 'stderr' ? (
                <AnsiText text={line.text} />
              ) : (
                line.text
              )}
            </div>
          ))
        )}
        {isRunning && (
          <div className="flex items-center gap-2 text-gray-400 mt-2">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            Running...
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-800 border-t border-gray-700">
        <span className="text-green-400 font-mono">{isRunning ? '>' : '$'}</span>
        <input
          ref={inputRef}
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isRunning ? (waitingForInput ? 'Type your answer...' : 'Type to send input to running command...') : 'Type a command...'}
          className="flex-1 bg-transparent text-gray-100 font-mono text-sm outline-none placeholder-gray-500"
          autoComplete="off"
          spellCheck="false"
        />
        <button
          onClick={() => runCommand(command)}
          disabled={!command.trim()}
          className="p-1.5 text-gray-400 hover:text-green-400 disabled:opacity-50 disabled:hover:text-gray-400 transition-colors"
        >
          <Play className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default ProjectTerminal;
