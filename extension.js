import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { SecondMonitorIndicator } from './lib/indicator.js';

// All other classes, constants, and most imports have been moved to their respective files:
// - dbusService.js: DBus related constants and proxy.
// - xmlReader.js: Logic for reading monitors.xml.
// - menu.js: Functions for building and updating the monitor selection menu.
// - toggle.js: The SecondMonitorToggle class.
// - indicator.js: The SecondMonitorIndicator class (imported above).

// Main extension class
export default class DualMonitorExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new SecondMonitorIndicator(this._settings);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
        console.log("Dual Monitor Toggle Enabled");
    }

    disable() {
        console.log(`Disabling Dual Monitor Toggle`);
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._settings = null;
        console.log("Dual Monitor Toggle Disabled");
    }
}
