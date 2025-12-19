# DevBox Pro Remote Configuration

This folder contains remote configuration files that can be updated without releasing a new app version. Users can check for updates from the **Settings > Advanced** section in DevBox Pro.

## Files

### `binaries.json`
Contains download URLs for all supported service binaries:
- **PHP** versions (8.4, 8.3, 8.2, 8.1, 8.0, 7.4)
- **MySQL** versions (8.4, 8.0, 5.7)
- **MariaDB** versions (11.4, 10.11, 10.6)
- **Redis** versions (7.4, 7.2, 6.2)
- **Nginx** versions (1.28, 1.26, 1.24)
- **Apache** (2.4)
- **Node.js** versions (22, 20, 18, 16)
- **Mailpit** (latest)
- **phpMyAdmin** (latest)
- **Composer** (latest)

### `compatibility.json`
Contains version compatibility rules and recommendations:
- PHP + MySQL/MariaDB compatibility warnings
- PHP + Laravel/Symfony/WordPress version requirements
- Web server (Nginx/Apache) + Database recommendations
- End-of-life notifications for deprecated versions

## Updating Binaries

When a new version of a service is released:

1. Update the URL and filename in `binaries.json`
2. Increment the `version` field (e.g., `1.0.0` → `1.0.1` for patches, `1.1.0` for new features)
3. Update the `lastUpdated` date
4. Commit and push to the `main` branch

### Example: Updating PHP 8.4

```json
"8.4": {
  "win": {
    "url": "https://windows.php.net/downloads/releases/php-8.4.17-nts-Win32-vs17-x64.zip",
    "filename": "php-8.4.17-nts-Win32-vs17-x64.zip"
  },
  "mac": {
    "url": "https://github.com/shivammathur/php-builder/releases/download/8.4.17/php-8.4.17-darwin-arm64.tar.gz",
    "filename": "php-8.4.17-darwin-arm64.tar.gz"
  },
  "label": "Latest"
}
```

## Updating Compatibility Rules

When adding new compatibility rules:

1. Add a new rule object to the `rules` array in `compatibility.json`
2. Each rule needs:
   - `id`: Unique identifier (e.g., `php84-mysql57-auth`)
   - `name`: Human-readable name
   - `enabled`: Set to `true` to activate
   - `conditions`: When the rule should trigger
   - `result`: Warning/info message to display

3. Increment the `version` field
4. Commit and push to the `main` branch

### Rule Conditions

| Condition Key | Description | Example |
|---------------|-------------|---------|
| `phpVersion` | PHP version | `{ "min": "8.0" }` or `{ "exact": "7.4" }` |
| `mysql` | MySQL version | `{ "min": "8.4" }` |
| `mariadb` | MariaDB version | `{ "any": true }` |
| `redis` | Redis version | `{ "max": "6.99" }` |
| `nginx` | Nginx version | `{ "min": "1.26" }` |
| `apache` | Apache version | `{ "max": "2.4.49" }` |
| `nodejs` | Node.js version | `{ "min": "20" }` |
| `projectType` | Project type | `{ "exact": "laravel" }` |
| `webServer` | Web server type | `{ "exact": "nginx" }` |

### Condition Operators

- `min`: Value must be >= this version
- `max`: Value must be <= this version
- `exact`: Value must match exactly
- `any`: Just checks if the value exists (set to `true`)

### Result Levels

- `error`: Blocks project creation (use sparingly)
- `warning`: Shows yellow warning, user can proceed
- `info`: Shows informational message

### Message Placeholders

You can use placeholders in messages that get replaced with actual values:
- `{phpVersion}` - PHP version
- `{mysqlVersion}` - MySQL version
- `{mariadbVersion}` - MariaDB version
- `{redisVersion}` - Redis version
- `{nginxVersion}` - Nginx version
- `{apacheVersion}` - Apache version
- `{nodeVersion}` - Node.js version
- `{projectType}` - Project type (laravel, wordpress, etc.)
- `{webServer}` - Web server type (nginx, apache)

### Example Rule

```json
{
  "id": "php84-mysql57-auth",
  "name": "PHP 8.4 + MySQL 5.7 Authentication",
  "enabled": true,
  "conditions": {
    "phpVersion": { "min": "8.4" },
    "mysql": { "max": "5.99" }
  },
  "result": {
    "level": "warning",
    "message": "MySQL {mysqlVersion} uses legacy authentication. You may need to configure MySQL for PHP {phpVersion} compatibility.",
    "suggestion": "Consider using MySQL 8.0+ or configure mysql_native_password."
  }
}
```

## How Updates Work

1. User clicks "Check for Updates" in Settings > Advanced
2. App fetches the latest JSON from GitHub raw URL
3. App compares versions and shows available updates
4. User clicks "Apply Updates" to save the new config locally
5. Updates persist between app restarts (cached in user data folder)

## Remote URLs

The app fetches from these URLs:
- Binaries: `https://raw.githubusercontent.com/JeffGepiga/DevBoxPro/main/config/binaries.json`
- Compatibility: `https://raw.githubusercontent.com/JeffGepiga/DevBoxPro/main/config/compatibility.json`

## Testing Changes

Before pushing changes:

1. Validate JSON syntax (use a JSON linter)
2. Test URLs are accessible and return valid downloads
3. Verify version numbers are formatted correctly (semver)

## Version History

### binaries.json
- `1.0.0` (2024-12-19): Initial release with all service binaries

### compatibility.json
- `1.1.0` (2024-12-19): Added Nginx/Apache + MySQL/MariaDB compatibility rules
- `1.0.0` (2024-12-19): Initial release with PHP, database, and framework rules
