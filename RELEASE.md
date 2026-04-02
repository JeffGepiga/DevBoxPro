# 🚀 DevBox Pro v1.0.5

**Stable Release | Your all-in-one local development environment for PHP & Node.js**

---

## 🆕 What's New in v1.0.5

### ✨ New Features

#### 🌍 Public Internet Sharing
- Share running projects publicly with **Cloudflare Tunnel** or **zrok** from the project detail screen
- Per-project **Share on Internet** toggle with optional **auto-start tunnel** support
- Public tunnels now support both **Nginx** and **Apache** projects, including mixed front-door proxy setups
- Cloudflare tunnel traffic is now stabilized with local proxy handling for redirects, cookies, and absolute local `.test` URLs
- Cloudflare public URLs are only surfaced once the `trycloudflare.com` hostname is resolvable, reducing broken fresh-tunnel links
- zrok public URL detection has been updated for current CLI output formats

#### ⚡ Improved Project Lifecycle Management
- Immediate service stopping when the last active project is closed
- Pending service shutdowns are automatically cancelled when starting new project services
- Track projects currently being started or stopped for accurate status reporting

#### 🔄 Graceful Update Installation
- Services are stopped before applying an app update via quit-and-install

#### 🪟 Enhanced Window & Migration Handling
- New utility functions for window management and data migration

#### 🗄️ Database Connection Improvements
- Database connection info now displays the correct port for the selected engine version
- Actual running port is used for active database connections instead of the default
- Integrated service configuration for database port offsets across all components

#### 💾 Database Import/Export
- Import and export support for SQL, MongoDB, and PostgreSQL workflows

#### 📦 Expanded Binary Downloads
- One-click downloads for MySQL, MariaDB, Redis, Mailpit, phpMyAdmin, Nginx, Apache, and Node.js binaries
- Download progress tracking and management
- Dynamic loading of bundled binary configuration – new versions appear without an app update
- Binary URL validation script added to the build pipeline

#### 🌐 Front-Door Proxy & Service Serialization
- Front-door proxy handling for Nginx and Apache projects with version checks
- Serialized service starts for Apache and Nginx to prevent port collisions

#### 🛑 Bulk Stop
- Stop all running projects and services at once from the UI

#### 🔗 Git Integration
- Git download support with availability checks before clone operations

#### 🔐 SSL & Import Enhancements
- Enhanced SSL certificate management workflows
- Improved project import functionality

### 🏗️ Architecture & Refactoring

- **Manager refactoring** – `CompatibilityManager` split into config and rules modules; `GitManager` split into smaller focused modules for improved maintainability
- **Spawn hardening** – Removed `shell: true` from process spawning across the codebase to avoid `DEP0190` deprecation warnings and improve process handling
- **Data path refactoring** – Centralized data path handling across services and utilities
- **Binary removal** – Better error handling for locked files during binary removal
- **MongoDB** – Enhanced binary detection and repair process
- **MySQL** – Removed redundant logging during startup
- **Nginx lifecycle** – Nginx is reloaded on rapid PHP-CGI port changes

### 🧹 Bug Fixes & Improvements

- Fixed public tunnel routing when multiple projects are running across Nginx and Apache
- Fixed Cloudflare tunnel sessions showing the wrong project when multiple projects are shared
- Fixed public tunnel flows that redirected browsers back to local `.test` URLs
- Fixed stale or not-yet-ready Cloudflare Quick Tunnel hostnames being shown as live too early
- Fixed multi-server version bugs when running multiple web server versions simultaneously
- Fixed port conflict issues across services
- Fixed WordPress installation bugs and added PHP extension toggles
- Fixed terminal consuming excessive memory
- Improved Nginx and Apache readiness check timeouts
- Added MySQL error log handling and phpMyAdmin loading state management
- Fixed bugs in PHP binary downloading
- Compatibility management service with remote rule updates integrated into project creation
- Added binary URL checking script to validate download URLs before build
- Comprehensive test coverage: new unit tests for vhost configs, CLI, database, project services, and lifecycle utilities

