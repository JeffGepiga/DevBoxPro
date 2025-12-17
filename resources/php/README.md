# PHP Binaries

This directory should contain the embedded PHP binaries for each supported version.

## Directory Structure

```
php/
├── 7.4/
│   ├── win/
│   │   └── php.exe, php-cgi.exe, etc.
│   └── mac/
│       └── php, php-cgi, etc.
├── 8.0/
│   ├── win/
│   └── mac/
├── 8.1/
│   ├── win/
│   └── mac/
├── 8.2/
│   ├── win/
│   └── mac/
└── 8.3/
    ├── win/
    └── mac/
```

## Obtaining PHP Binaries

### Windows
Download from: https://windows.php.net/download/

Required files:
- php.exe
- php-cgi.exe
- php.ini (configured for development)
- ext/ directory with extensions

### macOS
Compile from source or use Homebrew-built binaries.

## Required Extensions

Each PHP installation should include:
- bcmath
- curl
- dom
- fileinfo
- gd
- intl
- json
- mbstring
- mysqli
- openssl
- pdo_mysql
- pdo_sqlite
- redis
- soap
- sockets
- sqlite3
- xdebug
- xml
- zip
