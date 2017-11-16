'use strict';
const Fs = require('fire-fs');
const Path = require('fire-path');
const Electron = require('electron');
const Dialog = Electron.remote.dialog;


function showImportMessageBox (title, message, callback) {
    let boxInfo = {
        type: 'info',
        title: title,
        message: message,
        buttons: [Editor.T('MESSAGE.yes'), Editor.T('MESSAGE.no')],
        defaultId: 0,
        cancelId: 1,
        noLink: true
    };
    let cb = (result) => {
        callback && callback(null, result === 0);
    };
    Dialog.showMessageBox(boxInfo, cb);
}

function showSavePathDialog (defaultPath, callback) {
    Dialog.showOpenDialog(
        {
            defaultPath: defaultPath || Path.join(Editor.projectInfo.path, 'assets'),
            properties: ['openDirectory']
        },
        (paths) => {
            if (!callback || !paths) {
                return;
            }
            let savePath = Path.join(paths[0], '/');
            callback(null, savePath);
        }
    );
}

module.exports = {
    showImportMessageBox: showImportMessageBox,
    showSavePathDialog: showSavePathDialog,
};