---

## ✨ All Features

### 🐘 Multi-PHP Version Support
- PHP 7.4, 8.0, 8.1, 8.2, 8.3, 8.4, 8.5 – run any version side by side
- Per-project PHP version selection with compatibility validation
- Built-in php.ini editor for easy configuration

### 🌐 Web Servers
- **Nginx** 1.26 & 1.28 – high performance, low memory footprint
- **Apache** 2.4 – full .htaccess support, mod_rewrite included
- Automatic virtual host configuration
- HTTP & HTTPS support for every project

### 📦 Embedded Services
| Service | Versions |
|---------|----------|
| MySQL | 8.0, 8.4 |
| MariaDB | 10.11, 11.4 |
| Redis | 7.2, 7.4 |
| Node.js | 16, 18, 20 (LTS), 22, 24 |
| PostgreSQL | 14, 15, 16, 17 |
| MongoDB | 6.0, 7.0, 8.0 |
| Python | 3.10, 3.11, 3.12, 3.13 |
| SQLite | 3 (embedded) |
| MinIO | Latest |
| Memcached | 1.6 |
| Mailpit | Latest |
| phpMyAdmin | Latest |
| Composer | Latest |

### 💾 Database Management
- Create, drop, import, and export databases
- Supports `.sql` and `.gz` compressed files
- Progress tracking for large operations
- Quick access to phpMyAdmin

### 🔐 SSL & Domains
- Automatic SSL certificate generation
- One-click certificate trust
- `.test` domain support (e.g., `myproject.test`)

### 🎯 Framework Support
- **Laravel** – fresh installation with Composer, app key, npm
- **WordPress** – automatic download and setup
- **Symfony** – console commands ready
- **Node.js** – first-class Node.js project support with Nginx proxy
- **Custom PHP** – works with any PHP application

### 🌐 Local Network Project Sharing
- Share projects across your local network
- Enable/disable per project with a simple toggle

### 🔗 Git Clone Repository
- Clone from GitHub, GitLab, Bitbucket
- Support for public repos, Personal Access Tokens, and SSH keys
- Built-in SSH Key Management

### 💻 Terminal Commands
Use `php`, `npm`, `node`, `composer`, `mysql`, and `mysqldump` directly from any terminal:

```bash
cd C:\Projects\my-laravel-app

php artisan migrate      # Uses project's PHP version automatically
composer install         # Uses correct PHP for Composer
npm install              # Uses project's Node.js version
mysql -u root            # Connects using the active MySQL/MariaDB version
mysqldump -u root mydb > backup.sql  # Dump with the active DB version
```

---

## 📥 Downloads

| File | Description |
|------|-------------|
| **DevBox-Pro-Setup-1.0.5.exe** | Installer version (recommended) |
| **DevBox-Pro-1.0.5.exe** | Portable version – no installation required |

### System Requirements (Windows)
- **OS**: Windows 10/11 (64-bit)
- **RAM**: 4GB minimum, 8GB recommended
- **Disk**: 2GB for app + space for binaries

### 🍎 macOS Support

> macOS builds coming in a future release. Stay tuned!

---

## 🚀 Getting Started

1. **Download** the installer or portable version
2. **Run** DevBox Pro
3. Open **Binary Manager** and download the components you need
4. Click **"+ New Project"** to create your first project
5. Start coding!

---

## 🐛 Known Issues

- First launch may take a few seconds while initializing
- Windows Defender may prompt for firewall access on first service start

---

## 📣 Report Issues & Feedback

- 🐛 **Issues**: [GitHub Issues](https://github.com/JeffGepiga/DevBoxPro/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/JeffGepiga/DevBoxPro/discussions)
- 📧 **Email**: jeffreygepiga27@gmail.com

---

<p align="center">
  Made with ❤️ for PHP developers
</p>
