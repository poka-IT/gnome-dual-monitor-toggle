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
        this._mode = '1920x1080';
        this._pos = '2560x199';
        this._monitor = 'HDMI-0';
        this._timeoutId = null;

        // Fetch available monitors and build monitor menu
        this._getAvailableMonitors().then(() => {
            this._buildMonitorMenu();
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._getMonitorConfig();
                this._sync();
                return GLib.SOURCE_CONTINUE;
            });
        });

        this.connect('clicked', this._toggleSecondMonitor.bind(this));
    }
    
    async _getAvailableMonitors() {
        this._monitors = [];
        try {
            // Run xrandr command to query monitor information
            let proc = Gio.Subprocess.new(['xrandr', '--query'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            let [stdout, stderr] = await proc.communicate_utf8_async(null, null);
            if (!proc.get_successful()) {
                throw new Error(stderr);
            }
            // Extract monitor names from xrandr output
            let lines = stdout.split('\n');
            for (let line of lines) {
                if (line.includes(' connected ')) {
                    let monitor = line.split(' ')[0];
                    this._monitors.push(monitor);
                }
            }
        } catch (e) {
            console.error(e);
        }
    }

    _buildMonitorMenu() {
        this.menu.removeAll();

        // Add the menu title
        let menuTitle = new PopupMenu.PopupImageMenuItem(_("Select a monitor"), 'video-display-symbolic', {
            reactive: false,
            style_class: 'selectLabel'
        });
        menuTitle._icon.icon_size = 24;
        this.menu.addMenuItem(menuTitle);

        // Add a separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Add menu items for each available monitor
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

    // Sync the toggle state with the number of connected monitors
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
    
    async _getMonitorConfig() {
        try {
            // Run xrandr command to query monitor information
            let proc = Gio.Subprocess.new(['xrandr', '--query'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            let [stdout, stderr] = await proc.communicate_utf8_async(null, null);
            if (!proc.get_successful()) {
                throw new Error(stderr);
            }
            // Extract monitor configuration from xrandr output
            let lines = stdout.split('\n');
            for (let line of lines) {
                if (line.includes(`${this._monitor} connected`)) {
                    let modeMatch = line.match(/(\d+x\d+\+\d+\+\d+)/);
                    if (modeMatch) {
                        let modeStr = modeMatch[1];
                        let [mode, ...pos] = modeStr.split('+');
                        this._mode = mode;
                        this._pos = pos.join('x');
                    }
                    break;
                }
            }
        } catch (e) {
            console.error(e);
        }
    }
    
    async _toggleSecondMonitor() {
        this._sync();
        if (this.checked) {
            console.debug(`Disabling second monitor`);
            // Disable the second monitor using xrandr command
            Gio.Subprocess.new(['xrandr', '--output', this._monitor, '--off'], Gio.SubprocessFlags.NONE);
        } else {
            console.debug(`Enabling second monitor`);
            if (this._mode && this._pos) {
                // Enable the second monitor using xrandr command
                Gio.Subprocess.new(['xrandr', '--output', this._monitor, '--mode', this._mode, '--pos', this._pos], Gio.SubprocessFlags.NONE);
            } else {
                console.warn('Failed to get monitor configuration');
            }
        }
        
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
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

        this.quickSettingsItems.push(new SecondMonitorToggle(this._indicator));
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
