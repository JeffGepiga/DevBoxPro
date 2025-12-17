# MySQL Binaries

This directory should contain the embedded MySQL/MariaDB server binaries.

## Directory Structure

```
mysql/
├── win/
│   ├── bin/
│   │   ├── mysqld.exe
│   │   ├── mysql.exe
│   │   └── ...
│   ├── share/
│   └── data/ (initial empty database)
└── mac/
    ├── bin/
    │   ├── mysqld
    │   ├── mysql
    │   └── ...
    ├── share/
    └── data/
```

## Recommended Version

MySQL 8.0 or MariaDB 10.11 (LTS)

## Obtaining Binaries

### Windows
Download MySQL Community Server (no-install ZIP): https://dev.mysql.com/downloads/mysql/

### macOS
Download from MySQL website or extract from Homebrew installation.

## Configuration

Default configuration is handled by DevBox Pro's DatabaseManager.
Custom my.cnf is generated at runtime with:
- datadir pointing to user's data directory
- port configured by user settings
- appropriate memory limits for development
