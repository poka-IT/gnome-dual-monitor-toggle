import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import St from 'gi://St';

// Helper to get current persistence mode label, used internally by buildMonitorMenu and updatePersistenceModeSelectionInMenu
function getCurrentPersistenceModeLabel(toggle) {
    if (toggle._persistenceMode === 1) return _("Temporary");
    if (toggle._persistenceMode === 2) return _("Persistent");
    return _("Unknown");
}

export function buildMonitorMenu(toggle) {
    toggle.menu.removeAll();

    const menuTitle = new PopupMenu.PopupMenuItem(_("Select a monitor"), {
        reactive: false,
        style_class: 'selectLabel',
    });
    toggle.menu.addMenuItem(menuTitle);
    toggle.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    for (const monitor of toggle._monitors) {
        const connector = monitor[0][0];
        const menuItemDisplayName = toggle._getMonitorDisplayName(connector, 'long');

        const isMonitorActive = toggle._logicalMonitors.some(lm =>
            lm[5].some(m => m[0] === connector)
        );

        let item = new PopupMenu.PopupMenuItem('');
        item.add_style_class_name('monitor-item-entry');

        let box = new St.BoxLayout({ style_class: 'monitor-item-box' });
        item.add_child(box);

        let selectionDot = new St.Icon({
            icon_name: 'media-record-symbolic',
            style_class: 'monitor-selection-indicator',
            opacity: (connector === toggle._monitor) ? 255 : 0,
            icon_size: 8
        });
        box.add_child(selectionDot);

        let statusIconName = isMonitorActive ? 'video-display-symbolic' : 'display-off-symbolic';
        let icon = new St.Icon({
            icon_name: statusIconName,
            style_class: `monitor-status-icon ${isMonitorActive ? 'monitor-icon-active' : 'monitor-icon-inactive'}`,
            icon_size: 14
        });
        box.add_child(icon);

        let infoBox = new St.BoxLayout({
            vertical: true,
            style_class: 'monitor-info-box'
        });
        box.add_child(infoBox);

        let label = new St.Label({
            text: menuItemDisplayName,
            style_class: 'monitor-item-label'
        });
        infoBox.add_child(label);

        if (monitor[1] && monitor[1].length > 0) {
            let currentModeId = null;
            for (const lm of toggle._logicalMonitors) {
                const monInLm = lm[5].find(m => m[0] === connector);
                if (monInLm) {
                    currentModeId = monInLm[1];
                    break;
                }
            }

            let modeInfo = '';
            if (currentModeId) {
                const mode = monitor[1].find(m => m[0] === currentModeId);
                if (mode) {
                    const width = mode[1];
                    const height = mode[2];
                    const refreshRate = mode[3].toFixed(1);
                    modeInfo = `${width}×${height} @ ${refreshRate}Hz`;
                }
            } else if (monitor[1].length > 0) {
                const preferredMode = monitor[1][0];
                if (preferredMode) {
                    const width = preferredMode[1];
                    const height = preferredMode[2];
                    modeInfo = `${width}×${height}`;
                }
            }

            if (modeInfo) {
                let resolutionLabel = new St.Label({
                    text: modeInfo,
                    style_class: 'monitor-resolution-label'
                });
                infoBox.add_child(resolutionLabel);
            }
        }

        item._monitorConnector = connector;
        item._selectionDot = selectionDot;

        item.connect('activate', async () => {
            toggle._monitor = connector;
            await toggle._getMonitorConfig();
        });
        toggle.menu.addMenuItem(item);
    }

    toggle.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    toggle._configModeSubMenu = new PopupMenu.PopupSubMenuMenuItem(_("Configuration Mode: ") + getCurrentPersistenceModeLabel(toggle));
    toggle.menu.addMenuItem(toggle._configModeSubMenu);

    toggle._tempModeMenuItem = new PopupMenu.PopupMenuItem('');
    toggle._tempModeMenuItem.add_style_class_name('persistence-mode-item');
    let tempBox = new St.BoxLayout({ style_class: 'monitor-item-box' });
    toggle._tempModeMenuItem.add_child(tempBox);

    let tempSelectionDot = new St.Icon({ icon_name: 'media-record-symbolic', style_class: 'monitor-selection-indicator', icon_size: 8 });
    tempBox.add_child(tempSelectionDot);
    toggle._tempModeMenuItem._selectionDot = tempSelectionDot;

    let tempInfoBox = new St.BoxLayout({ vertical: true, style_class: 'monitor-info-box'});
    tempBox.add_child(tempInfoBox);
    tempInfoBox.add_child(new St.Label({ text: _("Temporary Mode"), style_class: 'monitor-item-label' }));
    tempInfoBox.add_child(new St.Label({ text: _("Changes are temporary and reset on reboot."), style_class: 'monitor-resolution-label' }));

    toggle._tempModeMenuItem.connect('activate', () => {
        if (toggle._persistenceMode !== 1) {
            toggle._persistenceMode = 1;
            updatePersistenceModeSelectionInMenu(toggle);
        }
    });
    toggle._configModeSubMenu.menu.addMenuItem(toggle._tempModeMenuItem);

    toggle._persistentModeMenuItem = new PopupMenu.PopupMenuItem('');
    toggle._persistentModeMenuItem.add_style_class_name('persistence-mode-item');
    let persistentBox = new St.BoxLayout({ style_class: 'monitor-item-box' });
    toggle._persistentModeMenuItem.add_child(persistentBox);

    let persistentSelectionDot = new St.Icon({ icon_name: 'media-record-symbolic', style_class: 'monitor-selection-indicator', icon_size: 8 });
    persistentBox.add_child(persistentSelectionDot);
    toggle._persistentModeMenuItem._selectionDot = persistentSelectionDot;

    let persistentInfoBox = new St.BoxLayout({ vertical: true, style_class: 'monitor-info-box'});
    persistentBox.add_child(persistentInfoBox);
    persistentInfoBox.add_child(new St.Label({ text: _("Persistent Mode"), style_class: 'monitor-item-label' }));
    persistentInfoBox.add_child(new St.Label({ text: _("Changes are saved and require confirmation."), style_class: 'monitor-resolution-label' }));

    toggle._persistentModeMenuItem.connect('activate', () => {
        if (toggle._persistenceMode !== 2) {
            toggle._persistenceMode = 2;
            updatePersistenceModeSelectionInMenu(toggle);
        }
    });
    toggle._configModeSubMenu.menu.addMenuItem(toggle._persistentModeMenuItem);
    
    updatePersistenceModeSelectionInMenu(toggle);
}

