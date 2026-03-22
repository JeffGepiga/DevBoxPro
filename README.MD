<p align="center">
  <img src="https://img.shields.io/badge/Electron-40.0.0-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/React-19.0.0-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/Vite-7.0.0-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/TailwindCSS-4.0.0-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="TailwindCSS">
</p>

# 🚀 DevBox Pro

**Run legacy and modern PHP and Node.js apps side by side with isolated runtimes, bundled services, and zero Docker setup.**

Maintaining an old PHP 7.4 project while building a new Laravel 11 app on PHP 8.5? Running a Next.js frontend alongside a PHP backend? DevBox Pro is built for exactly that workflow. It lets you run multiple PHP, Node.js, database, and web server versions at the same time, with per-project configuration, automatic local domains, compatibility warnings, and bundled tooling.

DevBox Pro is an Electron desktop app with a React renderer and a Node.js main process. It manages PHP, Node.js, MySQL, MariaDB, Redis, Nginx, Apache, PostgreSQL, MongoDB, MinIO, Memcached, Mailpit, phpMyAdmin, Composer, Git, and more from one local interface.

---

## ✨ Features

### 🐘 Multi-PHP Version Support
- **PHP 7.4, 8.0, 8.1, 8.2, 8.3, 8.4, 8.5** - Run multiple versions side by side
- Per-project PHP version selection with compatibility validation
- Easy extension management per version with php.ini editor
- Pre-configured for optimal performance

### 🟢 Node.js Project Support
- **Node.js 16, 18, 20, 22, 24** - Run pure Node.js applications
- Per-project Node.js version selection
- Automatic proxy through Nginx/Apache for `.test` domains
- Run Express, Next.js, Nuxt, or any Node.js framework

### 🌐 Web Server Options
- **Nginx 1.24, 1.26, 1.28** - High-performance, low memory footprint (recommended)
- **Apache 2.4** - Full .htaccess support, mod_rewrite included
- Front-door ownership and automatic proxying between Nginx and Apache
- Automatic virtual host creation
- HTTP & HTTPS support for every project

### 📦 Embedded Services
| Service | Versions | Description |
|---------|----------|-------------|
| **MySQL** | 5.7, 8.0, 8.4 | Powerful relational database |
| **MariaDB** | 10.6, 10.11, 11.4 | MySQL-compatible, open source |
| **Redis** | 6.2, 7.2, 7.4 | In-memory cache & session storage |
| **PostgreSQL** | 14, 15, 16, 17 | Advanced relational database |
| **MongoDB** | 6.0, 7.0, 8.0 | Document database |
| **Memcached** | 1.6 | Distributed memory caching |
| **MinIO** | Latest | S3-compatible object storage |
| **Mailpit** | Latest | Email testing with SMTP server |
| **phpMyAdmin** | Latest | Web-based database management |
| **Node.js** | 16, 18, 20, 22, 24 (LTS) | JavaScript runtime for projects & tooling |
| **Python** | 3.10, 3.11, 3.12, 3.13 | Runtime for project tooling and workers |
| **SQLite** | 3 | Embedded database runtime |
| **Composer** | Latest | PHP dependency manager |

### 💾 Database Management
- **Multi-engine support** - MySQL, MariaDB, PostgreSQL, and MongoDB workflows
- **Per-version data isolation** - Each version has its own data directory
- **Database import/export** with `.sql`, `.gz`, PostgreSQL, and MongoDB flows
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
- **Node.js** - Express, Next.js, Nuxt, Fastify, or any Node.js app

### 🔧 Binary Manager
- **Download individual components** - Only install what you need
- **Multi-version management** - Keep multiple versions installed
- **One-click updates** - Easy version upgrades
- **Import custom binaries** - Use your own compiled versions
- **Remote definitions** - Binary metadata and compatibility rules can be updated without shipping a new app build

