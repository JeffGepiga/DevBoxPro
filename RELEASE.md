# 🚀 DevBox Pro v1.0.1-BETA

**Pre-Release | Your all-in-one local development environment for PHP**

> ⚠️ **This is a pre-release version. Some features may be incomplete or unstable.**

---

## 🆕 What's New in v1.0.1

### ✨ New Features

#### 🌐 Local Network Project Sharing
- **Share projects across your local network** – Access your development projects from other devices on the same network
- **IP Address Retrieval** – Automatically detects and displays your machine's local IP address
- **Project Sharing Options** – Enable or disable network access per project with a simple toggle

#### 🔗 Git Clone Repository
- **Clone from GitHub, GitLab, Bitbucket** – Create new projects by cloning existing Git repositories
- **Multiple Authentication Methods** – Support for public repos, Personal Access Tokens, and SSH keys
- **Built-in SSH Key Management** – Generate, copy, and regenerate SSH keys directly from the app
- **Auto Laravel Setup** – Automatically runs `composer install`, `.env` setup, and `artisan key:generate` after cloning Laravel projects

### 🐛 Bug Fixes

#### 🔧 Multiple Running Services Fix
- **Resolved service conflicts** – Fixed issues when running multiple services simultaneously
- **Improved service management** – Better handling of concurrent service operations
- **Enhanced stability** – More reliable service startup and shutdown sequences

### 🧹 Improvements

- **Code cleanup** – Removed unnecessary console logs for cleaner production output
- **Project tab revamp** – Improved project management interface

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

### ☁️ Cloud Configuration Updates
- Remote binary definitions – new versions without app update
- Compatibility rules sync – updated version warnings
- One-click update check from Settings

### 💻 CLI Tool (dvp)
Run PHP, Node.js, Composer, and npm commands with **project-specific versions** from any terminal or editor:

```bash
# Navigate to your project and run commands
cd C:\Projects\my-laravel-app

dvp php artisan migrate      # Uses project's PHP version
dvp composer install         # Uses correct PHP for Composer
dvp npm install              # Uses project's Node.js version
dvp npm run dev              # Run npm scripts
```

---

## 📥 Downloads

| File | Description |
|------|-------------|
| **DevBox.Pro.Setup.1.0.1-BETA.exe** | Installer version (recommended) |
| **DevBox.Pro.1.0.1-Portable-BETA.exe** | Portable version – no installation required |

### 🍎 macOS Support

> **Note**: macOS builds are not yet available. The application has not been tested on macOS. 
> Please wait for a future release that includes macOS support. Stay tuned!

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