export function updatePersistenceModeSelectionInMenu(toggle) {
    if (toggle._tempModeMenuItem && toggle._tempModeMenuItem._selectionDot) {
        toggle._tempModeMenuItem._selectionDot.opacity = (toggle._persistenceMode === 1) ? 255 : 0;
    }
    if (toggle._persistentModeMenuItem && toggle._persistentModeMenuItem._selectionDot) {
        toggle._persistentModeMenuItem._selectionDot.opacity = (toggle._persistenceMode === 2) ? 255 : 0;
    }
    if (toggle._configModeSubMenu) {
        toggle._configModeSubMenu.label.text = _("Configuration Mode: ") + getCurrentPersistenceModeLabel(toggle);
    }
}

export function updateSelectedMonitorInMenu(toggle) {
    for (const item of toggle.menu._getMenuItems()) {
        if (item._monitorConnector) {
            if (item._monitorConnector === toggle._monitor) {
                item.add_style_class_name('selected-monitor-entry');
                if (item._selectionDot) {
                    item._selectionDot.opacity = 255;
                }
            } else {
                item.remove_style_class_name('selected-monitor-entry');
                if (item._selectionDot) {
                    item._selectionDot.opacity = 0;
                }
            }
        }
    }
    if (toggle._monitor) {
        toggle.subtitle = toggle._getMonitorDisplayName(toggle._monitor, 'short');
    } else if (toggle.sensitive) {
        toggle.subtitle = _('No monitor selected');
    } else {
        toggle.subtitle = _('Unavailable');
    }
} 