import GLib from 'gi://GLib';  
import GObject from 'gi://GObject';
import {QuickToggle, QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const SecondMonitorToggle = GObject.registerClass(
class SecondMonitorToggle extends QuickMenuToggle {
    _init(indicator) {
        log(`Initializing Dual Monitor Toggle`);
        super._init({
            title: _('Second Monitor'),
            iconName: 'video-display-symbolic',
            toggleMode: true,
        });

        this._indicator = indicator;
        this._mode = '1920x1080';
        this._pos = '2560x199';
        this._monitor = 'HDMI-0';

        this._getAvailableMonitors();
        this._buildMonitorMenu();
        
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._getMonitorConfig();
            this._sync();
        });
        this.connect('clicked', this._toggleSecondMonitor.bind(this));
    }
    
    _getAvailableMonitors() {
        this._monitors = [];
        try {
            let [ok, output, err, exit] = GLib.spawn_command_line_sync('xrandr --query');
            if (ok) {
                let lines = output.toString().split('\n');
                for (let line of lines) {
                    if (line.includes(' connected ')) {
                        let monitor = line.split(' ')[0];
                        this._monitors.push(monitor);
                    }
                }
            }
        } catch (e) {
            logError(e);
        }
    }

    _buildMonitorMenu() {
        this.menu.removeAll();
        
        for (let monitor of this._monitors) {
            let item = new PopupMenu.PopupMenuItem(monitor);
            item.connect('activate', () => {
                this._monitor = monitor;
                this._getMonitorConfig();
                this._sync();
            });
            this.menu.addMenuItem(item);
        }
    }
    
    _sync() {
        const nMonitors = global.display.get_n_monitors();
        this.checked = nMonitors > 1;
        this._updateIndicatorVisibility();
    }
    
    _updateIndicatorVisibility() {
        if (this.checked) {
            this._indicator.visible = true;
        } else {
            this._indicator.visible = false;
        }
    }
    
    _getMonitorConfig() {
        try {
            let [ok, output, err, exit] = GLib.spawn_command_line_sync(`xrandr --query | grep "${this._monitor} connected"`);
            if (ok) {
                let line = output.toString();
                let modeMatch = line.match(/(\d+x\d+\+\d+\+\d+)/);
                if (modeMatch) {
                    let modeStr = modeMatch[1];
                    let [mode, ...pos] = modeStr.split('+');
                    this._mode = mode;
                    this._pos = pos.join('x');
                }
            }
        } catch (e) {
            logError(e);
        }
    }
    
    _toggleSecondMonitor() {
        this._sync();
        if (this.checked) {
            log(`Disabling second monitor`);
            GLib.spawn_command_line_async(`xrandr --output ${this._monitor} --off`);
        } else {
            log(`Enabling second monitor`);
            if (this._mode && this._pos) {
                GLib.spawn_command_line_async(`xrandr --output ${this._monitor} --mode ${this._mode} --pos ${this._pos}`);
            } else {
                log('Failed to get monitor configuration');
            }
        }
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._sync();
        });
    }
});

const SecondMonitorIndicator = GObject.registerClass(
class SecondMonitorIndicator extends SystemIndicator {
    _init() {
        super._init();

        this._indicator = this._addIndicator();
        this._indicator.icon_name = 'video-display-symbolic';

        this.quickSettingsItems.push(new SecondMonitorToggle(this._indicator));
    }
});

export default class Extension {
    enable() {
        this._indicator = new SecondMonitorIndicator();
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }
    
    disable() {
        log(`Disabling Dual Monitor Toggle`);
        
        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.quickSettingsItems = [];
        
        this._indicator.destroy();
        this._indicator = null;
    }
}
