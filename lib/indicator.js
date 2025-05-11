import GObject from 'gi://GObject';
import { SystemIndicator } from 'resource:///org/gnome/shell/ui/quickSettings.js';
import { SecondMonitorToggle } from './toggle.js';

export const SecondMonitorIndicator = GObject.registerClass(
    class SecondMonitorIndicator extends SystemIndicator {
        _init() {
            super._init();
    
            this._indicator = this._addIndicator();
            this._indicator.icon_name = 'video-display-symbolic';
    
            this._secondMonitorToggle = new SecondMonitorToggle(this._indicator);
            this.quickSettingsItems.push(this._secondMonitorToggle);
        }
    
        destroy() {
            if (this._secondMonitorToggle) {
                this._secondMonitorToggle.destroy();
                this._secondMonitorToggle = null;
            }
            // The SystemIndicator's destroy method should handle this._indicator (the St.Icon)
            // and its quickSettingsItems array if it follows standard GObject lifecycle.
            super.destroy();
        }
    }
); 