### ☁️ Cloud Configuration Updates
- **Remote binary definitions** - New versions available without app update
- **Compatibility rules sync** - Updated version compatibility warnings
- **One-click update check** - Check for new binaries and rules from Settings
- **Offline fallback** - Built-in defaults when offline
- **Version tracking** - Only download when updates are available

### 💻 Terminal Commands
- **Direct command access** - Use `php`, `npm`, `node`, `composer`, `mysql`, `mysqldump`, and related tools directly from any terminal
- **Automatic version detection** - Detects your project and uses the correct PHP/Node.js version
- **Works everywhere** - VS Code, Windows Terminal, PowerShell, or any terminal emulator
- **No prefix needed** - Just run `php artisan migrate` instead of complex paths
- **Prevents version conflicts** - No more "wrong PHP version" issues

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

## 🚀 Quick Start

### Installation

1. **Download** the latest release for your platform:
   - Windows: `DevBox-Pro-Setup-x.x.x.exe`
  - Linux: `DevBox Pro-x.x.x-linux-x64.AppImage` or `DevBox Pro-x.x.x-linux-x64.deb`

2. **Install** the application

3. **Download binaries** from the Binary Manager:
   - Click "Download All" for the full stack, or
   - Select individual components as needed

### Creating Your First Project

1. Click **"+ New Project"** on the Dashboard
2. Select your **project type** (Laravel, Symfony, WordPress, Custom PHP, or Node.js)
3. Choose **project folder** and **PHP/Node.js version**
4. Configure **services** (MySQL, Redis, etc.)
5. Set your **domain** (e.g., `myproject.test`)
6. Click **Create** and you're ready!

### Using Terminal Commands

DevBox Pro lets you use `php`, `npm`, `node`, `composer`, `mysql`, and `mysqldump` directly from any terminal with automatic project version detection:

1. Go to **Settings > CLI Tool** in DevBox Pro
2. Enable **"Terminal commands"**
3. Restart your terminal or VS Code

**Usage examples:**
```bash
# Navigate to your project folder
cd C:\Projects\my-laravel-app

# Run PHP with project-specific version (auto-detected)
php artisan migrate
php artisan optimize

# Run Composer with correct PHP version
composer install
composer update

# Run Node.js/npm with project version (if enabled)
npm install
npm run dev
npx vite build

# Connect to MySQL/MariaDB using the active database version
mysql -u root
mysql -u root -p mydb < migration.sql
mysqldump -u root mydb > backup.sql
```

> **How it works:** When you run `php`, `mysql`, or `npm` from a project directory, DevBox Pro automatically uses that project's configured version. Outside a project, it uses your default version set in Settings.

---

## 💻 Development Setup

### Prerequisites

- Node.js 24+
- npm
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/JeffGepiga/DevBoxPro.git
cd DevBoxPro

# Install dependencies
npm install

# Start the Electron app with the Vite renderer dev server
npm run dev

# Build the renderer bundle only
npm run build:renderer

# Build platform packages
npm run build:win
npm run build:linux
npm run build:all
```

The renderer dev server runs at `http://localhost:3000`.

### Testing

DevBox Pro includes unit, integration, and end-to-end coverage.

```bash
# Run all tests
npm test

# Run only main process tests
npm run test:main

# Run only renderer process tests
npm run test:renderer

# Run End-to-End (E2E) tests
npm run test:e2e
```

The test suite covers the main-process managers, the renderer, and Playwright end-to-end scenarios for project creation, binaries, databases, SSL, and settings persistence.

### Project Structure

