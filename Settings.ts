// Settings.ts
import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type ChemEditPlugin from './main';

export interface ChemEditSettings {
    enableEln: boolean; enableNavigator: boolean; enablePathways: boolean; enableContextMenu: boolean; enableScripting: boolean;
    enableElnDashboard: boolean; enableInventoryDashboard: boolean; enableOrdersDashboard: boolean; enableEquipmentDashboard: boolean;
    enableProtocolsDashboard: boolean; enableLibraryDashboard: boolean; enableGalleryDashboard: boolean; enableCharacterizationDashboard: boolean;
    width: number; height: number; inlineWidth: number; inlineHeight: number;
    useSvgSmiles: boolean; useAcsSettings: boolean; lightTheme: string; darkTheme: string;
    inlineSmilesPrefix: string; inlineMolPrefix: string; smartPasteSmiles: boolean; smartPasteMol: boolean;
    supportedEmbedExtensions: string; mediaSavePath: string;
    showMediaRibbonIcons: boolean; showElnRibbonIcon: boolean; showDashboardRibbonIcon: boolean; showNavigatorRibbonIcon: boolean; 
    elnDirectory: string; elnPrefix: string; elnSections: string; libraryFilePath: string; 
    contextUrl1Name: string; contextUrl1: string; contextUrl2Name: string; contextUrl2: string;
    contextUrl3Name: string; contextUrl3: string; contextUrl4Name: string; contextUrl4: string;
    navigatorDefaultTab: string; pathwayColors: string; scriptsFolder: string;
}

export const DEFAULT_SETTINGS: ChemEditSettings = {
    enableEln: true, enableNavigator: true, enablePathways: true, enableContextMenu: true, enableScripting: false, 
    enableElnDashboard: true, enableInventoryDashboard: true, enableOrdersDashboard: true, enableEquipmentDashboard: true,
    enableProtocolsDashboard: true, enableLibraryDashboard: true, enableGalleryDashboard: true, enableCharacterizationDashboard: true,
    width: 300, height: 300, inlineWidth: 150, inlineHeight: 150, lightTheme: 'light', darkTheme: 'dark',
    inlineSmilesPrefix: '$smiles=', inlineMolPrefix: '$mol=', smartPasteSmiles: false, smartPasteMol: false,
    useSvgSmiles: true, useAcsSettings: false, mediaSavePath: "Assets/", 
    showMediaRibbonIcons: false, showElnRibbonIcon: true, showDashboardRibbonIcon: true, showNavigatorRibbonIcon: false, 
    elnDirectory: "ELN", elnPrefix: "EXP", elnSections: "TLC, LCMS, NMR",
    supportedEmbedExtensions: "mol, cdxml, ket, sdf, rxn, inchi, smarts, svg, fasta, sequence, idt, helm, biln",
    libraryFilePath: "ChemEdit/compounds.md",
    contextUrl1Name: "Search PubChem", contextUrl1: "https://pubchem.ncbi.nlm.nih.gov/#query={{smiles}}",
    contextUrl2Name: "Search MolPort", contextUrl2: "https://www.molport.com/shop/search-results?smiles={{smiles}}",
    contextUrl3Name: "Predict NMR (NMRium)", contextUrl3: "https://app.nmrium.com/predict?smiles={{smiles}}",
    contextUrl4Name: "Search ChemSpider", contextUrl4: "https://www.chemspider.com/Search.aspx?q={{smiles}}",
    navigatorDefaultTab: "context", pathwayColors: "#4e79a7, #f28e2c, #e15759, #76b7b2, #59a14f, #edc949, #af7aa1, #ff9da7, #9c755f, #bab0ab", scriptsFolder: "ChemEdit/Scripts"
};

export class ChemEditSettingTab extends PluginSettingTab {
    plugin: ChemEditPlugin; 
    
    constructor(app: App, plugin: ChemEditPlugin) { super(app, plugin); this.plugin = plugin; }

    private createAccordion(container: HTMLElement, title: string, icon: string, open: boolean = false) {
        const details = container.createEl('details');
        details.setCssStyles({ marginBottom: '15px', border: '1px solid var(--background-modifier-border)', borderRadius: '8px', background: 'var(--background-primary-alt)' });
        if (open) details.setAttribute('open', '');
        
        const summary = details.createEl('summary');
        summary.setCssStyles({ fontSize: '15px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', outline: 'none', userSelect: 'none' });
        
        summary.createSpan({ text: icon, attr: { style: 'font-size: 18px;' } });
        summary.createSpan({ text: title });
        
        const contentDiv = details.createDiv();
        contentDiv.setCssStyles({ padding: '0 15px 15px 15px', borderTop: '1px solid var(--background-modifier-border)' });
        return contentDiv;
    }
    
