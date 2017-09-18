'use strict';

const Fs = require('fire-fs');
const Url = require('fire-url');
const Path = require('path');
const Async = require('async');

const Utils = Editor.require('packages://cstudio-anim-import/code/utils');
const FsUtils = Editor.require('packages://cstudio-anim-import/libs/FsUtils');

const AssetsRootUrl = 'db://assets/';
const AssetsRootPath = Path.join(Editor.remote.projectPath, 'assets');
const TempFolderName = 'Temp';
const DEFAULT_ACTION_FPS = 60;

let AssetsTempPath = '';
let PREFAB_NAME = 'New Node';

//
let ExportJsonDataArr = [];
// 存储源文件的 name type path 等详细信息
let SrcFileArr = [];
// 存储 SpriteFrame UUid key = name, value = uuid
let SPRITEFRAME_ATLAS = [];
// 存储图集信息，通过 displayIndex 可以获取
let DISPLAY_DATA = [];
//
let AnimationClips = [];
// 存储每个 Layer 的属性 name
let LayerList = [];
// 存储已导入的图片资源
let importedTextureArr = [];
// 存储已导入的 plist 资源
let importedPlistArr = [];

let EXTNAME = {
    ExportJson: '.ExportJson',
    Plist: '.plist',
    Animation: '.anim',
    Prefab: '.prefab',
    Png: '.png'
};

function _init (items) {
    importedTextureArr = [];
    importedPlistArr = [];
    SrcFileArr = [];
    SPRITEFRAME_ATLAS = [];
    DISPLAY_DATA = [];
    _initScrArr(items);
    FsUtils.init('AnimationImport');
}

function _initScrArr (items) {
    ExportJsonDataArr = [];
    for (let i = 0; i < items.length; ++i) {
        let item = items[i];
        if (item.type === EXTNAME.ExportJson) {
            ExportJsonDataArr.push(item);
        }
        else {
            if (!SrcFileArr[item.type]) {
                SrcFileArr[item.type] = [];
            }
            SrcFileArr[item.type].push(item);
        }
    }
}

function _getSpriteFrameByDisplayIndex (name, displayIndx) {
    let url = DISPLAY_DATA[name][displayIndx];
    let uuid = SPRITEFRAME_ATLAS[url];
    if (uuid) {
        return Editor.serialize.asAsset(uuid);
    }
    cc.warn('texture：' + url + ' does not exist.');
    return null;
}

function _decodeDisplayData (name, display_data, cb) {
    let len = display_data.length;
    if (len > 0) {
        DISPLAY_DATA[name] = [];
        for (let i = 0; i < len; ++i) {
            let data = display_data[i];
            // display name;
            DISPLAY_DATA[name].push(data['name']);
            if (i === len - 1) {
                cb();
            }
        }
    }
    else {
        cb();
    }
}

function _decodeBone (bone_data, cb) {
    let index = 0;
    Async.whilst(
        function () {
            return index < bone_data.length;
        },
        function (whileCb) {
            let bData = bone_data[index];
            let name = bData['name'];
            LayerList.push(name);
            let display_data = bData['display_data'];
            if (!display_data) {
                return _sendErrorMessage('display_data is null');
            }
            _decodeDisplayData(name, display_data, () => {
                index++;
                whileCb();
            });
        },
        function () {
            cb();
        }
    );
}

function _addPropFrames (idx, frame, value, propFrams) {
    let tempValue = value;
    if (typeof value === 'function') {
        tempValue = value();
    }

    if (idx === 0) {
        propFrams[idx] = {
            frame: frame,
            value: tempValue || 0
        }
    }
    else if (tempValue || tempValue > 0) {
        propFrams[idx] = {
            frame: frame,
            value: tempValue || 0
        }
    }
}

