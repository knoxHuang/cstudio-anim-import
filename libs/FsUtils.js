const Fs = require('fire-fs');
const Path = require('path');

let TempAssetsPath = '';
let TempFolderName = 'temp';

function _init (root) {
    TempAssetsPath = Path.join(Editor.remote.projectPath, TempFolderName, root);
    if (Fs.existsSync(TempAssetsPath)) {
        _rmdirRecursive(TempAssetsPath);
    }
    Fs.mkdirsSync(TempAssetsPath);
}

function _removeTempAssetsPath () {
    try {
        _rmdirRecursive(TempAssetsPath);
    } catch (err) {
        Editor.warn('Delete temp path %s failed, please delete it manually!', TempAssetsPath);
    }
}

function _rmdirRecursive (path) {
    if (Fs.existsSync(path)) {
        Fs.readdirSync(path).forEach((file) => {
            let curPath = Path.join(path, file);
            if (Fs.lstatSync(curPath).isDirectory()) {
                // recurse
                _rmdirRecursive(curPath);
            }
            else {
                // delete file
                Fs.unlinkSync(curPath);
            }
        });
        Fs.rmdirSync(path);
    }
}

function _copyAssetsToTempPath (name, srcPath) {
    if (!Fs.existsSync(srcPath)) {
        Editor.warn('%s is not found!', srcPath);
        return;
    }
    let destPath = Path.join(TempAssetsPath, name);
    if (Fs.existsSync(destPath)) {
        return;
    }
    Fs.copySync(srcPath, destPath);
}

function _createFileToTempPath (root, name, rawData) {
    let rootPath = Path.join(TempAssetsPath, root);
    if (!Fs.existsSync(rootPath)) {
        Fs.mkdirsSync(rootPath);
    }
    let path = Path.join(rootPath, name);
    if (!Fs.existsSync(path)) {
        Fs.writeFileSync(path, rawData);
    }
    return path;
}

function _createFolder (dstPath) {
    if (!Fs.existsSync(dstPath)) {
        Fs.mkdirSync(dstPath);
    }
}

module.exports = {
    init: _init,
    removeTempAssetsPath: _removeTempAssetsPath,
    rmdirRecursive: _rmdirRecursive,
    copyAssetsToTempPath: _copyAssetsToTempPath,
    createFileToTempPath: _createFileToTempPath,
    createFolder: _createFolder
};