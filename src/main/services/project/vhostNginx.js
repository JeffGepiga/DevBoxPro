const path = require('path');
const fs = require('fs-extra');
const { isPortAvailable } = require('../../utils/PortUtils');

module.exports = {
  async createNginxVhost(project, overridePhpFpmPort = null, targetNginxVersion = null) {
    const dataPath = this.getDataPath();
    const resourcesPath = this.getResourcesPath();
    const sslDir = path.join(dataPath, 'ssl', project.domain);
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    let nginxVersion = this.getEffectiveWebServerVersion(project, 'nginx');

    const nginxVersionPath = path.join(resourcesPath, 'nginx', nginxVersion, platform);
    if (!await fs.pathExists(nginxVersionPath)) {
      const nginxDir = path.join(resourcesPath, 'nginx');
      if (await fs.pathExists(nginxDir)) {
        const availableVersions = await fs.readdir(nginxDir);
        for (const version of availableVersions) {
          const versionPath = path.join(nginxDir, version, platform);
          if (await fs.pathExists(versionPath)) {
            this.managers.log?.systemWarn(`Nginx ${nginxVersion} not found, using ${version} instead`, { project: project.name });
            nginxVersion = version;
            const projects = this.configStore.get('projects', []);
            const index = projects.findIndex((entry) => entry.id === project.id);
            if (index !== -1) {
              projects[index].webServerVersion = version;
              this.configStore.set('projects', projects);
            }
            break;
          }
        }
      }
    }

    const fastcgiParamsPath = path.join(resourcesPath, 'nginx', nginxVersion, platform, 'conf', 'fastcgi_params').replace(/\\/g, '/');
    const effectiveVersion = targetNginxVersion || nginxVersion;
    const sitesDir = path.join(dataPath, 'nginx', effectiveVersion, 'sites');

    await fs.ensureDir(sitesDir);

    const documentRoot = this.getDocumentRoot(project);
    await fs.ensureDir(documentRoot);

    const phpFpmPort = overridePhpFpmPort || this.getPhpFpmPort(project);
    const serviceManager = this.managers.service;
    const nginxPorts = serviceManager?.getServicePorts('nginx', effectiveVersion);
    const httpPort = nginxPorts?.httpPort || 80;
    const httpsPort = nginxPorts?.sslPort || 443;
    const networkAccess = project.networkAccess || false;

    let canUsePort80 = false;
    if (networkAccess) {
      if (this.networkPort80Owner === null) {
        const port80Free = await isPortAvailable(80);
        const ownServerOnPort80 = !port80Free && this.managers.service?.standardPortOwner === 'nginx';
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

    const listenDirective = networkAccess
      ? `0.0.0.0:${finalHttpPort}${canUsePort80 ? ' default_server' : ''}`
      : `${httpPort}`;
    const effectiveNginxVersion = effectiveVersion;
    const useHttp2Directive = parseFloat(effectiveNginxVersion) >= 1.25;
    const http2ListenSuffix = useHttp2Directive ? '' : ' http2';
    const http2Directive = useHttp2Directive ? '\n    http2 on;' : '';

    const listenDirectiveSsl = networkAccess
      ? `0.0.0.0:${httpsPort} ssl${http2ListenSuffix}`
      : `${httpsPort} ssl${http2ListenSuffix}`;

    const allNginxDomains = this.getProjectServerNameEntries(project);
    if (networkAccess && canUsePort80) {
      allNginxDomains.push('_');
    }
    const serverName = allNginxDomains.join(' ');

    let config = `
# DevBox Pro - ${project.name}
# Domain: ${project.domain}
# Generated: ${new Date().toISOString()}
    # NOTE: Auto-generated file. Manual edits are not recommended.
    # This file is regenerated when DevBox starts, stops, or reloads the project/service.
# Ports: HTTP=${finalHttpPort}, HTTPS=${httpsPort}${networkAccess ? '\n# Network Access: ENABLED - accessible from local network' : ''}${canUsePort80 ? '\n# Port 80 (first-come-first-served)' : ''}

# HTTP Server
server {
    listen ${listenDirective};
    server_name ${serverName};
    root "${documentRoot.replace(/\\/g, '/')}";
    index index.php index.html index.htm;

    charset utf-8;
    client_max_body_size 128M;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    error_page 404 /index.php;

    location ~ \\.php$ {
        try_files $uri /index.php?$query_string;
        fastcgi_pass 127.0.0.1:${phpFpmPort};
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
      include "${fastcgiParamsPath}";
        fastcgi_hide_header X-Powered-By;
        fastcgi_read_timeout 300;
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }

    access_log "${dataPath.replace(/\\/g, '/')}/nginx/logs/${project.id}-access.log";
    error_log "${dataPath.replace(/\\/g, '/')}/nginx/logs/${project.id}-error.log";
}
`;

    const certsExist = await this.ensureProjectSslCertificates(project, sslDir);

    if (project.ssl && !certsExist) {
      this.managers.log?.systemWarn(`SSL enabled for ${project.domain} but certificates not found at ${sslDir}. Skipping SSL block.`);
    }

    if (project.ssl && certsExist) {
      config += `
# HTTPS Server (SSL)
server {
    listen ${listenDirectiveSsl};${http2Directive}
    server_name ${serverName};
    root "${documentRoot.replace(/\\/g, '/')}";
    index index.php index.html index.htm;

    # SSL Configuration
    ssl_certificate "${sslDir.replace(/\\/g, '/')}/cert.pem";
    ssl_certificate_key "${sslDir.replace(/\\/g, '/')}/key.pem";
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    charset utf-8;
    client_max_body_size 128M;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    error_page 404 /index.php;

    location ~ \\.php$ {
        try_files $uri /index.php?$query_string;
        fastcgi_pass 127.0.0.1:${phpFpmPort};
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
      include "${fastcgiParamsPath}";
        fastcgi_hide_header X-Powered-By;
        fastcgi_read_timeout 300;
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }

    access_log "${dataPath.replace(/\\/g, '/')}/nginx/logs/${project.id}-ssl-access.log";
    error_log "${dataPath.replace(/\\/g, '/')}/nginx/logs/${project.id}-ssl-error.log";
}
`;
    }

    const configPath = path.join(sitesDir, `${project.id}.conf`);
    await fs.writeFile(configPath, config);
    await fs.ensureDir(path.join(dataPath, 'nginx', 'logs'));

    return { configPath, finalHttpPort, httpPort, networkAccess };
  },

  async createProxyNginxVhost(project, backendHttpPort, targetNginxVersion = null) {
    const dataPath = this.getDataPath();
    const sslDir = path.join(dataPath, 'ssl', project.domain);
    const effectiveVersion = targetNginxVersion || this.managers.service?.standardPortOwnerVersion || this.getDefaultWebServerVersion('nginx');
    const sitesDir = path.join(dataPath, 'nginx', effectiveVersion, 'sites');
    const serverName = this.getProjectServerNameEntries(project).join(' ');

    await fs.ensureDir(sitesDir);
    const certsExist = await this.ensureProjectSslCertificates(project, sslDir);

    let config = `
# DevBox Pro Proxy - ${project.name}
# Domain: ${project.domain}
# Generated: ${new Date().toISOString()}
  # NOTE: Auto-generated file. Manual edits are not recommended.
  # This file is regenerated when DevBox starts, stops, or reloads the project/service.
# Front Door: nginx -> ${this.getEffectiveWebServer(project)}:${backendHttpPort}

server {
    listen 80;
    server_name ${serverName};

    client_max_body_size 128M;

    location / {
        proxy_pass http://127.0.0.1:${backendHttpPort};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_buffering off;
        proxy_request_buffering off;
    }

    access_log "${dataPath.replace(/\\/g, '/')}/nginx/logs/${project.id}-proxy-access.log";
    error_log "${dataPath.replace(/\\/g, '/')}/nginx/logs/${project.id}-proxy-error.log";
}
`;

    if (project.ssl && certsExist) {
      const useHttp2Directive = parseFloat(effectiveVersion) >= 1.25;
      const http2ListenSuffix = useHttp2Directive ? '' : ' http2';
      const http2Directive = useHttp2Directive ? '\n    http2 on;' : '';

      config += `
server {
    listen 443 ssl${http2ListenSuffix};${http2Directive}
    server_name ${serverName};

    ssl_certificate "${sslDir.replace(/\\/g, '/')}/cert.pem";
    ssl_certificate_key "${sslDir.replace(/\\/g, '/')}/key.pem";
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    client_max_body_size 128M;

    location / {
        proxy_pass http://127.0.0.1:${backendHttpPort};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Port 443;
        proxy_buffering off;
        proxy_request_buffering off;
    }

    access_log "${dataPath.replace(/\\/g, '/')}/nginx/logs/${project.id}-proxy-ssl-access.log";
    error_log "${dataPath.replace(/\\/g, '/')}/nginx/logs/${project.id}-proxy-ssl-error.log";
}
`;
    }

    const configPath = path.join(sitesDir, `${project.id}.conf`);
    await fs.writeFile(configPath, config);
    await fs.ensureDir(path.join(dataPath, 'nginx', 'logs'));
    return { configPath, finalHttpPort: 80, httpPort: 80, networkAccess: false, proxied: true };
  },
};