function _decodeFrameData (mov_bone_data, sample, cb) {
    let curve_data = {};
    let name = mov_bone_data['name'];
    let frame_data = mov_bone_data['frame_data'];
    if (!frame_data) {
        return cb(curve_data);
    }
    let frames = [];
    let colors = [];
    let opacitys = [];
    let props = {};
    let xFrames = [];
    let yFrames = [];
    let hasAddOpacity = false;
    for (let i = 0, l = frame_data.length; i < l; i++) {
        let data = frame_data[i];
        let frame = (data['fi'] / sample);
        // 是否过度
        let tweenFrame = data['tweenFrame'];
        // sprite frame
        frames[i] = {
            frame: frame,
            value: _getSpriteFrameByDisplayIndex(name, data['dI']),
        };
        _addPropFrames(i, frame, data['x'], xFrames);
        _addPropFrames(i, frame, data['y'], yFrames);
        let tempColor = data['color'];
        if (tempColor) {
            // color
            _addPropFrames(i, frame, function () {
                return new cc.Color(tempColor['r'], tempColor['g'], tempColor['b']);
            }, colors);
            // opacity
            opacitys[i] = {
                frame: frame,
                value: tempColor['a']
            };
            if (!tweenFrame) {
                opacitys[i].curve = "constant";
            }
            hasAddOpacity = true;
        }
        else {
            if (hasAddOpacity) {
                hasAddOpacity = false;
                opacitys[i] = {
                    frame: frame,
                    value: 255,
                    curve: "constant"
                };
            }
        }
    }

    if (Object.keys(xFrames).length > 1) {
        props.x = xFrames;
    }
    if (Object.keys(yFrames).length > 1) {
        props.y = yFrames;
    }
    if (Object.keys(colors).length > 1) {
        props.color = colors;
    }
    if (Object.keys(opacitys).length > 1) {
        props.opacity = opacitys;
    }

    curve_data = {
        comps: {
            'cc.Sprite': {
                'spriteFrame': frames
            }
        },
        props: props
    };
    cb(name, curve_data);
}

function _decodeMovBoneData (mov_data, cb) {
    let animClip = new cc.AnimationClip();
    animClip.name = mov_data['name'];
    // sample 的缩放 1 表示 60 帧
    let sample_scale = mov_data['sc'] || 1;
    animClip.sample = DEFAULT_ACTION_FPS * sample_scale;
    animClip._duration = mov_data['dr'] / animClip.sample;
    animClip.wrapMode = mov_data['lp'] ? cc.WrapMode.Loop : cc.WrapMode.Normal;

    let mov_bone_data = mov_data['mov_bone_data'];
    if (!mov_bone_data) {
        return cb(animClip);
    }

    let node_curve_data = {};
    animClip.curveData = {
        paths: node_curve_data
    };

    let index = 0;
    Async.whilst(
        function () {
            return index < mov_bone_data.length;
        },
        function (whileCb) {
            let movboneData = mov_bone_data[index];
            _decodeFrameData(movboneData, animClip.sample, (name, curveData) => {
                node_curve_data[name] = curveData;
                index++;
                whileCb();
            });
        },
        function () {
            cb(animClip);
        }
    );
}

function _decodeMoveData (mov_data, cb) {
    let index = 0;
    Async.whilst(
        function () {
            return index < mov_data.length;
        },
        function (whileCb) {
            _decodeMovBoneData(mov_data[index], (animClip) => {
                if (animClip) {
                    AnimationClips.push(animClip);
                }
                index++;
                whileCb();
            });
        },
        function () {
            cb();
        }
    );
}

function importExportJson (exportJsonData, cb) {
    let exportJson_data = JSON.parse(Fs.readFileSync(exportJsonData.path, 'utf8'));
    Async.waterfall([
        function (next) {
            let armature_data = exportJson_data['armature_data'][0];
            if (!armature_data) {
                return _sendErrorMessage('armature_data is null');
            }
            let bone_data = armature_data['bone_data'];
            if (!bone_data) {
                return _sendErrorMessage('bone_data is null');
            }
            _decodeBone(bone_data, next);
        },
        // docode mov_data
        function (next) {
            let animation_data = exportJson_data['animation_data'][0];
            if (!animation_data) {
                return _sendErrorMessage("animation_data is null");
            }
            //
            let mov_data = animation_data['mov_data'];
            if (!mov_data) {
                return _sendErrorMessage("mov_data is null");
            }
            PREFAB_NAME = animation_data['name'];
            _decodeMoveData(mov_data, next);
        }
    ], cb);
}

const STEP_VALUE = 8;
let _progressCb = null;
let _progress = 0;
let _totalProgress = 0;
function _sendProgressMessage (message) {
    _progress++;
    _progressCb(message, _progress, _totalProgress);
}

function _sendErrorMessage (err) {
    Editor.error(err);
    Editor.Ipc.sendToAll('cstudio-anim-import:error');
}

