// ChemNavigator.ts

import { ItemView, WorkspaceLeaf, TFile, Notice, setIcon, requestUrl } from 'obsidian';
import type ChemEditPlugin from './main';
import { calculateMwOffline, getCompoundLibrary } from './SharedEln';
import { ChemDataEngine } from './ChemDataEngine';

export const CHEM_NAVIGATOR_VIEW_TYPE = "chem-navigator-view";

interface NavWidget {
    id: string;
    title: string;
    visible: boolean;
}

// These are the widgets specific to the "Context" tab
const DEFAULT_CONTEXT_LAYOUT: NavWidget[] = [
    { id: 'preview', title: '🖼️ Structure Preview', visible: true },
    { id: 'stock', title: '📦 Inventory & Library Check', visible: true },
    { id: 'properties', title: '📊 Properties & MW', visible: true },
    { id: 'actions', title: '⚡ Quick Actions', visible: true },
    { id: 'weblinks', title: '🌐 Web Search Links', visible: true },
    { id: 'network', title: '🕸️ Sequence Map', visible: true }
];

export class ChemNavigatorView extends ItemView {
    plugin: ChemEditPlugin;
    
    headerPanel: HTMLElement;
    tabBar: HTMLElement;
    settingsPanel: HTMLElement;
    contentArea: HTMLElement;
    
    widgets: Record<string, HTMLElement> = {};
    widgetContents: Record<string, HTMLElement> = {};
    
    activeTab: string = 'context';
    contextLayout: NavWidget[] = [];
    isSettingsOpen = false;

    constructor(leaf: WorkspaceLeaf, plugin: ChemEditPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return CHEM_NAVIGATOR_VIEW_TYPE; }
    getDisplayText() { return "Chem Navigator"; }
    getIcon() { return "flask-conical"; }

