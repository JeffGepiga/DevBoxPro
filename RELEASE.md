# 🚀 DevBox Pro v1.0.2-BETA

**Pre-Release | Your all-in-one local development environment for PHP**

> ⚠️ **This is a pre-release version. Some features may be incomplete or unstable.**

---

## 🆕 What's New in v1.0.2

### ✨ New Features

#### 🔄 Auto-Update System
- **Check for Updates** – Built-in update checker in Settings → Advanced tab
- **One-Click Download** – Download new versions directly within the app with progress indicator
- **Install & Restart** – Seamlessly install updates and restart the application
- **GitHub Releases Integration** – Updates are fetched securely from GitHub Releases

### 🧹 Improvements

- **Better version display** – Current version shown in the update checker
- **Download progress** – Real-time progress bar with download speed (MB/s)
- **Development mode handling** – Clear messaging when running in development mode

---

## ✨ Features in This Release

### 🐘 Multi-PHP Version Support
- PHP 7.4, 8.0, 8.1, 8.2, 8.3, 8.4 – run any version side by side
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
| Node.js | 18, 20 (LTS), 22 |
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
- **Custom PHP** – works with any PHP application

### 🌐 Local Network Project Sharing
- Share projects across your local network
- Enable/disable per project with a simple toggle

### 🔗 Git Clone Repository
- Clone from GitHub, GitLab, Bitbucket
- Support for public repos, Personal Access Tokens, and SSH keys
- Built-in SSH Key Management

### 💻 Terminal Commands
Use `php`, `npm`, `node`, and `composer` directly from any terminal:

```bash
cd C:\Projects\my-laravel-app

php artisan migrate      # Uses project's PHP version automatically
composer install         # Uses correct PHP for Composer
npm install              # Uses project's Node.js version
```

---

## 📥 Downloads

| File | Description |
|------|-------------|
| **DevBox.Pro.Setup.1.0.2-BETA.exe** | Installer version (recommended) |
| **DevBox.Pro.1.0.2-Portable-BETA.exe** | Portable version – no installation required |
| **latest.yml** | Auto-updater manifest |

### 🍎 macOS Support

> **Note**: macOS builds are not yet available. Stay tuned!

### System Requirements (Windows)
- **OS**: Windows 10/11 (64-bit)
- **RAM**: 4GB minimum, 8GB recommended
- **Disk**: 2GB for app + space for binaries

---

## 🚀 Getting Started

1. **Download** the installer or portable version
2. **Run** DevBox Pro
3. Open **Binary Manager** and download the components you need
4. Click **"+ New Project"** to create your first project
5. Start coding!

---

## ⚠️ Pre-Release Notice

This version is for **testing and feedback purposes**. Please expect:
- Possible bugs and unexpected behavior
- Features that may change before stable release
- Performance optimizations still in progress

**Please backup your work regularly.**

---

## 🐛 Known Issues

- First launch may take a few seconds while initializing
- Windows Defender may prompt for firewall access on first service start
- Some antivirus software may flag the portable version (false positive)
- Auto-updater requires app to be code-signed to avoid SmartScreen warning (planned for future)

---

## 📣 Report Issues & Feedback

Found a bug? Have a suggestion? We'd love to hear from you!

- 🐛 **Issues**: [GitHub Issues](https://github.com/JeffGepiga/DevBoxPro/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/JeffGepiga/DevBoxPro/discussions)
- 📧 **Email**: jeffreygepiga27@gmail.com

---

## 🙏 Thank You

Thank you for trying DevBox Pro! Your feedback is invaluable in making this the best local development tool for PHP developers.

---

<p align="center">
  Made with ❤️ for PHP developers
</p>