function _getImportTexturePathArr (exportJsonData) {
    let arr = [];
    let textureArr = SrcFileArr[EXTNAME.Png];
    if (!textureArr) {
        return arr;
    }
    let srcPlist = '', destPlist = '';
    let texturePath = Path.join(AssetsRootPath, exportJsonData.baseName, 'atlas');
    for (let i = 0; i < textureArr.length; ++i) {
        let texture = textureArr[i];
        let destPath = Path.join(texturePath, texture.name);
        if (importedTextureArr.indexOf(texture.name) !== -1) {
            continue;
        }
        if (!Fs.existsSync(destPath)) {
            arr.push(texture.path);
            importedTextureArr.push(texture.name);
            continue;
        }
        destPlist = Fs.readFileSync(destPath, 'utf8');
        if (Fs.existsSync(texture.path)) {
            srcPlist = Fs.readFileSync(texture.path, 'utf8');
        }
        if (destPlist !== srcPlist) {
            arr.push(texture.path);
            importedTextureArr.push(texture.name);
        }
    }
    return arr;
}

function _getImportPlistPathArr (exportJsonData) {
    let arr = [];
    let plistArr = SrcFileArr[EXTNAME.Plist];
    if (!plistArr) {
        return arr;
    }
    let srcPlist = '', destPlist = '';
    let atalsPath = Path.join(AssetsRootPath, exportJsonData.baseName, 'atlas');
    for (let i = 0; i < plistArr.length; ++i) {
        let plist = plistArr[i];
        let destPath = Path.join(atalsPath, plist.name);
        if (importedPlistArr.indexOf(plist.name) !== -1) {
            continue;
        }
        if (!Fs.existsSync(destPath)) {
            arr.push(plist.path);
            importedPlistArr.push(plist.name);
            continue;
        }
        destPlist = Fs.readFileSync(destPath, 'utf8');
        if (Fs.existsSync(plist.path)) {
            srcPlist = Fs.readFileSync(plist.path, 'utf8');
        }
        if (destPlist !== srcPlist) {
            arr.push(plist.path);
            importedPlistArr.push(plist.name);
        }
    }
    return arr;
}

function _import (items, destPath, progressCb) {
    _init(items);
    _progress = 1;
    _totalProgress = ExportJsonDataArr.length * STEP_VALUE;
    _progressCb = progressCb;

    let index = 0;
    Async.whilst(
        function () {
            return index < ExportJsonDataArr.length;
        },
        function (whileCb) {
            let exportJsonData = ExportJsonDataArr[index];
            _imports(exportJsonData, destPath, () => {
                index++;
                whileCb();
            });
        },
        function () {
            _sendProgressMessage('---- Finish ----');
            FsUtils.removeTempAssetsPath();
        }
    );
}

