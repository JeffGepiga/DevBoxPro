# phpMyAdmin Files

This directory should contain the phpMyAdmin web application.

## Directory Structure

```
phpmyadmin/
├── index.php
├── config.inc.php
├── libraries/
├── themes/
├── js/
├── ...
└── (all phpMyAdmin files)
```

## Recommended Version

phpMyAdmin 5.2.x (latest stable)

## Obtaining Files

Download from: https://www.phpmyadmin.net/downloads/

1. Download the "all languages" package
2. Extract to this directory
3. DevBox Pro will generate config.inc.php at runtime

## Configuration

DevBox Pro automatically configures phpMyAdmin with:
- Connection to local MySQL server
- Appropriate authentication settings
- Theme configuration
- No config storage (for simplicity)

The config.inc.php is generated dynamically based on user's MySQL settings.
