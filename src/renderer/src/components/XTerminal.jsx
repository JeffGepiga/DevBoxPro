import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import 'xterm/css/xterm.css';

// Ensure xterm fills its container correctly
const xtermStyle = `
  .xterm-container .xterm {
    height: 100% !important;
    width: 100% !important;
    padding: 0 !important;
  }
  .xterm-container .xterm-viewport {
    width: 100% !important;
    overflow-y: auto !important;
  }
  .xterm-container .xterm-screen {
    width: 100% !important;
  }
`;

let styleInjected = false;
function injectXtermStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = xtermStyle;
  document.head.appendChild(style);
}

const XTerminal = forwardRef(({
  projectPath = null,
  projectId = null,
  onReady = null,
  initialCommand = null,
  readOnly = false,
  className = '',
  isVisible = true,
}, ref) => {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const mountRef = useRef(null); // Separate mount point for xterm (no padding)
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    injectXtermStyle();
  }, []);
  const commandBuffer = useRef('');
  const commandHistory = useRef([]);
  const historyIndex = useRef(-1);
  const savedCommand = useRef('');
  const isRunningCommand = useRef(false);
  const runningProcessId = useRef(null);

  // Re-fit whenever the terminal becomes visible (container was display:none before)
  useEffect(() => {
    if (isVisible && fitAddonRef.current) {
      // Small delay to let the browser complete the layout after display change
      const t = setTimeout(() => fitAddonRef.current?.fit(), 50);
      return () => clearTimeout(t);
    }
  }, [isVisible]);

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    write: (text) => {
      if (xtermRef.current) {
        xtermRef.current.write(text);
      }
    },
    writeln: (text) => {
      if (xtermRef.current) {
        xtermRef.current.writeln(text);
      }
    },
    clear: () => {
      if (xtermRef.current) {
        xtermRef.current.clear();
      }
    },
    focus: () => {
      if (xtermRef.current) {
        xtermRef.current.focus();
      }
    },
    fit: () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    },
    getTerminal: () => xtermRef.current,
  }));

  useEffect(() => {
    if (!mountRef.current) return;

    // Create terminal
    const terminal = new Terminal({
      theme: {
        background: '#1a1b26',
        foreground: '#a9b1d6',
        cursor: '#c0caf5',
        cursorAccent: '#1a1b26',
        selection: 'rgba(128, 128, 128, 0.3)',
        black: '#32344a',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#ad8ee6',
        cyan: '#449dab',
        white: '#787c99',
        brightBlack: '#444b6a',
        brightRed: '#ff7a93',
        brightGreen: '#b9f27c',
        brightYellow: '#ff9e64',
        brightBlue: '#7da6ff',
        brightMagenta: '#bb9af7',
        brightCyan: '#0db9d7',
        brightWhite: '#acb0d0',
      },
      fontFamily: 'JetBrains Mono, Cascadia Code, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
      allowProposedApi: true,
    });

    // Load addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    // Open terminal in its dedicated mount div (no padding so FitAddon measures correctly)
    terminal.open(mountRef.current);

    // Fit to container
    setTimeout(() => {
      fitAddon.fit();
    }, 50);

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(mountRef.current);

    // Welcome message

    if (projectPath) {
      terminal.writeln(`\x1b[90mWorking directory: ${projectPath}\x1b[0m`);
      terminal.writeln('');
    }

    // Handle input if not read-only
    if (!readOnly) {
      writePrompt(terminal, projectPath);

      terminal.onData(async (data) => {
        // Handle escape sequences for arrow keys
        if (data.startsWith('\x1b')) {
          if (data === '\x1b[A') { // Arrow Up
            if (isRunningCommand.current) return;

            if (commandHistory.current.length > 0) {
              // Save current command when starting to navigate
              if (historyIndex.current === -1) {
                savedCommand.current = commandBuffer.current;
              }

              if (historyIndex.current < commandHistory.current.length - 1) {
                historyIndex.current++;
                const historyCommand = commandHistory.current[commandHistory.current.length - 1 - historyIndex.current];

                // Clear current line and write history command
                clearCurrentLine(terminal, projectPath);
                commandBuffer.current = historyCommand;
                terminal.write(historyCommand);
              }
            }
            return;
          } else if (data === '\x1b[B') { // Arrow Down
            if (isRunningCommand.current) return;

            if (historyIndex.current > 0) {
              historyIndex.current--;
              const historyCommand = commandHistory.current[commandHistory.current.length - 1 - historyIndex.current];

              clearCurrentLine(terminal, projectPath);
              commandBuffer.current = historyCommand;
              terminal.write(historyCommand);
            } else if (historyIndex.current === 0) {
              historyIndex.current = -1;
              clearCurrentLine(terminal, projectPath);
              commandBuffer.current = savedCommand.current;
              terminal.write(savedCommand.current);
            }
            return;
          } else if (data === '\x1b[C') { // Arrow Right
            return; // Ignore for now
          } else if (data === '\x1b[D') { // Arrow Left
            return; // Ignore for now
          }
          return;
        }

        const code = data.charCodeAt(0);

        if (code === 13) { // Enter
          terminal.write('\r\n');

          if (isRunningCommand.current && runningProcessId.current) {
            // Send input to running process (include the typed text + newline)
            const inputText = commandBuffer.current + '\n';
            const result = await window.devbox?.terminal?.sendInput?.(runningProcessId.current, inputText);
            commandBuffer.current = '';
          } else {
            const command = commandBuffer.current.trim();
            if (command) {
              // Add to history (avoid duplicates)
              if (commandHistory.current[commandHistory.current.length - 1] !== command) {
                commandHistory.current.push(command);
                // Limit history to 100 commands
                if (commandHistory.current.length > 100) {
                  commandHistory.current.shift();
                }
              }
              historyIndex.current = -1;
              executeCommand(terminal, command, projectPath);
            } else {
              writePrompt(terminal, projectPath);
            }
            commandBuffer.current = '';
          }
        } else if (code === 127) { // Backspace
          if (commandBuffer.current.length > 0) {
            commandBuffer.current = commandBuffer.current.slice(0, -1);
            terminal.write('\b \b');
          }
        } else if (code === 3) { // Ctrl+C
          if (terminal.hasSelection()) {
            navigator.clipboard.writeText(terminal.getSelection());
            terminal.clearSelection();
            return;
          }
          terminal.write('^C\r\n');
          commandBuffer.current = '';
          historyIndex.current = -1;

          // Cancel running command
          if (isRunningCommand.current && runningProcessId.current) {
            window.devbox?.terminal?.cancelCommand?.(runningProcessId.current);
          }

          isRunningCommand.current = false;
          runningProcessId.current = null;
          writePrompt(terminal, projectPath);
        } else if (code === 22) { // Ctrl+V
          try {
            const text = await navigator.clipboard.readText();
            const cleanText = text.replace(/\r?\n/g, ' '); // simple cleaning of multilines
            commandBuffer.current += cleanText;
            terminal.write(cleanText);
          } catch (err) {
            console.error('Failed to paste:', err);
          }
        } else if (code >= 32) { // Printable characters
          // In case the user pasted using context menu native browser paste
          if (data.length > 1 && (data.includes('\n') || data.includes('\r'))) {
            const cleanText = data.replace(/\r?\n/g, ' ');
            commandBuffer.current += cleanText;
            terminal.write(cleanText);
          } else {
            commandBuffer.current += data;
            terminal.write(data);
          }
        }
      });
    }

    setIsReady(true);
    onReady?.(terminal);

    // Run initial command if provided
    if (initialCommand && !readOnly) {
      setTimeout(() => {
        terminal.write(initialCommand);
        commandBuffer.current = initialCommand;
        terminal.write('\r\n');
        executeCommand(terminal, initialCommand, projectPath);
        commandBuffer.current = '';
      }, 200);
    }

    terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).catch(err => {
          console.error("Failed to copy text:", err);
        });
      }
    });

    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
    };
  }, []);

  const writePrompt = (terminal, path) => {
    const shortPath = path ? path.split(/[\\/]/).pop() : 'devbox';
    terminal.write(`\x1b[1;32m${shortPath}\x1b[0m \x1b[1;34m❯\x1b[0m `);
  };

  const clearCurrentLine = (terminal, path) => {
    const shortPath = path ? path.split(/[\\/]/).pop() : 'devbox';
    const promptLength = shortPath.length + 3 + commandBuffer.current.length; // path + " ❯ " + command
    terminal.write('\r\x1b[K'); // Move to start and clear line
    terminal.write(`\x1b[1;32m${shortPath}\x1b[0m \x1b[1;34m❯\x1b[0m `);
  };

  const executeCommand = async (terminal, command, cwd) => {
    try {
      // Parse command
      const parts = command.split(' ');
      const cmd = parts[0].toLowerCase();

      // Handle built-in commands
      if (cmd === 'clear' || cmd === 'cls') {
        terminal.clear();
        writePrompt(terminal, cwd);
        return;
      }

      if (cmd === 'help') {
        terminal.writeln('\x1b[1;36mAvailable Commands:\x1b[0m');
        terminal.writeln('  \x1b[33mphp\x1b[0m           Run PHP commands');
        terminal.writeln('  \x1b[33mcomposer\x1b[0m      Run Composer commands');
        terminal.writeln('  \x1b[33mnpm\x1b[0m           Run NPM commands');
        terminal.writeln('  \x1b[33martisan\x1b[0m       Run Laravel Artisan (php artisan)');
        terminal.writeln('  \x1b[33mclear\x1b[0m         Clear the terminal');
        terminal.writeln('  \x1b[33mhelp\x1b[0m          Show this help message');
        terminal.writeln('');
        writePrompt(terminal, cwd);
        return;
      }

      // Handle artisan shortcut
      let finalCommand = command;
      if (cmd === 'artisan') {
        finalCommand = `php artisan ${parts.slice(1).join(' ')}`;
      }

      // Mark as running
      isRunningCommand.current = true;

      // Execute command via IPC with streaming support
      const processId = projectId || 'terminal';
      runningProcessId.current = processId;

      // Set up output listener for streaming
      const outputHandler = (event) => {
        // Event structure from backend: { projectId, text, type }
        // Add null check as other terminal events may have different structure
        if (event && event.projectId === processId && event.text) {
          // Normalize line endings: \n alone means "move down, keep column" in VT100.
          // Without a real PTY, npm/node output raw \n so we must convert to \r\n
          // so xterm resets the cursor to column 0 on each new line.
          terminal.write(event.text.replace(/\r?\n/g, '\r\n'));
        }
      };

      // Listen for output events
      const removeListener = window.devbox?.terminal?.onOutput?.(outputHandler);

      try {
        const result = await window.devbox?.terminal?.runCommand?.(
          processId,
          finalCommand,
          {
            cwd,
            interactive: true,
          }
        );

        // Remove listener after command completes
        if (removeListener) removeListener();

        // Don't write buffered output since we already handled streaming
        // Only show errors that weren't streamed
        if (result?.error) {
          terminal.write(`\x1b[31m${result.error}\x1b[0m`);
        }
      } catch (error) {
        if (removeListener) removeListener();
        terminal.writeln(`\x1b[31mError: ${error.message}\x1b[0m`);
      } finally {
        isRunningCommand.current = false;
        runningProcessId.current = null;
      }

      terminal.writeln('');
      writePrompt(terminal, cwd);
    } catch (error) {
      terminal.writeln(`\x1b[31mError: ${error.message}\x1b[0m`);
      writePrompt(terminal, cwd);
    }
  };

  return (
    <div
      ref={terminalRef}
      className={`xterm-container ${className}`}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#1a1b26',
        borderRadius: '8px',
        overflow: 'hidden',
        padding: '4px',
        boxSizing: 'border-box',
      }}
    >
      {/* Separate inner div for xterm mount — padding-free so FitAddon measures correctly */}
      <div
        ref={mountRef}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
});

XTerminal.displayName = 'XTerminal';

export default XTerminal;
