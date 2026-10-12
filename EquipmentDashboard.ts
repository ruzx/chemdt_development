// EquipmentDashboard.ts

import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import type ChemEditPlugin from './main';
import { renderLimsNav } from './SharedBase';

export const EQUIPMENT_DASHBOARD_VIEW_TYPE = "chem-equipment-dashboard";

interface EquipmentEntry {
    file: TFile;
    name: string;
    location: string;
    status: string;
    bookedBy: string;
    nextMaintenance: string;
    contact: string;
    rowEl?: HTMLElement;
    searchText: string;
}

export class EquipmentDashboardView extends ItemView {
    plugin: ChemEditPlugin;
    toolbarEl: HTMLElement;
    tableBodyEl: HTMLElement;
    allEntries: EquipmentEntry[] = [];
    currentFilter: string = 'All';
    searchQuery: string = '';

    constructor(leaf: WorkspaceLeaf, plugin: ChemEditPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return EQUIPMENT_DASHBOARD_VIEW_TYPE; }
    getDisplayText() { return "Lab Equipment"; }
    getIcon() { return "microscope"; }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('chem-equipment-dashboard-view');
        container.setCssStyles({ display: "flex", flexDirection: "column", padding: "0", background: "var(--background-primary)" });

        const header = container.createDiv();
        header.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "20px 30px", background: "var(--background-secondary)", borderBottom: "1px solid var(--background-modifier-border)" });
        const titleArea = header.createDiv();
        titleArea.setCssStyles({ display: "flex", flexDirection: "column" });

        renderLimsNav(titleArea, "equipment", this.plugin);

        titleArea.createEl("h2", { text: "Lab Equipment" }).setCssStyles({ margin: "0", fontSize: "22px", fontWeight: "700", color: "var(--text-normal)" });
        titleArea.createEl("span", { text: "Track instrument bookings, manuals, and maintenance logs" }).setCssStyles({ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" });

        const newBtn = header.createEl("button", { text: "+ Add Instrument", cls: "mod-cta" });
        newBtn.setCssStyles({ height: "36px", fontSize: "14px", fontWeight: "600", padding: "0 20px" });
        newBtn.onclick = () => void this.createNewEquipment();

        this.toolbarEl = container.createDiv();
        this.toolbarEl.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "15px 30px", background: "var(--background-primary)", borderBottom: "1px solid var(--background-modifier-border)" });
        
        const leftTools = this.toolbarEl.createDiv();
        leftTools.setCssStyles({ display: "flex", gap: "15px", alignItems: "center" });
        const filterTabs = leftTools.createDiv();
        filterTabs.setCssStyles({ display: "flex", gap: "8px" });
        const tabs = ['All', 'Available', 'In Use', 'Maintenance'];
        
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
        const dirInp = dirWrap.createEl("input", { type: "text", value: window.localStorage.getItem('chem-equip-dir') || "Equipment" });
        dirInp.setCssStyles({ width: "120px", fontSize: "12px", padding: "4px 8px", borderRadius: "4px", height: "26px", border: "1px solid var(--background-modifier-border)" });
        dirInp.onchange = (e: any) => {
            window.localStorage.setItem('chem-equip-dir', e.target.value.trim());
            void this.loadEquipment();
        };

        const searchInp = this.toolbarEl.createEl("input", { type: "search", placeholder: "Search instrument or location..." });
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
        ["Instrument", "Location", "Status", "Maintenance", "Actions"].forEach(c => {
            tr.createEl("th", { text: c }).setCssStyles({ padding: "16px 10px", borderBottom: "2px solid var(--background-modifier-border)", color: "var(--text-muted)", fontWeight: "600", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px" });
        });

        this.tableBodyEl = table.createEl("tbody");
        
        await this.loadEquipment();

        let refreshTimeout: number;
        const requestRefresh = () => {
            window.clearTimeout(refreshTimeout);
            refreshTimeout = window.setTimeout(() => void this.loadEquipment(), 2000);
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

    private async createNewEquipment() {
        const targetDir = window.localStorage.getItem('chem-equip-dir') || "Equipment";
        if (!await this.app.vault.adapter.exists(targetDir)) {
            await this.app.vault.createFolder(targetDir);
        }

        const name = "New Instrument " + window.moment().format("HHmmss");
        const content = `---\ntags: [equipment]\nname: "${name}"\nlocation: "Unassigned"\nstatus: "Available"\nbooked_by: ""\nnext_maintenance: "${window.moment().add(1, 'year').format("YYYY-MM-DD")}"\ncontact: ""\n---\n# ${name}\n\n## 📖 Standard Operating Procedure\n1. Turn on the machine...\n\n## 🔗 Important Links\n- [Link to PDF Manual]()\n\n## 🛠️ Service Logs\n- **${window.moment().format("YYYY-MM-DD")}:** Added to system.\n`;
        const file = await this.app.vault.create(`${targetDir}/${name}.md`, content);
        this.app.workspace.getLeaf(false).openFile(file);
        new Notice(`Created ${name}`);
    }

    private async loadEquipment() {
        const targetDir = window.localStorage.getItem('chem-equip-dir') || "Equipment";
        const files = this.app.vault.getMarkdownFiles();
        const entries: EquipmentEntry[] = [];

        for (const file of files) {
            const inFolder = targetDir && file.path.startsWith(targetDir);
            const cache = this.app.metadataCache.getFileCache(file);
            const fmTags = cache?.frontmatter?.tags || [];
            const isTagged = (Array.isArray(fmTags) ? fmTags.includes('equipment') : fmTags === 'equipment');

            if (!inFolder && !isTagged) continue;

            const fm = cache?.frontmatter || {};
            const name = fm.name || file.basename;
            const location = fm.location || "Unknown";
            const contact = fm.contact || "";

            entries.push({
                file,
                name,
                location,
                status: fm.status || "Available",
                bookedBy: fm.booked_by || "",
                nextMaintenance: fm.next_maintenance || "-",
                contact,
                searchText: `${name} ${location} ${contact}`.toLowerCase()
            });
        }
        
        this.allEntries = entries.sort((a, b) => a.name.localeCompare(b.name));
        this.buildTableDOM();
        this.applyFilters();
    }

    private buildTableDOM() {
        this.tableBodyEl.empty();

        if (this.allEntries.length === 0) {
            const tr = this.tableBodyEl.createEl("tr");
            const td = tr.createEl("td", { text: "No equipment found. Create notes in an 'Equipment' folder or use tags: [equipment]." });
            td.setAttribute("colspan", "5");
            td.setCssStyles({ textAlign: "center", padding: "40px", color: "var(--text-muted)", fontStyle: "italic" });
            return;
        }

        this.allEntries.forEach(e => {
            const tr = this.tableBodyEl.createEl("tr");
            tr.setCssStyles({ cursor: "default", transition: "background 0.2s" });
            e.rowEl = tr; 

            tr.onmouseover = () => tr.setCssStyles({ backgroundColor: "var(--background-secondary-alt)" });
            tr.onmouseout = () => tr.setCssStyles({ backgroundColor: "transparent" });

            const tdName = tr.createEl("td");
            tdName.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
            const nameLink = tdName.createDiv({ text: `🔬 ${e.name}` });
            nameLink.setCssStyles({ fontWeight: "700", color: "var(--text-accent)", fontSize: "14px", cursor: "pointer", marginBottom: "4px" });
            nameLink.onclick = () => this.app.workspace.getLeaf(false).openFile(e.file);
            if (e.contact) tdName.createDiv({ text: `Contact: ${e.contact}` }).setCssStyles({ fontSize: "11px", color: "var(--text-muted)" });

            const tdLoc = tr.createEl("td", { text: `📍 ${e.location}` });
            tdLoc.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)", fontWeight: "500" });

            const tdStatus = tr.createEl("td");
            tdStatus.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
            const isAvail = e.status === 'Available';
            const color = isAvail ? 'var(--text-success)' : e.status === 'Maintenance' ? 'var(--text-error)' : 'var(--text-warning)';
            
            const statDiv = tdStatus.createDiv({ text: e.status.toUpperCase() });
            statDiv.setCssStyles({ display: "inline-block", padding: "4px 10px", borderRadius: "12px", fontSize: "10px", fontWeight: "700", color: color, border: `1px solid ${color}`, background: "var(--background-primary)", marginBottom: "4px" });
            if (e.bookedBy) tdStatus.createDiv({ text: `👤 ${e.bookedBy}` }).setCssStyles({ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" });

            const tdMaint = tr.createEl("td", { text: e.nextMaintenance });
            tdMaint.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)", color: "var(--text-muted)" });

            const tdAct = tr.createEl("td");
            tdAct.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
            const actContainer = tdAct.createDiv();
            actContainer.setCssStyles({ display: "flex", flexDirection: "column", gap: "6px" });
            
            const btn = actContainer.createEl("button", { text: isAvail ? "📅 Book" : "✅ Release" });
            btn.setCssStyles({ fontSize: "11px", padding: "4px", height: "26px", width: "100%" });
            btn.onclick = async () => {
                const newStatus = isAvail ? 'In Use' : 'Available';
                const user = isAvail ? "Current User" : "";
                await this.app.fileManager.processFrontMatter(e.file, (fm: any) => { 
                    fm.status = newStatus; 
                    fm.booked_by = user; 
                });
                new Notice(`${e.name} is now ${newStatus}.`);
            };

            if (e.status !== 'Maintenance') {
                const maintBtn = actContainer.createEl("button", { text: "🔧 Maint." });
                maintBtn.setCssStyles({ fontSize: "11px", padding: "4px", height: "26px", width: "100%" });
                maintBtn.onclick = async () => {
                    await this.app.fileManager.processFrontMatter(e.file, (fm: any) => { 
                        fm.status = 'Maintenance'; 
                        fm.booked_by = "Service Team"; 
                    });
                    new Notice(`${e.name} set to Maintenance.`);
                };
            }
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

    async onClose() {}
}