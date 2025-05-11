import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export function loadMonitorConfigFromMonitorsXML(connectorName) {
    const path = GLib.get_home_dir() + '/.config/monitors.xml';
    const file = Gio.File.new_for_path(path);

    if (!file.query_exists(null)) {
        // console.log('monitors.xml does not exist.');
        return null;
    }

    try {
        const [ok, contentsBytes] = GLib.file_get_contents(path);
        if (!ok || !contentsBytes) {
            // console.warn('Failed to read monitors.xml contents.');
            return null;
        }
        const contents = new TextDecoder().decode(contentsBytes); 

        const configurationsRegex = /<configuration>([\s\S]*?)<\/configuration>/gm;
        let configurationMatch;
        let iteration = 0;

        while ((configurationMatch = configurationsRegex.exec(contents)) !== null) {
            iteration++;
            const currentConfigurationContent = configurationMatch[1];
            // console.log(`Parsing monitors.xml: Looking in <configuration> block #${iteration}`);

            const logicalMonitorRegex = /<logicalmonitor>([\s\S]*?)<\/logicalmonitor>/gm;
            let logicalMonitorMatch;
            while ((logicalMonitorMatch = logicalMonitorRegex.exec(currentConfigurationContent)) !== null) {
                const logicalMonitorContent = logicalMonitorMatch[1];
    
                const connectorRegex = new RegExp(`<connector>${connectorName}</connector>`);
                if (connectorRegex.test(logicalMonitorContent)) {
                    const xMatch = /<x>([-\d]+)<\/x>/.exec(logicalMonitorContent);
                    const yMatch = /<y>([-\d]+)<\/y>/.exec(logicalMonitorContent);
                    const scaleMatch = /<scale>([0-9\.]+)<\/scale>/.exec(logicalMonitorContent);
                    const rotationMatch = /<rotation>(normal|left|right|upside-down)<\/rotation>/.exec(logicalMonitorContent);
                    
                    let transformValue = 0; 
                    if (rotationMatch) {
                        switch (rotationMatch[1]) {
                            case 'normal': transformValue = 0; break;
                            case 'left': transformValue = 1; break;
                            case 'upside-down': transformValue = 2; break;
                            case 'right': transformValue = 3; break;
                        }
                    }
                    
                    if (xMatch && yMatch && scaleMatch) {
                        const config = {
                            x: parseInt(xMatch[1], 10),
                            y: parseInt(yMatch[1], 10),
                            scale: parseFloat(scaleMatch[1]),
                            transform: transformValue,
                        };
                        // console.log(`Loaded config from monitors.xml (configuration #${iteration}) for ${connectorName}:`, config);
                        return config; 
                    }
                }
            }
        }
        // console.log(`Connector ${connectorName} not found in any <configuration> block of monitors.xml.`);
        return null;
    } catch (e) {
        console.error(`Error processing monitors.xml for ${connectorName}: ${e}`);
        return null;
    }
}
 