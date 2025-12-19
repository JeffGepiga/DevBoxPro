<p align="center">
  <img src="https://img.shields.io/badge/Electron-28.0.0-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/React-18.2.0-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/Vite-5.0.10-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/TailwindCSS-3.4.0-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="TailwindCSS">
</p>

# 🚀 DevBox Pro

**A powerful, cross-platform local development server for PHP developers**

DevBox Pro is a standalone desktop application that provides everything you need for PHP development - multiple PHP versions, MySQL/MariaDB, Redis, Mailpit, and more - all bundled in a single, easy-to-use application. No Docker required!

---

## ✨ Features

### 🐘 Multi-PHP Version Support
- **PHP 7.4, 8.0, 8.1, 8.2, 8.3, 8.4** - Run any version side by side
- Per-project PHP version selection with compatibility validation
- Easy extension management per version with php.ini editor
- Pre-configured for optimal performance

### 🌐 Web Server Options
- **Nginx 1.26, 1.28** - High-performance, low memory footprint (recommended)
- **Apache 2.4** - Full .htaccess support, mod_rewrite included
- Multi-version support - run different versions per project
- Automatic virtual host creation
- HTTP & HTTPS support for every project

### 📦 Embedded Services
| Service | Versions | Description |
|---------|----------|-------------|
| **MySQL** | 8.0, 8.4 | Powerful relational database |
| **MariaDB** | 10.11, 11.4 | MySQL-compatible, open source |
| **Redis** | 7.2, 7.4 | In-memory cache & session storage |
| **Mailpit** | Latest | Email testing with SMTP server |
| **phpMyAdmin** | Latest | Web-based database management |
| **Node.js** | 18, 20 (LTS), 22 | JavaScript runtime |
| **Composer** | Latest | PHP dependency manager |

### 💾 Database Management
- **Multi-version support** - Run MySQL 8.0 and MariaDB 11.4 simultaneously
- **Per-version data isolation** - Each version has its own data directory
- **Database import/export** with .gz compression support
- **Progress tracking** for import/export operations
- **phpMyAdmin integration** for web-based management
- **Automatic database creation** per project

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

### 🔧 Binary Manager
- **Download individual components** - Only install what you need
- **Multi-version management** - Keep multiple versions installed
- **One-click updates** - Easy version upgrades
- **Import custom binaries** - Use your own compiled versions

### 📊 Logging & Monitoring
- **Real-time log streaming** per project and service
- **Color-coded log levels** (info, warning, error)
- **Log file rotation** and cleanup
- **Service resource monitoring**

### ⚙️ Project Configuration
- **Service version selection** per project
- **Compatibility validation** - Warns about incompatible combinations
- **Binary validation** - Checks required binaries before project start
- **php.ini editor** - Customize PHP settings per version

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
git clone https://github.com/JeffGepiga/DevBoxPro.git
cd DevBoxPro

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
DevBoxPro/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── services/
│   │   │   ├── PhpManager.js        # PHP version management
│   │   │   ├── ProjectManager.js    # Project lifecycle
│   │   │   ├── ServiceManager.js    # MySQL, MariaDB, Redis, etc.
│   │   │   ├── DatabaseManager.js   # Database operations (CRUD, import/export)
│   │   │   ├── SslManager.js        # SSL certificates
│   │   │   ├── WebServerManager.js  # Nginx/Apache
│   │   │   ├── BinaryDownloadManager.js  # Binary downloads
│   │   │   ├── LogManager.js        # Log management
│   │   │   ├── SupervisorManager.js # Process supervisor
│   │   │   └── ...
│   │   ├── ipc/
│   │   │   └── handlers.js      # IPC communication
│   │   ├── utils/
│   │   │   └── ConfigStore.js   # Configuration storage
│   │   ├── preload.js           # Preload script
│   │   └── main.js              # Main entry
│   │
│   └── renderer/                # React frontend
│       ├── src/
│       │   ├── components/      # Reusable components
│       │   │   ├── Sidebar.jsx
│       │   │   ├── PhpIniEditor.jsx
│       │   │   ├── ProjectTerminal.jsx
│       │   │   └── ...
│       │   ├── pages/           # Page components
│       │   │   ├── Dashboard.jsx
│       │   │   ├── Projects.jsx
│       │   │   ├── ProjectDetail.jsx
│       │   │   ├── Databases.jsx
│       │   │   ├── Services.jsx
│       │   │   ├── BinaryManager.jsx
│       │   │   ├── Settings.jsx
│       │   │   └── ...
│       │   ├── context/         # React context
│       │   │   └── AppContext.jsx
│       │   └── App.jsx          # Root component
│       └── index.html
│
├── resources/                   # App resources (icons, configs)
├── build/                       # Build resources
├── electron-builder.config.js   # Electron builder config
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
| MariaDB | 3306 (or 3307 if MySQL is running) |
| Redis | 6379 |
| Mailpit SMTP | 1025 |
| Mailpit Web | 8025 |
| phpMyAdmin | 8080 |
| Nginx HTTP | 80 |
| Nginx HTTPS | 443 |
| Apache HTTP | 80 (or 8081 if Nginx is on 80) |
| Apache HTTPS | 443 |

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

- [x] Multi-PHP version support (7.4 - 8.4)
- [x] MySQL & MariaDB multi-version support
- [x] Redis multi-version integration  
- [x] Nginx & Apache multi-version web servers
- [x] Automatic SSL certificates
- [x] Virtual host management
- [x] Node.js & npm multi-version support
- [x] Composer integration
- [x] Database import/export with compression
- [x] Per-project service version selection
- [x] Binary validation before project start
- [x] php.ini editor
- [x] Real-time log streaming
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
- 🐛 Issues: [GitHub Issues](https://github.com/JeffGepiga/DevBoxPro/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/JeffGepiga/DevBoxPro/discussions)

---

<p align="center">
  Made with ❤️ for PHP developers
</p>