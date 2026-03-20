const path = require('path');
const fs = require('fs-extra');

module.exports = {
  async downloadMysql(version = '8.4') {
    const id = `mysql-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.mysql[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`MySQL ${version} not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'mysql', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError(`Failed to download MySQL ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

  async downloadMariadb(version = '11.4') {
    const id = `mariadb-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.mariadb[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`MariaDB ${version} not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'mariadb', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError(`Failed to download MariaDB ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

  async downloadRedis(version = '7.4') {
    const id = `redis-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.redis[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`Redis ${version} not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'redis', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError(`Failed to download Redis ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

  async downloadMailpit() {
    const id = 'mailpit';
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.mailpit[platform];

    if (!downloadInfo) {
      throw new Error(`Mailpit not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'mailpit', platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError('Failed to download Mailpit', { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

  async downloadPhpMyAdmin() {
    const id = 'phpmyadmin';
    const downloadInfo = this.downloads.phpmyadmin.all;

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'phpmyadmin');

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);

      try {
        const meta = await this.fetchRemoteMetadata(downloadInfo.url);
        await this.saveServiceMetadata('phpmyadmin', meta);
      } catch (metaErr) {
        this.managers?.log?.systemWarn('Failed to fetch phpmyadmin metadata', { error: metaErr.message });
      }

      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError('Failed to download phpMyAdmin', { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

  async createPhpMyAdminConfig(pmaPath) {
    const configContent = `<?php
/**
 * phpMyAdmin configuration for DevBox Pro
 */

$cfg['blowfish_secret'] = '${this.generateSecret(32)}';
$cfg['Servers'][1]['host'] = '127.0.0.1';
$cfg['Servers'][1]['port'] = '3306';
$cfg['Servers'][1]['auth_type'] = 'cookie';
$cfg['Servers'][1]['user'] = 'root';
$cfg['Servers'][1]['password'] = '';
$cfg['Servers'][1]['AllowNoPassword'] = true;
$cfg['UploadDir'] = '';
$cfg['SaveDir'] = '';
$cfg['DefaultLang'] = 'en';
$cfg['ServerDefault'] = 1;
`;

    await fs.writeFile(path.join(pmaPath, 'config.inc.php'), configContent);
  },

  async downloadNginx(version = '1.28') {
    const id = `nginx-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.nginx[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`Nginx ${version} not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'nginx', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);
      await this.createNginxConfig(extractPath);
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError(`Failed to download Nginx ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

  async createNginxConfig(nginxPath) {
    const confDir = path.join(nginxPath, 'conf');
    const sitesDir = path.join(nginxPath, 'conf', 'sites-enabled');
    await fs.ensureDir(confDir);
    await fs.ensureDir(sitesDir);

    const mainConfig = `
worker_processes  auto;
error_log  logs/error.log;
pid        logs/nginx.pid;

events {
    worker_connections  1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;

    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent" "$http_x_forwarded_for"';

    access_log  logs/access.log  main;

    sendfile        on;
    keepalive_timeout  65;

    # Include site configurations
    include sites-enabled/*.conf;
}
`;
    await fs.writeFile(path.join(confDir, 'nginx.conf'), mainConfig);

    const defaultSite = `
# Default DevBox Pro Site
# Copy this file and modify for each project

server {
    listen       80;
    server_name  localhost;
    root         /path/to/your/project/public;
    index        index.php index.html index.htm;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass   127.0.0.1:9000;
        fastcgi_index  index.php;
        fastcgi_param  SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include        fastcgi_params;
    }

    location ~ /\.ht {
        deny  all;
    }
}
`;
    await fs.writeFile(path.join(sitesDir, 'default.conf.example'), defaultSite);
    await fs.ensureDir(path.join(nginxPath, 'logs'));
  },

  async downloadApache(version = '2.4') {
    const id = `apache-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.apache[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`Apache ${version} not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'apache', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      const urls = [downloadInfo.url, ...(downloadInfo.fallbackUrls || [])];
      let downloaded = false;

      for (const url of urls) {
        try {
          await this.downloadFile(url, downloadPath, id);
          downloaded = true;
          break;
        } catch (err) {
          await fs.remove(downloadPath).catch(() => { });
        }
      }

      if (!downloaded) {
        const manualNote = downloadInfo.manualDownloadNote || '';
        const manualUrl = downloadInfo.manualDownloadUrl || 'https://www.apachelounge.com/download/';
        throw new Error(`Apache download failed. ${manualNote} Manual download: ${manualUrl}`);
      }

      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);

      const apache24Path = path.join(extractPath, 'Apache24');
      if (await fs.pathExists(apache24Path)) {
        const contents = await fs.readdir(apache24Path);
        for (const item of contents) {
          const srcPath = path.join(apache24Path, item);
          const destPath = path.join(extractPath, item);
          await fs.move(srcPath, destPath, { overwrite: true });
        }
        await fs.remove(apache24Path);
      }

      await this.createApacheConfig(extractPath);
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError(`Failed to download Apache ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

  async importApache(filePath, version = '2.4') {
    const id = `apache-${version}`;
    const platform = this.getPlatform();

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      if (!await fs.pathExists(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const isValid = await this.validateZipFile(filePath);
      if (!isValid) {
        throw new Error('Invalid ZIP file. Please download the correct Apache ZIP from Apache Lounge.');
      }

      const extractPath = path.join(this.resourcesPath, 'apache', version, platform);
      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      this.emitProgress(id, { status: 'extracting', progress: 50 });
      await this.extractArchive(filePath, extractPath, id);

      const apache24Path = path.join(extractPath, 'Apache24');
      if (await fs.pathExists(apache24Path)) {
        const contents = await fs.readdir(apache24Path);
        for (const item of contents) {
          const srcPath = path.join(apache24Path, item);
          const destPath = path.join(extractPath, item);
          await fs.move(srcPath, destPath, { overwrite: true });
        }
        await fs.remove(apache24Path);
      }

      await this.createApacheConfig(extractPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

  async createApacheConfig(apachePath) {
    const confDir = path.join(apachePath, 'conf');
    const extraDir = path.join(apachePath, 'conf', 'extra');
    const vhostsDir = path.join(apachePath, 'conf', 'vhosts');
    await fs.ensureDir(confDir);
    await fs.ensureDir(extraDir);
    await fs.ensureDir(vhostsDir);

    const phpConfig = `
# PHP Configuration for Apache
# DevBox Pro will configure the correct PHP path automatically

# Load PHP module (Windows example - adjust path based on PHP version)
# LoadModule php_module "C:/devbox/php/8.3/win/php8apache2_4.dll"

# For PHP-FPM (recommended)
<FilesMatch \.php$>
    SetHandler "proxy:fcgi://127.0.0.1:9000"
</FilesMatch>

# PHP file handling
<IfModule dir_module>
    DirectoryIndex index.php index.html
</IfModule>

# PHP file types
AddType application/x-httpd-php .php
AddType application/x-httpd-php-source .phps
`;
    await fs.writeFile(path.join(extraDir, 'httpd-php.conf'), phpConfig);

    const vhostTemplate = `
# DevBox Pro Virtual Host Template
# Copy and modify for each project

<VirtualHost *:80>
    ServerName myproject.test
    DocumentRoot "/path/to/your/project/public"
    
    <Directory "/path/to/your/project/public">
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
    
    ErrorLog "logs/myproject-error.log"
    CustomLog "logs/myproject-access.log" common
</VirtualHost>

# SSL Example
# <VirtualHost *:443>
#     ServerName myproject.test
#     DocumentRoot "/path/to/your/project/public"
#     
#     SSLEngine on
#     SSLCertificateFile "/path/to/cert.pem"
#     SSLCertificateKeyFile "/path/to/key.pem"
#     
#     <Directory "/path/to/your/project/public">
#         Options Indexes FollowSymLinks
#         AllowOverride All
#         Require all granted
#     </Directory>
# </VirtualHost>
`;
    await fs.writeFile(path.join(vhostsDir, 'template.conf.example'), vhostTemplate);
    await fs.ensureDir(path.join(apachePath, 'logs'));
  },

  generateSecret(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=';
    let result = '';
    for (let i = 0; i < length; i += 1) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },
};