```
DevBoxPro/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── services/
│   │   │   ├── BinaryDownloadManager.js  # Thin facade for binary downloads and extraction
│   │   │   ├── CliManager.js             # Thin facade for terminal integration
│   │   │   ├── CompatibilityManager.js   # Thin facade for compatibility rules and updates
│   │   │   ├── DatabaseManager.js        # Thin facade for multi-engine DB operations
│   │   │   ├── GitManager.js             # Thin facade for Git clone and SSH workflows
│   │   │   ├── ProjectManager.js         # Thin facade for project lifecycle and vhosts
│   │   │   ├── ServiceManager.js         # Thin facade for service lifecycle and config generation
│   │   │   ├── SupervisorManager.js      # Thin facade for worker and process supervision
│   │   │   ├── binary/                   # Binary manager mixins
│   │   │   ├── cli/                      # CLI manager mixins
│   │   │   ├── compatibility/            # Compatibility manager mixins
│   │   │   ├── database/                 # Database manager mixins
│   │   │   ├── git/                      # Git manager mixins
│   │   │   ├── project/                  # Project manager mixins
│   │   │   ├── service/                  # Service manager mixins
│   │   │   ├── supervisor/               # Supervisor manager mixins
│   │   │   └── ...
│   │   ├── ipc/
│   │   │   └── handlers.js      # IPC communication
│   │   ├── utils/
│   │   │   ├── ConfigStore.js   # Configuration storage
│   │   │   ├── PortUtils.js     # Port probing and process lookup
│   │   │   └── SpawnUtils.js    # Safer child-process helpers
│   │   ├── preload.js           # Preload script
│   │   └── main.js              # Main entry
│   │
│   └── renderer/                # React frontend
│       ├── src/
│       │   ├── components/      # Reusable components
│       │   │   ├── Sidebar.jsx
│       │   │   ├── PhpIniEditor.jsx
│       │   │   ├── XTerminal.jsx
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
├── config/                      # Remote configuration files
│   ├── binaries.json            # Binary download definitions
│   ├── compatibility.json       # Version compatibility rules
│   └── README.md                # Config contribution guide
├── screenshots/                 # App screenshots
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
| MariaDB | 3310 |
| Redis | 6379 |
| PostgreSQL | 5432 |
| MongoDB | 27017 |
| Memcached | 11211 |
| MinIO API | 9000 |
| MinIO Console | 9001 |
| Mailpit SMTP | 1025 |
| Mailpit Web | 8025 |
| phpMyAdmin | 8080 |
| Nginx HTTP | 80 |
| Nginx HTTPS | 443 |
| Apache HTTP | 8081 when Apache is not the front-door server |
| Apache HTTPS | 8444 when Apache is not the front-door server |

Web server ownership is dynamic. The first active web server can claim ports `80` and `443`, while the other is assigned alternate ports and proxied automatically.

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

- **Electron 40** - Cross-platform desktop framework
- **React 19** - UI library
- **Vite 7** - Build and dev server
- **TailwindCSS 4** - Styling pipeline
- **Vitest** - Unit and integration testing
- **Playwright** - End-to-end testing
- **electron-builder** - Distribution packaging

---

## 📋 Roadmap

- [x] Multi-PHP version support (7.4 - 8.5)
- [x] MySQL & MariaDB multi-version support
- [x] Redis multi-version integration  
- [x] Nginx & Apache multi-version web servers
- [x] Automatic SSL certificates
- [x] Virtual host management
- [x] Node.js & npm multi-version support
- [x] Pure Node.js project support (Express, Next.js, etc.)
- [x] Composer integration
- [x] Database import/export with compression
- [x] Per-project service version selection
- [x] Binary validation before project start
- [x] php.ini editor
- [x] Real-time log streaming
- [x] Cloud config updates (binaries & compatibility rules)
- [x] PostgreSQL support
- [x] MongoDB support
- [x] Project templates
- [x] Git clone integration with SSH key management
- [x] Supervisor process management (queues, workers, schedulers)
- [x] Bulk project and service stop
- [x] Front-door proxy for Nginx/Apache co-existence
- [ ] Docker container support
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

- 📧 Email: jeffreygepiga27@gmail.com
- 🐛 Issues: [GitHub Issues](https://github.com/JeffGepiga/DevBoxPro/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/JeffGepiga/DevBoxPro/discussions)

---

<p align="center">
  Made with ❤️ for PHP & Node.js developers
</p>