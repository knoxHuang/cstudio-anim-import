'use strict';

const Fs = require('fire-fs');
const Path = require('path');
const Utils = Editor.require('packages://cstudio-anim-import/code/utils');
const AnimImporter = Editor.require('packages://cstudio-anim-import/code/importer');
const Electron = require('electron');

const PATH = {
    html: Editor.url('packages://cstudio-anim-import/panel/panel.html'),
    style: Editor.url('packages://cstudio-anim-import/panel/style.css')
};

Editor.Panel.extend({
    template: Fs.readFileSync(PATH.html, 'utf-8'),
    style: Fs.readFileSync(PATH.style, 'utf-8'),

    ready () {
        let local = this.profiles.local;
        this._vm = new window.Vue({
            el: this.shadowRoot,
            created () {
                this._initDataInfo();
                Electron.ipcRenderer.on('cstudio-anim-import:progress', (event, message, progress, totalProgress) => {
                    this.progress = 100 * (progress / totalProgress);
                    this.progressTips = message;
                    this.btnResetStr = this.T('cstudio-anim-import.PANEL.button_again');
                });

                Electron.ipcRenderer.on('cstudio-anim-import:error', (event) => {
                    this.hasError = true;
                    this.progress = 0;
                    this.progressTips = '';
                    this.tips = this.T('cstudio-anim-import.TIPS.error');
                });

                this.btnResetStr = this.T('cstudio-anim-import.PANEL.button_reset');
                this.tips = this.T('cstudio-anim-import.TIPS.error');
            },

            data: {
                savePath: '',

                exists: false,
                imported: false,
                hasError: false,

                dragItems: [],

                progress: 0,
                progressTips: 'sleep',

                tips: '',
                btnResetStr: ''
            },

            watch: {
                folderPath: {},
                progress: {
                    handler (val) {

                    }
                }
            },

            methods: {
                T: Editor.T,

                _getResetDisable () {
                    return this.dragItems.length === 0;
                },

                _initDataInfo () {
                    this.dragItems = local.data['dragItems'];
                    this.savePath = local.data['save-path'];
                    this.exists = this.dragItems.length > 0;
                },

                _saveData (key, value) {
                    local.data[key] = value;
                    local.save();
                },

                onDragEnd (event) {
                    this.dragItems.length = 0;
                    for (let i = 0; i < event.detail.dragItems.length; ++i) {
                        let item = event.detail.dragItems[i];
                        let type = Path.extname(item.path);
                        this.dragItems.push({
                            name: item.name,
                            baseName: Path.basename(item.path, type),
                            type: type,
                            path: item.path
                        });
                    }
                    this.exists = this.dragItems.length > 0;
                    this._saveData('dragItems', this.dragItems);
                },

                onChooseSavePath () {
                    Utils.showSavePathDialog(local.data['save-path'], (err, path)=> {
                        this.savePath = path;
                        this._saveData('save-path', this.savePath);
                    })
                },

                onReset () {
                    this.progress = 0;
                    this.progressTips = '';
                    this.dragItems.length = 0;
                    this.exists = false;
                    this.imported = false;
                    this.hasError = false;
                    this._saveData('dragItems', this.dragItems);
                    this.btnResetStr = this.T('cstudio-anim-import.PANEL.button_reset');
                },

                onReImport () {
                    this.tips = '';
                    this.hasError = false;
                    this.progress = 0;
                    this.progressTips = '';
                    this.onImport();
                },

                onImport () {
                    if (this.dragItems.length > 0) {
                        let str = '\n';
                        for (let i = 0; i < this.dragItems.length; ++i) {
                            let item = this.dragItems[i];
                            str += item.name + '\n';
                        }
                        let title = this.T('cstudio-anim-import.TIPS.import_title');
                        let message = this.T('cstudio-anim-import.TIPS.import', {
                            resources: str,
                            savePath: this.savePath
                        });
                        Utils.showImportMessageBox(title, message, (err, result) => {
                            if (result) {
                                this.imported = true;
                                Editor.Scene.callSceneScript('cstudio-anim-import', 'import-animation',
                                    {
                                        dragItems: this.dragItems,
                                        savePath: this.savePath
                                    }, () => {
                                        console.log('导入完毕');
                                    }
                                );
                            }
                        });
                    }
                }
            }
        });
    }
});