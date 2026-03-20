const path = require('path');
const fs = require('fs-extra');

module.exports = {
  async installWordPress(project, mainWindow = null) {
    const projectPath = project.path;
    const projectName = project.name || 'wordpress';
    const wpVersion = project.wordpressVersion || 'latest';

    await fs.ensureDir(projectPath);

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
    onOutput('📦 Installing WordPress...', 'info');
    onOutput(`Version: ${wpVersion}`, 'info');
    onOutput('═══════════════════════════════════════════════════════════════', 'info');

    try {
      const downloadUrl = wpVersion === 'latest'
        ? 'https://wordpress.org/latest.zip'
        : `https://wordpress.org/wordpress-${wpVersion}.zip`;
      const zipPath = path.join(projectPath, 'wordpress.zip');

      onOutput('Step 1/3: Downloading WordPress...', 'info');
      onOutput(`URL: ${downloadUrl}`, 'command');

      const https = require('https');
      const http = require('http');

      await new Promise((resolve, reject) => {
        const downloadFile = (url, dest, retryWithoutVerify = false) => {
          const file = fs.createWriteStream(dest);
          const protocol = url.startsWith('https') ? https : http;
          const options = url.startsWith('https')
            ? {
                family: 4,
                agent: new https.Agent({ rejectUnauthorized: !retryWithoutVerify }),
              }
            : { family: 4 };

          const request = protocol.get(url, options, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
              file.close(() => {
                try {
                  if (fs.existsSync(dest)) {
                    fs.unlinkSync(dest);
                  }
                } catch {
                  // Ignore cleanup errors.
                }
                downloadFile(response.headers.location, dest, retryWithoutVerify);
              });
              return;
            }

            if (response.statusCode !== 200) {
              file.close(() => {
                try {
                  if (fs.existsSync(dest)) {
                    fs.unlinkSync(dest);
                  }
                } catch {
                  // Ignore cleanup errors.
                }
                reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
              });
              return;
            }

            const totalSize = parseInt(response.headers['content-length'], 10) || 0;
            let downloadedSize = 0;
            let lastProgress = 0;

            response.on('data', (chunk) => {
              downloadedSize += chunk.length;
              if (totalSize > 0) {
                const progress = Math.floor((downloadedSize / totalSize) * 100);
                if (progress >= lastProgress + 20) {
                  onOutput(`   Downloading: ${progress}%`, 'info');
                  lastProgress = progress;
                }
              }
            });

            response.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
          });

          request.on('error', (err) => {
            file.close(() => {
              fs.unlink(dest, () => {});
            });

            if (!err.message && err.errors && err.errors.length > 0) {
              err.message = err.errors.map((entry) => entry.message || entry.code).join(', ');
            }

            if (!retryWithoutVerify && (
              err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
              || err.code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'
              || (err.message && (err.message.includes('certificate') || err.message.includes('SSL')))
            )) {
              onOutput('   SSL certificate verification failed, retrying...', 'warning');
              downloadFile(url, dest, true);
              return;
            }

            reject(err);
          });
        };

        downloadFile(downloadUrl, zipPath);
      });

      onOutput('✓ Download complete!', 'success');
      onOutput('Step 2/3: Extracting files...', 'info');

      const AdmZip = require('adm-zip');
      const zip = new AdmZip(path.join(projectPath, 'wordpress.zip'));
      const zipEntries = zip.getEntries();

      let extractedCount = 0;
      for (const entry of zipEntries) {
        if (entry.isDirectory) {
          continue;
        }

        let entryPath = entry.entryName;
        if (entryPath.startsWith('wordpress/')) {
          entryPath = entryPath.substring('wordpress/'.length);
        }

        if (entryPath) {
          const destPath = path.join(projectPath, entryPath);
          await fs.ensureDir(path.dirname(destPath));
          await fs.writeFile(destPath, entry.getData());
          extractedCount++;
        }
      }

      await fs.unlink(path.join(projectPath, 'wordpress.zip'));
      onOutput(`✓ Extracted ${extractedCount} files!`, 'success');
      onOutput('Step 3/3: Configuring WordPress...', 'info');

      const wpConfigSamplePath = path.join(projectPath, 'wp-config-sample.php');
      const wpConfigPath = path.join(projectPath, 'wp-config.php');

      if (await fs.pathExists(wpConfigSamplePath) && !await fs.pathExists(wpConfigPath)) {
        let wpConfig = await fs.readFile(wpConfigSamplePath, 'utf-8');

        const dbName = this.sanitizeDatabaseName(projectName);
        const dbInfo = this.managers.database?.getDatabaseInfo() || {};
        const dbUser = dbInfo.user || 'root';
        const dbPassword = dbInfo.password || '';
        const dbHost = `127.0.0.1:${dbInfo.port || 3306}`;

        wpConfig = wpConfig.replace(/define\(\s*'DB_NAME',\s*'[^']*'\s*\)/, `define( 'DB_NAME', '${dbName}' )`);
        wpConfig = wpConfig.replace(/define\(\s*'DB_USER',\s*'[^']*'\s*\)/, `define( 'DB_USER', '${dbUser}' )`);
        wpConfig = wpConfig.replace(/define\(\s*'DB_PASSWORD',\s*'[^']*'\s*\)/, `define( 'DB_PASSWORD', '${dbPassword}' )`);
        wpConfig = wpConfig.replace(/define\(\s*'DB_HOST',\s*'[^']*'\s*\)/, `define( 'DB_HOST', '${dbHost}' )`);

        const generateSalt = () => {
          const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}|;:,.<>?';
          let salt = '';
          for (let index = 0; index < 64; index++) {
            salt += chars.charAt(Math.floor(Math.random() * chars.length));
          }
          return salt;
        };

        const salts = [
          'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY',
          'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT',
        ];

        for (const salt of salts) {
          wpConfig = wpConfig.replace(
            new RegExp(`define\\(\\s*'${salt}',\\s*'[^']*'\\s*\\)`),
            `define( '${salt}', '${generateSalt()}' )`
          );
        }

        await fs.writeFile(wpConfigPath, wpConfig);
        onOutput('✓ wp-config.php configured!', 'success');
      }

      onOutput('', 'info');
      onOutput('🎉 WordPress installed successfully!', 'success');
      onOutput(`Project location: ${projectPath}`, 'info');
      onOutput('', 'info');
      onOutput('Next steps:', 'info');
      onOutput('  1. Start the project to launch the web server', 'info');
      onOutput('  2. Visit your site to complete the WordPress setup wizard', 'info');

      return { success: true };
    } catch (error) {
      this.managers.log?.systemError('[installWordPress] Error', { error: error.message });
      onOutput(`✗ Installation error: ${error.message}`, 'error');
      throw error;
    }
  },
};