    display(): void {
        const {containerEl} = this; 
        containerEl.empty(); 
        
        new Setting(containerEl).setName('🧪 ChemEdit Settings').setHeading();
        
        const howtoEl = containerEl.createDiv();
        howtoEl.setCssStyles({ marginBottom: "25px", padding: "15px", background: "var(--background-secondary)", borderRadius: "8px", border: "1px solid var(--interactive-accent)" });
        
        howtoEl.createDiv({ text: "Quick How-To:", attr: { style: "font-weight: 700; margin-bottom: 8px; color: var(--interactive-accent);" } });
        const ul = howtoEl.createEl("ul", { attr: { style: "margin: 0; padding-left: 20px; color: var(--text-normal); font-size: 13px;" } });
        
        const li1 = ul.createEl("li"); li1.createEl("b", { text: "Draw:" }); li1.appendText(" Click the Hexagon icon in the left ribbon to draw a new structure.");
        const li2 = ul.createEl("li"); li2.createEl("b", { text: "Embeds:" }); li2.appendText(" Type ![[molecule.mol]] directly in any note.");
        const li3 = ul.createEl("li"); li3.createEl("b", { text: "Dashboards:" }); li3.appendText(" Use the Command Palette (Ctrl+P) to open the LIMS Dashboards.");
        const li4 = ul.createEl("li"); li4.createEl("b", { text: "Edit:" }); li4.appendText(" Double-click any rendered molecule to open Ketcher.");

        const genSec = this.createAccordion(containerEl, "General & File Paths", "📂", true);
        new Setting(genSec).setName('Default ELN Directory').setDesc('Folder where new ELN experiments will be saved.').addText(text => text.setPlaceholder('Experiments/').setValue(this.plugin.settings.elnDirectory).onChange(async (v) => { this.plugin.settings.elnDirectory = v; await this.plugin.saveSettings(); }));
        new Setting(genSec).setName('Default Experiment Prefix').setDesc('Prefix for new ELN files (e.g., EXP).').addText(text => text.setPlaceholder('EXP').setValue(this.plugin.settings.elnPrefix).onChange(async (v) => { this.plugin.settings.elnPrefix = v; await this.plugin.saveSettings(); }));
        new Setting(genSec).setName('Analytical Sections').setDesc('Comma-separated list of sections to auto-generate.').addText(text => text.setPlaceholder('TLC, LCMS, NMR').setValue(this.plugin.settings.elnSections).onChange(async (v) => { this.plugin.settings.elnSections = v; await this.plugin.saveSettings(); }));
        new Setting(genSec).setName('Compound Library File Path').setDesc('Point to a .md file for your common chemicals.').addText(text => text.setPlaceholder('Meta/Compounds.md').setValue(this.plugin.settings.libraryFilePath).onChange(async (v) => { this.plugin.settings.libraryFilePath = v; await this.plugin.saveSettings(); }));
        new Setting(genSec).setName('Media Images Save Path').setDesc('Folder where camera/TLC pictures will be stored.').addText(text => text.setPlaceholder('Assets/').setValue(this.plugin.settings.mediaSavePath).onChange(async (v) => { this.plugin.settings.mediaSavePath = v; await this.plugin.saveSettings(); }));

        const modSec = this.createAccordion(containerEl, "Active Modules & Dashboards", "🧩");
        modSec.createEl('p', { text: "Turn off features you don't use to save memory. Restart required.", cls: "setting-item-description" });
        new Setting(modSec).setName('Enable Core Dashboards & ELN').addToggle(t => t.setValue(this.plugin.settings.enableEln).onChange(async (v) => { this.plugin.settings.enableEln = v; await this.plugin.saveSettings(); }));
        new Setting(modSec).setName('Enable Chem Navigator').addToggle(t => t.setValue(this.plugin.settings.enableNavigator).onChange(async (v) => { this.plugin.settings.enableNavigator = v; await this.plugin.saveSettings(); }));
        new Setting(modSec).setName('Enable Synthesis Pathways').addToggle(t => t.setValue(this.plugin.settings.enablePathways).onChange(async (v) => { this.plugin.settings.enablePathways = v; await this.plugin.saveSettings(); }));
        new Setting(modSec).setName('Enable Context Menu').addToggle(t => t.setValue(this.plugin.settings.enableContextMenu).onChange(async (v) => { this.plugin.settings.enableContextMenu = v; await this.plugin.saveSettings(); }));

        new Setting(modSec).setName('Specific Dashboards').setHeading();
        const makeDbToggle = (name: string, settingKey: keyof ChemEditSettings) => { new Setting(modSec).setName(name).addToggle(t => t.setValue(this.plugin.settings[settingKey] as boolean).onChange(async (v) => { (this.plugin.settings as any)[settingKey] = v; await this.plugin.saveSettings(); })); };
        makeDbToggle('🧪 ELN Notebook', 'enableElnDashboard'); makeDbToggle('🛒 Orders & Requests', 'enableOrdersDashboard'); makeDbToggle('📦 Chemical Inventory', 'enableInventoryDashboard'); makeDbToggle('🔬 Lab Equipment', 'enableEquipmentDashboard'); makeDbToggle('📄 SOPs & Protocols', 'enableProtocolsDashboard'); makeDbToggle('📚 Compounds Library', 'enableLibraryDashboard'); makeDbToggle('🖼️ Drawings Gallery', 'enableGalleryDashboard'); makeDbToggle('📊 Characterization Data', 'enableCharacterizationDashboard');

        const linkSec = this.createAccordion(containerEl, "Context Menu Web Links", "🌐");
        new Setting(linkSec).setName('Custom Link 1 Name').addText(text => text.setValue(this.plugin.settings.contextUrl1Name).onChange(async (v) => { this.plugin.settings.contextUrl1Name = v; await this.plugin.saveSettings(); }));
        new Setting(linkSec).setName('Custom Link 1 URL').addText(text => text.setValue(this.plugin.settings.contextUrl1).onChange(async (v) => { this.plugin.settings.contextUrl1 = v; await this.plugin.saveSettings(); }));
        new Setting(linkSec).setName('Custom Link 2 Name').addText(text => text.setValue(this.plugin.settings.contextUrl2Name).onChange(async (v) => { this.plugin.settings.contextUrl2Name = v; await this.plugin.saveSettings(); }));
        new Setting(linkSec).setName('Custom Link 2 URL').addText(text => text.setValue(this.plugin.settings.contextUrl2).onChange(async (v) => { this.plugin.settings.contextUrl2 = v; await this.plugin.saveSettings(); }));
        new Setting(linkSec).setName('Custom Link 3 Name').addText(text => text.setValue(this.plugin.settings.contextUrl3Name).onChange(async (v) => { this.plugin.settings.contextUrl3Name = v; await this.plugin.saveSettings(); }));
        new Setting(linkSec).setName('Custom Link 3 URL').addText(text => text.setValue(this.plugin.settings.contextUrl3).onChange(async (v) => { this.plugin.settings.contextUrl3 = v; await this.plugin.saveSettings(); }));


        const renderSec = this.createAccordion(containerEl, "Rendering & Theming", "🎨");
        new Setting(renderSec).setName('Image Size (Block Embeds)').addText(text => text.setPlaceholder('Width').setValue(this.plugin.settings.width.toString()).onChange(async (v) => { this.plugin.settings.width = parseInt(v) || 300; await this.plugin.saveSettings(); })).addText(text => text.setPlaceholder('Height').setValue(this.plugin.settings.height.toString()).onChange(async (v) => { this.plugin.settings.height = parseInt(v) || 300; await this.plugin.saveSettings(); }));
        new Setting(renderSec).setName('Render SMILES as SVG').addToggle(toggle => toggle.setValue(this.plugin.settings.useSvgSmiles).onChange(async (value) => { this.plugin.settings.useSvgSmiles = value; await this.plugin.saveSettings(); }));
        new Setting(renderSec).setName('ChemDraw ACS 1996 Style (Ketcher)').addToggle(toggle => toggle.setValue(this.plugin.settings.useAcsSettings).onChange(async (value) => { this.plugin.settings.useAcsSettings = value; await this.plugin.saveSettings(); }));
        const themeOptions = { 'light': 'Light', 'dark': 'Dark', 'oldschool': 'Oldschool (B&W)' };
        new Setting(renderSec).setName('Themes').addDropdown(dropdown => dropdown.addOptions(themeOptions).setValue(this.plugin.settings.lightTheme).onChange(async (value) => { this.plugin.settings.lightTheme = value; await this.plugin.saveSettings(); })).addDropdown(dropdown => dropdown.addOptions(themeOptions).setValue(this.plugin.settings.darkTheme).onChange(async (value) => { this.plugin.settings.darkTheme = value; await this.plugin.saveSettings(); }));

        const pasteSec = this.createAccordion(containerEl, "Smart Paste & Inline Embeds", "📋");
        new Setting(pasteSec).setName('Auto-format pasted SMILES').addToggle(toggle => toggle.setValue(this.plugin.settings.smartPasteSmiles).onChange(async (value) => { this.plugin.settings.smartPasteSmiles = value; await this.plugin.saveSettings(); }));
        new Setting(pasteSec).setName('Auto-format pasted MOL text').addToggle(toggle => toggle.setValue(this.plugin.settings.smartPasteMol).onChange(async (value) => { this.plugin.settings.smartPasteMol = value; await this.plugin.saveSettings(); }));
        new Setting(pasteSec).setName('Supported File Extensions').addText(text => text.setValue(this.plugin.settings.supportedEmbedExtensions).onChange(async (v) => { this.plugin.settings.supportedEmbedExtensions = v; await this.plugin.saveSettings(); }));
        new Setting(pasteSec).setName('Inline Image Size').addText(text => text.setValue(this.plugin.settings.inlineWidth.toString()).onChange(async (v) => { this.plugin.settings.inlineWidth = parseInt(v) || 150; await this.plugin.saveSettings(); })).addText(text => text.setValue(this.plugin.settings.inlineHeight.toString()).onChange(async (v) => { this.plugin.settings.inlineHeight = parseInt(v) || 150; await this.plugin.saveSettings(); }));
        new Setting(pasteSec).setName('Inline Prefixes').addText(text => text.setValue(this.plugin.settings.inlineSmilesPrefix).onChange(async (v) => { this.plugin.settings.inlineSmilesPrefix = v; await this.plugin.saveSettings(); })).addText(text => text.setValue(this.plugin.settings.inlineMolPrefix).onChange(async (v) => { this.plugin.settings.inlineMolPrefix = v; await this.plugin.saveSettings(); }));

        const iconSec = this.createAccordion(containerEl, "Sidebar Ribbon Icons", "🗂️");
        new Setting(iconSec).setName('Show LIMS Dashboards Icon').addToggle(toggle => toggle.setValue(this.plugin.settings.showDashboardRibbonIcon).onChange(async (value) => { this.plugin.settings.showDashboardRibbonIcon = value; await this.plugin.saveSettings(); this.plugin.refreshRibbonIcons(); }));
        new Setting(iconSec).setName('Show "Create Blank ELN" Icon').addToggle(toggle => toggle.setValue(this.plugin.settings.showElnRibbonIcon).onChange(async (value) => { this.plugin.settings.showElnRibbonIcon = value; await this.plugin.saveSettings(); this.plugin.refreshRibbonIcons(); }));
        new Setting(iconSec).setName('Show "Take Photo/TLC" Icons').addToggle(toggle => toggle.setValue(this.plugin.settings.showMediaRibbonIcons).onChange(async (value) => { this.plugin.settings.showMediaRibbonIcons = value; await this.plugin.saveSettings(); this.plugin.refreshRibbonIcons(); }));
        new Setting(iconSec).setName('Show Chem Navigator Icon').addToggle(toggle => toggle.setValue(this.plugin.settings.showNavigatorRibbonIcon).onChange(async (value) => { this.plugin.settings.showNavigatorRibbonIcon = value; await this.plugin.saveSettings(); this.plugin.refreshRibbonIcons(); }));

        const resetWrap = containerEl.createDiv();
        resetWrap.setCssStyles({ marginTop: "40px", paddingTop: "20px", borderTop: "1px solid var(--background-modifier-border)", display: "flex", justifyContent: "space-between", alignItems: "center" });
        resetWrap.createDiv({ text: "Danger Zone", attr: { style: "color: var(--text-error); font-weight: bold;" }});
        const resetBtn = resetWrap.createEl("button", { text: "Reset to Default Settings" });
        resetBtn.setCssStyles({ backgroundColor: "transparent", border: "1px solid var(--text-error)", color: "var(--text-error)" });
        resetBtn.onclick = async () => {
            if (confirm("Are you sure you want to reset all ChemEdit settings to defaults?")) {
                this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
                await this.plugin.saveSettings();
                new Notice("ChemEdit settings reset. Please restart Obsidian.");
                this.display(); 
            }
        };
    }
}