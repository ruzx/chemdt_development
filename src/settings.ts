import { App, PluginSettingTab, Setting } from 'obsidian';
import ChemSpecPlugin from './main';
import { ChemSpecSettings } from './types';

export const DEFAULT_SETTINGS: ChemSpecSettings = {
    canvasHeight: 450,
    lineColor: '#ef4444',
    integralColor: '#22c55e',
    multipletColor: '#3b82f6',
    peakColor: '#eab308',
    lineWidth: 1.2,
    numTicks: 10,
    ppmDecimals: 2,
    showMetadata: true,
    showSolventLines: true,
    pdataSubpath: 'pdata/1',
    saveFolder: '',
    hotkeyPan: 'p', hotkeyZoom: 'z', hotkeyIntegrate: 'i', hotkeyMultiplet: 'm', hotkeyPeak: 'k',
    defaultNmrRangeMax: 12.0,
    defaultNmrRangeMin: -1.0,
    supportedExtensions: 'nmr, jdx, jcamp'
};

export class ChemSpecSettingTab extends PluginSettingTab {
    plugin: ChemSpecPlugin;

    constructor(app: App, plugin: ChemSpecPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    // Required by Obsidian API 1.13.0+ to clear the Search API warning
    public getSettingDefinitions() {
        return [];
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // Native DOM building instead of innerHTML
        const helpDiv = containerEl.createDiv({ cls: 'setting-item-description' });
        helpDiv.setCssStyles({ paddingBottom: "15px", borderBottom: "1px solid var(--background-modifier-border)", marginBottom: "15px", marginTop: "10px" });
        
        helpDiv.createEl('b', { text: 'Quick How-To:' });
        helpDiv.createEl('br');
        
        const line1 = helpDiv.createDiv();
        line1.createSpan({ text: '• ' });
        line1.createEl('b', { text: 'Embeds:' });
        line1.createSpan({ text: ' Type ' });
        line1.createEl('code', { text: '![[spectrum.jdx]]' });
        line1.createSpan({ text: ' directly in any note.' });

        const line2 = helpDiv.createDiv();
        line2.createSpan({ text: '• ' });
        line2.createEl('b', { text: 'NMR Stacking:' });
        line2.createSpan({ text: ' Open a spectrum in the viewer, then drag & drop another file onto the canvas.' });

        const line3 = helpDiv.createDiv();
        line3.createSpan({ text: '• ' });
        line3.createEl('b', { text: 'CV Peaks:' });
        line3.createSpan({ text: ' "Find Peaks" detects true local redox waves.' });

        const line4 = helpDiv.createDiv();
        line4.createSpan({ text: '• ' });
        line4.createEl('b', { text: 'Hotkeys:' });
        line4.createSpan({ text: ' Hover over the viewer and press P (Pan), Z (Zoom), I (Integrate), M (Multiplet), or K (Peak).' });

        helpDiv.createEl('br');
        helpDiv.createSpan({ text: 'Found a bug or need a feature? ' });
        const helpLink = helpDiv.createEl('a', { text: 'Report it on the ruzx ChemSpec GitHub!' });
        helpLink.href = "https://github.com/ruzx/chemspec/issues";
        helpLink.target = "_blank";

        new Setting(containerEl)
            .setName('Supported File Extensions')
            .setDesc('Comma-separated list of extensions ChemSpec will visualize natively (e.g., nmr, jdx). Reload plugin to fully apply.')
            .addText(text => text.setValue(this.plugin.settings.supportedExtensions).onChange(v => { 
                this.plugin.settings.supportedExtensions = v; void this.plugin.saveSettings(); 
            }));

        new Setting(containerEl)
            .setName('Default NMR Range (Max ppm)')
            .setDesc('Left bound of the spectrum on initial load (e.g. 11)')
            .addText(text => text.setValue((this.plugin.settings.defaultNmrRangeMax ?? 12.0).toString()).onChange(v => { 
                const num = parseFloat(v); if (!isNaN(num)) { this.plugin.settings.defaultNmrRangeMax = num; void this.plugin.saveSettings(); }
            }));

        new Setting(containerEl)
            .setName('Default NMR Range (Min ppm)')
            .setDesc('Right bound of the spectrum on initial load (e.g. 0)')
            .addText(text => text.setValue((this.plugin.settings.defaultNmrRangeMin ?? -1.0).toString()).onChange(v => { 
                const num = parseFloat(v); if (!isNaN(num)) { this.plugin.settings.defaultNmrRangeMin = num; void this.plugin.saveSettings(); }
            }));

        new Setting(containerEl)
            .setName('Default save folder')
            .setDesc('Folder where .nmr files save. Leave empty to save next to the original file.')
            .addText(text => text.setValue(this.plugin.settings.saveFolder).onChange(v => { this.plugin.settings.saveFolder = v; void this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Spectrum line color')
            .addText(text => text.setValue(this.plugin.settings.lineColor).onChange(v => { this.plugin.settings.lineColor = v; void this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Integral curve color')
            .addText(text => text.setValue(this.plugin.settings.integralColor).onChange(v => { this.plugin.settings.integralColor = v; void this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Multiplet bracket color')
            .addText(text => text.setValue(this.plugin.settings.multipletColor).onChange(v => { this.plugin.settings.multipletColor = v; void this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Peak picking color')
            .addText(text => text.setValue(this.plugin.settings.peakColor).onChange(v => { this.plugin.settings.peakColor = v; void this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Viewer height (px)')
            .addText(text => text.setValue(this.plugin.settings.canvasHeight.toString()).onChange(v => { 
                const num = parseInt(v); this.plugin.settings.canvasHeight = isNaN(num) ? 450 : num; void this.plugin.saveSettings(); 
            }));

        new Setting(containerEl).setName('Custom hotkeys').setHeading();
        new Setting(containerEl).setName('Pan mode key').addText(text => text.setValue(this.plugin.settings.hotkeyPan).onChange(v => { this.plugin.settings.hotkeyPan = v.toLowerCase(); void this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Zoom mode key').addText(text => text.setValue(this.plugin.settings.hotkeyZoom).onChange(v => { this.plugin.settings.hotkeyZoom = v.toLowerCase(); void this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Integrate mode key').addText(text => text.setValue(this.plugin.settings.hotkeyIntegrate).onChange(v => { this.plugin.settings.hotkeyIntegrate = v.toLowerCase(); void this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Multiplet mode key').addText(text => text.setValue(this.plugin.settings.hotkeyMultiplet).onChange(v => { this.plugin.settings.hotkeyMultiplet = v.toLowerCase(); void this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Peak mode key').addText(text => text.setValue(this.plugin.settings.hotkeyPeak).onChange(v => { this.plugin.settings.hotkeyPeak = v.toLowerCase(); void this.plugin.saveSettings(); }));
    }
}