function _imports (exportJsonData, destPath, callback) {
    LayerList = [];
    AnimationClips = [];
    let outUrl = Url.join(AssetsRootUrl, Path.relative(AssetsRootPath, destPath), exportJsonData.baseName);
    let outResUrl = Url.join(outUrl, 'atlas/');
    let outAnimClipUrl = Url.join(outUrl, 'clips/');
    let importAssetTempPaths = [];

    cc.log('---- Import ' + exportJsonData.baseName + ' Animation ----');

    Async.waterfall([
        // create folder
        function (next) {
            _sendProgressMessage('create ' + exportJsonData.baseName + ' folder');
            if (!Editor.assetdb.remote.urlToUuid(outUrl)) {
                Editor.assetdb.create(outUrl, undefined, () => {
                    next();
                });
            }
            else {
                next();
            }
        },
        // import Textures
        function (next) {
            _sendProgressMessage('import ' + exportJsonData.baseName + ' textures');
            let importTextureArr = _getImportTexturePathArr(exportJsonData);
            if (importTextureArr.length > 0) {
                function importTexturesRes () {
                    Editor.assetdb.import(importTextureArr, outResUrl, false, (err, results) => {
                        if (err) {
                            return _sendErrorMessage(err);
                        }
                        next();
                    });
                }

                if (!Editor.assetdb.remote.urlToUuid(outResUrl)) {
                    Editor.assetdb.create(outResUrl, undefined, () => {
                        importTexturesRes()
                    });
                }
                else {
                    importTexturesRes();
                }

            }
            else {
                next();
            }
        },
        // import Plist
        function (next) {
            _sendProgressMessage('import ' + exportJsonData.baseName + ' plist');
            let imporPlistPathArr = _getImportPlistPathArr(exportJsonData);
            if (imporPlistPathArr.length > 0) {
                function importPlistResources () {
                    Editor.assetdb.import(imporPlistPathArr, outResUrl, false, (err, results) => {
                        if (err) {
                            return _sendErrorMessage(err);
                        }
                        next();
                    });
                }

                if (!Editor.assetdb.remote.urlToUuid(outResUrl)) {
                    Editor.assetdb.create(outResUrl, undefined, () => {
                        importPlistResources();
                    });
                }
                else {
                    importPlistResources();
                }
            }
            else {
                next();
            }
        },
        // save sprite-frame-atlas
        function (next) {
            Editor.assetdb.queryAssets( null, 'sprite-atlas', ( err, results ) => {
                if (err) {
                    return _sendErrorMessage(err);
                }
                for (let i = 0; i < results.length; ++i) {
                    let atlas = results[i];
                    let atlasMeta = Editor.remote.assetdb.loadMetaByUuid(atlas.uuid);
                    if (atlasMeta) {
                        let subMeata = atlasMeta.getSubMetas();
                        let keys = Object.keys(subMeata);
                        for (let j = 0; j < keys.length; ++j) {
                            let key = keys[j];
                            let value = subMeata[key];
                            key = key.replace(/-/g, '/');
                            SPRITEFRAME_ATLAS[key] = value.uuid;
                        }
                    }
                }
                next();
            });
        },
        // import and parsers exportJson
        function (next) {
            _sendProgressMessage('import and parsers ' + exportJsonData.baseName + ' exportJson');
            importExportJson(exportJsonData, () => {
                next();
            });
        },
        // create clip
        function (next) {
            _sendProgressMessage('create ' + exportJsonData.baseName + ' animation clip');
            let index = 0;
            Async.whilst(
                function () {
                    return index < AnimationClips.length;
                },
                function (whileCb) {
                    let clip = AnimationClips[index];
                    let clipData = clip.serialize();
                    let tempPath = FsUtils.createFileToTempPath(exportJsonData.baseName, clip.name + EXTNAME.Animation, clipData);
                    importAssetTempPaths.push(tempPath);
                    index++;
                    whileCb();
                },
                function () {
                    next();
                }
            );
        },
        // import animation clip to assets
        function (next) {
            _sendProgressMessage('import  ' + exportJsonData.baseName + ' animation clip');

            function importAnimationClip () {
                Editor.assetdb.import(importAssetTempPaths, outAnimClipUrl, false, (err, animClips) => {
                    if (err) {
                        return _sendErrorMessage(err);
                    }
                    importAssetTempPaths = [];
                    next(null, animClips);
                });
            }

            if (!Editor.assetdb.remote.urlToUuid(outAnimClipUrl)) {
                Editor.assetdb.create(outAnimClipUrl, undefined, () => {
                    importAnimationClip();
                });
            }
            else {
                importAnimationClip();
            }
        },
        // create prefab
        function (animClips, next) {
            _sendProgressMessage('create ' + exportJsonData.baseName + ' prefab');
            let rootNode = new cc.Node(PREFAB_NAME);
            let animComp = rootNode.addComponent(cc.Animation);
            for (let i = 0; i < LayerList.length; ++i) {
                let layer = LayerList[i];
                let childNode = new cc.Node(layer);
                let spriteComp = childNode.addComponent(cc.Sprite);
                spriteComp.sizeMode = cc.Sprite.SizeMode.RAW;
                spriteComp.trim = false;
                childNode.parent = rootNode;
            }
            for (let i = 0; i < animClips.length; ++i) {
                let baseClip = animClips[i];
                let animClip = new cc.AnimationClip();
                animClip._uuid = baseClip.uuid;
                animClip._name = Url.basenameNoExt(baseClip.url);
                if (i === 0) {
                    animComp.defaultClip = animClip;
                }
                else {
                    animComp.addClip(animClip);
                }
            }
            let prefab = _Scene.PrefabUtils.createPrefabFrom(rootNode);
            let tempPath = FsUtils.createFileToTempPath(exportJsonData.baseName,
                           PREFAB_NAME + EXTNAME.Prefab, prefab.serialize());
            importAssetTempPaths.push(tempPath);
            next();
        },
        // import prefab
        function (next) {
            _sendProgressMessage('import ' + exportJsonData.baseName + ' prefab');
            Editor.assetdb.import(importAssetTempPaths, outUrl, false, (err) => {
                if (err) {
                    return _sendErrorMessage(err);
                }
                next();
            });
        }
    ], () => {
        callback();
    });
}

module.exports = {
    Import: _import
};
