# Mailpit Binaries

This directory should contain the embedded Mailpit SMTP server.

## Directory Structure

```
mailpit/
├── win/
│   └── mailpit.exe
└── mac/
    └── mailpit
```

## About Mailpit

Mailpit is a modern email testing tool with:
- SMTP server for catching outgoing emails
- Web UI for viewing emails
- API for programmatic access
- Support for attachments and HTML emails

## Recommended Version

Latest stable from: https://github.com/axllent/mailpit/releases

## Obtaining Binaries

Download the appropriate binary for each platform from GitHub releases:
- Windows: `mailpit-windows-amd64.zip`
- macOS Intel: `mailpit-darwin-amd64.tar.gz`
- macOS Apple Silicon: `mailpit-darwin-arm64.tar.gz`

## Default Ports

- SMTP: 1025
- Web UI: 8025

Configure in DevBox Pro settings.
