'use strict';

module.exports = {
    load () {},
    unload () {},
    messages: {
        'open' () {
            Editor.Panel.open('cstudio-anim-import');
            Editor.Metrics.trackEvent({
                category: 'Packages',
                label: 'cstudio-anim-import',
                action: 'cstudio anim import'
            }, null);
        }
    }
};