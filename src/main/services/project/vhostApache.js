const path = require('path');
const fs = require('fs-extra');
const { isPortAvailable } = require('../../utils/PortUtils');
const { getPlatformKey, resolvePhpCgiPath } = require('../../utils/PhpPathResolver');

module.exports = {
  async createApacheVhost(project, targetApacheVersion = null) {
    const dataPath = this.getDataPath();
    const vhostsDir = path.join(dataPath, 'apache', 'vhosts');
    const sslDir = path.join(dataPath, 'ssl', project.domain).replace(/\\/g, '/');

    const apacheVersion = this.getEffectiveWebServerVersion(project, 'apache');
    const effectiveApacheVersion = targetApacheVersion
      || this.managers.service?.serviceStatus?.get('apache')?.version
      || apacheVersion;

    await fs.ensureDir(vhostsDir);

    const documentRoot = this.getDocumentRoot(project);
    await fs.ensureDir(documentRoot);

    let phpFpmPort = this.getPhpFpmPort(project);
    if (isNaN(phpFpmPort) || phpFpmPort < 9000 || phpFpmPort > 9999) {
      this.managers.log?.systemError(`[Apache Vhost] Invalid PHP-CGI port calculated: ${phpFpmPort}. Using default 9000.`);
      phpFpmPort = 9000;
    }

    const phpFpmPortStr = String(phpFpmPort).trim();
    const serviceManager = this.managers.service;
    const apachePorts = serviceManager?.getServicePorts('apache', effectiveApacheVersion);
    const httpPort = apachePorts?.httpPort || 80;
    const httpsPort = apachePorts?.sslPort || 443;
    const networkAccess = project.networkAccess || false;

    let canUsePort80 = false;
    if (networkAccess) {
      if (this.networkPort80Owner === null) {
        const port80Free = await isPortAvailable(80);
        const ownServerOnPort80 = !port80Free && this.managers.service?.standardPortOwner === 'apache';
        canUsePort80 = (port80Free || ownServerOnPort80) && httpPort === 80;
        if (canUsePort80) {
          this.networkPort80Owner = project.id;
        }
      } else if (this.networkPort80Owner === project.id) {
        canUsePort80 = true;
      }
    }

    let finalHttpPort;
    if (networkAccess) {
      finalHttpPort = canUsePort80 ? 80 : (project.port || httpPort);
    } else {
      finalHttpPort = httpPort;
    }

    const listenAddress = '*';
    const allApacheDomains = this.getProjectServerAliasEntries(project);
    const httpApacheDomains = [...allApacheDomains];
    if (networkAccess && canUsePort80) {
      httpApacheDomains.push('*');
    }
    const httpServerAlias = httpApacheDomains.join(' ');
    const httpsServerAlias = allApacheDomains.join(' ');

    const phpVersion = project.phpVersion || '8.4';
    const platform = getPlatformKey();
    const resourcesPath = this.getResourcesPath();
    const phpCgiPath = (resolvePhpCgiPath(resourcesPath, phpVersion, platform)
      || path.join(resourcesPath, 'php', phpVersion, platform, platform === 'win' ? 'php-cgi.exe' : 'php-cgi')).replace(/\\/g, '/');
    const phpCgiAction = platform === 'win' ? '/php-cgi/php-cgi.exe' : '/php-cgi/php-cgi';

    let config = `
# DevBox Pro - ${project.name}
# Domain: ${project.domain}
# Generated: ${new Date().toISOString()}
  # NOTE: Auto-generated file. Manual edits are not recommended.
  # This file is regenerated when DevBox starts, stops, or reloads the project/service.
# Apache running on ports HTTP=${finalHttpPort}, SSL=${httpsPort}
# PHP Version: ${phpVersion}${networkAccess ? '\n# Network Access: ENABLED - accessible from local network' : ''}${canUsePort80 ? '\n# Port 80 (first-come-first-served)' : ''}

# HTTP Virtual Host
<VirtualHost ${listenAddress}:${finalHttpPort}>
    ServerName ${project.domain}
  ServerAlias ${httpServerAlias}
    DocumentRoot "${documentRoot}"
    
    <Directory "${documentRoot}">
        Options Indexes FollowSymLinks MultiViews ExecCGI
        AllowOverride All
        Require all granted
        
        # Enable .htaccess
        <IfModule mod_rewrite.c>
            RewriteEngine On
            RewriteBase /
            RewriteCond %{REQUEST_FILENAME} !-f
            RewriteCond %{REQUEST_FILENAME} !-d
            RewriteRule ^(.*)$ index.php?$1 [L,QSA]
        </IfModule>
    </Directory>

    # PHP Configuration using Action/AddHandler
    ScriptAlias /php-cgi/ "${path.dirname(phpCgiPath).replace(/\\/g, '/')}/"
    <Directory "${path.dirname(phpCgiPath).replace(/\\/g, '/')}">
        AllowOverride None
        Options None
        Require all granted
    </Directory>
    
    Action application/x-httpd-php "${phpCgiAction}"
    AddHandler application/x-httpd-php .php

    DirectoryIndex index.php index.html

    ErrorLog "${dataPath}/apache/logs/${project.id}-error.log"
    CustomLog "${dataPath}/apache/logs/${project.id}-access.log" combined
</VirtualHost>
`;

    const certsExist = await this.ensureProjectSslCertificates(project, sslDir);

    if (project.ssl && !certsExist) {
      this.managers.log?.systemWarn(`SSL enabled for ${project.domain} but certificates not found at ${sslDir}. Skipping SSL block.`);
    }

    if (project.ssl && certsExist) {
      const listenAddressSsl = '*';
      config += `
# HTTPS Virtual Host (SSL) - Port ${httpsPort}
<VirtualHost ${listenAddressSsl}:${httpsPort}>
    ServerName ${project.domain}
  ServerAlias ${httpsServerAlias}
    DocumentRoot "${documentRoot}"
    
    # SSL Configuration
    SSLEngine on
    SSLCertificateFile "${sslDir}/cert.pem"
    SSLCertificateKeyFile "${sslDir}/key.pem"
    
    # Modern SSL configuration
    SSLProtocol all -SSLv3 -TLSv1 -TLSv1.1
    SSLCipherSuite ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256
    SSLHonorCipherOrder off
    
    # Security headers
    Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set X-Content-Type-Options "nosniff"
    
    <Directory "${documentRoot}">
        Options Indexes FollowSymLinks MultiViews ExecCGI
        AllowOverride All
        Require all granted
        
        <IfModule mod_rewrite.c>
            RewriteEngine On
            RewriteBase /
            RewriteCond %{REQUEST_FILENAME} !-f
            RewriteCond %{REQUEST_FILENAME} !-d
            RewriteRule ^(.*)$ index.php?$1 [L,QSA]
        </IfModule>
    </Directory>

    # PHP Configuration using Action/AddHandler
    ScriptAlias /php-cgi/ "${path.dirname(phpCgiPath).replace(/\\/g, '/')}/"
    <Directory "${path.dirname(phpCgiPath).replace(/\\/g, '/')}">
        AllowOverride None
        Options None
        Require all granted
    </Directory>
    
    Action application/x-httpd-php "${phpCgiAction}"
    AddHandler application/x-httpd-php .php

    DirectoryIndex index.php index.html

    ErrorLog "${dataPath}/apache/logs/${project.id}-ssl-error.log"
    CustomLog "${dataPath}/apache/logs/${project.id}-ssl-access.log" combined
</VirtualHost>
`;
    }

    const configPath = path.join(vhostsDir, `${project.id}.conf`);
    await fs.writeFile(configPath, config);
    await fs.ensureDir(path.join(dataPath, 'apache', 'logs'));

    return { configPath, finalHttpPort, httpPort, networkAccess };
  },

  async createProxyApacheVhost(project, backendHttpPort, targetApacheVersion = null) {
    const dataPath = this.getDataPath();
    const vhostsDir = path.join(dataPath, 'apache', 'vhosts');
    const sslDir = path.join(dataPath, 'ssl', project.domain).replace(/\\/g, '/');
    const primaryDomain = this.getProjectPrimaryDomain(project);
    const serverAliases = this.getProjectServerAliasEntries(project).join(' ');
    const effectiveVersion = targetApacheVersion
      || this.managers.service?.standardPortOwnerVersion
      || this.getDefaultWebServerVersion('apache');
    const frontDoorPorts = this.managers.service?.getServicePorts('apache', effectiveVersion);
    const httpPort = frontDoorPorts?.httpPort || 80;
    const httpsPort = frontDoorPorts?.sslPort || 443;

    await fs.ensureDir(vhostsDir);
    const certsExist = await this.ensureProjectSslCertificates(project, sslDir);

    let config = `
# DevBox Pro Proxy - ${project.name}
# Domain: ${project.domain}
# Generated: ${new Date().toISOString()}
  # NOTE: Auto-generated file. Manual edits are not recommended.
  # This file is regenerated when DevBox starts, stops, or reloads the project/service.
# Front Door: apache -> ${this.getEffectiveWebServer(project)}:${backendHttpPort}

<VirtualHost *:${httpPort}>
    ServerName ${primaryDomain}
${serverAliases ? `    ServerAlias ${serverAliases}` : ''}

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:${backendHttpPort}/ retry=0
    ProxyPassReverse / http://127.0.0.1:${backendHttpPort}/
    RequestHeader set X-Forwarded-Proto "http"
  RequestHeader set X-Forwarded-Port "${httpPort}"

    ErrorLog "${dataPath.replace(/\\/g, '/')}/apache/logs/${project.id}-proxy-error.log"
    CustomLog "${dataPath.replace(/\\/g, '/')}/apache/logs/${project.id}-proxy-access.log" combined
</VirtualHost>
`;

    if (project.ssl && certsExist) {
      config += `
<VirtualHost *:${httpsPort}>
    ServerName ${primaryDomain}
${serverAliases ? `    ServerAlias ${serverAliases}` : ''}

    SSLEngine on
    SSLCertificateFile "${sslDir}/cert.pem"
    SSLCertificateKeyFile "${sslDir}/key.pem"

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:${backendHttpPort}/ retry=0
    ProxyPassReverse / http://127.0.0.1:${backendHttpPort}/
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "${httpsPort}"

    ErrorLog "${dataPath.replace(/\\/g, '/')}/apache/logs/${project.id}-proxy-ssl-error.log"
    CustomLog "${dataPath.replace(/\\/g, '/')}/apache/logs/${project.id}-proxy-ssl-access.log" combined
</VirtualHost>
`;
    }

    const configPath = path.join(vhostsDir, `${project.id}.conf`);
    await fs.writeFile(configPath, config);
    await fs.ensureDir(path.join(dataPath, 'apache', 'logs'));
    return { configPath, finalHttpPort: httpPort, httpPort, networkAccess: false, proxied: true };
  },
};
