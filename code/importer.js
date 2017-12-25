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

function _getSpriteFrameByDisplayIndex (name, displayIndex) {
    let url = DISPLAY_DATA[name][displayIndex];
    let uuid = SPRITEFRAME_ATLAS[url];
    if (uuid) {
        return Editor.serialize.asAsset(uuid);
    }
    cc.warn('texture：' + url + ' does not exist.');
    return null;
}

function _loadSpriteFrameByDisplayIndex (name, displayIndex, cb) {
    let url = DISPLAY_DATA[name][displayIndex];
    let uuid = SPRITEFRAME_ATLAS[url];
    if (uuid) {
        cc.AssetLibrary.loadAsset(uuid, (err, spriteFrame) => {
            if (err) {
                Editor.error(err);
                cb(err, null);
                return;
            }
            cb(null, spriteFrame);
        });
    }
    else {
        cb('texture：' + url + ' does not exist.', null);
    }
}

function _decodeDisplayData (name, display_data, layerInfo, cb) {
    let len = display_data.length;
    if (len > 0) {
        DISPLAY_DATA[name] = [];
        for (let i = 0; i < len; ++i) {
            let data = display_data[i];
            // display name;
            let dpName = data['name'];
            DISPLAY_DATA[name].push(dpName);
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
            // Layer info
            let layerInfo = {
                name: name,
                x: bData['x'],
                y: bData['y'],
                scaleX: bData['cX'],
                scaleY: bData['cY'],
                skewX: parseFloat(bData['kY']),
                skewY: parseFloat(bData['kY']),
                rotationX: cc.radiansToDegrees(parseFloat(bData['kX'])),
                rotationY: cc.radiansToDegrees(-parseFloat(bData['kY'])),
                defaultSpriteFrame: null,
            };
            LayerList[name] = layerInfo;
            let display_data = bData['display_data'];
            if (!display_data) {
                return _sendErrorMessage('display_data is null');
            }
            _decodeDisplayData(name, display_data, layerInfo, () => {
                index++;
                let displayIndex = bData['dI'];
                if (displayIndex !== -1) {
                    _loadSpriteFrameByDisplayIndex(name, displayIndex, (err, spriteFrame) =>{
                        layerInfo.defaultSpriteFrame = spriteFrame;
                        whileCb();
                    });
                }
                else {
                    whileCb();
                }
            });
        },
        function () {
            cb();
        }
    );
}

function _addPropFrames (idx, frame, value, propFrams, tweenFrame) {
    let tempValue = value;
    if (typeof value === 'function') {
        tempValue = value();
    }
    propFrams[idx] = {
        frame: frame,
        value: tempValue || 0
    };
    if (!tweenFrame) {
        propFrams[idx].curve = "constant";
    }
}

// 第二个参数为默认数值，或者是判断函数
function _canAddProps (frames, defaultValueOrCheckFunc = 0) {
    let len = Object.keys(frames).length;
    if (typeof defaultValueOrCheckFunc === 'function') {
        return (len === 1 && defaultValueOrCheckFunc()) || len > 1;
    }
    return (len === 1 && (frames[0] && frames[0].value !== defaultValueOrCheckFunc)) || len > 1;
}

function _decodeFrameData (mov_bone_data, sample, layerInfo, cb) {
    let curve_data = {};
    let name = mov_bone_data['name'];
    let frame_data = mov_bone_data['frame_data'];
    if (!frame_data) {
        return cb(curve_data);
    }
    let frames = [];
    let colors = [];
    let opacitys = [];
    let hasAddOpacity = false;
    let props = {};
    let xFrames = [];
    let yFrames = [];
    let rotationXs = [];
    let rotationYs = [];
    let scaleXs = [];
    let scaleYs = [];
    let skewXs = [];
    let skewYs = [];
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
        if (!tweenFrame) {
            frames[i].curve = "constant";
        }
        let x = data['x'] + layerInfo.x;
        _addPropFrames(i, frame, x, xFrames, tweenFrame);
        let y = data['y'] + layerInfo.y;
        _addPropFrames(i, frame, y, yFrames, tweenFrame);
        let cX = data['cX'] * layerInfo.scaleX;
        _addPropFrames(i, frame, cX, scaleXs, tweenFrame);
        let cY = data['cY'] * layerInfo.scaleY;
        _addPropFrames(i, frame, cY, scaleYs, tweenFrame);
        let rotationX = cc.radiansToDegrees(parseFloat(data['kX'])) + layerInfo.rotationX;
        _addPropFrames(i, frame, rotationX, rotationXs, tweenFrame);
        let rotationY = cc.radiansToDegrees(-parseFloat(data['kY'])) + layerInfo.rotationY;
        _addPropFrames(i, frame, rotationY, rotationYs, tweenFrame);
        // let skewX = parseFloat(data['kX']) + layerInfo.skewX;
        // _addPropFrames(i, frame, skewX, skewXs, tweenFrame);
        // let skewY = parseFloat(data['kY']) + layerInfo.skewY;
        // _addPropFrames(i, frame, skewY, skewYs, tweenFrame);

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
        }
        else {
            opacitys[i] = {
                frame: frame,
                value: 255,
                curve: "constant"
            };
        }
    }

    if (_canAddProps(xFrames)) {
        props.x = xFrames;
    }
    if (_canAddProps(yFrames)) {
        props.y = yFrames;
    }
    if (_canAddProps(scaleXs, 1)) {
        props.scaleX = scaleXs;
    }
    if (_canAddProps(scaleYs, 1)) {
        props.scaleY = scaleYs;
    }
    if (_canAddProps(rotationXs)) {
        props.rotationX = rotationXs;
    }
    if (_canAddProps(rotationYs)) {
        props.rotationY = rotationYs;
    }
    // if (_canAddProps(skewXs)) {
    //     props.skewX = skewXs;
    // }
    // if (_canAddProps(skewYs)) {
    //     props.skewY = skewYs;
    // }
    if (_canAddProps(opacitys, 255)) {
        props.opacity = opacitys;
    }
    if (_canAddProps(colors, () => {
            return (colors[0] && !colors[0].value.equals(cc.Color.WHITE));
        })) {
        props.color = colors;
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
            let mov_bone_name = movboneData['name'];
            _decodeFrameData(movboneData, animClip.sample, LayerList[mov_bone_name], (name, curveData) => {
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
            let keys = Object.keys(LayerList);
            for (let i = keys.length - 1; i >= 0; --i) {
                let key = keys[i];
                let layer = LayerList[key];
                let childNode = new cc.Node(layer.name);
                childNode.setPosition(layer.x, layer.y);
                childNode.setScale(layer.scaleX, layer.scaleY);
                childNode.setScale(layer.scaleX, layer.scaleY);
                // childNode.setSkewX(layer.skewX);
                // childNode.setSkewY(layer.skewY);
                childNode.setRotationX(layer.rotationX);
                childNode.setRotationY(layer.rotationY);
                let spriteComp = childNode.addComponent(cc.Sprite);
                if (layer.defaultSpriteFrame) {
                    spriteComp.spriteFrame = layer.defaultSpriteFrame;
                }
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
