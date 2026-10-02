// electron-builder config. The app version comes from the root package.json, so
// bumping DevOne's version is all it takes to version the desktop app too.
const { version } = require('../package.json');

module.exports = {
  appId: 'dev.devone.desktop',
  productName: 'DevOne',
  artifactName: 'DevOne-${version}-${os}-${arch}.${ext}',
  extraMetadata: { version },
  directories: { output: 'dist' },
  files: ['main.js', 'package.json'],
  // Copies the Next.js standalone server (built by prepare-server.mjs) into the
  // app's resources. extraResources can't do it: electron-builder strips node_modules.
  afterPack: './after-pack.cjs',
  mac: { category: 'public.app-category.developer-tools', target: 'dmg' },
  win: { target: 'nsis' },
  linux: { target: 'AppImage', category: 'Development' }
};
