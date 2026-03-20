const path = require('path');
const fs = require('fs-extra');
const childProcess = require('child_process');

function quoteWindowsCmdArgument(value) {
  const stringValue = String(value ?? '');
  if (!/[\s"&()\[\]{}^=;!'+,`~|<>]/.test(stringValue)) {
    return stringValue;
  }

  return `"${stringValue.replace(/"/g, '""')}"`;
}

module.exports = {
  async installNodeFramework(project, mainWindow = null) {
    const divider = '-'.repeat(64);
    const projectPath = project.path;
    const nodejsVersion = project.services?.nodejsVersion || '20';
    const framework = project.nodeFramework || '';
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const resourcePath = this.getResourcesPath();
    const nodeDir = path.join(resourcePath, 'nodejs', nodejsVersion, platform);
    const npmCmd = process.platform === 'win32'
      ? path.join(nodeDir, 'npm.cmd')
      : path.join(nodeDir, 'bin', 'npm');
    const npxCmd = process.platform === 'win32'
      ? path.join(nodeDir, 'npx.cmd')
      : path.join(nodeDir, 'bin', 'npx');
    const envWithNode = {
      ...process.env,
      PATH: process.platform === 'win32'
        ? `${nodeDir};${process.env.PATH || ''}`
        : `${path.join(nodeDir, 'bin')}:${process.env.PATH || ''}`,
    };

    const onOutput = (text, type) => {
      const cleanText = text.toString().replace(/\r\n/g, '\n').trim();
      if (!cleanText) {
        return;
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents.send('terminal:output', {
            projectId: 'installation',
            text: cleanText,
            type,
          });
        } catch (err) {
          // Ignore send errors.
        }
      }
    };

    const runCmd = (command, args, cwd, label) => new Promise((resolve, reject) => {
      onOutput(`$ ${label || [command, ...args].join(' ')}`, 'command');
      const isWindowsCommandWrapper = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
      const spawnCommand = isWindowsCommandWrapper ? (process.env.COMSPEC || 'cmd.exe') : command;
      const spawnArgs = isWindowsCommandWrapper
        ? ['/d', '/s', '/c', [quoteWindowsCmdArgument(command), ...args.map(quoteWindowsCmdArgument)].join(' ')]
        : args;

      const proc = childProcess.spawn(spawnCommand, spawnArgs, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: envWithNode,
      });
      proc.stdout.on('data', (data) => onOutput(data.toString(), 'stdout'));
      proc.stderr.on('data', (data) => onOutput(data.toString(), 'stderr'));
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command exited with code ${code}`));
        }
      });
      proc.on('error', (err) => reject(err));
    });

    await fs.ensureDir(projectPath);

    const frameworkNames = {
      express: 'Express',
      fastify: 'Fastify',
      nestjs: 'NestJS',
      nextjs: 'Next.js',
      nuxtjs: 'Nuxt.js',
      koa: 'Koa',
      hapi: 'Hapi',
      adonisjs: 'AdonisJS',
      remix: 'Remix',
      sveltekit: 'SvelteKit',
      strapi: 'Strapi',
      elysia: 'Elysia',
    };

    const displayName = frameworkNames[framework] || 'Node.js';

    onOutput(divider, 'info');
    onOutput(`Setting up ${displayName} project...`, 'info');
    onOutput(divider, 'info');

    try {
      switch (framework) {
        case 'express':
          await runCmd(npxCmd, ['-y', 'express-generator', '.', '--force', '--no-view'], projectPath, 'npx express-generator . --force --no-view');
          await runCmd(npmCmd, ['install'], projectPath, 'npm install');
          break;

        case 'fastify':
          await runCmd(npxCmd, ['-y', 'fastify-cli', 'generate', '.', '--lang=js'], projectPath, 'npx fastify-cli generate . --lang=js');
          await runCmd(npmCmd, ['install'], projectPath, 'npm install');
          break;

        case 'nestjs':
          await runCmd(npxCmd, ['-y', '@nestjs/cli', 'new', '.', '--skip-git', '--package-manager', 'npm'], projectPath, 'npx @nestjs/cli new . --skip-git --package-manager npm');
          break;

        case 'nextjs':
          await runCmd(npxCmd, ['-y', 'create-next-app@latest', '.', '--use-npm', '--eslint', '--no-tailwind', '--no-src-dir', '--no-app', '--no-import-alias', '--turbopack'], projectPath, 'npx create-next-app@latest . --use-npm');
          break;

        case 'nuxtjs':
          await runCmd(npxCmd, ['-y', 'nuxi@latest', 'init', '.', '--force', '--packageManager', 'npm'], projectPath, 'npx nuxi init . --force');
          await runCmd(npmCmd, ['install'], projectPath, 'npm install');
          break;

        case 'koa':
          await runCmd(npmCmd, ['init', '-y'], projectPath, 'npm init -y');
          await runCmd(npmCmd, ['install', 'koa'], projectPath, 'npm install koa');
          await fs.writeFile(
            path.join(projectPath, 'index.js'),
            `const Koa = require('koa');\nconst app = new Koa();\n\napp.use(async ctx => {\n  ctx.body = 'Hello from Koa!';\n});\n\nconst PORT = process.env.PORT || 3000;\napp.listen(PORT, () => {\n  console.log(\`Server running on port \${PORT}\`);\n});\n`
          );
          onOutput('Created index.js with Koa starter', 'success');
          break;

        case 'hapi':
          await runCmd(npmCmd, ['init', '-y'], projectPath, 'npm init -y');
          await runCmd(npmCmd, ['install', '@hapi/hapi'], projectPath, 'npm install @hapi/hapi');
          await fs.writeFile(
            path.join(projectPath, 'index.js'),
            `'use strict';\nconst Hapi = require('@hapi/hapi');\n\nconst init = async () => {\n  const server = Hapi.server({\n    port: process.env.PORT || 3000,\n    host: '0.0.0.0'\n  });\n\n  server.route({\n    method: 'GET',\n    path: '/',\n    handler: (request, h) => {\n      return 'Hello from Hapi!';\n    }\n  });\n\n  await server.start();\n  console.log('Server running on %s', server.info.uri);\n};\n\ninit();\n`
          );
          onOutput('Created index.js with Hapi starter', 'success');
          break;

        case 'adonisjs':
          await runCmd(npmCmd, ['init', 'adonis-ts-app@latest', '.', '--', '--boilerplate=web'], projectPath, 'npm init adonis-ts-app . --boilerplate=web');
          break;

        case 'remix':
          await runCmd(npxCmd, ['-y', 'create-remix@latest', '.', '--no-install', '--no-git-init'], projectPath, 'npx create-remix . --no-install --no-git-init');
          await runCmd(npmCmd, ['install'], projectPath, 'npm install');
          break;

        case 'sveltekit':
          await runCmd(npxCmd, ['-y', 'sv', 'create', '.', '--template', 'minimal', '--no-add-ons', '--no-install'], projectPath, 'npx sv create . --template minimal');
          await runCmd(npmCmd, ['install'], projectPath, 'npm install');
          break;

        case 'strapi':
          await runCmd(npxCmd, ['-y', 'create-strapi-app@latest', '.', '--quickstart', '--no-run'], projectPath, 'npx create-strapi-app . --quickstart --no-run');
          break;

        case 'elysia':
          await runCmd(npmCmd, ['init', '-y'], projectPath, 'npm init -y');
          await runCmd(npmCmd, ['install', 'elysia'], projectPath, 'npm install elysia');
          await fs.writeFile(
            path.join(projectPath, 'index.js'),
            `const { Elysia } = require('elysia');\n\nconst app = new Elysia()\n  .get('/', () => 'Hello from Elysia!')\n  .listen(process.env.PORT || 3000);\n\nconsole.log(\`Server running on port \${app.server?.port}\`);\n`
          );
          onOutput('Created index.js with Elysia starter', 'success');
          break;

        default:
          await runCmd(npmCmd, ['init', '-y'], projectPath, 'npm init -y');
          await fs.writeFile(
            path.join(projectPath, 'index.js'),
            `const http = require('http');\n\nconst PORT = process.env.PORT || 3000;\n\nconst server = http.createServer((req, res) => {\n  res.writeHead(200, { 'Content-Type': 'text/plain' });\n  res.end('Hello from Node.js!');\n});\n\nserver.listen(PORT, () => {\n  console.log(\`Server running on port \${PORT}\`);\n});\n`
          );
          onOutput('Created index.js with Node.js starter', 'success');
          break;
      }

      onOutput(`${displayName} project scaffolded successfully!`, 'success');
    } catch (error) {
      this.managers.log?.systemError('[installNodeFramework] Framework scaffolding error', { framework, error: error.message });
      onOutput(`Framework scaffolding error: ${error.message}`, 'error');
      throw error;
    }
  },
};