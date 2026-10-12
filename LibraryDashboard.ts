// LibraryDashboard.ts

import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import type ChemEditPlugin from './main';
import { renderLimsNav } from './SharedBase';
import { calculateMwOffline } from './SharedEln';

export const LIBRARY_DASHBOARD_VIEW_TYPE = "chem-library-dashboard";

interface LibraryEntry {
    file: TFile;
    name: string;
    smiles: string;
    formula: string;
    mw: number;
    tags: string[];
}

export class LibraryDashboardView extends ItemView {
    plugin: ChemEditPlugin;
    tableBodyEl: HTMLElement;
    allEntries: LibraryEntry[] = [];
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
                            if (renderEl) { renderEl.style.maxWidth = '100%'; renderEl.style.maxHeight = '100%'; el.appendChild(renderEl); } 
                            else el.createSpan({ text: "Invalid", cls: "color-text-muted" });
                        });
                    }
                }
            });
        }, { root: null, rootMargin: "100px", threshold: 0.1 });
    }

    getViewType() { return LIBRARY_DASHBOARD_VIEW_TYPE; }
    getDisplayText() { return "Compounds Library"; }
    getIcon() { return "library"; }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('chem-library-dashboard-view');
        container.setCssStyles({ display: "flex", flexDirection: "column", padding: "0", background: "var(--background-primary)" });

        const header = container.createDiv();
        header.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "20px 30px", background: "var(--background-secondary)", borderBottom: "1px solid var(--background-modifier-border)" });
        const titleArea = header.createDiv();
        titleArea.setCssStyles({ display: "flex", flexDirection: "column" });

        renderLimsNav(titleArea, "library", this.plugin);

        titleArea.createEl("h2", { text: "Compounds Library" }).setCssStyles({ margin: "0", fontSize: "22px", fontWeight: "700", color: "var(--text-normal)" });
        titleArea.createEl("span", { text: "Central database of reference structures and building blocks" }).setCssStyles({ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" });

        const newBtn = header.createEl("button", { text: "+ Add Compound", cls: "mod-cta" });
        newBtn.setCssStyles({ height: "36px", fontSize: "14px", fontWeight: "600", padding: "0 20px" });
        newBtn.onclick = () => {
            this.plugin.api.ketcher.openEditor("", "smiles", async (smiles: string) => {
                if (!smiles) return;
                const name = "Compound_" + window.moment().format("HHmmss");
                const content = `---\ntags: [library]\nname: "${name}"\nsmiles: "${smiles}"\n---\n# ${name}\n\n\`\`\`smiles\n${smiles}\n\`\`\`\n`;
                const file = await this.app.vault.create(`Library/${name}.md`, content);
                this.app.workspace.getLeaf(false).openFile(file);
            });
        };

        const toolbarEl = container.createDiv();
        toolbarEl.setCssStyles({ display: "flex", justifyContent: "flex-end", alignItems: "center", padding: "15px 30px", background: "var(--background-primary)", borderBottom: "1px solid var(--background-modifier-border)" });
        const searchInp = toolbarEl.createEl("input", { type: "search", placeholder: "Search name, SMILES, or formula..." });
        searchInp.setCssStyles({ width: "280px", fontSize: "13px", borderRadius: "6px" });
        searchInp.oninput = (e: any) => { this.searchQuery = e.target.value.toLowerCase(); this.renderTable(); };

        const tableContainer = container.createDiv();
        tableContainer.setCssStyles({ flexGrow: "1", overflow: "auto", padding: "0 30px 30px 30px" });
        const table = tableContainer.createEl("table");
        table.setCssStyles({ width: "100%", borderCollapse: "separate", borderSpacing: "0", textAlign: "left", fontSize: "13px" });
        const thead = table.createEl("thead");
        thead.setCssStyles({ position: "sticky", top: "0", background: "var(--background-primary)", zIndex: "10" });
        
        const tr = thead.createEl("tr");
        ["Structure", "Name", "Properties", "SMILES", "Actions"].forEach(c => {
            tr.createEl("th", { text: c }).setCssStyles({ padding: "16px 10px", borderBottom: "2px solid var(--background-modifier-border)", color: "var(--text-muted)", fontWeight: "600", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px" });
        });

        this.tableBodyEl = table.createEl("tbody");
        await this.loadLibrary();
        this.registerEvent(this.app.metadataCache.on('resolved', () => void this.loadLibrary()));
    }

    private async loadLibrary() {
        const files = this.app.vault.getMarkdownFiles();
        this.allEntries = [];
        for (const file of files) {
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
            const isLib = fm?.tags?.includes('library') || file.path.toLowerCase().includes('library/');
            if (!isLib) continue;

            let smiles = fm?.smiles || "";
            if (!smiles) {
                const content = await this.app.vault.cachedRead(file);
                const blockMatch = content.match(/```smiles\s*\n([\s\S]*?)\n```/);
                if (blockMatch) smiles = blockMatch[1].trim();
            }

            let mw = fm?.mw || 0;
            let formula = fm?.formula || "";
            if (smiles && (!mw || !formula)) {
                const p = await calculateMwOffline(smiles, this.plugin);
                if (p) { mw = p.mw; formula = p.formula; }
            }

            this.allEntries.push({
                file, name: fm?.name || file.basename, smiles, formula, mw, tags: fm?.tags || []
            });
        }
        this.allEntries.sort((a, b) => a.name.localeCompare(b.name));
        this.renderTable();
    }

    private renderTable() {
        this.tableBodyEl.empty();
        this.observer.disconnect();

        const filtered = this.allEntries.filter(e => !this.searchQuery || `${e.name} ${e.smiles} ${e.formula}`.toLowerCase().includes(this.searchQuery));

        if (filtered.length === 0) {
            const emptyTr = this.tableBodyEl.createEl("tr");
            const emptyTd = emptyTr.createEl("td", { text: "No compounds found. Create a note in a 'Library' folder or use tags: [library]." });
            emptyTd.setAttribute("colspan", "5");
            emptyTd.setCssStyles({ textAlign: "center", padding: "40px", color: "var(--text-muted)", fontStyle: "italic" });
            return;
        }

        filtered.forEach(e => {
            const tr = this.tableBodyEl.createEl("tr");
            tr.setCssStyles({ transition: "background 0.2s" });
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

            const tdName = tr.createEl("td");
            tdName.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
            const nameDiv = tdName.createDiv({ text: e.name });
            nameDiv.setCssStyles({ fontWeight: "700", color: "var(--text-accent)", fontSize: "14px", marginBottom: "4px", cursor: "pointer" });
            nameDiv.onclick = () => this.app.workspace.getLeaf(false).openFile(e.file);

            const tdProps = tr.createEl("td");
            tdProps.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
            tdProps.createDiv({ text: `Formula: ${e.formula || '-'}` }).setCssStyles({ fontSize: "12px", color: "var(--text-normal)", fontWeight: "600" });
            tdProps.createDiv({ text: `MW: ${e.mw ? e.mw.toFixed(2) : '-'}` }).setCssStyles({ fontSize: "12px", color: "var(--text-muted)" });

            const tdSmiles = tr.createEl("td");
            tdSmiles.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)", maxWidth: "200px" });
            tdSmiles.createEl("code", { text: e.smiles.length > 30 ? e.smiles.substring(0, 30) + "..." : e.smiles }).setCssStyles({ fontSize: "10px", wordBreak: "break-all" });

            const tdAct = tr.createEl("td");
            tdAct.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
            const copyBtn = tdAct.createEl("button", { text: "📋 Copy SMILES" });
            copyBtn.setCssStyles({ fontSize: "11px", padding: "4px 12px", width: "100%", marginBottom: "6px" });
            copyBtn.onclick = () => { void navigator.clipboard.writeText(e.smiles); new Notice("Copied!"); };
        });
    }
    async onClose() { this.observer.disconnect(); }
}