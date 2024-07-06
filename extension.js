import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const DisplayConfigInterface = `
<node>
  <interface name="org.gnome.Mutter.DisplayConfig">
    <method name="GetCurrentState">
      <arg type="u" direction="out" name="serial"/>
      <arg type="a((ssss)a(siiddada{sv})a{sv})" direction="out" name="monitors"/>
      <arg type="a(iiduba(ssss)a{sv})" direction="out" name="logical_monitors"/>
      <arg type="a{sv}" direction="out" name="properties"/>
    </method>
    <method name="ApplyMonitorsConfig">
      <arg type="u" direction="in" name="serial"/>
      <arg type="u" direction="in" name="method"/>
      <arg type="a(iiduba(ssa{sv}))" direction="in" name="logical_monitors"/>
      <arg type="a{sv}" direction="in" name="properties"/>
    </method>
  </interface>
</node>`;

const DisplayConfigProxy = Gio.DBusProxy.makeProxyWrapper(DisplayConfigInterface);

const SecondMonitorToggle = GObject.registerClass(
class SecondMonitorToggle extends QuickMenuToggle {
    _init(indicator) {
        console.log(`Initializing Dual Monitor Toggle`);

        super._init({
            title: _('Second Monitor'),
            iconName: 'video-display-symbolic',
            toggleMode: true,
        });

        this._indicator = indicator;
        this._proxy = null;
        this._monitors = [];
        this._logicalMonitors = [];
        this._properties = {};
        this._serial = 0;
        this._layoutMode = 1; // Default to logical layout
        this._supportsChangingLayoutMode = false;

        this._initProxy();
        this.connect('clicked', this._toggleSecondMonitor.bind(this));
    }

    _initProxy() {
        this._proxy = new DisplayConfigProxy(
            Gio.DBus.session,
            'org.gnome.Mutter.DisplayConfig',
            '/org/gnome/Mutter/DisplayConfig',
            (proxy, error) => {
                if (error) {
                    console.log('Failed to create DBus proxy:', error);
                    this._disableToggle();
                } else {
                    this._getMonitorConfig().catch(e => {
                        console.log('Error getting monitor configuration:', e);
                        this._disableToggle();
                    });
                }
            }
        );
    }

    async _getMonitorConfig() {
        try {
            const [serial, monitors, logicalMonitors, properties] = await this._proxy.GetCurrentStateAsync();
            this._serial = serial;
            this._monitors = monitors;
            this._logicalMonitors = logicalMonitors;
            this._properties = properties;
            this._layoutMode = properties['layout-mode']?.deepUnpack() ?? 1;
            this._supportsChangingLayoutMode = properties['supports-changing-layout-mode']?.deepUnpack() ?? false;
            // console.log(`Monitors detected: ${this._monitors.length}`);
            // console.log(`Logical monitors: ${this._logicalMonitors.length}`);
            // console.log(`Layout mode: ${this._layoutMode}`);
            // console.log(`Supports changing layout mode: ${this._supportsChangingLayoutMode}`);
            // console.log('Raw monitor data:', JSON.stringify(this._monitors, null, 2));
            // console.log('Raw logical monitor data:', JSON.stringify(this._logicalMonitors, null, 2));
            this._buildMonitorMenu();
            this._updateSelectedMonitor();
            this._sync();
        } catch (e) {
            console.log('Error getting monitor configuration:', e);
            this._disableToggle();
        }
    }

    _buildMonitorMenu() {
        this.menu.removeAll();

        const menuTitle = new PopupMenu.PopupMenuItem(_("Select a monitor"), {
            reactive: false,
            style_class: 'selectLabel'
        });
        this.menu.addMenuItem(menuTitle);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        for (const monitor of this._monitors) {
            const item = new PopupMenu.PopupMenuItem(monitor[0][0]); // Use the display port name
            item.connect('activate', async () => {
                this._monitor = monitor[0][0];
                await this._getMonitorConfig();
                this._sync();
            });
            this.menu.addMenuItem(item);
        }
    }

    _sync() {
        const nMonitors = this._logicalMonitors.length;
        this.checked = nMonitors > 1;
        this._updateIndicatorVisibility();
    }

    _updateSelectedMonitor() {
        for (const item of this.menu._getMenuItems()) {
            if (item.label && item.label.text === this._monitor) {
                item.setOrnament(PopupMenu.Ornament.DOT);
            } else {
                item.setOrnament(PopupMenu.Ornament.NONE);
            }
        }
    }

    _updateIndicatorVisibility() {
        this._indicator.visible = this.checked;
    }

    async _toggleSecondMonitor() {
        if (!this._proxy) return;
    
        console.log('Current layout mode:', this._layoutMode);
        console.log('Supports changing layout mode:', this._supportsChangingLayoutMode);
    
        // Vérifier l'état actuel du second écran
        const isSecondMonitorActive = this._logicalMonitors.length > 1;
    
        // Basculer l'état du second écran
        const newLogicalMonitors = isSecondMonitorActive
            ? this._logicalMonitors.filter(lm => lm[4]) // Si actif, ne garder que le moniteur principal
            : this._logicalMonitors; // Si inactif, restaurer tous les moniteurs
    
        const convertedLogicalMonitors = newLogicalMonitors.map(lm => {
            const [x, y, scale, transform, isPrimary, monitors, properties] = lm;
            const convertedMonitors = monitors.map(m => {
                const monitor = this._monitors.find(mon => mon[0][0] === m[0]);
                // console.log(`Monitor ${m[0]} full data:`, JSON.stringify(monitor, null, 2));
                const validModes = monitor[1].filter(mode => typeof mode[0] === 'string').map(mode => mode[0]);
                console.log(`Valid modes for ${m[0]}:`, validModes);
                let modeId = m[1];
                
                if (validModes.length === 0) {
                    console.log(`No valid modes found for monitor ${m[0]}`);
                    return null;
                }
                
                if (!validModes.includes(modeId)) {
                    console.warn(`Invalid mode ${modeId} for monitor ${m[0]}. Using current mode.`);
                    modeId = monitor[1][0][0]; // Use the first mode as current mode
                }
                
                console.log(`Mode selected for ${m[0]}: ${modeId}`);
                return [m[0], modeId, {}];
            }).filter(m => m !== null);
            return [x, y, scale, transform, isPrimary, convertedMonitors, properties];
        });
    
        const properties = {};
        if (this._supportsChangingLayoutMode) {
            properties['layout-mode'] = new GLib.Variant('u', this._layoutMode);
        }
    
        if (convertedLogicalMonitors.length === 0 || convertedLogicalMonitors.some(lm => lm[5].length === 0)) {
            console.log('No valid monitor configurations found. Aborting.');
            this._disableToggle();
            return;
        }
    
        try {
            console.log('Applying monitor config:', JSON.stringify({
                serial: this._serial,
                method: 2,
                logicalMonitors: convertedLogicalMonitors,
                properties: properties
            }, null, 2));
            await this._proxy.ApplyMonitorsConfigAsync(
                this._serial,
                2, // PERSISTENT_METHOD
                convertedLogicalMonitors,
                properties
            );
            await this._getMonitorConfig();
        } catch (e) {
            console.log('Error applying monitor configuration:', e);
            console.log('Converted logical monitors:', JSON.stringify(convertedLogicalMonitors, null, 2));
            console.log('Properties:', JSON.stringify(properties, null, 2));
            this._disableToggle();
        }
    
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }    

    _disableToggle() {
        this.checked = false;
        this.sensitive = false;
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
        console.log(`Disabling Dual Monitor Toggle`);
        
        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.quickSettingsItems = [];
        
        this._indicator.destroy();
        this._indicator = null;
    }
}
