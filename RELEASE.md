# 🚀 DevBox Pro v1.0.7

**Stable Release | More reliable local runtimes, databases, and service startup for PHP & Node.js development**

---

## 🆕 What's New in v1.0.7

### ✨ Reliability & Performance Improvements

#### 🌐 Web Server Stability
- Hardened **Apache** and **Nginx** startup to better reclaim ports, wait for stale bindings to clear, and reduce failed starts on Windows
- Improved restart behavior for restart-sensitive services by keeping them warm during quick project stop/start cycles
- Refined **Nginx** forwarded-header handling so proxied HTTPS requests preserve the correct FastCGI and application-facing scheme details

#### 🧰 PHP & Runtime Tooling
- Improved project-aware **PHP** and **Composer** command handling, including support for shell operators in routed commands
- Updated bundled **PHP** download URLs to current upstream assets
- Strengthened Windows runtime repair by synchronizing required **VC++ DLLs** for PHP and related services
- Installer builds can now silently install a bundled **Microsoft Visual C++ Redistributable** during setup when needed

#### 💾 Database & Import Workflows
- Improved database import progress reporting and large SQL import performance
- Added more resilient **PostgreSQL** startup retry handling for transient failures
- Expanded **MongoDB** operations with `mongosh` integration and better binary management support

### 🛡️ Web Server Hardening

- Improved port availability checks for **Apache**, **Nginx**, and **Redis** to reduce collisions and false-start states
- Hardened Windows stop/start reclaim flows so web server ports clear more predictably between restarts
- Reduced mixed-server startup races when multiple web server versions or front-door owners are active
- Preserved correct HTTPS behavior behind proxies by tightening forwarded-header and FastCGI override handling

### 🧹 Fixes Included In This Release

- Fixed Windows web server restart races that could leave **Apache** or **Nginx** ports stuck in use
- Fixed stale port bindings causing intermittent startup failures for **Apache**, **Nginx**, and **Redis**
- Fixed PHP runtime issues on Windows caused by missing or outdated local **VC++ runtime DLLs**
- Fixed database import flows that were slower or less transparent on large SQL files
- Fixed transient **PostgreSQL** startup failures with improved retry behavior
- Fixed MongoDB database operations on installs missing a usable shell client

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
| **DevBox-Pro-Setup-1.0.7.exe** | Installer version (recommended) |
| **DevBox-Pro-1.0.7.exe** | Portable version – no installation required |

### System Requirements (Windows)
- **OS**: Windows 10/11 (64-bit)
- **RAM**: 4GB minimum, 8GB recommended
- **Disk**: 2GB for app + space for binaries
- **Runtime**: Installer builds can bundle and silently run `vcredist/VC_redist.x64.exe` to install or repair the Microsoft Visual C++ Redistributable

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
