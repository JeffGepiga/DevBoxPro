# Apache HTTP Server Binaries

This directory contains the embedded Apache HTTP Server binaries.

## Directory Structure

```
apache/
├── win/
│   ├── bin/
│   │   ├── httpd.exe
│   │   └── ...
│   ├── conf/
│   │   ├── httpd.conf
│   │   └── extra/
│   ├── modules/
│   └── logs/
└── mac/
    ├── bin/
    │   └── httpd
    ├── conf/
    ├── modules/
    └── logs/
```

## Version

Apache 2.4.x (latest stable)

## Download Sources

### Windows
- Apache Lounge: https://www.apachelounge.com/download/
- Direct link: https://www.apachelounge.com/download/VS17/binaries/httpd-2.4.62-240904-win64-VS17.zip

Note: Windows builds require Visual C++ Redistributable.

### macOS
Apache comes pre-installed on macOS, but can also be installed via Homebrew:
```bash
brew install httpd
```

## PHP Integration

Apache can connect to PHP in two ways:

### 1. PHP-FPM (Recommended)
Uses `mod_proxy_fcgi` to forward PHP requests:
```apache
<FilesMatch \.php$>
    SetHandler "proxy:fcgi://127.0.0.1:9000"
</FilesMatch>
```

### 2. mod_php (Traditional)
Loads PHP as an Apache module:
```apache
LoadModule php_module "path/to/php8apache2_4.dll"
```

DevBox Pro uses PHP-FPM by default for better performance and flexibility.

## Features

- **.htaccess support** - Full `mod_rewrite` for Laravel, WordPress, etc.
- **Virtual Hosts** - Each project gets its own VirtualHost
- **SSL/TLS** - Auto-configured with generated certificates
- **Per-project logs** - Separate error and access logs

## Default Configuration

DevBox Pro generates Apache configurations with:
- `mod_rewrite` enabled for URL rewriting
- `AllowOverride All` for .htaccess support
- PHP-FPM proxy configuration
- SSL virtual hosts when enabled
- Proper directory permissions

## Required Modules

DevBox Pro enables these Apache modules:
- mod_authz_core
- mod_dir
- mod_log_config
- mod_mime
- mod_proxy
- mod_proxy_fcgi
- mod_rewrite
- mod_ssl

## Manual Configuration

Advanced users can edit configurations in:
- Windows: `%APPDATA%/devbox-pro/data/apache/vhosts/`
- macOS: `~/Library/Application Support/devbox-pro/data/apache/vhosts/`
