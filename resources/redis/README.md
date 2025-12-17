# Redis Binaries

This directory should contain the embedded Redis server binaries.

## Directory Structure

```
redis/
├── win/
│   ├── redis-server.exe
│   ├── redis-cli.exe
│   └── redis.conf
└── mac/
    ├── redis-server
    ├── redis-cli
    └── redis.conf
```

## Recommended Version

Redis 7.x (latest stable)

## Obtaining Binaries

### Windows
Download from: https://github.com/tporadowski/redis/releases
(Microsoft Archive or tporadowski's builds)

### macOS
Extract from Homebrew installation or compile from source:
```bash
brew install redis
cp $(brew --prefix)/bin/redis-* ./mac/
```

## Default Configuration

The default redis.conf should include:
- bind 127.0.0.1
- port 6379 (configurable)
- maxmemory 256mb
- appendonly no (for development)
