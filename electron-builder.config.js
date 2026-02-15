/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
module.exports = {
  appId: 'com.devbox.pro',
  productName: 'DevBox Pro',
  copyright: 'Copyright © 2024 DevBox Pro',
  asar: true,
  directories: {
    output: 'dist',
    buildResources: 'resources',
  },
  files: [
    'src/main/**/*',
    'src/shared/**/*',
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
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
      {
        target: 'portable',
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
  portable: {
    artifactName: 'DevBox-Pro-${version}.${ext}',
  },
  mac: {
    target: [
      {
        target: 'dmg',
        arch: ['x64', 'arm64'],
      },
      {
        target: 'zip',
        arch: ['x64', 'arm64'],
      },
    ],
    icon: 'resources/icons/icon.icns',
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'resources/entitlements.mac.plist',
    entitlementsInherit: 'resources/entitlements.mac.plist',
    artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  },
  dmg: {
    contents: [
      {
        x: 130,
        y: 220,
      },
      {
        x: 410,
        y: 220,
        type: 'link',
        path: '/Applications',
      },
    ],
    window: {
      width: 540,
      height: 380,
    },
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
    icon: 'resources/icons',
    category: 'Development',
    artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  },
  publish: {
    provider: 'github',
    owner: 'JeffGepiga',
    repo: 'DevBoxPro',
  },
};
