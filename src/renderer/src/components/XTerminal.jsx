import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import 'xterm/css/xterm.css';

const XTerminal = forwardRef(({ 
  projectPath = null, 
  projectId = null,
  onReady = null,
  initialCommand = null,
  readOnly = false,
  className = '',
}, ref) => {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const commandBuffer = useRef('');
  const commandHistory = useRef([]);
  const historyIndex = useRef(-1);
  const savedCommand = useRef('');
  const isRunningCommand = useRef(false);
  const runningProcessId = useRef(null);

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
    if (!terminalRef.current) return;

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

    // Open terminal in container
    terminal.open(terminalRef.current);
    
    // Fit to container
    setTimeout(() => {
      fitAddon.fit();
    }, 100);

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(terminalRef.current);

    // Welcome message
    terminal.writeln('\x1b[1;34m╔══════════════════════════════════════════════════════════════════╗\x1b[0m');
    terminal.writeln('\x1b[1;34m║\x1b[0m  \x1b[1;36mDevBox Pro Terminal\x1b[0m                                             \x1b[1;34m║\x1b[0m');
    terminal.writeln('\x1b[1;34m╚══════════════════════════════════════════════════════════════════╝\x1b[0m');
    terminal.writeln('');

    if (projectPath) {
      terminal.writeln(`\x1b[90mWorking directory: ${projectPath}\x1b[0m`);
      terminal.writeln('');
    }

    // Handle input if not read-only
    if (!readOnly) {
      writePrompt(terminal, projectPath);
      
      let escapeSequence = '';
      
      terminal.onData(async (data) => {
        // Handle escape sequences for arrow keys
        if (escapeSequence.length > 0 || data === '\x1b') {
          escapeSequence += data;
          
          // Check for complete escape sequences
          if (escapeSequence === '\x1b[A') { // Arrow Up
            escapeSequence = '';
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
          } else if (escapeSequence === '\x1b[B') { // Arrow Down
            escapeSequence = '';
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
          } else if (escapeSequence === '\x1b[C') { // Arrow Right
            escapeSequence = '';
            return; // Ignore for now
          } else if (escapeSequence === '\x1b[D') { // Arrow Left
            escapeSequence = '';
            return; // Ignore for now
          } else if (escapeSequence.length >= 3) {
            // Unknown escape sequence, reset
            escapeSequence = '';
            return;
          }
          return;
        }
        
        const code = data.charCodeAt(0);
        
        if (code === 13) { // Enter
          terminal.write('\r\n');
          
          if (isRunningCommand.current && runningProcessId.current) {
            // Send input to running process (include the typed text + newline)
            const inputText = commandBuffer.current + '\n';
            console.log('Sending input to process:', runningProcessId.current, 'Input:', JSON.stringify(inputText));
            const result = await window.devbox?.terminal?.sendInput?.(runningProcessId.current, inputText);
            console.log('sendInput result:', result);
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
        } else if (code >= 32) { // Printable characters
          commandBuffer.current += data;
          terminal.write(data);
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
          terminal.write(event.text);
        }
      };

      // Listen for output events
      const removeListener = window.devbox?.terminal?.onOutput?.(outputHandler);

      try {
        const result = await window.devbox?.terminal?.runCommand?.(
          processId,
          finalCommand,
          { cwd, interactive: true }
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
        padding: '8px',
        borderRadius: '8px',
      }}
    />
  );
});

XTerminal.displayName = 'XTerminal';

export default XTerminal;
