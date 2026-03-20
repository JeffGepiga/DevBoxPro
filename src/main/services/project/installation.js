const installationCreate = require('./installation/create');
const installationFlow = require('./installation/flow');
const installationLaravel = require('./installation/laravel');
const installationNodeFramework = require('./installation/nodeFramework');
const installationPostClone = require('./installation/postClone');
const installationSymfony = require('./installation/symfony');
const installationWordPress = require('./installation/wordpress');

module.exports = Object.assign(
  {},
  installationCreate,
  installationFlow,
  installationLaravel,
  installationNodeFramework,
  installationPostClone,
  installationSymfony,
  installationWordPress,
);