<p align="center">
  <img src="https://img.shields.io/badge/Electron-28.0.0-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/React-18.2.0-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/Vite-5.0.10-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/TailwindCSS-3.4.0-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="TailwindCSS">
</p>

# 🚀 DevBox Pro

**A powerful, cross-platform local development server for PHP developers**

DevBox Pro is a standalone desktop application that provides everything you need for PHP development - multiple PHP versions, MySQL, Redis, Mailpit, and more - all bundled in a single, easy-to-use application. No Docker required!

---

## ✨ Features

### 🐘 Multi-PHP Version Support
- **PHP 7.4, 8.0, 8.1, 8.2, 8.3** - Run any version side by side
- Per-project PHP version selection
- Easy extension management per version
- Pre-configured for optimal performance

### 🌐 Web Server Options
- **Nginx** - High-performance, low memory footprint (recommended)
- **Apache** - Full .htaccess support, mod_rewrite included
- Automatic virtual host creation
- HTTP & HTTPS support for every project

### 📦 Embedded Services
| Service | Description |
|---------|-------------|
| **MySQL 8.0** | Powerful relational database |
| **Redis** | In-memory cache & session storage |
| **Mailpit** | Email testing with SMTP server |
| **phpMyAdmin** | Web-based database management |
| **Node.js** | v18, v20 (LTS), v22 support |
| **Composer** | PHP dependency manager |

### 🔐 SSL & Security
- Automatic SSL certificate generation
- Wildcard certificate support
- One-click certificate trust
- `.test` domain support (e.g., `myproject.test`)

### 🎯 Framework Support
- **Laravel** - Full support with Artisan, Queue Workers, Scheduler
- **Symfony** - Console commands, Doctrine integration
- **WordPress** - WP-CLI ready, Multisite support
- **Custom PHP** - Works with any PHP application

---

## 📸 Screenshots

```
┌─────────────────────────────────────────────────────────────┐
│  DevBox Pro                                          _ □ X │
├─────────────────────────────────────────────────────────────┤
│  🏠 Dashboard    📁 Projects    ⚙️ Services    📊 Logs     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   My Projects                           + New Project       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 🟢 Laravel Blog          PHP 8.3    Port: 8000      │  │
│  │    laravel-blog.test     MySQL ✓    Redis ✓         │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 🔴 WordPress Site        PHP 8.1    Port: 8001      │  │
│  │    wordpress.test        MySQL ✓                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│   Services Status                                           │
│   MySQL: 🟢 Running    Redis: 🟢 Running    Mailpit: ⚪    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Installation

1. **Download** the latest release for your platform:
   - Windows: `DevBox-Pro-Setup-x.x.x.exe`
   - macOS: `DevBox-Pro-x.x.x.dmg`

2. **Install** the application

3. **Download binaries** from the Binary Manager:
   - Click "Download All" for the full stack, or
   - Select individual components as needed

### Creating Your First Project

1. Click **"+ New Project"** on the Dashboard
2. Select your **project type** (Laravel, Symfony, WordPress, or Custom)
3. Choose **project folder** and **PHP version**
4. Configure **services** (MySQL, Redis, etc.)
5. Set your **domain** (e.g., `myproject.test`)
6. Click **Create** and you're ready!

---

## 💻 Development Setup

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/devbox-pro.git
cd devbox-pro

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Create distribution package
npm run dist
```

### Project Structure

```
devbox-pro/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── services/
│   │   │   ├── PhpManager.js        # PHP version management
│   │   │   ├── ProjectManager.js    # Project lifecycle
│   │   │   ├── ServiceManager.js    # MySQL, Redis, etc.
│   │   │   ├── SslManager.js        # SSL certificates
│   │   │   ├── WebServerManager.js  # Nginx/Apache
│   │   │   ├── BinaryDownloadManager.js  # Binary downloads
│   │   │   └── ...
│   │   ├── ipc/
│   │   │   └── handlers.js      # IPC communication
│   │   ├── preload.js           # Preload script
│   │   └── main.js              # Main entry
│   │
│   └── renderer/                # React frontend
│       ├── src/
│       │   ├── components/      # Reusable components
│       │   ├── pages/           # Page components
│       │   ├── context/         # React context
│       │   └── App.jsx          # Root component
│       └── index.html
│
├── resources/                   # App resources
├── electron.vite.config.mjs     # Vite config for Electron
├── package.json
└── README.MD
```

---

## ⚙️ Configuration

### Default Ports

| Service | Default Port |
|---------|-------------|
| PHP Projects | 8000+ (auto-assigned) |
| MySQL | 3306 |
| Redis | 6379 |
| Mailpit SMTP | 1025 |
| Mailpit Web | 8025 |
| phpMyAdmin | 8080 |

### Environment Variables

Projects can use `.env` files with these pre-configured variables:

```env
APP_ENV=local
APP_DEBUG=true
APP_URL=http://myproject.test

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=myproject
DB_USERNAME=root
DB_PASSWORD=

CACHE_DRIVER=redis
SESSION_DRIVER=redis
QUEUE_CONNECTION=redis

REDIS_HOST=127.0.0.1
REDIS_PASSWORD=null
REDIS_PORT=6379

MAIL_MAILER=smtp
MAIL_HOST=127.0.0.1
MAIL_PORT=1025
```

---

## 🛠️ Technologies

- **Electron** - Cross-platform desktop framework
- **React** - UI library
- **Vite** - Fast build tool
- **TailwindCSS** - Utility-first CSS
- **electron-builder** - Distribution packaging

---

## 📋 Roadmap

- [x] Multi-PHP version support
- [x] MySQL & Redis integration  
- [x] Nginx & Apache web servers
- [x] Automatic SSL certificates
- [x] Virtual host management
- [x] Node.js & npm support
- [x] Composer integration
- [ ] Docker container support
- [ ] PostgreSQL support
- [ ] MongoDB support
- [ ] Project templates
- [ ] Extension marketplace
- [ ] Cloud sync settings

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 💬 Support

- 📧 Email: support@devboxpro.dev
- 🐛 Issues: [GitHub Issues](https://github.com/yourusername/devbox-pro/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/yourusername/devbox-pro/discussions)

---

<p align="center">
  Made with ❤️ for PHP developers
</p>