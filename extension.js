import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import { QuickMenuToggle, SystemIndicator } from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

/// 0 (TEMPORARY_METHOD): Apply configuration temporarily without confirmation. Changes are not saved after logout or reboot.
/// 1 (CONFIGURATION_METHOD): Applies configuration as standard. Persistent or temporary behavior is context-dependent and may vary.
/// 2 (PERSISTENT_METHOD): Applies the configuration persistently for the current user. This triggers the confirmation dialog to avoid problematic configurations.
/// 3 (PERSISTENT_DEFAULT_METHOD): Sets the configuration as default for the current user, affecting future sessions without immediate confirmation.
/// 4 (PERSISTENT_GLOBAL_METHOD): Sets the configuration as a global default for all users. This requires administrative privileges and modifies system parameters.
const PERSISTENT_MODE = 2; // PERSISTENT_METHOD

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
            super._init({
                title: _('Monitor Toggle'),
                iconName: 'video-display-symbolic',
                toggleMode: true,
            });
    
            this._indicator = indicator;
            this._proxy = null;
            this._monitors = [];
            this._logicalMonitors = [];
            this._originalLogicalMonitors = []; // Store the original logical monitors
            this._properties = {};
            this._serial = 0;
            this._layoutMode = 1; // Default to logical layout
            this._supportsChangingLayoutMode = false;
            this._monitor = null; // Selected monitor
    
            this._initProxy();
            this.connect('clicked', this._toggleMonitor.bind(this));
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
                if (!this._originalLogicalMonitors.length) {
                    this._originalLogicalMonitors = JSON.parse(JSON.stringify(logicalMonitors));
                }
                this._properties = properties;
                this._layoutMode = properties['layout-mode']?.deepUnpack() ?? 1;
                this._supportsChangingLayoutMode = properties['supports-changing-layout-mode']?.deepUnpack() ?? false;
    
                // Select the secondary monitor by default if not already selected
                if (!this._monitor) {
                    // Find a logical monitor that is not primary
                    const nonPrimaryLogicalMonitor = this._logicalMonitors.find(lm => !lm[4]); // lm[4] is isPrimary
                    if (nonPrimaryLogicalMonitor && nonPrimaryLogicalMonitor[5].length > 0) {
                        const firstMonitor = nonPrimaryLogicalMonitor[5][0]; // monitors array
                        if (firstMonitor) {
                            this._monitor = firstMonitor[0]; // connector name
                        }
                    } else {
                        // If no non-primary monitor found, use the first monitor
                        this._monitor = this._monitors[0][0][0];
                    }
                }
    
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
                style_class: 'selectLabel',
            });
            this.menu.addMenuItem(menuTitle);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    
            for (const monitor of this._monitors) {
                const connector = monitor[0][0]; // Use the display port name
                const item = new PopupMenu.PopupMenuItem(connector);
                item.connect('activate', async () => {
                    this._monitor = connector;
                    await this._getMonitorConfig();
                    this._sync();
                });
                this.menu.addMenuItem(item);
            }
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
    
        _sync() {
            // Check if the selected monitor is active
            const isSelectedMonitorActive = this._logicalMonitors.some(lm =>
                lm[5].some(m => m[0] === this._monitor)
            );
            this.checked = isSelectedMonitorActive;
            this._updateIndicatorVisibility();
        }
    
        _updateIndicatorVisibility() {
            this._indicator.visible = this.checked;
        }
    
        async _toggleMonitor() {
            if (!this._proxy) return;
    
            console.log('Current layout mode:', this._layoutMode);
            console.log('Supports changing layout mode:', this._supportsChangingLayoutMode);
    
            // Check if the selected monitor is the primary monitor
            const isPrimaryMonitor = this._logicalMonitors.some(lm =>
                lm[4] && lm[5].some(m => m[0] === this._monitor)
            );
    
            if (isPrimaryMonitor) {
                // Prevent disabling the primary monitor
                console.warn('Cannot disable the primary monitor.');
                this.checked = true; // Ensure the toggle stays on
                return;
            }
    
            // Check if the selected monitor is active
            const isSelectedMonitorActive = this._logicalMonitors.some(lm =>
                lm[5].some(m => m[0] === this._monitor)
            );

            await this._getMonitorConfig();
    
            let newLogicalMonitors;
    
            if (isSelectedMonitorActive) {
                // Remove the selected monitor from the logical monitors
                newLogicalMonitors = this._logicalMonitors.map(lm => {
                    const [x, y, scale, transform, isPrimary, monitors, properties] = lm;
                    const filteredMonitors = monitors.filter(m => m[0] !== this._monitor);
                    if (filteredMonitors.length > 0) {
                        return [x, y, scale, transform, isPrimary, filteredMonitors, properties];
                    } else {
                        // If no monitors remain in this logical monitor, we exclude it
                        return null;
                    }
                }).filter(lm => lm !== null);
            } else {
                // Add the selected monitor back
                // Find the original logical monitor(s) containing the selected monitor
                const originalMonitorConfigs = this._originalLogicalMonitors.filter(lm =>
                    lm[5].some(m => m[0] === this._monitor)
                );
    
                if (originalMonitorConfigs.length > 0) {
                    newLogicalMonitors = [...this._logicalMonitors];
    
                    for (const originalLm of originalMonitorConfigs) {
                        // Avoid duplicates
                        const monitorAlreadyExists = newLogicalMonitors.some(lm =>
                            lm[5].some(m => m[0] === this._monitor)
                        );
    
                        if (!monitorAlreadyExists) {
                            // Adjust position if necessary
                            const [x, y, scale, transform, isPrimary, monitors, properties] = originalLm;
    
                            // Ensure the new monitor doesn't overlap existing monitors
                            let newX = x;
                            let newY = y;
    
                            while (newLogicalMonitors.some(lm => lm[0] === newX && lm[1] === newY)) {
                                newX += 50; // Adjust position to the right
                                newY += 50; // Adjust position downward
                            }
    
                            newLogicalMonitors.push([newX, newY, scale, transform, isPrimary, monitors, properties]);
                        }
                    }
                } else {
                    console.log('Original configuration for selected monitor not found.');
                    this._disableToggle();
                    return;
                }
            }
    
            const convertedLogicalMonitors = newLogicalMonitors.map((lm, index) => {
                const [x, y, scale, transform, isPrimary, monitors, properties] = lm;
                const convertedMonitors = monitors.map(m => {
                    const [connector, modeId, monitorProps] = m;
                    const monitor = this._monitors.find(mon => mon[0][0] === connector);
    
                    if (!monitor) {
                        console.log(`Monitor ${connector} not found.`);
                        return null;
                    }
    
                    const validModes = monitor[1]
                        .filter(mode => typeof mode[0] === 'string')
                        .map(mode => mode[0]);
    
                    console.log(`Valid modes for ${connector}:`, validModes);
    
                    let selectedModeId = modeId;
    
                    // Handle 'DEL' or invalid modes
                    if (selectedModeId === 'DEL' || !validModes.includes(selectedModeId)) {
                        console.warn(`Invalid mode ${selectedModeId} for monitor ${connector}. Using preferred mode.`);
                        selectedModeId = monitor[2]; // Use the preferred mode
                    }
    
                    // If the preferred mode is invalid, use the first valid mode
                    if (!validModes.includes(selectedModeId)) {
                        console.warn(`Preferred mode ${selectedModeId} is invalid. Using first valid mode.`);
                        selectedModeId = validModes[0];
                    }
    
                    if (!selectedModeId) {
                        console.log(`No valid mode found for monitor ${connector}`);
                        return null;
                    }
    
                    console.log(`Mode selected for ${connector}: ${selectedModeId}`);
                    return [connector, selectedModeId, {}];
                }).filter(m => m !== null);
    
                if (convertedMonitors.length === 0) {
                    console.log(`No valid monitors for logical monitor at position (${x}, ${y})`);
                    return null;
                }
    
                // Adjust primary monitor position to (0, 0)
                let adjustedX = x;
                let adjustedY = y;
                if (isPrimary) {
                    adjustedX = 0;
                    adjustedY = 0;
                }
    
                return [adjustedX, adjustedY, scale, transform, isPrimary, convertedMonitors, properties];
            }).filter(lm => lm !== null);
    
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
                console.log(
                    'Applying monitor config:',
                    JSON.stringify(
                        {
                            serial: this._serial,
                            method: PERSISTENT_MODE,
                            logicalMonitors: convertedLogicalMonitors,
                            properties: properties,
                        },
                        null,
                        2
                    )
                );
                await this._proxy.ApplyMonitorsConfigAsync(
                    this._serial,
                    PERSISTENT_MODE,
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
    }
);
    
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
    }
);
    
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
