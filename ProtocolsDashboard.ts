// ProtocolsDashboard.ts

import { ItemView, WorkspaceLeaf, TFile, Notice, debounce } from 'obsidian';
import type ChemEditPlugin from './main';
import { renderLimsNav } from './SharedBase';

export const PROTOCOLS_DASHBOARD_VIEW_TYPE = "chem-protocols-dashboard";

interface ProtocolEntry {
    file: TFile;
    title: string;
    author: string;
    status: string;
    lastReviewed: string;
    rowEl?: HTMLElement;
    searchText: string;
}

export class ProtocolsDashboardView extends ItemView {
    plugin: ChemEditPlugin;
    toolbarEl: HTMLElement;
    tableBodyEl: HTMLElement;
    allEntries: ProtocolEntry[] = [];
    currentFilter: string = 'All';
    searchQuery: string = '';

    constructor(leaf: WorkspaceLeaf, plugin: ChemEditPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return PROTOCOLS_DASHBOARD_VIEW_TYPE; }
    getDisplayText() { return "Lab Protocols"; }
    getIcon() { return "file-text"; }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('chem-protocols-dashboard-view');
        container.setCssStyles({ display: "flex", flexDirection: "column", padding: "0", background: "var(--background-primary)" });

        const header = container.createDiv();
        header.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "20px 30px", background: "var(--background-secondary)", borderBottom: "1px solid var(--background-modifier-border)" });
        const titleArea = header.createDiv();
        titleArea.setCssStyles({ display: "flex", flexDirection: "column" });

        renderLimsNav(titleArea, "protocols", this.plugin);

        titleArea.createEl("h2", { text: "Standard Operating Procedures" }).setCssStyles({ margin: "0", fontSize: "22px", fontWeight: "700", color: "var(--text-normal)" });
        titleArea.createEl("span", { text: "Manage lab methodologies, reaction protocols, and safety rules" }).setCssStyles({ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" });

        const newBtn = header.createEl("button", { text: "+ New Protocol", cls: "mod-cta" });
        newBtn.setCssStyles({ height: "36px", fontSize: "14px", fontWeight: "600", padding: "0 20px" });
        newBtn.onclick = () => void this.createNewProtocol();

        this.toolbarEl = container.createDiv();
        this.toolbarEl.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "15px 30px", background: "var(--background-primary)", borderBottom: "1px solid var(--background-modifier-border)" });
        
        const leftTools = this.toolbarEl.createDiv();
        leftTools.setCssStyles({ display: "flex", gap: "15px", alignItems: "center" });
        const filterTabs = leftTools.createDiv();
        filterTabs.setCssStyles({ display: "flex", gap: "8px" });
        const tabs = ['All', 'Draft', 'Approved', 'Obsolete'];
        
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
        const dirInp = dirWrap.createEl("input", { type: "text", value: window.localStorage.getItem('chem-protocols-dir') || "Protocols" });
        dirInp.setCssStyles({ width: "120px", fontSize: "12px", padding: "4px 8px", borderRadius: "4px", height: "26px", border: "1px solid var(--background-modifier-border)" });
        dirInp.onchange = (e: any) => {
            window.localStorage.setItem('chem-protocols-dir', e.target.value.trim());
            void this.loadProtocols();
        };

        const searchInp = this.toolbarEl.createEl("input", { type: "search", placeholder: "Search protocol titles, authors..." });
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
        ["Protocol Title", "Author", "Status", "Last Reviewed", "Actions"].forEach(c => {
            const th = tr.createEl("th", { text: c });
            th.setCssStyles({ padding: "16px 10px", borderBottom: "2px solid var(--background-modifier-border)", color: "var(--text-muted)", fontWeight: "600", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px" });
        });

        this.tableBodyEl = table.createEl("tbody");
        
        await this.loadProtocols();
        
        let refreshTimeout: number;
        const requestRefresh = () => {
            window.clearTimeout(refreshTimeout);
            refreshTimeout = window.setTimeout(() => void this.loadProtocols(), 2000);
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

    private async createNewProtocol() {
        const targetDir = window.localStorage.getItem('chem-protocols-dir') || "Protocols";
        if (!await this.app.vault.adapter.exists(targetDir)) {
            await this.app.vault.createFolder(targetDir);
        }

        const name = "SOP - " + window.moment().format("HHmmss");
        const content = `---\ntags: [protocol]\ntitle: "${name}"\nauthor: "Current User"\nstatus: "Draft"\nlast_reviewed: "${window.moment().format("YYYY-MM-DD")}"\n---\n# ${name}\n\n## ⚠️ Safety Precautions\n- Wear PPE.\n\n## 🧪 Reagents & Materials\n- \n\n## 📝 Step-by-Step Procedure\n1. \n`;
        const file = await this.app.vault.create(`${targetDir}/${name}.md`, content);
        this.app.workspace.getLeaf(false).openFile(file);
    }

    private async loadProtocols() {
        const targetDir = window.localStorage.getItem('chem-protocols-dir') || "Protocols";
        const files = this.app.vault.getMarkdownFiles();
        const entries: ProtocolEntry[] = [];

        for (const file of files) {
            const inFolder = targetDir && file.path.startsWith(targetDir);
            const cache = this.app.metadataCache.getFileCache(file);
            const fmTags = cache?.frontmatter?.tags || [];
            const isTagged = (Array.isArray(fmTags) ? (fmTags.includes('protocol') || fmTags.includes('sop')) : (fmTags === 'protocol' || fmTags === 'sop'));

            if (!inFolder && !isTagged) continue;

            const fm = cache?.frontmatter || {};
            const title = fm.title || file.basename;
            const author = fm.author || "Unknown";

            entries.push({
                file,
                title,
                author,
                status: fm.status || "Draft",
                lastReviewed: fm.last_reviewed || "-",
                searchText: `${title} ${author} ${fm.status || ''}`.toLowerCase()
            });
        }
        
        this.allEntries = entries.sort((a, b) => a.title.localeCompare(b.title));
        this.buildTableDOM();
        this.applyFilters();
    }

    private buildTableDOM() {
        this.tableBodyEl.empty();

        if (this.allEntries.length === 0) {
            const tr = this.tableBodyEl.createEl("tr");
            const td = tr.createEl("td", { text: "No protocols found. Create a note in a 'Protocols' folder or use tags: [protocol]." });
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
            const nameLink = tdName.createDiv({ text: `📄 ${e.title}` });
            nameLink.setCssStyles({ fontWeight: "700", color: "var(--text-accent)", fontSize: "14px", cursor: "pointer" });
            nameLink.onclick = () => this.app.workspace.getLeaf(false).openFile(e.file);

            const tdAuthor = tr.createEl("td", { text: e.author });
            tdAuthor.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)", fontWeight: "500" });

            const tdStatus = tr.createEl("td");
            tdStatus.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
            let color = 'var(--text-warning)', bg = 'var(--background-primary)';
            if (e.status === 'Approved') color = 'var(--text-success)';
            else if (e.status === 'Obsolete') color = 'var(--text-error)';
            
            const statSpan = tdStatus.createDiv({ text: e.status.toUpperCase() });
            statSpan.setCssStyles({ display: "inline-block", padding: "4px 10px", borderRadius: "12px", fontSize: "10px", fontWeight: "700", color: color, border: `1px solid ${color}`, background: bg });

            const tdRev = tr.createEl("td", { text: e.lastReviewed });
            tdRev.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)", color: "var(--text-muted)" });

            const tdAct = tr.createEl("td");
            tdAct.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
            const btn = tdAct.createEl("button", { text: "✍️ Mark Reviewed" });
            btn.setCssStyles({ fontSize: "11px", padding: "4px 12px", width: "100%" });
            btn.onclick = async () => {
                await this.app.fileManager.processFrontMatter(e.file, (fm: any) => { 
                    fm.last_reviewed = window.moment().format("YYYY-MM-DD"); 
                    fm.status = "Approved"; 
                });
                new Notice(`${e.title} marked as Reviewed & Approved.`);
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

    async onClose() {}
}