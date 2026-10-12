// InventoryDashboard.ts

import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import type ChemEditPlugin from './main';
import { AddInventoryModal, QrCodeModal, renderLimsNav } from './SharedBase';

export const INVENTORY_DASHBOARD_VIEW_TYPE = "chem-inventory-dashboard";

interface InventoryEntry {
    file: TFile;
    name: string;
    smiles: string;
    cas: string;
    supplier: string;
    location: string;
    amount: string;
    status: string;
    checkedOutBy: string;
    lastUpdated: string;
    timestamp: number;
    rowEl?: HTMLElement;
    searchText: string;
}

export class InventoryDashboardView extends ItemView {
    plugin: ChemEditPlugin;
    
    toolbarEl: HTMLElement;
    tableBodyEl: HTMLElement;
    
    allEntries: InventoryEntry[] = [];
    currentFilter: string = 'All';
    searchQuery: string = '';

    private observer: IntersectionObserver;

    constructor(leaf: WorkspaceLeaf, plugin: ChemEditPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target as HTMLElement;
                    const smiles = el.dataset.smiles;
                    if (smiles && !el.dataset.rendered) {
                        el.dataset.rendered = "true";
                        this.plugin.api.renderStructure(smiles, 120, 100).then(renderEl => {
                            el.empty();
                            if (renderEl) {
                                renderEl.setCssStyles({ maxWidth: '100%', maxHeight: '100%' });
                                el.appendChild(renderEl);
                            } else {
                                el.createSpan({ text: "Invalid", cls: "color-text-muted" }).setCssStyles({ fontSize: "11px" });
                            }
                        });
                    }
                }
            });
        }, { root: null, rootMargin: "150px", threshold: 0.1 });
    }

    getViewType() { return INVENTORY_DASHBOARD_VIEW_TYPE; }
    getDisplayText() { return "Chemical Inventory"; }
    getIcon() { return "package"; }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('chem-inventory-dashboard-view');
        
        container.setCssStyles({ display: "flex", flexDirection: "column", padding: "0", background: "var(--background-primary)" });

        const header = container.createDiv();
        header.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "20px 30px", background: "var(--background-secondary)", borderBottom: "1px solid var(--background-modifier-border)" });
        const titleArea = header.createDiv();
        titleArea.setCssStyles({ display: "flex", flexDirection: "column" });

        renderLimsNav(titleArea, "inventory", this.plugin);

        titleArea.createEl("h2", { text: "Chemical Inventory" }).setCssStyles({ margin: "0", fontSize: "22px", fontWeight: "700", color: "var(--text-normal)" });
        titleArea.createEl("span", { text: "Track reagents, locations, and stock levels" }).setCssStyles({ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" });

        const newBtn = header.createEl("button", { text: "+ Add Item", cls: "mod-cta" });
        newBtn.setCssStyles({ height: "36px", fontSize: "14px", fontWeight: "600", padding: "0 20px" });
        newBtn.onclick = () => {
            const folder = window.localStorage.getItem('chem-inv-dir') || "Inventory";
            new AddInventoryModal(this.app, this.plugin, folder, () => {
                void this.loadInventory();
            }).open();
        };

        this.toolbarEl = container.createDiv();
        this.toolbarEl.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "15px 30px", background: "var(--background-primary)", borderBottom: "1px solid var(--background-modifier-border)" });
        
        const leftTools = this.toolbarEl.createDiv();
        leftTools.setCssStyles({ display: "flex", gap: "15px", alignItems: "center" });
        const filterTabs = leftTools.createDiv();
        filterTabs.setCssStyles({ display: "flex", gap: "8px" });
        const tabs = ['All', 'Available', 'Checked Out'];
        
        tabs.forEach(t => {
            const btn = filterTabs.createEl("button", { text: t });
            btn.setCssStyles({ borderRadius: "20px", padding: "4px 16px", fontSize: "12px", fontWeight: "600", border: `1px solid ${this.currentFilter === t ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'}`, background: this.currentFilter === t ? 'var(--interactive-accent)' : 'var(--background-primary)', color: this.currentFilter === t ? 'var(--text-on-accent)' : 'var(--text-muted)', boxShadow: "none" });
            btn.onclick = () => {
                this.currentFilter = t;
                this.renderToolbar();
                this.applyFilters();
            };
        });

        const dirWrap = leftTools.createDiv();
        dirWrap.setCssStyles({ display: "flex", alignItems: "center", gap: "6px", marginLeft: "10px" });
        dirWrap.createEl("span", { text: "📁 Folder:" }).setCssStyles({ fontSize: "11px", fontWeight: "600", color: "var(--text-muted)" });
        const dirInp = dirWrap.createEl("input", { type: "text", value: window.localStorage.getItem('chem-inv-dir') || "Inventory" });
        dirInp.setCssStyles({ width: "120px", fontSize: "12px", padding: "4px 8px", borderRadius: "4px", height: "26px", border: "1px solid var(--background-modifier-border)" });
        dirInp.onchange = (e: any) => {
            window.localStorage.setItem('chem-inv-dir', e.target.value.trim());
            void this.loadInventory();
        };

        const searchInp = this.toolbarEl.createEl("input", { type: "search", placeholder: "Search name, CAS, location..." });
        searchInp.setCssStyles({ width: "280px", fontSize: "13px", borderRadius: "6px" });
        searchInp.oninput = (e: any) => {
            this.searchQuery = e.target.value.toLowerCase();
            this.applyFilters();
        };

        const tableContainer = container.createDiv();
        tableContainer.setCssStyles({ flexGrow: "1", overflow: "auto", padding: "0 30px 30px 30px" });
        
        const table = tableContainer.createEl("table");
        table.setCssStyles({ width: "100%", borderCollapse: "separate", borderSpacing: "0", textAlign: "left", fontSize: "13px" });
        const thead = table.createEl("thead");
        thead.setCssStyles({ position: "sticky", top: "0", background: "var(--background-primary)", zIndex: "10" });
        
        const tr = thead.createEl("tr");
        const cols = [
            { name: "Structure", width: "140px" },
            { name: "Item Details", width: "250px" },
            { name: "Location & Stock", width: "150px" },
            { name: "Status", width: "120px" },
            { name: "Actions", width: "120px" }
        ];

        cols.forEach(c => {
            const th = tr.createEl("th", { text: c.name });
            th.setCssStyles({ padding: "16px 10px", borderBottom: "2px solid var(--background-modifier-border)", color: "var(--text-muted)", fontWeight: "600", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", width: c.width });
        });

        this.tableBodyEl = table.createEl("tbody");

        await this.loadInventory();
        
        let refreshTimeout: number;
        const requestRefresh = () => {
            window.clearTimeout(refreshTimeout);
            refreshTimeout = window.setTimeout(() => void this.loadInventory(), 2000);
        };

        this.registerEvent(this.app.vault.on('modify', requestRefresh));
        this.registerEvent(this.app.vault.on('create', requestRefresh));
        this.registerEvent(this.app.vault.on('delete', requestRefresh));
    }

    private renderToolbar() {
        const btns = this.toolbarEl.querySelectorAll('button');
        btns.forEach((btn: HTMLElement) => {
            const isMatch = btn.innerText === this.currentFilter;
            btn.setCssStyles({ background: isMatch ? 'var(--interactive-accent)' : 'var(--background-primary)', color: isMatch ? 'var(--text-on-accent)' : 'var(--text-muted)', borderColor: isMatch ? 'var(--interactive-accent)' : 'var(--background-modifier-border)' });
        });
    }

    private async loadInventory() {
        const targetDir = window.localStorage.getItem('chem-inv-dir') || "Inventory";
        const files = this.app.vault.getMarkdownFiles();
        const entries: InventoryEntry[] = [];

        for (const file of files) {
            const inFolder = targetDir && file.path.startsWith(targetDir);
            
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;
            const fmTags = fm?.tags || [];
            const isTagged = (Array.isArray(fmTags) ? fmTags.includes('inventory') : fmTags === 'inventory');

            if (!inFolder && !isTagged) continue;

            let smiles = fm?.smiles || "";
            
            if (!smiles) {
                const hasCodeBlock = cache?.sections?.some(s => s.type === 'code');
                if (hasCodeBlock) {
                    const content = await this.app.vault.cachedRead(file);
                    const blockMatch = content.match(/```smiles\s*\n([\s\S]*?)\n```/);
                    if (blockMatch) smiles = blockMatch[1].trim();
                }
            }

            const name = fm?.name || file.basename;
            const cas = fm?.cas || "";
            const supplier = fm?.supplier || "-";
            const location = fm?.location || "Unassigned";

            entries.push({
                file,
                name: name,
                smiles: smiles,
                cas: cas,
                supplier: supplier,
                location: location,
                amount: fm?.amount || "-",
                status: fm?.status || "Available",
                checkedOutBy: fm?.checked_out_by || "",
                lastUpdated: fm?.last_updated || "-",
                timestamp: file.stat.mtime,
                searchText: `${name} ${cas} ${supplier} ${location}`.toLowerCase()
            });
        }

        this.allEntries = entries.sort((a, b) => a.name.localeCompare(b.name));
        this.buildTableDOM();
        this.applyFilters();
    }

    private buildTableDOM() {
        this.tableBodyEl.empty();
        this.observer.disconnect();

        if (this.allEntries.length === 0) {
            const tr = this.tableBodyEl.createEl("tr");
            const td = tr.createEl("td", { text: "No inventory items found. Add items to an Inventory folder or use tags: [inventory]." });
            td.setAttribute("colspan", "5");
            td.setCssStyles({ textAlign: "center", padding: "40px", color: "var(--text-muted)", fontStyle: "italic" });
            return;
        }

        this.allEntries.forEach(e => {
            const tr = this.tableBodyEl.createEl("tr");
            tr.setCssStyles({ transition: "background 0.2s" });
            e.rowEl = tr;

            tr.onmouseover = () => tr.setCssStyles({ backgroundColor: "var(--background-secondary-alt)" });
            tr.onmouseout = () => tr.setCssStyles({ backgroundColor: "transparent" });

            const tdStruct = tr.createEl("td");
            tdStruct.setCssStyles({ padding: "10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
            const structWrap = tdStruct.createDiv();
            structWrap.setAttribute("data-smiles", e.smiles);
            structWrap.setCssStyles({ width: "120px", height: "100px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--background-primary)", border: "1px solid var(--background-modifier-border)", borderRadius: "6px", cursor: "pointer" });
            
            structWrap.onclick = () => this.app.workspace.getLeaf(false).openFile(e.file); 
            
            if (e.smiles) {
                structWrap.createSpan({ text: "⏳ Loading...", cls: "color-text-muted" }).setCssStyles({ fontSize: "11px" });
                this.observer.observe(structWrap);
            } else {
                structWrap.createSpan({ text: "No Structure", cls: "color-text-muted" }).setCssStyles({ fontSize: "11px" });
            }

            const tdDetails = tr.createEl("td");
            tdDetails.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
            const nameEl = tdDetails.createDiv({ text: e.name });
            nameEl.setCssStyles({ fontWeight: "700", color: "var(--text-accent)", fontSize: "14px", marginBottom: "6px", cursor: "pointer" });
            nameEl.onclick = () => this.app.workspace.getLeaf(false).openFile(e.file);
            
            if (e.cas) tdDetails.createDiv({ text: `CAS: ${e.cas}` }).setCssStyles({ fontSize: "11px", color: "var(--text-muted)", marginBottom: "2px" });
            tdDetails.createDiv({ text: `Supplier: ${e.supplier}` }).setCssStyles({ fontSize: "11px", color: "var(--text-muted)" });

            const tdLoc = tr.createEl("td");
            tdLoc.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
            tdLoc.createDiv({ text: `📍 ${e.location}` }).setCssStyles({ fontSize: "13px", color: "var(--text-normal)", fontWeight: "500", marginBottom: "4px" });
            tdLoc.createDiv({ text: `⚖️ ${e.amount}` }).setCssStyles({ fontSize: "12px", color: "var(--text-muted)" });

            const tdStatus = tr.createEl("td");
            tdStatus.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
            const isAvail = e.status === 'Available';
            const color = isAvail ? 'var(--text-success)' : 'var(--text-warning)';
            const border = isAvail ? 'var(--text-success)' : 'var(--text-warning)';
            
            const statSpan = tdStatus.createDiv({ text: e.status.toUpperCase() });
            statSpan.setCssStyles({ display: "inline-block", padding: "4px 10px", borderRadius: "12px", fontSize: "10px", fontWeight: "700", color: color, border: `1px solid ${border}`, background: "var(--background-primary)", marginBottom: "4px" });
            
            if (!isAvail && e.checkedOutBy) {
                tdStatus.createDiv({ text: `👤 ${e.checkedOutBy}` }).setCssStyles({ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" });
            }

            const tdActions = tr.createEl("td");
            tdActions.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
            const actContainer = tdActions.createDiv();
            actContainer.setCssStyles({ display: "flex", flexDirection: "column", gap: "6px" });
            
            const toggleBtn = actContainer.createEl("button", { text: isAvail ? "📤 Check Out" : "📥 Return" });
            toggleBtn.setCssStyles({ fontSize: "11px", padding: "4px", height: "26px", width: "100%" });
            toggleBtn.onclick = async () => {
                const newStatus = isAvail ? 'Checked Out' : 'Available';
                const user = newStatus === 'Checked Out' ? "Current User" : ""; 
                
                await this.app.fileManager.processFrontMatter(e.file, (fm: any) => { 
                    fm.status = newStatus; 
                    fm.checked_out_by = user;
                    fm.last_updated = window.moment().format("YYYY-MM-DD");
                });
                
                new Notice(`${e.name} is now ${newStatus}`);
            };

            const qrBtn = actContainer.createEl("button", { text: "🖨️ Label" });
            qrBtn.setCssStyles({ fontSize: "11px", padding: "4px", height: "26px", width: "100%" });
            qrBtn.onclick = () => {
                new QrCodeModal(this.app, e.file).open();
            };
        });
    }

    private applyFilters() {
        this.allEntries.forEach(e => {
            if (!e.rowEl) return;
            const matchFilter = this.currentFilter === 'All' || e.status === this.currentFilter;
            const matchSearch = !this.searchQuery || e.searchText.includes(this.searchQuery);
            e.rowEl.setCssStyles({ display: (matchFilter && matchSearch) ? "" : "none" });
        });
    }

    async onClose() {
        this.observer.disconnect();
    }
}