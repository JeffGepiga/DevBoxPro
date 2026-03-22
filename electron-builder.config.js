/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
module.exports = {
  appId: 'com.devbox.pro',
  productName: 'DevBox Pro',
  copyright: 'Copyright © 2024 DevBox Pro',
  asar: true,
  // Use the Electron binary already downloaded by `npm install` (node_modules/electron/dist)
  // This avoids re-downloading 138MB from GitHub during every build.
  electronDist: './node_modules/electron/dist',
  directories: {
    output: 'dist',
    buildResources: 'resources',
  },
  files: [
    'src/main/**/*',
    'src/shared/**/*',
    'config/binaries.json',
    'config/compatibility.json',
    '!src/main/**/*.map',
    {
      from: 'src/renderer/dist',
      to: 'renderer',
    },
  ],
  extraFiles: [
    {
      from: 'build/icon.png',
      to: 'icon.png',
    },
    {
      from: 'logo.ico',
      to: 'icon.ico',
    },
  ],
  extraResources: [
    {
      from: 'vcredist',
      to: 'vcredist',
      filter: ['**/*'],
    },
    {
      from: 'resources/php',
      to: 'php',
      filter: ['**/*'],
    },
    {
      from: 'resources/mysql',
      to: 'mysql',
      filter: ['**/*'],
    },
    {
      from: 'resources/redis',
      to: 'redis',
      filter: ['**/*'],
    },
    {
      from: 'resources/mailpit',
      to: 'mailpit',
      filter: ['**/*'],
    },
    {
      from: 'resources/phpmyadmin',
      to: 'phpmyadmin',
      filter: ['**/*'],
    },
  ],
  win: {
    executableName: 'DevBoxPro',
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    icon: 'build/icon.png',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'DevBox Pro',
    include: 'resources/installer.nsh',
    artifactName: 'DevBox-Pro-Setup-${version}.${ext}',
  },
  linux: {
    target: [
      {
        target: 'AppImage',
        arch: ['x64'],
      },
      {
        target: 'deb',
        arch: ['x64'],
      },
    ],
    icon: 'build/icon.png',
    category: 'Development',
    artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  },
  publish: {
    provider: 'github',
    owner: 'JeffGepiga',
    repo: 'DevBoxPro',
  },
};
