import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import { QuickMenuToggle } from 'resource:///org/gnome/shell/ui/quickSettings.js';

import { DisplayConfigProxy, PERSISTENT_MODE } from './dbusService.js';
import { loadMonitorConfigFromMonitorsXML } from './xmlReader.js';
import { buildMonitorMenu, updateSelectedMonitorInMenu, updatePersistenceModeSelectionInMenu } from './menu.js';


export const SecondMonitorToggle = GObject.registerClass(
    class SecondMonitorToggle extends QuickMenuToggle {
        _init(indicator, settings) {
            super._init({
                title: _('Monitors'),
                subtitle: '',
                iconName: 'video-display-symbolic',
                toggleMode: true,
            });

            this._settings = settings;
            const modeSetting = this._settings.get_int('mode-setting');            
            
            this._indicator = indicator;
            this._proxy = null;
            this._monitors = [];
            this._logicalMonitors = [];
            this._originalLogicalMonitors = [];
            this._properties = {};
            this._serial = 0;
            this._layoutMode = 1;
            this._supportsChangingLayoutMode = false;
            this._monitor = null;
            this._persistenceMode = (modeSetting === 1 || modeSetting === 2) ? modeSetting : PERSISTENT_MODE;
            this._menuInitiallyBuilt = false;
            this._cachedMonitorsForBuild = '[]';
            this._timeoutId = null;

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

        _getMonitorDisplayName(connectorName, format = 'short') {
            if (!connectorName) return _('Unknown');

            const monitorData = this._monitors.find(m => m[0][0] === connectorName);
            if (monitorData) {
                const vendor = monitorData[0][1] || '';
                const product = monitorData[0][2] || '';
                
                if (format === 'short') {
                    if (product) return product;
                } else { // format === 'long'
                    if (vendor && product) {
                        const cleanVendor = vendor.trim();
                        if (product.toUpperCase().includes(cleanVendor.toUpperCase())) {
                            return `${product} (${connectorName})`;
                        } else {
                            return `${cleanVendor} ${product} (${connectorName})`;
                        }
                    } else if (product) {
                        return `${product} (${connectorName})`;
                    }
                }
            }
            return connectorName; 
        }

        async _getMonitorConfig() {
            try {
                const [serial, newMonitors, newLogicalMonitors, newProperties] = await this._proxy.GetCurrentStateAsync();

                const relevantMonitorDataForBuild = newMonitors.map(m => ({
                    connector: m[0][0],
                    vendor: m[0][1],
                    product: m[0][2],
                    modes: m[1].map(mode => ({ id: mode[0], w: mode[1], h: mode[2], r: mode[3] }))
                }));
                const currentMonitorsStateForBuild = JSON.stringify(relevantMonitorDataForBuild);

                const monitorsListChanged = this._cachedMonitorsForBuild !== currentMonitorsStateForBuild;
                // const activeMonitorsChanged = JSON.stringify(this._logicalMonitors) !== JSON.stringify(newLogicalMonitors); // Keep for potential future optimization

                this._serial = serial;
                this._monitors = newMonitors;
                this._logicalMonitors = newLogicalMonitors;

                if (!this._originalLogicalMonitors.length && newLogicalMonitors.length > 0) {
                    this._originalLogicalMonitors = JSON.parse(JSON.stringify(newLogicalMonitors));
                }
                this._properties = newProperties;
                this._layoutMode = newProperties['layout-mode']?.deepUnpack() ?? 1;
                this._supportsChangingLayoutMode = newProperties['supports-changing-layout-mode']?.deepUnpack() ?? false;

                if (!this._monitor && this._monitors.length > 0) {

                    const savedConnector = this._settings.get_string('monitor-setting');
                    const monitorExists = this._monitors.some(m => m[0][0] === savedConnector);
    
                    if (savedConnector && monitorExists) {
                        this._monitor = savedConnector;
                    } else if (this._monitors.length === 1) {
                        this._monitor = this._monitors[0][0][0];
                    } else {
                        this._monitor = this._monitors[1][0][0]; // Default to second if multiple
                    }
                }
                
                if (!this._menuInitiallyBuilt || monitorsListChanged) {
                    buildMonitorMenu(this);
                    this._cachedMonitorsForBuild = currentMonitorsStateForBuild;
                    this._menuInitiallyBuilt = true;
                } 
                // Since buildMonitorMenu rebuilds everything, including active states, 
                // an explicit call for activeMonitorsChanged might be redundant if menu structure itself didn't change.
                // However, if only active state changed, we still need to update the menu visuals (icons etc.)
                // buildMonitorMenu will handle this due to its removeAll() and full reconstruction approach.
                // For finer-grained updates, one might separate active state updates from full rebuilds.

                updateSelectedMonitorInMenu(this);
                this._sync();
            } catch (e) {
                console.log('Error getting monitor configuration during init/refresh:', e);
                this.subtitle = _('Error');
                this._disableToggle();
            }
        }

        _sync() {
            const isSelectedMonitorActive = this._logicalMonitors.some(lm =>
                lm[5].some(m => m[0] === this._monitor)
            );
            this.checked = isSelectedMonitorActive;
            this._updateIndicatorVisibility();
        }

        _updateIndicatorVisibility() {
            if (this._indicator) {
                this._indicator.visible = this.checked;
            }
        }

        async _toggleMonitor() {
            if (!this._proxy) return;
    
            await this._getMonitorConfig(); 
    
            const isPrimaryMonitorSelected = this._logicalMonitors.some(lm =>
                lm[4] && lm[5].some(m => m[0] === this._monitor)
            );
    
            if (isPrimaryMonitorSelected && !this.checked) {
                console.warn('Cannot disable the primary monitor.');
                this.checked = true; 
                this._sync(); 
                return;
            }
    
            const isSelectedMonitorActive = this._logicalMonitors.some(lm =>
                lm[5].some(m => m[0] === this._monitor)
            );
    
            let newLogicalMonitorsCandidate;
    
            if (isSelectedMonitorActive) { 
                newLogicalMonitorsCandidate = this._logicalMonitors.map(lm => {
                    const [x, y, scale, transform, isPrimary, monitors, properties] = lm;
                    const filteredMonitors = monitors.filter(m => m[0] !== this._monitor);
                    if (filteredMonitors.length > 0) {
                        return [x, y, scale, transform, isPrimary, filteredMonitors, properties];
                    }
                    return null; 
                }).filter(lm => lm !== null);

                if (newLogicalMonitorsCandidate.length === 0 && this._monitors.length > 0) {
                    await this._getMonitorConfig(); 
                    return;
                }

            } else { 
                const originalLmsContainingSelectedMonitor = this._originalLogicalMonitors.filter(lm =>
                    lm[5].some(m => m[0] === this._monitor)
                );
    
                if (originalLmsContainingSelectedMonitor.length > 0) {
                    newLogicalMonitorsCandidate = JSON.parse(JSON.stringify(this._logicalMonitors)); 
                    for (const originalLm of originalLmsContainingSelectedMonitor) {
                        const monitorAlreadyInCurrentSetup = newLogicalMonitorsCandidate.some(currentLm =>
                            currentLm[5].length === originalLm[5].length &&
                            currentLm[5].every(cm => originalLm[5].some(om => om[0] === cm[0] && om[1] === cm[1]))
                        );
                        if (!monitorAlreadyInCurrentSetup) {
                            newLogicalMonitorsCandidate.push(JSON.parse(JSON.stringify(originalLm)));
                        }
                    }
                } else { 
                    const physicalMonitorToEnable = this._monitors.find(physMon => physMon[0][0] === this._monitor);
                    if (!physicalMonitorToEnable) { this._disableToggle(); return; }

                    const connector = physicalMonitorToEnable[0][0];
                    const modes = physicalMonitorToEnable[1]; 
                    
                    let modeIdToUse = null;
                    let initialXForNewMonitor = 0; 
                    let initialYForNewMonitor = 0; 
                    let initialScale = 1.0;
                    let initialTransform = 0;

                    const storedXmlConfig = loadMonitorConfigFromMonitorsXML(connector);

                    if (storedXmlConfig) {
                        initialXForNewMonitor = storedXmlConfig.x;
                        initialYForNewMonitor = storedXmlConfig.y;
                        initialScale = storedXmlConfig.scale;
                        initialTransform = storedXmlConfig.transform;
                    }

                    if (modes && modes.length > 0) {
                        const firstValidMode = modes.find(mode => typeof mode[0] === 'string');
                        if (firstValidMode) modeIdToUse = firstValidMode[0];
                    }

                    if (!modeIdToUse) { this._disableToggle(); return; }
                    
                    if (!storedXmlConfig) {
                        if (this._logicalMonitors.length > 0) {
                            const primaryLmInCandidate = this._logicalMonitors.find(lm => lm[4]);
                            if (primaryLmInCandidate) {
                                initialYForNewMonitor = primaryLmInCandidate[1]; 
                            }
                        }
                    }

                    newLogicalMonitorsCandidate = JSON.parse(JSON.stringify(this._logicalMonitors));
                    const newLmEntry = [ 
                        initialXForNewMonitor, initialYForNewMonitor, initialScale,          
                        initialTransform, (newLogicalMonitorsCandidate.length === 0),
                        [[connector, modeIdToUse, {}]], {} 
                    ];
                    newLogicalMonitorsCandidate.push(newLmEntry);
                }
            }

            if (!newLogicalMonitorsCandidate || (newLogicalMonitorsCandidate.length === 0 && this._monitors.length > 0)) {
                await this._getMonitorConfig(); return;
            }

            const resolvedLmsStep1 = newLogicalMonitorsCandidate.map(lm => {
                const [x, y, scale, transform, isPrimary, monitors, properties] = lm;
                const resolvedMonitorsInLm = monitors.map(m_orig => {
                    const [connector, originalModeId, monProps] = m_orig;
                    const physicalMonitor = this._monitors.find(physMon => physMon[0][0] === connector);
                    if (!physicalMonitor) return null;
                    const validModes = physicalMonitor[1].filter(mode => typeof mode[0] === 'string').map(mode => mode[0]);
                    let currentModeId = originalModeId;
                    if (typeof currentModeId !== 'string' || !validModes.includes(currentModeId)) {
                        if (validModes.length > 0) currentModeId = validModes[0];
                        else return null;
                    }
                    return [connector, currentModeId, {}]; 
                }).filter(m => m !== null);

                if (resolvedMonitorsInLm.length === 0) return null;
                return [x, y, scale, transform, isPrimary, resolvedMonitorsInLm, properties];
            }).filter(lm => lm !== null);

            if (resolvedLmsStep1.length === 0 && this._monitors.length > 0) {
                await this._getMonitorConfig(); return;
            }

            let positionedLms = JSON.parse(JSON.stringify(resolvedLmsStep1));
            if (positionedLms.length > 0) {
                let primaryIdx = positionedLms.findIndex(lm => lm[4] === true);

                if (primaryIdx === -1 || positionedLms.filter(lm => lm[4] === true).length > 1) {
                    let currentPrimaryConnector = null;
                    if (this._logicalMonitors.length > 0) {
                        const currentPrimaryLm = this._logicalMonitors.find(lm => lm[4] === true);
                        if (currentPrimaryLm && currentPrimaryLm[5].length > 0) {
                            currentPrimaryConnector = currentPrimaryLm[5][0][0];
                        }
                    }
                    if (currentPrimaryConnector) {
                        primaryIdx = positionedLms.findIndex(lm => lm[5][0][0] === currentPrimaryConnector);
                    }
                    if (primaryIdx === -1 || !positionedLms[primaryIdx]) {
                        primaryIdx = 0; 
                    }
                    positionedLms.forEach((lm, idx) => { lm[4] = (idx === primaryIdx); });
                }
                
                let currentX = 0;
                const sortedPositionedLms = [];
                if (positionedLms[primaryIdx]) { 
                    sortedPositionedLms.push(positionedLms[primaryIdx]); 
                }
                for (let i = 0; i < positionedLms.length; i++) {
                    if (i !== primaryIdx) {
                        sortedPositionedLms.push(positionedLms[i]);
                    }
                }
                positionedLms = sortedPositionedLms;

                for (let i = 0; i < positionedLms.length; i++) {
                    const lm = positionedLms[i];
                    const physicalMonInLm = lm[5][0]; 
                    const connector = physicalMonInLm[0];
                    const resolvedModeId = physicalMonInLm[1];
                    const physicalMonitorData = this._monitors.find(m => m[0][0] === connector);
                    let monitorWidth = 1920; 

                    if (physicalMonitorData && physicalMonitorData[1]) {
                        const modeData = physicalMonitorData[1].find(md => md[0] === resolvedModeId);
                        if (modeData && typeof modeData[1] === 'number') {
                            monitorWidth = modeData[1] * lm[2]; 
                        }
                    }

                    if (lm[4]) { 
                        lm[0] = 0; lm[1] = 0; currentX = monitorWidth;
                    } else { 
                        lm[0] = currentX; currentX += monitorWidth;
                    }
                }
            }
            
            const finalLogicalMonitors = positionedLms; 
            const propertiesToApply = {};
            if (this._supportsChangingLayoutMode) {
                propertiesToApply['layout-mode'] = new GLib.Variant('u', this._layoutMode);
            }
    
            if (finalLogicalMonitors.length === 0 && this._monitors.length > 0) {
                await this._getMonitorConfig(); return;
            }
    
            try {
                await this._proxy.ApplyMonitorsConfigAsync(
                    this._serial, this._persistenceMode,
                    finalLogicalMonitors, propertiesToApply
                );
                if (this._timeoutId) GLib.Source.remove(this._timeoutId);
                this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, async () => { 
                    await this._getMonitorConfig(); 
                    this._timeoutId = null;
                    return GLib.SOURCE_REMOVE;
                });

            } catch (e) {
                console.error('Error applying monitor configuration:', e);
                this._disableToggle(); 
                if (this._timeoutId) GLib.Source.remove(this._timeoutId);
                this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, async () => { 
                    await this._getMonitorConfig(); 
                    this.sensitive = true; 
                    this._timeoutId = null;
                    return GLib.SOURCE_REMOVE;
                });
            }
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