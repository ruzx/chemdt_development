// ElnDashboard.ts

import { ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import type ChemEditPlugin from './main';
import { CreateExperimentModal, createNewElnExperiment } from './SharedEln';
import { renderLimsNav } from './SharedBase';

export const ELN_DASHBOARD_VIEW_TYPE = "chem-eln-dashboard";

interface ElnEntry {
    file: TFile;
    code: string;
    project: string;
    status: string;
    date: string;
    yieldStr: string;
    rxnSmiles: string;
    timestamp: number;
    rowEl?: HTMLElement;
    searchText: string;
}

export class ElnDashboardView extends ItemView {
    plugin: ChemEditPlugin;
    
    toolbarEl: HTMLElement;
    tableBodyEl: HTMLElement;
    
    allEntries: ElnEntry[] = [];
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
                        
                        this.plugin.api.renderStructure(smiles, 280, 110).then(renderEl => {
                            el.empty();
                            if (renderEl) {
                                renderEl.setCssStyles({ maxWidth: '100%', maxHeight: '100%' });
                                el.appendChild(renderEl);
                            } else {
                                el.createSpan({ text: "Invalid Structure", cls: "color-text-muted" }).setCssStyles({ fontSize: "11px" });
                            }
                        });
                    }
                }
            });
        }, { root: null, rootMargin: "150px", threshold: 0.1 });
    }

    getViewType() { return ELN_DASHBOARD_VIEW_TYPE; }
    getDisplayText() { return "ELN Dashboard"; }
    getIcon() { return "book-open"; }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('chem-eln-dashboard-view');
        
        container.setCssStyles({ display: "flex", flexDirection: "column", padding: "0", background: "var(--background-primary)" });

        // --- HEADER ---
        const header = container.createDiv();
        header.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "20px 30px", background: "var(--background-secondary)", borderBottom: "1px solid var(--background-modifier-border)" });
        const titleArea = header.createDiv();
        titleArea.setCssStyles({ display: "flex", flexDirection: "column" });
        
        renderLimsNav(titleArea, "eln", this.plugin);

        titleArea.createEl("h2", { text: "Laboratory Notebook" }).setCssStyles({ margin: "0", fontSize: "22px", fontWeight: "700", color: "var(--text-normal)" });
        titleArea.createEl("span", { text: "Manage and track all your chemical experiments" }).setCssStyles({ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" });

        const newBtn = header.createEl("button", { text: "+ New Experiment", cls: "mod-cta" });
        newBtn.setCssStyles({ height: "36px", fontSize: "14px", fontWeight: "600", padding: "0 20px" });
        newBtn.onclick = () => {
            const currentDir = window.localStorage.getItem('chem-eln-dir') ?? (this.plugin.settings.elnDirectory || "/");
            new CreateExperimentModal(this.app, this.plugin, this.plugin.settings.elnPrefix, currentDir, async (expCode: string) => {
                await createNewElnExperiment(this.app, expCode, currentDir, this.plugin.settings.elnSections);
                void this.loadExperiments();
            }).open();
        };

        // --- TOOLBAR ---
        this.toolbarEl = container.createDiv();
        this.toolbarEl.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "15px 30px", background: "var(--background-primary)", borderBottom: "1px solid var(--background-modifier-border)" });
        
        const leftTools = this.toolbarEl.createDiv();
        leftTools.setCssStyles({ display: "flex", gap: "15px", alignItems: "center" });
        const filterTabs = leftTools.createDiv();
        filterTabs.setCssStyles({ display: "flex", gap: "8px" });
        const tabs = ['All', 'Planned', 'Running', 'Completed', 'Failed'];
        
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
        const dirInp = dirWrap.createEl("input", { type: "text", value: window.localStorage.getItem('chem-eln-dir') ?? (this.plugin.settings.elnDirectory || "") });
        dirInp.placeholder = "e.g. ELN/2026";
        dirInp.setCssStyles({ width: "140px", fontSize: "12px", padding: "4px 8px", borderRadius: "4px", height: "26px", border: "1px solid var(--background-modifier-border)" });
        dirInp.onchange = (e: any) => {
            window.localStorage.setItem('chem-eln-dir', e.target.value.trim());
            void this.loadExperiments();
        };

        const searchInp = this.toolbarEl.createEl("input", { type: "search", placeholder: "Search reference, project..." });
        searchInp.setCssStyles({ width: "280px", fontSize: "13px", borderRadius: "6px" });
        searchInp.oninput = (e: any) => {
            this.searchQuery = e.target.value.toLowerCase();
            this.applyFilters();
        };

        // --- TABLE CONTAINER ---
        const tableContainer = container.createDiv();
        tableContainer.setCssStyles({ flexGrow: "1", overflow: "auto", padding: "0 30px 30px 30px" });
        const table = tableContainer.createEl("table");
        table.setCssStyles({ width: "100%", borderCollapse: "separate", borderSpacing: "0", textAlign: "left", fontSize: "13px" });
        const thead = table.createEl("thead");
        thead.setCssStyles({ position: "sticky", top: "0", background: "var(--background-primary)", zIndex: "10" });
        
        const tr = thead.createEl("tr");
        const cols = [
            { name: "Reference", width: "120px" },
            { name: "Reaction Scheme", width: "320px" },
            { name: "Project", width: "150px" },
            { name: "Yield", width: "80px" },
            { name: "Last Edited", width: "120px" },
            { name: "Status", width: "120px" }
        ];

        cols.forEach(c => {
            tr.createEl("th", { text: c.name }).setCssStyles({ padding: "16px 10px", borderBottom: "2px solid var(--background-modifier-border)", color: "var(--text-muted)", fontWeight: "600", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", width: c.width });
        });

        this.tableBodyEl = table.createEl("tbody");

        await this.loadExperiments();

        let refreshTimeout: number;
        const requestRefresh = () => {
            window.clearTimeout(refreshTimeout);
            refreshTimeout = window.setTimeout(() => void this.loadExperiments(), 2000);
        };

        this.registerEvent(this.app.vault.on('modify', requestRefresh));
        this.registerEvent(this.app.vault.on('create', requestRefresh));
        this.registerEvent(this.app.vault.on('delete', requestRefresh));
    }

    private renderToolbar() {
        const btns = this.toolbarEl.querySelectorAll('button');
        btns.forEach((btn: HTMLElement) => {
            const isMatch = btn.innerText === this.currentFilter;
            btn.setCssStyles({
                background: isMatch ? 'var(--interactive-accent)' : 'var(--background-primary)',
                color: isMatch ? 'var(--text-on-accent)' : 'var(--text-muted)',
                borderColor: isMatch ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'
            });
        });
    }

    private async loadExperiments() {
        const { parseYaml } = require('obsidian');
        const files = this.app.vault.getMarkdownFiles();
        const entries: ElnEntry[] = [];
        
        const targetDir = window.localStorage.getItem('chem-eln-dir') ?? (this.plugin.settings.elnDirectory || "");

        for (const file of files) {
            const inFolder = !targetDir || file.path.startsWith(targetDir);
            const cache = this.app.metadataCache.getFileCache(file);
            const fmTags = cache?.frontmatter?.tags || [];
            const isTagged = Array.isArray(fmTags) ? fmTags.includes('experiment') : fmTags === 'experiment';
            
            if (!inFolder && !isTagged) continue;

            const hasCodeBlock = cache?.sections?.some(s => s.type === 'code');
            if (!hasCodeBlock) continue;

            const content = await this.app.vault.cachedRead(file);
            const elnMatch = content.match(/```eln\s*\n([\s\S]*?)\n```/);
            
            if (elnMatch) {
                try {
                    const safeSource = elnMatch[1].replace(/smiles:\s*(.*)$/gm, (m: any, p1: string) => {
                        let s = p1.trim(); if (!s) return m;
                        const cMatch = s.match(/(\s+#.*)$/); if (cMatch) s = s.substring(0, s.length - cMatch[1].length).trim();
                        if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.substring(1, s.length - 1);
                        return `smiles: '${s.replace(/\\"/g, '"').replace(/'/g, "''")}'`;
                    });

                    const data = parseYaml(safeSource);
                    
                    const rs = (data.reactants || []).map((r:any) => r.smiles).filter(Boolean).join('.');
                    const ps = (data.products || []).map((p:any) => p.smiles).filter(Boolean).join('.');
                    const rxnSmiles = rs || ps ? `${rs}>>${ps}` : "";

                    const code = data.code || file.basename;
                    const project = data.project || 'Unassigned';

                    entries.push({
                        file,
                        code: code,
                        project: project,
                        status: data.status || 'Planned',
                        date: data.date || window.moment(file.stat.mtime).format("MMM D, YYYY"),
                        yieldStr: data.products?.[0]?.yield ? `${data.products[0].yield}%` : '-',
                        rxnSmiles: rxnSmiles,
                        timestamp: file.stat.mtime,
                        searchText: `${code} ${project} ${data.status || ''}`.toLowerCase()
                    });
                } catch (e) {}
            }
        }

        this.allEntries = entries.sort((a, b) => b.timestamp - a.timestamp);
        this.buildTableDOM();
        this.applyFilters();
    }

    private buildTableDOM() {
        const fragment = document.createDocumentFragment();
        this.observer.disconnect();

        if (this.allEntries.length === 0) {
            const emptyTr = document.createElement("tr");
            const emptyTd = document.createElement("td");
            emptyTd.setAttribute("colspan", "6");
            emptyTd.textContent = "No experiments found. Create notes tagged with [experiment].";
            emptyTd.setCssStyles({ textAlign: "center", padding: "40px", color: "var(--text-muted)", fontStyle: "italic" });
            emptyTr.appendChild(emptyTd);
            fragment.appendChild(emptyTr);
        } else {
            this.allEntries.forEach(e => {
                const tr = document.createElement("tr");
                tr.setCssStyles({ cursor: "pointer", transition: "background 0.2s" });
                e.rowEl = tr; 

                tr.onmouseover = () => tr.setCssStyles({ backgroundColor: "var(--background-secondary-alt)" });
                tr.onmouseout = () => tr.setCssStyles({ backgroundColor: "transparent" });
                tr.onclick = () => this.app.workspace.getLeaf(false).openFile(e.file);

                const tdCode = document.createElement("td");
                tdCode.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
                const codeDiv = document.createElement("div");
                codeDiv.textContent = e.code;
                codeDiv.setCssStyles({ fontWeight: "700", color: "var(--text-accent)" });
                tdCode.appendChild(codeDiv);
                tr.appendChild(tdCode);

                const tdScheme = document.createElement("td");
                tdScheme.setCssStyles({ padding: "10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
                const schemeWrap = document.createElement("div");
                schemeWrap.setAttribute("data-smiles", e.rxnSmiles);
                schemeWrap.setCssStyles({ width: "280px", height: "90px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--background-primary)", border: "1px solid var(--background-modifier-border)", borderRadius: "6px" });
                
                if (e.rxnSmiles) {
                    const s = document.createElement("span"); s.textContent = "⏳ Loading..."; s.setCssStyles({ color: "var(--text-muted)", fontSize: "11px" });
                    schemeWrap.appendChild(s);
                    this.observer.observe(schemeWrap);
                } else {
                    const s = document.createElement("span"); s.textContent = "No Structure"; s.setCssStyles({ color: "var(--text-muted)", fontSize: "11px" });
                    schemeWrap.appendChild(s);
                }
                tdScheme.appendChild(schemeWrap);
                tr.appendChild(tdScheme);

                const tdProj = document.createElement("td");
                tdProj.textContent = e.project;
                tdProj.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)", color: "var(--text-normal)" });
                tr.appendChild(tdProj);

                const yColor = e.yieldStr !== '-' ? (parseFloat(e.yieldStr) >= 80 ? 'var(--text-success)' : 'var(--text-normal)') : 'var(--text-muted)';
                const tdYield = document.createElement("td");
                tdYield.textContent = e.yieldStr;
                tdYield.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)", fontWeight: "600", color: yColor });
                tr.appendChild(tdYield);

                const tdDate = document.createElement("td");
                tdDate.textContent = e.date;
                tdDate.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)", color: "var(--text-muted)" });
                tr.appendChild(tdDate);

                const tdStatus = document.createElement("td");
                tdStatus.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
                
                let bg = 'var(--background-primary)', color = 'var(--text-muted)', border = 'var(--background-modifier-border)';
                if (e.status === 'Completed') { color = 'var(--text-success)'; border = 'var(--text-success)'; }
                else if (e.status === 'Running') { color = 'var(--text-warning)'; border = 'var(--text-warning)'; }
                else if (e.status === 'Failed') { color = 'var(--text-error)'; border = 'var(--text-error)'; }
                else if (e.status === 'Planned') { color = 'var(--text-accent)'; border = 'var(--text-accent)'; }

                const statDiv = document.createElement("div");
                statDiv.textContent = e.status.toUpperCase();
                statDiv.setCssStyles({ display: "inline-block", padding: "4px 10px", borderRadius: "12px", fontSize: "10px", fontWeight: "700", color: color, border: `1px solid ${border}`, background: bg });
                tdStatus.appendChild(statDiv);
                tr.appendChild(tdStatus);

                fragment.appendChild(tr);
            });
        }

        this.tableBodyEl.empty();
        this.tableBodyEl.appendChild(fragment);
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