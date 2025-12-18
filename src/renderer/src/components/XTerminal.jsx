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
      
      terminal.onData((data) => {
        const code = data.charCodeAt(0);
        
        if (code === 13) { // Enter
          terminal.write('\r\n');
          const command = commandBuffer.current.trim();
          if (command) {
            executeCommand(terminal, command, projectPath);
          } else {
            writePrompt(terminal, projectPath);
          }
          commandBuffer.current = '';
        } else if (code === 127) { // Backspace
          if (commandBuffer.current.length > 0) {
            commandBuffer.current = commandBuffer.current.slice(0, -1);
            terminal.write('\b \b');
          }
        } else if (code === 3) { // Ctrl+C
          terminal.write('^C\r\n');
          commandBuffer.current = '';
          // Cancel running command
          if (projectId) {
            window.devbox?.terminal?.cancelCommand?.(projectId);
          }
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

      // Execute command via IPC
      const result = await window.devbox?.terminal?.runCommand?.(
        projectId || 'terminal',
        finalCommand,
        { cwd }
      );

      if (result?.output) {
        terminal.write(result.output);
      }
      if (result?.error) {
        terminal.write(`\x1b[31m${result.error}\x1b[0m`);
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
