const path = require('path');
const fs = require('fs-extra');

module.exports = {
  async installSymfony(project, mainWindow = null) {
    const projectPath = project.path;
    const phpVersion = project.phpVersion || '8.4';
    const projectName = project.name || 'symfony';
    const parentPath = path.dirname(projectPath);
    const folderName = path.basename(projectPath);

    await fs.ensureDir(parentPath);

    const binary = this.managers.binaryDownload;
    if (!binary) {
      throw new Error('BinaryDownloadManager not available');
    }

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
        } catch {
          // Ignore send errors.
        }
      }
    };

    onOutput('═══════════════════════════════════════════════════════════════', 'info');
    onOutput('📦 Installing Symfony...', 'info');
    onOutput('$ composer create-project symfony/skeleton', 'command');
    onOutput('═══════════════════════════════════════════════════════════════', 'info');

    try {
      await binary.runComposer(
        parentPath,
        `create-project symfony/skeleton ${folderName} --prefer-dist --no-interaction`,
        phpVersion,
        onOutput
      );

      onOutput('✓ Symfony skeleton installed successfully!', 'success');
    } catch (error) {
      this.managers.log?.systemError('[installSymfony] Composer error', { error: error.message });
      onOutput(`✗ Composer error: ${error.message}`, 'error');
      throw error;
    }

    try {
      onOutput('Installing webapp dependencies...', 'info');
      onOutput('$ composer require webapp', 'command');

      await binary.runComposer(
        projectPath,
        'require webapp --no-interaction',
        phpVersion,
        onOutput
      );

      onOutput('✓ Webapp dependencies installed!', 'success');
    } catch (error) {
      onOutput(`Note: Could not install webapp pack: ${error.message}`, 'warning');
      onOutput('You can install it manually later with: composer require webapp', 'info');
    }

    try {
      const envPath = path.join(projectPath, '.env');
      if (await fs.pathExists(envPath)) {
        onOutput('Configuring .env file...', 'info');
        let envContent = await fs.readFile(envPath, 'utf-8');

        const dbName = this.sanitizeDatabaseName(projectName);
        const dbInfo = this.managers.database?.getDatabaseInfo() || {};
        const dbUser = dbInfo.user || 'root';
        const dbPassword = dbInfo.password || '';
        const dbPort = dbInfo.port || 3306;
        const dbUrl = `mysql://${dbUser}:${dbPassword}@127.0.0.1:${dbPort}/${dbName}?serverVersion=8.0`;

        if (envContent.includes('DATABASE_URL=')) {
          envContent = envContent.replace(/^DATABASE_URL=.*/m, `DATABASE_URL="${dbUrl}"`);
        } else {
          envContent += `\nDATABASE_URL="${dbUrl}"\n`;
        }

        envContent = envContent.replace(/^APP_ENV=.*/m, 'APP_ENV=dev');

        await fs.writeFile(envPath, envContent);
        onOutput('✓ .env file configured', 'success');
      }
    } catch (error) {
      onOutput(`Warning: Could not configure .env: ${error.message}`, 'warning');
    }

    onOutput('', 'info');
    onOutput('🎉 Symfony installed successfully!', 'success');
    onOutput(`Project location: ${projectPath}`, 'info');

    return { success: true };
  },
};