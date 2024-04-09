import GLib from 'gi://GLib';  
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const SecondMonitorToggle = GObject.registerClass(
class SecondMonitorToggle extends QuickMenuToggle {
    _init(indicator) {
        console.debug(`Initializing Dual Monitor Toggle`);

        super._init({
            title: _('Second Monitor'),
            iconName: 'video-display-symbolic',
            toggleMode: true,
        });

        // Add callback to communicate_utf8_async method
        Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

        // Set initial values for monitor configuration
        this._indicator = indicator;
        this._configsMap = {};

        // Fetch available monitors and build monitor menu
        this._getMonitorConfig().then(() => {
            this._buildMonitorMenu();
            this._updateSelectedMonitor();
            this._sync();
        });

        this.connect('clicked', this._toggleSecondMonitor.bind(this));
    }

    _buildMonitorMenu() {
        this.menu.removeAll();

        // Add the menu title
        const menuTitle = new PopupMenu.PopupImageMenuItem(_("Select a monitor"), 'video-display-symbolic', {
            reactive: false,
            style_class: 'selectLabel'
        });
        menuTitle._icon.icon_size = 24;
        this.menu.addMenuItem(menuTitle);

        // Add a separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Add menu items for each available monitor
        for (const [monitorName, _] of Object.entries(this._configsMap)) {
            const item = new PopupMenu.PopupMenuItem(monitorName);
            item.connect('activate', () => {
                this._monitor = monitorName;
                this._getMonitorConfig();
                this._sync();
            });
            this.menu.addMenuItem(item);
        }
    }

    // Sync the toggle state with the number of connected monitors
    _sync() {
        const nMonitors = global.display.get_n_monitors();
        this.checked = nMonitors > 1;
        this._updateIndicatorVisibility();
    }

    // Update the selected monitor visual in the menu
    _updateSelectedMonitor() {
        for (const item of this.menu._getMenuItems()) {
            if (item.label.text === this._monitor) {
                item.add_style_class_name('selectedMonitor');
            } else {
                item.remove_style_class_name('selectedMonitor');
            }
        }
    }

    _updateIndicatorVisibility() {
        if (this.checked) {
            this._indicator.visible = true;
        } else {
            this._indicator.visible = false;
        }
    }

    async _getMonitorConfig() {
        try {
            // Run xrandr command to query monitor information
            const proc = Gio.Subprocess.new(['xrandr', '--query'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            const [stdout, stderr] = await proc.communicate_utf8_async(null, null);
            if (!proc.get_successful()) {
                throw new Error(stderr);
            }
            const isConfigsMapEmpty = Object.keys(this._configsMap).length === 0;
            const lines = stdout.split('\n');
            for (const line of lines) {
                // Extract enabled monitor names from xrandr output
                const modeMatch = line.match(/(\d+x\d+\+\d+\+\d+)/); 
                if (line.includes(' connected ') && modeMatch) {
                    const monitor = line.split(' ')[0];
                    if (isConfigsMapEmpty) {
                        const modeStr = modeMatch[1];
                        let [mode, ...pos] = modeStr.split('+');
                        pos = pos.join('x');
                        this._configsMap[monitor] = {mode, pos};
                    }
                    // Set current monitor control
                    if (!line.includes(' primary ') && !this._monitor) {
                        this._monitor = monitor;
                    }
                }
            }
            if (isConfigsMapEmpty) {
                // Sort configsMap by order of pos num value (lower first)
                this._configsMap = new Map([...this._configsMap.entries()].sort((a, b) => {
                    const posA = parseInt(a[1].pos.split('x')[0]);
                    const posB = parseInt(b[1].pos.split('x')[0]);
                    return posA - posB;
                }));
            }
            this._updateSelectedMonitor();
        } catch (e) {
            console.error(e);
        }
    }
    
    async _toggleSecondMonitor() {
        this._sync();
        if (this.checked) {
            console.debug(`Disabling monitor: ${this._monitor}`);
            Gio.Subprocess.new(['xrandr', '--output', this._monitor, '--off'], Gio.SubprocessFlags.NONE);
        } else {
            console.debug(`Enabling monitor: ${this._monitor}`);
            if (Object.keys(this._configsMap).length > 0) {
                // Build xrandr command to restore initial monitor configuration
                let cmd = ['xrandr'];
                Object.entries(this._configsMap).forEach(([monitor, config]) => {
                    cmd.push('--output', monitor, '--mode', config.mode, '--pos', config.pos);
                });
                // Run xrandr command
                Gio.Subprocess.new(cmd, Gio.SubprocessFlags.NONE);
            } else {
                console.warn('Failed to restore initial monitor configuration');
            }
        }
        
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }
    
    destroy() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = null;
        }
        super.destroy();
    }
});

const SecondMonitorIndicator = GObject.registerClass(
class SecondMonitorIndicator extends SystemIndicator {
    _init() {
        super._init();

        this._indicator = this._addIndicator();
        this._indicator.icon_name = 'video-display-symbolic';

        this._secondMonitorToggle = new SecondMonitorToggle(this._indicator);
        this.quickSettingsItems.push(this._secondMonitorToggle);
    }

    destroy() {
        this._secondMonitorToggle.destroy();
        this._secondMonitorToggle = null;
        
        super.destroy();
    }
});

export default class DualMonitorExtension {
    enable() {
        this._indicator = new SecondMonitorIndicator();
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }
    
    disable() {
        console.debug(`Disabling Dual Monitor Toggle`);
        
        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.quickSettingsItems = [];
        
        this._indicator.destroy();
        this._indicator = null;
    }
}
