# Nginx Binaries

This directory contains the embedded Nginx web server binaries.

## Directory Structure

```
nginx/
├── win/
│   ├── nginx.exe
│   ├── conf/
│   │   ├── nginx.conf
│   │   ├── mime.types
│   │   └── fastcgi_params
│   └── logs/
└── mac/
    ├── nginx
    ├── conf/
    └── logs/
```

## Version

Nginx 1.26.x (stable)

## Download Sources

### Windows
- Official: https://nginx.org/en/download.html
- Direct link: https://nginx.org/download/nginx-1.26.2.zip

### macOS
For macOS, nginx is typically compiled from source or installed via Homebrew:
```bash
brew install nginx
```

DevBox Pro will automatically download and configure nginx for each platform.

## PHP Integration

Nginx connects to PHP via FastCGI. DevBox Pro automatically:
1. Starts PHP-CGI or PHP-FPM for each project
2. Generates nginx server blocks that proxy `.php` requests to PHP
3. Configures proper `fastcgi_params` for Laravel, Symfony, WordPress, etc.

## Default Configuration

DevBox Pro generates nginx configurations with:
- FastCGI pass to `127.0.0.1:9000` (PHP-FPM)
- Proper `try_files` for Laravel/Symfony routing
- SSL support with auto-generated certificates
- Per-project error and access logs

## Manual Configuration

Advanced users can edit configurations in:
- Windows: `%APPDATA%/devbox-pro/data/nginx/sites/`
- macOS: `~/Library/Application Support/devbox-pro/data/nginx/sites/`
