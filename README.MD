Complete AI Prompt for Local Development Server with Multi-PHP Support
Project Overview: "DevBox Pro"
A standalone, cross-platform local development server for Windows and macOS that supports multiple PHP versions, multiple projects simultaneously, and various PHP frameworks (Laravel, Symfony, WordPress, custom PHP).

Core Requirements:
1. Cross-Platform
Single application distribution for Windows (.exe) and macOS (.dmg)

No dependencies required (everything bundled)

Native look and feel for each OS

2. Multi-PHP Version Support
Support PHP 7.4, 8.0, 8.1, 8.2, 8.3 simultaneously

Per-project PHP version selection

Easy PHP version switching

PHP extension management per version

3. Multi-Project Management
Run unlimited projects simultaneously

Different PHP versions per project

Project isolation

Quick start/stop for individual projects

Project groups/categories

4. Embedded Services
MySQL (latest compatible version)

Redis (with persistence)

Mailpit (email testing)

phpMyAdmin (database management)

Local SSL (mkcert integration)

Supervisor (process management)

5. Framework Support
Laravel (with artisan commands, queue workers)

Symfony

WordPress

Custom PHP applications

Static websites

Node.js projects (optional)

6. Advanced Features
Local SSL certificate generation (wildcard support)

Custom domain support (project.test)

Port management (auto or manual)

Environment variable management

Database management (create, import, export)

Composer/NPM integration

Git integration

Log viewer (real-time)

Resource monitor (CPU, memory, disk)

Technical Specifications:
Application Architecture
text
DevBox Pro Application
├── Main Process (Electron)
│   ├── Service Manager
│   ├── PHP Version Manager
│   ├── Project Manager
│   ├── SSL Manager
│   └── Supervisor Manager
├── Renderer Process (Dashboard UI)
│   ├── Project Dashboard
│   ├── Service Status Panel
│   ├── Log Viewer
│   └── Settings Panel
└── Resources (Embedded)
    ├── PHP Binaries (multiple versions)
    ├── MySQL Server
    ├── Redis Server
    ├── Mailpit
    ├── phpMyAdmin
    └── Supervisor
Data Structure
json
{
  "app": {
    "version": "1.0.0",
    "settings": {
      "autoStartServices": true,
      "portRangeStart": 8000,
      "sslEnabled": true
    }
  },
  "projects": [
    {
      "id": "uuid",
      "name": "Project Name",
      "path": "/absolute/path",
      "type": "laravel|symfony|wordpress|custom",
      "phpVersion": "8.2",
      "port": 8000,
      "domains": ["project.test", "api.project.test"],
      "services": {
        "mysql": true,
        "redis": true,
        "queue": false
      },
      "environment": {
        "APP_ENV": "local",
        "DB_DATABASE": "project_db"
      },
      "supervisor": {
        "workers": 2,
        "processes": []
      }
    }
  ],
  "phpVersions": {
    "8.2": {
      "path": "/resources/php/8.2",
      "extensions": ["pdo_mysql", "redis", "xdebug"],
      "default": true
    }
  }
}
User Interface Requirements:
Main Dashboard
Project list with status indicators

Quick start/stop all projects

Resource usage overview

Service status indicators

Recent logs

Project Detail View
Project information card

Service controls (MySQL, Redis, etc.)

Log output panel

Environment variables editor

Database management tools

Artisan/CLI command runner

Project Creation Wizard
Select project type

Choose PHP version

Configure services (MySQL, Redis, etc.)

Set up domains/ports

Environment setup

Optional: Clone from Git

Settings Panel
PHP version management

Service configuration

Network settings

SSL certificate management

Theme/Appearance

Update settings

Implementation Details:
Technology Stack
Frontend: Electron + React/Vue.js (your choice)

Backend: Node.js (Electron main process)

Build Tool: electron-builder

Database: SQLite for configuration

Process Management: Node.js child_process + Supervisor

Key Technical Challenges to Address
PHP Binary Management: Bundle multiple PHP versions, handle extensions

Port Conflict Resolution: Smart port assignment and management

SSL Certificate Generation: Auto-create and trust certificates

Service Lifecycle: Start/stop services in correct order

Resource Isolation: Prevent projects from interfering

Update Mechanism: Seamless application updates

Log Management: Centralized log collection and viewing

Performance: Low memory footprint, efficient process management

File Structure
text
devbox-pro/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── services/
│   │   │   ├── PhpManager.js
│   │   │   ├── ProjectManager.js
│   │   │   ├── ServiceManager.js
│   │   │   ├── SslManager.js
│   │   │   └── SupervisorManager.js
│   │   ├── utils/
│   │   └── main.js
│   ├── renderer/                # UI
│   │   ├── components/
│   │   ├── views/
│   │   ├── store/
│   │   └── App.js
│   └── shared/                  # Shared code
│       └── constants.js
├── resources/                   # Embedded binaries
│   ├── php/
│   │   ├── 7.4/
│   │   ├── 8.0/
│   │   └── 8.2/
│   ├── mysql/
│   ├── redis/
│   └── supervisor/
├── scripts/                     # Build/install scripts
├── docs/                        # Documentation
└── tests/                       # Test suites
Development Phases:
Phase 1: Foundation (2-3 weeks)
Electron application shell

Basic UI framework

Configuration management

Single PHP version support

Phase 2: Core Services (3-4 weeks)
Multi-PHP version manager

MySQL/Redis integration

Project management

Basic dashboard

Phase 3: Advanced Features (3-4 weeks)
Supervisor integration

SSL certificate generation

phpMyAdmin integration

Log management system

Phase 4: Polish & Optimization (2-3 weeks)
Performance optimization

UI/UX improvements

Testing and bug fixes

Documentation

Distribution Strategy:
Windows: Portable EXE and Installer

macOS: DMG and Mac App Store

Auto-update mechanism

Offline installation support

Testing Requirements:
Unit tests for core functionality

Integration tests for services

Cross-platform testing

Performance benchmarking

User acceptance testing

Documentation:
Installation guide

User manual

Developer guide

API documentation (if any)

Troubleshooting guide