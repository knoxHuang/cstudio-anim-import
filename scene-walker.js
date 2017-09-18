const Fs = require('fire-fs');
const Path = require('fire-path');

const AnimImporter = Editor.require('packages://cstudio-anim-import/code/importer');

module.exports = {
    'import-animation' (event, data) {
        AnimImporter.Import(data.dragItems, data.savePath, (message, progress, totalProgress) => {
            Editor.Ipc.sendToAll('cstudio-anim-import:progress', message, progress, totalProgress);
        });
    }
};