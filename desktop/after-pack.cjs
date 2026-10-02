// electron-builder afterPack hook: copy desktop/server (the Next.js standalone
// server, node_modules included) into the packaged app's resources folder.
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const resources =
    electronPlatformName === 'darwin' || electronPlatformName === 'mas'
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(appOutDir, 'resources');
  const source = path.join(__dirname, 'server');
  if (!fs.existsSync(path.join(source, 'server.js'))) {
    throw new Error('desktop/server is missing; run `node prepare-server.mjs` first');
  }
  fs.cpSync(source, path.join(resources, 'server'), { recursive: true, verbatimSymlinks: true });
};