    async onOpen() {
        this.loadLayout();

        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('chem-navigator-view');
        container.setCssStyles({ padding: "0", display: "flex", flexDirection: "column" });

        // 1. HEADER
        this.headerPanel = container.createDiv();
        this.headerPanel.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 15px", background: "var(--background-secondary)", borderBottom: "1px solid var(--background-modifier-border)", flexShrink: "0", zIndex: "2" });
        
        this.headerPanel.createEl("h3", { text: "🧪 Chem Navigator" }).setCssStyles({ margin: "0", fontSize: "15px", fontWeight: "700", color: "var(--text-normal)" });
        
        const tools = this.headerPanel.createDiv();
        tools.setCssStyles({ display: "flex", gap: "5px" });
        
        const settingsBtn = tools.createEl("button", { attr: { title: "Configure Context Layout" } });
        settingsBtn.setCssStyles({ background: "transparent", border: "none", boxShadow: "none", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center", justifyContent: "center" });
        setIcon(settingsBtn, "settings");
        settingsBtn.onclick = () => this.toggleSettings();

        const refreshBtn = tools.createEl("button", { attr: { title: "Refresh Data" } });
        refreshBtn.setCssStyles({ background: "transparent", border: "none", boxShadow: "none", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center", justifyContent: "center" });
        setIcon(refreshBtn, "refresh-cw");
        refreshBtn.onclick = () => { void this.renderActiveTab(); };

        // 2. TAB BAR
        this.tabBar = container.createDiv();
        this.tabBar.setCssStyles({ display: "flex", background: "var(--background-secondary)", borderBottom: "1px solid var(--background-modifier-border)", padding: "0 10px", flexShrink: "0", zIndex: "2" });
        
        const tabs = [
            { id: 'context', icon: 'microscope', tooltip: 'Active Context' },
            { id: 'projects', icon: 'folder-tree', tooltip: 'Projects Tree' },
            { id: 'library', icon: 'library', tooltip: 'Compound Library' },
            { id: 'inventory', icon: 'package', tooltip: 'Inventory' },
            { id: 'search', icon: 'search', tooltip: 'Vault Search' },
            { id: 'tools', icon: 'wrench', tooltip: 'Utilities' }
        ];

        tabs.forEach(t => {
            const btn = this.tabBar.createEl("button", { attr: { title: t.tooltip } });
            btn.setCssStyles({ flex: "1", padding: "10px 0", background: "transparent", border: "none", borderBottom: "2px solid transparent", boxShadow: "none", cursor: "pointer", display: "flex", justifyContent: "center", alignItems: "center", borderRadius: "0", color: "var(--text-muted)", transition: "0.2s" });
            setIcon(btn, t.icon);
            btn.id = `nav-tab-${t.id}`;
            
            btn.onclick = () => {
                this.activeTab = t.id;
                this.updateTabStyles();
                void this.renderActiveTab();
            };
        });

        // 3. SETTINGS DRAWER
        this.settingsPanel = container.createDiv();
        this.settingsPanel.setCssStyles({ display: "none", flexDirection: "column", padding: "15px", background: "var(--background-secondary-alt)", borderBottom: "2px solid var(--interactive-accent)", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.05)", flexShrink: "0", zIndex: "1" });

        // 4. CONTENT AREA
        this.contentArea = container.createDiv();
        this.contentArea.setCssStyles({ flexGrow: "1", overflowY: "auto", padding: "15px", display: "flex", flexDirection: "column", gap: "15px", background: "var(--background-primary)" });

        this.updateTabStyles();
        
        // Initialize Context Widget DOMs
        this.contextLayout.forEach(w => {
            const card = document.createElement("div");
            card.setCssStyles({ display: "flex", flexDirection: "column", background: "var(--background-secondary)", border: "1px solid var(--background-modifier-border)", borderRadius: "8px", padding: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" });
            
            const cardHeader = card.createDiv();
            cardHeader.setCssStyles({ fontWeight: "700", color: "var(--text-normal)", fontSize: "13px", marginBottom: "8px", borderBottom: "1px solid var(--background-modifier-border)", paddingBottom: "6px" });
            cardHeader.setText(w.title);
            
            const content = card.createDiv();
            content.setCssStyles({ display: "flex", flexDirection: "column", gap: "8px" });
            
            this.widgets[w.id] = card;
            this.widgetContents[w.id] = content;
        });

        await this.renderActiveTab();
        this.registerEvent(this.app.workspace.on('file-open', () => { if (this.activeTab === 'context') void this.renderActiveTab(); }));
    }

    // ========================================================================
    // LAYOUT & SETTINGS (Only applies to Context Tab)
    // ========================================================================
    private updateTabStyles() {
        Array.from(this.tabBar.children).forEach((child: HTMLElement) => {
            child.setCssStyles({ borderBottomColor: 'transparent', color: 'var(--text-muted)' });
        });
        const activeBtn = this.tabBar.querySelector(`#nav-tab-${this.activeTab}`) as HTMLElement;
        if (activeBtn) {
            activeBtn.setCssStyles({ borderBottomColor: 'var(--interactive-accent)', color: 'var(--interactive-accent)' });
        }
        
        const settingsBtn = this.headerPanel.querySelector('button[title="Configure Context Layout"]') as HTMLElement;
        if (settingsBtn) {
            settingsBtn.setCssStyles({ display: this.activeTab === 'context' ? 'flex' : 'none' });
        }
        
        if (this.activeTab !== 'context') {
            this.isSettingsOpen = false;
            this.settingsPanel.setCssStyles({ display: 'none' });
        }
    }

    private loadLayout() {
        try {
            const saved = window.localStorage.getItem('chemedit-context-layout');
            if (saved) {
                const parsed = JSON.parse(saved);
                this.contextLayout = DEFAULT_CONTEXT_LAYOUT.map(def => {
                    const found = parsed.find((p:any) => p.id === def.id);
                    return found ? { ...def, visible: found.visible } : def;
                });
                this.contextLayout.sort((a, b) => {
                    const idxA = parsed.findIndex((p:any) => p.id === a.id);
                    const idxB = parsed.findIndex((p:any) => p.id === b.id);
                    return (idxA > -1 ? idxA : 99) - (idxB > -1 ? idxB : 99);
                });
                return;
            }
        } catch(e) {}
        this.contextLayout = JSON.parse(JSON.stringify(DEFAULT_CONTEXT_LAYOUT));
    }

    private saveLayout() { window.localStorage.setItem('chemedit-context-layout', JSON.stringify(this.contextLayout)); }

    private applyLayout() {
        Object.values(this.widgets).forEach(w => w.remove());
        this.contextLayout.forEach((w) => {
            const el = this.widgets[w.id];
            if (el && w.visible) this.contentArea.appendChild(el);
        });
    }

    private toggleSettings() {
        this.isSettingsOpen = !this.isSettingsOpen;
        this.settingsPanel.setCssStyles({ display: this.isSettingsOpen ? "flex" : "none" });
        if (this.isSettingsOpen) this.renderSettingsUI();
    }

    private renderSettingsUI() {
        this.settingsPanel.empty();
        const header = this.settingsPanel.createDiv();
        header.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" });
        
        header.createEl("div", { text: "Context Panel Layout" }).setCssStyles({ fontSize: "11px", fontWeight: "bold", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" });
        
        const closeBtn = header.createEl("button", { attr: { title: "Close" } });
        closeBtn.setCssStyles({ background: "transparent", border: "none", padding: "0", boxShadow: "none", cursor: "pointer", height: "16px" });
        setIcon(closeBtn, "x");
        closeBtn.onclick = () => this.toggleSettings();

        this.contextLayout.forEach((w, i) => {
            const row = this.settingsPanel.createDiv();
            row.setCssStyles({ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "var(--background-primary)", border: "1px solid var(--background-modifier-border)", borderRadius: "6px", marginBottom: "6px" });
            
            const left = row.createDiv();
            left.setCssStyles({ display: "flex", alignItems: "center", gap: "8px" });
            
            const visBtn = left.createEl("button", { text: w.visible ? "👁️" : "🚫", attr: { title: "Toggle Visibility" } });
            visBtn.setCssStyles({ padding: "2px 4px", fontSize: "12px", background: "transparent", border: "none", boxShadow: "none" });
            visBtn.onclick = () => { w.visible = !w.visible; this.saveLayout(); this.renderSettingsUI(); if (this.activeTab === 'context') this.applyLayout(); };
            
            left.createSpan({ text: w.title }).setCssStyles({ fontSize: "12px", fontWeight: "500", color: !w.visible ? "var(--text-muted)" : "var(--text-normal)", textDecoration: !w.visible ? "line-through" : "none" });

            const right = row.createDiv();
            right.setCssStyles({ display: "flex", gap: "4px" });
            
            const upBtn = right.createEl("button", { text: "▲", attr: { disabled: i === 0 ? true : undefined } });
            upBtn.setCssStyles({ padding: "2px 6px", fontSize: "10px", height: "20px" });
            upBtn.onclick = () => this.swapWidget(i, i - 1);
            
            const dnBtn = right.createEl("button", { text: "▼", attr: { disabled: i === this.contextLayout.length - 1 ? true : undefined } });
            dnBtn.setCssStyles({ padding: "2px 6px", fontSize: "10px", height: "20px" });
            dnBtn.onclick = () => this.swapWidget(i, i + 1);
        });
    }

    private swapWidget(idx1: number, idx2: number) {
        const temp = this.contextLayout[idx1];
        this.contextLayout[idx1] = this.contextLayout[idx2];
        this.contextLayout[idx2] = temp;
        this.saveLayout();
        this.renderSettingsUI();
        if (this.activeTab === 'context') this.applyLayout();
    }

    // ========================================================================
    // TAB ROUTER
    // ========================================================================
    async renderActiveTab() {
        if (!['context', 'projects', 'library', 'inventory', 'search', 'tools'].includes(this.activeTab)) this.activeTab = 'context';

        if (this.activeTab !== 'context') {
            Object.values(this.widgets).forEach(w => w.remove());
            this.contentArea.empty();
        }

        if (this.activeTab === 'context') await this.renderContextTab();
        else if (this.activeTab === 'projects') await this.renderProjectsTab();
        else if (this.activeTab === 'library') await this.renderLibraryTab();
        else if (this.activeTab === 'inventory') await this.renderInventoryTab();
        else if (this.activeTab === 'search') await this.renderSearchTab();
        else if (this.activeTab === 'tools') await this.renderToolsTab();
    }

    // ========================================================================
    // 1. CONTEXT TAB
    // ========================================================================
    private async renderContextTab() {
        this.applyLayout(); 
        const file = this.app.workspace.getActiveFile();
        
        Object.values(this.widgetContents).forEach(w => w.empty());
        
        if (!file || file.extension !== 'md') {
            const placeholder = this.widgetContents['preview'].createDiv({ text: "Open a chemical note to load context." });
            placeholder.setCssStyles({ padding: "15px", textAlign: "center", color: "var(--text-muted)", fontSize: "12px", fontStyle: "italic" });
            return;
        }

        const chemData = await this.extractChemistryFromNote(file);

        if (!chemData || chemData.smilesList.length === 0) {
            const noChem = this.widgetContents['preview'].createDiv();
            noChem.setCssStyles({ padding: "10px", color: "var(--text-muted)", fontSize: "12px", fontStyle: "italic", display: "flex", alignItems: "center", gap: "6px", border: "1px dashed var(--background-modifier-border)", borderRadius: "8px" });
            noChem.createSpan({ text: "📄 " }).setCssStyles({ color: "var(--text-accent)" });
            noChem.createSpan({ text: `${file.basename} (No chemistry)` });
            return;
        }

        const targetSmiles = chemData.smilesList[0];
        const isEln = chemData.type === 'eln';

        // 🖼️ WIDGET: PREVIEW
        if (this.widgetContents['preview']) {
            this.widgetContents['preview'].createDiv({ text: `🔬 ${chemData.name}` }).setCssStyles({ fontSize: "13px", fontWeight: "bold", color: "var(--text-accent)", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
            
            const previewWrapper = this.widgetContents['preview'].createDiv();
            previewWrapper.setCssStyles({ width: "100%", height: "160px", background: "var(--background-primary)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--background-modifier-border)", boxShadow: "inset 0 0 5px rgba(0,0,0,0.02)" });
            previewWrapper.createSpan({ text: "⏳" });
            
            window.requestAnimationFrame(async () => {
                const renderEl = await this.plugin.api.renderStructure(targetSmiles, 240, 150);
                previewWrapper.empty();
                if (renderEl) { 
                    renderEl.setCssStyles({ maxWidth: '100%', maxHeight: '100%' }); 
                    previewWrapper.appendChild(renderEl); 
                } else {
                    previewWrapper.createSpan({ text: "❌" });
                }
            });
        }

        // 📦 WIDGET: STOCK & LIBRARY CHECK (OPTIMIZED)
        if (this.widgetContents['stock']) {
            const body = this.widgetContents['stock'];
            const checkBtn = body.createEl("button", { text: "🔍 Check Inventory & Library" });
            checkBtn.setCssStyles({ width: "100%", fontSize: "11px", padding: "4px", height: "26px" });
            
            checkBtn.onclick = async () => {
                body.empty();
                body.createSpan({ text: "Checking inventory... ⏳" }).setCssStyles({ color: "var(--text-muted)", fontSize: "11px" });
                
                window.setTimeout(async () => {
                    const invFiles = this.getInventoryFiles();
                    let foundInInv = null;
                    
                    for (const f of invFiles) {
                        const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
                        if (fm && fm.smiles === targetSmiles) {
                            foundInInv = { file: f, loc: fm.location || "Unknown", amt: fm.amount || "-" };
                            break;
                        }
                    }

                    const lib = await getCompoundLibrary(this.plugin);
                    const foundInLib = lib.find(c => c.smiles === targetSmiles);

                    body.empty();
                    if (foundInInv) {
                        const invStatus = body.createDiv();
                        invStatus.setCssStyles({ fontSize: "12px", color: "var(--text-success)", marginBottom: "4px" });
                        invStatus.createSpan({ text: "✅ " });
                        invStatus.createEl("b", { text: "In Inventory" });
                        
                        const locBtn = body.createDiv({ text: `📍 ${foundInInv.loc} | ⚖️ ${foundInInv.amt}`, attr: { title: "Click to open" } });
                        locBtn.setCssStyles({ fontSize: "11px", color: "var(--text-normal)", cursor: "pointer" });
                        locBtn.onclick = () => this.app.workspace.getLeaf(false).openFile(foundInInv.file);
                    } else {
                        const invStatus = body.createDiv();
                        invStatus.setCssStyles({ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px" });
                        invStatus.createSpan({ text: "❌ " });
                        invStatus.createEl("b", { text: "Not in Inventory" });
                    }

                    if (foundInLib) {
                        const libStatus = body.createDiv();
                        libStatus.setCssStyles({ fontSize: "12px", color: "var(--text-accent)", marginTop: "6px" });
                        libStatus.createSpan({ text: "📚 " });
                        libStatus.createEl("b", { text: "In Library " });
                        libStatus.createSpan({ text: `(${foundInLib.name})` });
                    } else {
                        const addBtn = body.createEl("button", { text: "+ Add to Library" });
                        addBtn.setCssStyles({ marginTop: "6px", fontSize: "10px", height: "22px", width: "max-content" });
                        addBtn.onclick = () => {
                            void this.plugin.api.library.addCompound(chemData.name, targetSmiles);
                        };
                    }
                }, 10);
            };
        }

        // 📊 WIDGET: PROPERTIES
        if (this.widgetContents['properties']) {
            const body = this.widgetContents['properties'];
            const renderPropBox = async (title: string, smiles: string) => {
                if (!smiles) return;
                const box = body.createDiv();
                box.setCssStyles({ background: "var(--background-primary)", border: "1px solid var(--background-modifier-border)", borderRadius: "6px", padding: "8px 12px", fontSize: "11px", marginBottom: "4px" });
                
                const props = ChemDataEngine.getPropertiesFromSmiles(smiles.split(' |')[0].trim());
                const mwProps = await calculateMwOffline(smiles, this.plugin);

                const header = box.createDiv();
                header.setCssStyles({ fontWeight: "700", color: "var(--text-accent)", marginBottom: "6px", borderBottom: "1px solid var(--background-modifier-border)", paddingBottom: "4px", display: "flex", justifyContent: "space-between" });
                header.createSpan({ text: title });

                const createRow = (label: string, value: string) => {
                    const r = box.createDiv();
                    r.setCssStyles({ display: "flex", justifyContent: "space-between", marginBottom: "2px" });
                    r.createSpan({ text: label }).setCssStyles({ color: "var(--text-muted)" });
                    r.createSpan({ text: value }).setCssStyles({ fontWeight: "600", color: "var(--text-normal)" });
                };

                createRow("Formula:", mwProps.formula);
                createRow("Exact Mass:", mwProps.mw.toFixed(2));

                if (props && props.logp) {
                    createRow("LogP:", props.logp.toFixed(2));
                    createRow("TPSA:", props.tpsa.toFixed(2));
                    createRow("H-Bond (D/A):", `${props.hbd} / ${props.hba}`);
                    
                    if (props.alerts && props.alerts !== "None") {
                        const alertBox = box.createDiv({ text: `⚠️ ${props.alerts}` });
                        alertBox.setCssStyles({ marginTop: "6px", padding: "4px", background: "#fde0df", border: "1px solid #f40724", borderRadius: "4px", color: "#f40724", fontWeight: "bold", textAlign: "center" });
                    }
                }
            };
            if (isEln && chemData.data?.reactants?.[0]?.smiles) await renderPropBox("Ref. Reactant", chemData.data.reactants[0].smiles);
            if (targetSmiles) await renderPropBox(isEln ? "Ref. Product" : "Structure Info", targetSmiles);
        }

        // ⚡ WIDGET: ACTIONS
        if (this.widgetContents['actions']) {
            const body = this.widgetContents['actions'];
            const actionGrid = body.createDiv();
            actionGrid.setCssStyles({ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" });
            
            const makeBtn = (text: string, onClick: () => void, fullWidth = false) => {
                const b = actionGrid.createEl("button", { text });
                b.setCssStyles({ fontSize: "11px", padding: "4px", height: "26px", borderRadius: "4px" });
                if (fullWidth) b.style.gridColumn = "span 2";
                b.onclick = onClick;
            };
            
            makeBtn("📋 Copy SMILES", () => { void navigator.clipboard.writeText(targetSmiles); new Notice("Copied!"); });
            makeBtn("✏️ Edit Structure", () => {
                this.plugin.api.ketcher.openEditor(targetSmiles, "smiles", async (newData: string) => {
                    const fileContent = await this.app.vault.read(file);
                    const newContent = fileContent.replace(targetSmiles, newData);
                    await this.app.vault.modify(file, newContent);
                    void this.renderActiveTab();
                });
            });
            
            const findBtn = actionGrid.createEl("button", { text: "🔍 Find in Vault" });
            findBtn.setCssStyles({ gridColumn: "span 2", fontSize: "11px", padding: "4px", height: "26px", borderRadius: "4px", background: "var(--interactive-accent)", color: "var(--text-on-accent)", border: "none" });
            findBtn.onclick = () => {
                const searchPlugin = (this.app as any).internalPlugins?.getPluginById('global-search');
                if (searchPlugin && searchPlugin.instance) searchPlugin.instance.openGlobalSearch(`"${targetSmiles}"`);
            };
        }

        // 🌐 WIDGET: WEBLINKS
        if (this.widgetContents['weblinks']) {
            const body = this.widgetContents['weblinks'];
            const webGrid = body.createDiv();
            webGrid.setCssStyles({ display: "flex", gap: "10px", flexWrap: "wrap", background: "var(--background-secondary-alt)", padding: "8px", borderRadius: "6px", border: "1px solid var(--background-modifier-border)" });
            
            const makeWebLink = (text: string, urlTemplate: string) => {
                if (!urlTemplate) return;
                const a = webGrid.createEl("a", { text, href: "#" });
                a.setCssStyles({ fontSize: "11px", fontWeight: "500", color: "var(--text-accent)", textDecoration: "none" });
                a.onmouseover = () => a.style.textDecoration = 'underline';
                a.onmouseout = () => a.style.textDecoration = 'none';
                a.onclick = (e) => { e.preventDefault(); window.open(urlTemplate.replace(/\{\{smiles\}\}/gi, encodeURIComponent(targetSmiles)), '_blank'); };
            };
            makeWebLink("PubChem", this.plugin.settings.contextUrl1);
            makeWebLink("MolPort", this.plugin.settings.contextUrl2);
            makeWebLink("NMRium", this.plugin.settings.contextUrl3);
        }

        // 🕸️ WIDGET: NETWORK (AUTO-RUN WITH THREAD YIELDING)
        if (this.widgetContents['network']) {
            const body = this.widgetContents['network'];
            if (isEln && chemData.data) {
                body.empty();
                body.createDiv({ text: "Scanning pathway... ⏳" }).setCssStyles({ fontSize: "11px", color: "var(--text-muted)", textAlign: "center" });
                
                // Track the current file to prevent race conditions if user clicks away fast
                const currentFilePath = file.path;
                
                // Yield thread to let the rest of Obsidian UI update instantly
                window.setTimeout(async () => {
                    // Abort if user clicked another file while we were waiting
                    if (this.app.workspace.getActiveFile()?.path !== currentFilePath) return;
                    
                    try {
                        const connections = await this.buildFullSequence(file, chemData.data);
                        
                        // Abort if user clicked away during the async parse
                        if (this.app.workspace.getActiveFile()?.path !== currentFilePath) return;
                        
                        this.renderVerticalSequenceMap(body, connections.sequence, connections.samestep, file, chemData.data);
                    } catch (e) {
                        if (this.app.workspace.getActiveFile()?.path === currentFilePath) {
                            body.empty();
                            body.createDiv({ text: "Error scanning map." }).setCssStyles({ textAlign: "center", color: "var(--text-error)", fontSize: "11px" });
                        }
                    }
                }, 150); 
            } else {
                body.empty();
                body.createDiv({ text: "Requires an ELN experiment block." }).setCssStyles({ padding: "10px", textAlign: "center", color: "var(--text-muted)", fontSize: "11px", fontStyle: "italic" });
            }
        }
    }

    // ========================================================================
    // FAST SEQUENCE ENGINE (Fortified & Directory Constrained)
    // ========================================================================
    
    // OPTIMIZED: Only checks files inside the ELN directory, or falls back to fast cache check
    private getElnFiles(): TFile[] {
        const elnDir = this.plugin.settings.elnDirectory;
        return this.app.vault.getMarkdownFiles().filter(f => {
            if (elnDir && !f.path.startsWith(elnDir)) return false;
            const cache = this.app.metadataCache.getFileCache(f);
            if (!cache) return false;
            
            const fmTags = cache.frontmatter?.tags || [];
            const hasFmTag = Array.isArray(fmTags) ? fmTags.includes('experiment') : fmTags === 'experiment';
            const hasInlineTag = cache.tags?.some(t => t.tag.toLowerCase().includes('experiment'));
            return hasFmTag || hasInlineTag || (elnDir && f.path.startsWith(elnDir));
        });
    }

    // OPTIMIZED: Only checks frontmatter cache, NO file reads!
    private getInventoryFiles(): TFile[] {
        return this.app.vault.getMarkdownFiles().filter(f => {
            const cache = this.app.metadataCache.getFileCache(f);
            if (!cache) return false;
            const fmTags = cache.frontmatter?.tags || [];
            const hasFmTag = Array.isArray(fmTags) ? fmTags.includes('inventory') : fmTags === 'inventory';
            const hasInlineTag = cache.tags?.some(t => t.tag.toLowerCase().includes('inventory'));
            const inFolder = f.path.toLowerCase().includes('/inventory/') || f.path.toLowerCase().startsWith('inventory/');
            return hasFmTag || hasInlineTag || inFolder;
        });
    }

    async buildFullSequence(currentFile: TFile, currentExpData: any) {
        const files = this.getElnFiles();
        const allExp: any[] = [];
        const normalize = (s: string) => s?.split(' |')[0].trim() || "";
        const { parseYaml } = require('obsidian');

        for (const f of files) {
            // Fast skip the current file, we already have its data parsed
            if (f.path === currentFile.path) continue;

            const content = await this.app.vault.cachedRead(f);
            const elnMatch = content.match(/```eln\s*\n([\s\S]*?)\n```/);
            if (!elnMatch) continue;

            try {
                // Ultra-lightweight string cleaning before parsing
                const safeSource = elnMatch[1].replace(/smiles:\s*(.*)$/gm, (m:any, p1:string) => {
                    let s = p1.trim(); if (!s) return m;
                    const cMatch = s.match(/(\s+#.*)$/); if (cMatch) s = s.substring(0, s.length - cMatch[1].length).trim();
                    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.substring(1, s.length - 1);
                    return `smiles: '${s.replace(/\\"/g, '"').replace(/'/g, "''")}'`;
                });
                
                const data = parseYaml(safeSource);
                const limitingR = normalize(data.reactants?.find((r:any)=>r.is_limiting)?.smiles || data.reactants?.[0]?.smiles);
                const mainP = normalize(data.products?.[0]?.smiles);
                
                if (limitingR || mainP) {
                    allExp.push({ 
                        file: f, 
                        code: data.code || f.basename, 
                        rSmi: limitingR, 
                        pSmi: mainP, 
                        yieldNum: parseFloat(data.products?.[0]?.yield) || 0, 
                        yieldStr: data.products?.[0]?.yield ? `${data.products[0].yield}%` : '-' 
                    });
                }
            } catch(e) {}
        }

        // Add current file to the pool
        const rSmi = normalize(currentExpData?.reactants?.find((r:any)=>r.is_limiting)?.smiles || currentExpData?.reactants?.[0]?.smiles);
        const pSmi = normalize(currentExpData?.products?.[0]?.smiles);
        const currentExp = { 
            file: currentFile, 
            code: currentExpData?.code || currentFile.basename, 
            rSmi, 
            pSmi, 
            yieldStr: currentExpData?.products?.[0]?.yield ? `${currentExpData.products[0].yield}%` : '-', 
            yieldNum: parseFloat(currentExpData?.products?.[0]?.yield) || 0 
        };
        allExp.push(currentExp);

        const upstream: any[] = []; let curr = currentExp;
        while (curr && curr.rSmi) {
            const parents = allExp.filter(e => e.pSmi === curr.rSmi && e.file.path !== curr.file.path);
            if (parents.length === 0) break;
            parents.sort((a,b) => b.yieldNum - a.yieldNum); 
            const bestParent = parents[0];
            if (upstream.find(e => e.file.path === bestParent.file.path)) break; 
            upstream.push(bestParent); curr = bestParent;
        }

        const downstream: any[] = []; curr = currentExp;
        while (curr && curr.pSmi) {
            const children = allExp.filter(e => e.rSmi === curr.pSmi && e.file.path !== curr.file.path);
            if (children.length === 0) break;
            children.sort((a,b) => b.yieldNum - a.yieldNum); 
            const bestChild = children[0];
            if (downstream.find(e => e.file.path === bestChild.file.path)) break;
            downstream.push(bestChild); curr = bestChild;
        }

        const sequence = [...upstream.reverse(), currentExp, ...downstream];
        const samestep = allExp.filter(e => e.rSmi === currentExp.rSmi && e.pSmi === currentExp.pSmi && e.file.path !== currentFile.path);
        samestep.sort((a,b) => b.yieldNum - a.yieldNum);

        return { sequence, samestep };
    }

    private renderVerticalSequenceMap(container: HTMLElement, sequence: any[], samestep: any[], currentFile: TFile, currentExpData: any) {
        container.empty();
        container.createDiv({ text: `${sequence.length} Step Sequence` }).setCssStyles({ fontSize: "11px", fontWeight: "bold", color: "var(--text-muted)", textAlign: "center", marginBottom: "10px" });

        const mapWrapper = container.createDiv();
        mapWrapper.setCssStyles({ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" });
        
        const drawArrowDown = (parent: HTMLElement) => {
            const arr = parent.createDiv();
            arr.setCssStyles({ display: "flex", flexDirection: "column", alignItems: "center", margin: "2px 0" });
            arr.createDiv().setCssStyles({ height: "15px", width: "2px", background: "var(--background-modifier-border)" });
            arr.createDiv().setCssStyles({ width: "0", height: "0", borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: "6px solid var(--background-modifier-border)" });
        };

        if (sequence.length === 1 && sequence[0].file.path === currentFile.path) {
            const reactantSmi = currentExpData.reactants?.find((r:any)=>r.is_limiting)?.smiles || currentExpData.reactants?.[0]?.smiles;
            if (reactantSmi) {
                const rNode = mapWrapper.createDiv();
                rNode.setCssStyles({ width: "110px", background: "var(--background-primary)", border: "1px solid var(--background-modifier-border)", borderRadius: "8px", padding: "5px", display: "flex", flexDirection: "column", alignItems: "center" });
                rNode.createDiv({ text: "Starting Material" }).setCssStyles({ fontSize: "9px", fontWeight: "bold", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: "100%", textAlign: "center" });
                
                const rPrev = rNode.createDiv();
                rPrev.setCssStyles({ width: "90px", height: "60px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--background-secondary)", borderRadius: "4px" });
                rPrev.createSpan({ text: "⏳" });
                
                window.requestAnimationFrame(async () => {
                    const rEl = await this.plugin.api.renderStructure(reactantSmi, 90, 60);
                    rPrev.empty();
                    if (rEl) { rEl.setCssStyles({ maxWidth: '100%', maxHeight: '100%' }); rPrev.appendChild(rEl); } 
                    else rPrev.createSpan({ text: "❌" });
                });
                drawArrowDown(mapWrapper);
            }
        }

        sequence.forEach((exp, index) => {
            const isActive = exp.file.path === currentFile.path;
            const borderColor = isActive ? "var(--interactive-accent)" : "var(--background-modifier-border)";
            const bgColor = isActive ? "var(--background-primary-alt)" : "var(--background-primary)";
            const shadow = isActive ? "0 4px 12px rgba(22, 119, 130, 0.15)" : "0 1px 3px rgba(0,0,0,0.02)";

            const node = mapWrapper.createDiv();
            node.setCssStyles({ width: "140px", background: bgColor, border: `2px solid ${borderColor}`, borderRadius: "8px", padding: "8px", display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", transition: "transform 0.2s", boxShadow: shadow });
            
            const nHeader = node.createDiv();
            nHeader.setCssStyles({ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: "6px", alignItems: "center" });
            
            if (isActive) { 
                nHeader.createDiv({ text: `Step ${index + 1} (Current)` }).setCssStyles({ fontSize: "9px", fontWeight: "bold", color: "var(--interactive-accent)", textTransform: "uppercase" }); 
            } else { 
                nHeader.createDiv({ text: `Step ${index + 1}` }).setCssStyles({ fontSize: "9px", fontWeight: "bold", color: "var(--text-muted)", textTransform: "uppercase" }); 
            }

            const subHeader = node.createDiv();
            subHeader.setCssStyles({ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: "4px" });
            subHeader.createDiv({ text: exp.code }).setCssStyles({ fontSize: "11px", fontWeight: "bold", color: "var(--text-normal)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
            
            if (exp.yieldStr && exp.yieldStr !== '-') {
                subHeader.createDiv({ text: exp.yieldStr }).setCssStyles({ fontSize: "10px", fontWeight: "bold", color: "var(--text-success)" });
            }

            const preview = node.createDiv();
            preview.setCssStyles({ width: "120px", height: "80px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--background-secondary)", borderRadius: "4px", border: "1px solid var(--background-modifier-border)" });
            preview.createSpan({ text: "⏳" });

            window.requestAnimationFrame(async () => {
                const renderEl = await this.plugin.api.renderStructure(exp.pSmi, 120, 80);
                preview.empty();
                if (renderEl) { renderEl.setCssStyles({ maxWidth: '100%', maxHeight: '100%' }); preview.appendChild(renderEl); } 
                else preview.createSpan({ text: "❌" });
            });

            node.onmouseover = () => node.style.transform = "scale(1.03)";
            node.onmouseout = () => node.style.transform = "scale(1)";
            node.onclick = () => { if (!isActive) this.app.workspace.getLeaf(false).openFile(exp.file); };

            if (index < sequence.length - 1) drawArrowDown(mapWrapper);
        });

        if (samestep.length > 0) {
            const ssHeader = container.createDiv({ text: `🔄 Optimization Variants (${samestep.length})` });
            ssHeader.setCssStyles({ marginTop: "25px", borderTop: "1px dashed var(--background-modifier-border)", paddingTop: "15px", fontSize: "11px", color: "var(--text-muted)", fontWeight: "bold" });
            
            const variantList = container.createDiv();
            variantList.setCssStyles({ display: "flex", flexDirection: "column", gap: "4px", marginTop: "8px" });
            
            samestep.forEach((item: any) => {
                const row = variantList.createDiv();
                row.setCssStyles({ display: "flex", justifyContent: "space-between", padding: "6px 10px", background: "var(--background-primary)", border: "1px solid var(--background-modifier-border)", borderRadius: "6px", cursor: "pointer", transition: "0.2s", fontSize: "11px" });
                
                row.createEl("span", { text: item.code }).setCssStyles({ fontWeight: "600", color: "var(--text-normal)" });
                row.createEl("span", { text: item.yieldStr }).setCssStyles({ fontWeight: "bold", color: "var(--text-success)" });
                
                row.onmouseover = () => { row.style.borderColor = "var(--interactive-accent)"; row.style.transform = "translateX(2px)"; };
                row.onmouseout = () => { row.style.borderColor = "var(--background-modifier-border)"; row.style.transform = "translateX(0)"; };
                row.onclick = () => this.app.workspace.getLeaf(false).openFile(item.file);
            });
        }
    }

    // ========================================================================
    // TAB: PROJECTS (Optimized for Directory)
    // ========================================================================
    private async renderProjectsTab() {
        const treeContainer = this.contentArea.createDiv();
        treeContainer.setCssStyles({ display: "flex", flexDirection: "column", gap: "10px", overflowY: "auto" });

        const files = this.getElnFiles();
        const projects = new Map<string, TFile[]>();

        for (const file of files) {
            let projName = "Unassigned";
            const fileContent = await this.app.vault.cachedRead(file);
            const pMatch = fileContent.match(/project:\s*(.+)/);
            if (pMatch && pMatch[1].trim()) projName = pMatch[1].trim();

            if (!projects.has(projName)) projects.set(projName, []);
            projects.get(projName)!.push(file);
        }

        if (projects.size === 0) {
            const noProj = treeContainer.createDiv({ text: "No ELN experiments found in your ELN Directory setting." });
            noProj.setCssStyles({ color: "var(--text-muted)", fontSize: "12px", fontStyle: "italic", padding: "20px", border: "1px dashed var(--background-modifier-border)", borderRadius: "8px", textAlign: "center" });
            return;
        }

        const sortedProjects = Array.from(projects.keys()).sort((a,b) => a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b));

        for (const proj of sortedProjects) {
            const expList = projects.get(proj)!;
            const projWrapper = treeContainer.createDiv();
            projWrapper.setCssStyles({ border: "1px solid var(--background-modifier-border)", borderRadius: "6px", background: "var(--background-primary)", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" });
            
            const projHeader = projWrapper.createDiv();
            projHeader.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "var(--background-secondary)", cursor: "pointer" });
            projHeader.createDiv({ text: `📁 ${proj}` }).setCssStyles({ fontSize: "13px", fontWeight: "bold", color: "var(--text-normal)" });
            
            const projTools = projHeader.createDiv();
            projTools.setCssStyles({ display: "flex", gap: "5px" });
            const mapBtn = projTools.createEl("button", { text: "🗺️ Map", attr: { title: "Generate Synthesis Map" } });
            mapBtn.setCssStyles({ padding: "2px 6px", height: "20px", fontSize: "10px", background: "transparent", border: "1px solid var(--background-modifier-border)", boxShadow: "none" });
            
            const listContainer = projWrapper.createDiv();
            listContainer.setCssStyles({ display: "none", flexDirection: "column", padding: "5px", borderTop: "1px solid var(--background-modifier-border)" });
            
            projHeader.onclick = (e) => {
                if ((e.target as HTMLElement).tagName.toLowerCase() === 'button') return;
                listContainer.style.display = listContainer.style.display === 'none' ? 'flex' : 'none';
            };

            mapBtn.onclick = async () => {
                const safeName = proj === "Unassigned" ? "All" : proj.replace(/[\\/:"*?<>|]/g, '_');
                const filePath = `${this.plugin.settings.elnDirectory || ''}/${safeName}_Dashboard.md`.replace(/^\//, '');
                
                if (this.app.vault.getAbstractFileByPath(filePath)) {
                    new Notice(`Dashboard already exists at ${filePath}`);
                    this.app.workspace.getLeaf(false).openFile(this.app.vault.getAbstractFileByPath(filePath) as TFile);
                    return;
                }
                const content = `---\ntags: [dashboard]\n---\n# ${proj} - Synthesis Dashboard\n\n\`\`\`synthesis-map\npath: ${this.plugin.settings.elnDirectory || ''}\nproject: ${proj === "Unassigned" ? "" : proj}\n\`\`\`\n`;
                const newFile = await this.app.vault.create(filePath, content);
                this.app.workspace.getLeaf(false).openFile(newFile);
            };

            expList.sort((a,b) => a.basename.localeCompare(b.basename)).forEach(f => {
                const item = listContainer.createDiv({ text: `📄 ${f.basename}` });
                item.setCssStyles({ padding: "4px 8px", fontSize: "12px", color: "var(--text-muted)", cursor: "pointer", borderRadius: "4px" });
                item.onmouseover = () => item.style.backgroundColor = "var(--background-modifier-hover)";
                item.onmouseout = () => item.style.backgroundColor = "transparent";
                item.onclick = () => this.app.workspace.getLeaf(false).openFile(f);
            });
        }
    }

    // ========================================================================
    // TAB: LIBRARY (Optimized Single File Read)
    // ========================================================================
    private async renderLibraryTab() {
        const header = this.contentArea.createDiv();
        header.setCssStyles({ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "10px" });
        
        const topActions = header.createDiv();
        topActions.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center" });
        topActions.createEl("span", { text: "Search or Edit Library:" }).setCssStyles({ fontSize: "11px", color: "var(--text-muted)", fontWeight: "bold" });
        
        const editLibBtn = topActions.createEl("button", { text: "📝 Edit File" });
        editLibBtn.setCssStyles({ fontSize: "11px", padding: "4px 8px", borderRadius: "4px", height: "24px" });
        editLibBtn.onclick = () => {
            const libPath = this.plugin.settings?.libraryFilePath;
            if (!libPath) { new Notice("Library file path not set in settings."); return; }
            const file = this.app.vault.getAbstractFileByPath(libPath);
            if (file instanceof TFile) this.app.workspace.getLeaf(false).openFile(file);
            else new Notice("Library file not found.");
        };

        const searchInp = header.createEl("input", { type: "search", placeholder: "Search reagents..." });
        searchInp.setCssStyles({ width: "100%", fontSize: "12px", padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--background-modifier-border)" });
        
        const grid = this.contentArea.createDiv();
        grid.setCssStyles({ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "15px", paddingBottom: "20px" });
        
        const loadingMsg = grid.createDiv({ text: "Loading..." });
        loadingMsg.setCssStyles({ color: "var(--text-muted)", fontSize: "12px", textAlign: "center", gridColumn: "1/-1" });
        
        const lib = await getCompoundLibrary(this.plugin);
        grid.empty();
        const cards: { el: HTMLElement, text: string }[] = [];

        lib.forEach(c => {
            const card = grid.createDiv();
            card.setCssStyles({ background: "var(--background-secondary)", border: "1px solid var(--background-modifier-border)", borderRadius: "8px", padding: "8px", display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", transition: "transform 0.2s, border-color 0.2s", boxShadow: "0 2px 6px rgba(0,0,0,0.02)", position: "relative" });
            
            const trashBtn = card.createEl("button", { text: "🗑️", attr: { title: "Remove from Library" } });
            trashBtn.setCssStyles({ position: "absolute", top: "4px", right: "4px", background: "var(--background-secondary-alt)", border: "1px solid var(--background-modifier-border)", borderRadius: "4px", padding: "2px 4px", fontSize: "10px", display: "none" });
            
            card.onmouseover = () => { card.style.borderColor = "var(--interactive-accent)"; card.style.transform = "translateY(-2px)"; trashBtn.style.display = "block"; };
            card.onmouseout = () => { card.style.borderColor = "var(--background-modifier-border)"; card.style.transform = "translateY(0)"; trashBtn.style.display = "none"; };
            
            trashBtn.onclick = async (e) => {
                e.stopPropagation();
                const path = this.plugin.settings?.libraryFilePath;
                const file = this.app.vault.getAbstractFileByPath(path);
                if (file instanceof TFile) {
                    const content = await this.app.vault.read(file);
                    const lines = content.split('\n');
                    const newLines = lines.filter(l => !(l.includes(c.smiles) && l.includes(c.name)));
                    await this.app.vault.modify(file, newLines.join('\n'));
                    new Notice(`Removed ${c.name}`);
                    void this.renderActiveTab();
                }
            };

            const preview = card.createDiv();
            preview.setCssStyles({ width: "100px", height: "80px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--background-primary)", borderRadius: "4px" });
            preview.createSpan({ text: "⏳" });
            
            window.requestAnimationFrame(async () => {
                const el = await this.plugin.api.renderStructure(c.smiles, 100, 80);
                preview.empty();
                if(el) { el.style.maxWidth='100%'; el.style.maxHeight='100%'; preview.appendChild(el); } else preview.createSpan({ text: "❌" });
            });

            const cardTitle = card.createDiv({ text: c.name, attr: { title: c.name } });
            cardTitle.setCssStyles({ fontSize: "11px", fontWeight: "600", textAlign: "center", marginTop: "8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%", color: "var(--text-normal)" });
            card.onclick = () => { void navigator.clipboard.writeText(c.smiles); new Notice(`Copied ${c.name} SMILES!`); };

            cards.push({ el: card, text: `${c.name} ${c.smiles}`.toLowerCase() });
        });

        if (cards.length === 0) {
            const emptyMsg = grid.createSpan({ text: "Library empty." });
            emptyMsg.setCssStyles({ color: "var(--text-muted)", fontSize: "12px", fontStyle: "italic", gridColumn: "1/-1", textAlign: "center" });
        }

        searchInp.addEventListener('input', (e: any) => {
            const query = e.target.value.toLowerCase();
            cards.forEach(c => { c.el.style.display = c.text.includes(query) ? "flex" : "none"; });
        });
    }

    // ========================================================================
    // TAB: INVENTORY (Optimized Memory Cache Only)
    // ========================================================================
    private async renderInventoryTab() {
        const header = this.contentArea.createDiv();
        header.setCssStyles({ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "10px" });
        const searchInp = header.createEl("input", { type: "search", placeholder: "Search stock (name, location, CAS)..." });
        searchInp.setCssStyles({ width: "100%", fontSize: "12px", padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--background-modifier-border)" });
        
        const list = this.contentArea.createDiv();
        list.setCssStyles({ display: "flex", flexDirection: "column", gap: "8px" });
        const invFiles = this.getInventoryFiles();

        // Optimized rendering relies completely on frontmatter, NO cachedRead()
        const renderList = (query: string) => {
            list.empty();
            let count = 0;
            for (const f of invFiles) {
                const cache = this.app.metadataCache.getFileCache(f);
                const fm = cache?.frontmatter;
                const name = fm?.name || f.basename;
                const loc = fm?.location || "Unknown Location";
                const amt = fm?.amount || "-";
                const cas = fm?.cas || "";
                
                const searchStr = `${name} ${loc} ${cas}`.toLowerCase();
                if (query && !searchStr.includes(query)) continue;
                if (count > 100) break; // Limit rendering for speed
                count++;

                const item = list.createDiv();
                item.setCssStyles({ display: "flex", flexDirection: "column", padding: "10px", background: "var(--background-secondary)", border: "1px solid var(--background-modifier-border)", borderRadius: "6px", cursor: "pointer", fontSize: "11px", transition: "0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" });
                item.onmouseover = () => item.style.borderColor = "var(--interactive-accent)";
                item.onmouseout = () => item.style.borderColor = "var(--background-modifier-border)";
                item.onclick = () => this.app.workspace.getLeaf(false).openFile(f);
                
                item.createDiv({ text: name }).setCssStyles({ fontWeight: "700", fontSize: "13px", color: "var(--text-accent)", marginBottom: "4px" });
                
                const metaRow = item.createDiv();
                metaRow.setCssStyles({ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--text-muted)" });
                metaRow.createSpan({ text: `📍 ${loc}` });
                metaRow.createSpan({ text: `⚖️ ${amt}` }).setCssStyles({ fontWeight: "bold", color: "var(--text-normal)" });
            }
            if (count === 0) {
                const noInv = list.createSpan({ text: "No inventory found. Create notes inside an Inventory folder or add `tags: [inventory]`." });
                noInv.setCssStyles({ color: "var(--text-muted)", fontSize: "12px", fontStyle: "italic" });
            }
        };

        searchInp.oninput = (e: any) => renderList(e.target.value.toLowerCase());
        renderList("");
    }

    // ========================================================================
    // TAB: SEARCH (Vault Text & Structure Search - FIX: ALL FILES)
    // ========================================================================
    private async renderSearchTab() {
        const header = this.contentArea.createDiv();
        header.setCssStyles({ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "10px" });
        const textInp = header.createEl("input", { type: "search", placeholder: "Search the ENTIRE vault..." });
        textInp.setCssStyles({ width: "100%", fontSize: "12px", padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--background-modifier-border)" });
        
        // REPLACED SUBSTRUCTURE SEARCH WITH FULL-WIDTH EXACT MATCH
        const exactBtn = header.createEl("button", { text: "⬡ Structure Match (Entire Vault)", cls: "mod-cta" });
        exactBtn.setCssStyles({ width: "100%", height: "32px", fontSize: "11px" });
        
        const resultsDiv = this.contentArea.createDiv();
        resultsDiv.setCssStyles({ display: "flex", flexDirection: "column", gap: "6px", overflowY: "auto", paddingBottom: "20px" });

        const performSearch = async (mode: 'text'|'exact', query: string) => {
            resultsDiv.empty();
            const loadingSpan = resultsDiv.createDiv();
            loadingSpan.setCssStyles({ textAlign: "center", fontSize: "12px", color: "var(--text-accent)", marginTop: "20px" });
            loadingSpan.createSpan({ text: "Scanning entire vault... ⏳" });
            loadingSpan.createEl("br");
            loadingSpan.createSpan({ text: "(Large vaults may take a few seconds)" }).setCssStyles({ fontSize: "10px", color: "var(--text-muted)" });
            
            // FIX: ALWAYS SEARCH ALL MARKDOWN FILES
            const files = this.app.vault.getMarkdownFiles();
            const matches: any[] = [];
            
            for (const f of files) {
                const chemData = await this.extractChemistryFromNote(f);
                if (!chemData) continue;

                let isMatch = false;

                if (mode === 'text') {
                    const searchStr = `${f.basename} ${chemData.name} ${chemData.smilesList.join(' ')}`.toLowerCase();
                    if (searchStr.includes(query.toLowerCase())) isMatch = true;
                } else if (mode === 'exact') {
                    const queryCanonical = this.plugin.api.data.molToSmiles(query) || query;
                    for (const s of chemData.smilesList) {
                         if (s.includes(query) || (this.plugin.api.data.molToSmiles(s) === queryCanonical && queryCanonical !== "")) {
                             isMatch = true; break;
                         }
                    }
                }

                if (isMatch) matches.push({ file: f, name: chemData.name, type: chemData.type });
            }

            resultsDiv.empty();
            if (matches.length === 0) {
                const noMatch = resultsDiv.createDiv({ text: "No matches found." });
                noMatch.setCssStyles({ textAlign: "center", fontSize: "12px", color: "var(--text-muted)", marginTop: "20px" });
            } else {
                const matchHeader = resultsDiv.createDiv({ text: `Found ${matches.length} matching notes:` });
                matchHeader.setCssStyles({ fontSize: "11px", fontWeight: "bold", color: "var(--text-success)", marginBottom: "8px" });
                
                matches.forEach(m => {
                    const item = resultsDiv.createDiv();
                    item.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px", background: "var(--background-secondary)", border: "1px solid var(--background-modifier-border)", borderRadius: "6px", cursor: "pointer", transition: "0.2s" });
                    
                    const nameSpan = item.createSpan({ text: m.name });
                    nameSpan.setCssStyles({ fontWeight: "600", fontSize: "12px", color: "var(--text-normal)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "160px" });
                    
                    const badgeColor = m.type === 'eln' ? 'var(--text-accent)' : m.type === 'inventory' ? 'var(--text-warning)' : 'var(--text-muted)';
                    const typeSpan = item.createSpan({ text: m.type.toUpperCase() });
                    typeSpan.setCssStyles({ color: badgeColor, fontSize: "9px", fontWeight: "bold", padding: "2px 6px", borderRadius: "4px", border: "1px solid var(--background-modifier-border)", background: "var(--background-primary)" });
                    
                    item.onmouseover = () => item.style.borderColor = "var(--interactive-accent)";
                    item.onmouseout = () => item.style.borderColor = "var(--background-modifier-border)";
                    item.onclick = () => this.app.workspace.getLeaf(false).openFile(m.file);
                });
            }
        };

        textInp.onkeydown = (e) => { if (e.key === 'Enter' && textInp.value.trim()) void performSearch('text', textInp.value.trim()); };
        exactBtn.onclick = () => { this.plugin.api.ketcher.openEditor("", "smiles", (q: string) => { if (q) void performSearch('exact', q); }); };
    }

    // ========================================================================
    // TAB: TOOLS (Utilities)
    // ========================================================================
    private async renderToolsTab() {
        const header1 = this.contentArea.createEl("h4", { text: "🛠️ Map Generators" });
        header1.setCssStyles({ margin: "0 0 10px 0", fontSize: "14px", color: "var(--text-normal)" });
        
        const mapBox = this.contentArea.createDiv();
        mapBox.setCssStyles({ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "15px" });
        
        const genPlanBtn = mapBox.createEl("button", { text: "🎯 Create New Synthesis Plan", cls: "mod-cta" });
        genPlanBtn.setCssStyles({ width: "100%", height: "28px", fontSize: "12px" });
        genPlanBtn.onclick = async () => {
            const file = await this.app.vault.create(`Synthesis Plan ${window.moment().format("HHmmss")}.md`, `---\ntags: [dashboard]\n---\n# New Synthesis Plan\n\n\`\`\`synthesis-plan\n\n\`\`\`\n`);
            this.app.workspace.getLeaf(false).openFile(file);
        };

        const genMapBtn = mapBox.createEl("button", { text: "🗺️ Create Folder Map Dashboard" });
        genMapBtn.setCssStyles({ width: "100%", height: "28px", fontSize: "12px" });
        genMapBtn.onclick = async () => {
            const folder = this.plugin.settings.elnDirectory || "";
            const file = await this.app.vault.create(`Synthesis Map ${window.moment().format("HHmmss")}.md`, `---\ntags: [dashboard]\n---\n# Synthesis Map\n\n\`\`\`synthesis-map\npath: ${folder}\n\`\`\`\n`);
            this.app.workspace.getLeaf(false).openFile(file);
        };

        const header2 = this.contentArea.createEl("h4", { text: "🧮 Calculators" });
        header2.setCssStyles({ margin: "10px 0", fontSize: "14px", color: "var(--text-normal)" });

        // 1. Name to Structure Resolver
        const resolverBox = this.contentArea.createDiv();
        resolverBox.setCssStyles({ background: "var(--background-secondary)", border: "1px solid var(--background-modifier-border)", borderRadius: "8px", padding: "12px", marginBottom: "10px" });
        
        const rTitle = resolverBox.createDiv({ text: "Name to Structure (Web)" });
        rTitle.setCssStyles({ fontWeight: "700", fontSize: "12px", marginBottom: "8px", color: "var(--text-accent)" });
        
        const nameInp = resolverBox.createEl("input", { type: "text", placeholder: "e.g. Aspirin" });
        nameInp.setCssStyles({ width: "100%", fontSize: "12px", padding: "6px", borderRadius: "4px", border: "1px solid var(--background-modifier-border)", marginBottom: "8px" });
        
        const resolveBtn = resolverBox.createEl("button", { text: "Search" });
        resolveBtn.setCssStyles({ width: "100%", height: "26px", fontSize: "11px" });
        
        const resolveRes = resolverBox.createDiv();
        resolveRes.setCssStyles({ marginTop: "10px", display: "none", flexDirection: "column", gap: "6px" });
        
        resolveBtn.onclick = async () => {
            const name = nameInp.value.trim();
            if (!name) return;
            resolveBtn.innerText = "Searching...";
            try {
                let smi = "";
                const fetcher = async (url: string) => { const r = await requestUrl(url); return r.status === 200 ? r : null; };

                // 1. Try OPSIN (Fastest for IUPAC)
                try { const res = await fetcher(`https://opsin.ch.cam.ac.uk/opsin/${encodeURIComponent(name)}.smi`); if(res) smi = res.text.trim(); } catch(e){}
                // 2. Try Cactus
                if (!smi) { try { const res = await fetcher(`https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(name)}/smiles`); if(res) smi = res.text.trim(); } catch(e){} }
                // 3. Try Pubchem
                if (!smi) { try { const res = await fetcher(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/property/IsomericSMILES/JSON`); if(res) smi = res.json.PropertyTable.Properties[0].IsomericSMILES; } catch(e){} }

                if (smi) {
                    resolveRes.style.display = "flex";
                    resolveRes.empty();
                    
                    const preview = resolveRes.createDiv();
                    preview.setCssStyles({ width: "100%", height: "120px", background: "var(--background-primary)", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "inset 0 0 4px rgba(0,0,0,0.05)" });
                    window.requestAnimationFrame(async () => {
                        const el = await this.plugin.api.renderStructure(smi, 200, 100);
                        if (el) { el.style.maxWidth='100%'; el.style.maxHeight='100%'; preview.appendChild(el); }
                    });

                    const btns = resolveRes.createDiv();
                    btns.setCssStyles({ display: "flex", gap: "8px" });
                    
                    const cpyBtn = btns.createEl("button", { text: "📋 Copy SMILES" });
                    cpyBtn.setCssStyles({ flex: "1", height: "24px", fontSize: "10px" });
                    cpyBtn.onclick = () => { void navigator.clipboard.writeText(smi); new Notice("Copied!"); };
                    
                    const addBtn = btns.createEl("button", { text: "📚 Add to Lib" });
                    addBtn.setCssStyles({ flex: "1", height: "24px", fontSize: "10px" });
                    addBtn.onclick = () => { void this.plugin.api.library.addCompound(name, smi); };
                } else { new Notice("Not found."); }
            } catch(e) { new Notice("Search failed."); }
            resolveBtn.innerText = "Search";
        };

        nameInp.onkeydown = (e) => { if(e.key === 'Enter') resolveBtn.click(); };

        // 2. Offline Calculator
        const calcBox = this.contentArea.createDiv();
        calcBox.setCssStyles({ background: "var(--background-secondary)", border: "1px solid var(--background-modifier-border)", borderRadius: "8px", padding: "12px" });
        
        const cTitle = calcBox.createDiv({ text: "Quick Calculator (Offline)" });
        cTitle.setCssStyles({ fontWeight: "700", fontSize: "12px", marginBottom: "8px", color: "var(--text-accent)" });
        
        const smiInp = calcBox.createEl("input", { type: "text", placeholder: "Paste SMILES here..." });
        smiInp.setCssStyles({ width: "100%", fontSize: "12px", padding: "6px", borderRadius: "4px", border: "1px solid var(--background-modifier-border)", marginBottom: "8px" });
        
        const calcRes = calcBox.createDiv();
        calcRes.setCssStyles({ fontSize: "11px", color: "var(--text-normal)", display: "flex", flexDirection: "column", gap: "4px" });

        smiInp.oninput = async () => {
            const smi = smiInp.value.trim();
            calcRes.empty();
            if (!smi) return;
            
            calcRes.createSpan({ text: "Calculating..." }).setCssStyles({ color: "var(--text-muted)" });
            
            // Wait slightly for Ketcher Normalizer fallback to work
            const mwProps = await calculateMwOffline(smi, this.plugin);
            const oclProps = ChemDataEngine.getPropertiesFromSmiles(smi.split(' |')[0].trim());

            calcRes.empty();
            if (mwProps && mwProps.mw > 0) {
                const r1 = calcRes.createDiv(); r1.setCssStyles({ display: "flex", justifyContent: "space-between" });
                r1.createSpan({ text: "Formula:" }).setCssStyles({ color: "var(--text-muted)" }); r1.createEl("b", { text: mwProps.formula });
                
                const r2 = calcRes.createDiv(); r2.setCssStyles({ display: "flex", justifyContent: "space-between" });
                r2.createSpan({ text: "Exact Mass:" }).setCssStyles({ color: "var(--text-muted)" }); r2.createEl("b", { text: mwProps.mw.toFixed(3) });

                if (oclProps && oclProps.logp) {
                    const r3 = calcRes.createDiv(); r3.setCssStyles({ display: "flex", justifyContent: "space-between" });
                    r3.createSpan({ text: "LogP:" }).setCssStyles({ color: "var(--text-muted)" }); r3.createEl("b", { text: oclProps.logp.toFixed(2) });
                    
                    const r4 = calcRes.createDiv(); r4.setCssStyles({ display: "flex", justifyContent: "space-between" });
                    r4.createSpan({ text: "TPSA:" }).setCssStyles({ color: "var(--text-muted)" }); r4.createEl("b", { text: oclProps.tpsa.toFixed(2) });
                }
            } else { 
                calcRes.createSpan({ text: "Invalid SMILES" }).setCssStyles({ color: "var(--text-error)" }); 
            }
        };
    }

    // ========================================================================
    // HELPER: EXTRACT CHEMISTRY
    // ========================================================================
    private async extractChemistryFromNote(file: TFile): Promise<{name: string, type: string, smilesList: string[], data?: any} | null> {
        const content = await this.app.vault.cachedRead(file);
        const smilesList: string[] = [];
        let name = file.basename;
        let type = 'note';
        let expData: any = null;

        const elnMatch = content.match(/```eln\s*\n([\s\S]*?)\n```/);
        if (elnMatch) {
            type = 'eln';
            try {
                const { parseYaml } = require('obsidian');
                const safeSource = elnMatch[1].replace(/smiles:\s*(.*)$/gm, (m:any, p1:string) => {
                    let s = p1.trim(); if (!s) return m;
                    const cMatch = s.match(/(\s+#.*)$/); if (cMatch) s = s.substring(0, s.length - cMatch[1].length).trim();
                    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.substring(1, s.length - 1);
                    return `smiles: '${s.replace(/\\"/g, '"').replace(/'/g, "''")}'`;
                });
                expData = parseYaml(safeSource);
                if (expData.code) name = expData.code;
                if (expData.reactants) expData.reactants.forEach((r:any) => { if(r.smiles) smilesList.push(r.smiles); });
                if (expData.products) expData.products.forEach((p:any) => { if(p.smiles) smilesList.push(p.smiles); });
            } catch(e) {}
        } else {
            const smiMatch = content.match(/```smiles\s*\n([\s\S]*?)\n```/g);
            if (smiMatch) {
                type = 'smiles';
                smiMatch.forEach(block => {
                    const s = block.replace(/```smiles|```/g, '').trim();
                    if (s) smilesList.push(s);
                });
            }
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache?.frontmatter?.smiles) {
                type = cache.frontmatter.tags?.includes('inventory') ? 'inventory' : 'library';
                smilesList.push(cache.frontmatter.smiles);
            }
        }

        if (smilesList.length > 0) return { name, type, smilesList, data: expData };
        return null;
    }
}