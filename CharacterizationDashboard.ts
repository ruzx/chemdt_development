// CharacterizationDashboard.ts
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises */

import { ItemView, WorkspaceLeaf, TFile, Notice, debounce, Menu, Modal, App } from 'obsidian';
import type ChemEditPlugin from './main';
import { renderLimsNav } from './SharedBase';

export const CHARACTERIZATION_DASHBOARD_VIEW_TYPE = "chem-characterization-dashboard";

interface CharEntry {
    file: TFile;
    name: string;
    smiles: string;
    metricsData: Record<string, any>; 
    score: number;
    timestamp: number;
    rowEl?: HTMLElement;
    searchText: string;
}

export class CharacterizationDashboardView extends ItemView {
    plugin: ChemEditPlugin;
    tableBodyEl: HTMLElement;
    tableHeadTr: HTMLElement;
    
    allEntries: CharEntry[] = [];
    searchQuery: string = '';
    metricsList: string[] = []; 
    
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

    getViewType() { return CHARACTERIZATION_DASHBOARD_VIEW_TYPE; }
    getDisplayText() { return "Compound Data Organizer"; }
    getIcon() { return "bar-chart-2"; }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('chem-characterization-dashboard-view');
        
        container.setCssStyles({ display: "flex", flexDirection: "column", padding: "0", background: "var(--background-primary)" });

        // --- HEADER ---
        const header = container.createDiv();
        header.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "20px 30px", background: "var(--background-secondary)", borderBottom: "1px solid var(--background-modifier-border)" });
        const titleArea = header.createDiv();
        titleArea.setCssStyles({ display: "flex", flexDirection: "column" });

        renderLimsNav(titleArea, "data", this.plugin);

        titleArea.createEl("h2", { text: "Compound Data Organizer" }).setCssStyles({ margin: "0", fontSize: "22px", fontWeight: "700", color: "var(--text-normal)" });
        titleArea.createEl("span", { text: "Track publication readiness and analytical spectra" }).setCssStyles({ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" });

        const newBtn = header.createEl("button", { text: "+ Add Compound", cls: "mod-cta" });
        newBtn.setCssStyles({ height: "36px", fontSize: "14px", fontWeight: "600", padding: "0 20px" });
        newBtn.onclick = () => {
            const folder = window.localStorage.getItem('chem-char-dir') || "Characterization";
            void this.createNewEntry(folder);
        };

        // --- TOOLBAR ---
        const toolbarEl = container.createDiv();
        toolbarEl.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "15px 30px", background: "var(--background-primary)", borderBottom: "1px solid var(--background-modifier-border)" });
        
        const leftTools = toolbarEl.createDiv();
        leftTools.setCssStyles({ display: "flex", gap: "15px", alignItems: "center", flexWrap: "wrap" });
        
        // 1. Folder Setting
        const dirWrap = leftTools.createDiv();
        dirWrap.setCssStyles({ display: "flex", alignItems: "center", gap: "6px" });
        dirWrap.createEl("span", { text: "📁 Folder:" }).setCssStyles({ fontSize: "11px", fontWeight: "600", color: "var(--text-muted)" });
        const dirInp = dirWrap.createEl("input", { type: "text", value: window.localStorage.getItem('chem-char-dir') || "Characterization" });
        dirInp.setCssStyles({ width: "120px", fontSize: "12px", padding: "4px 8px", borderRadius: "4px", height: "26px", border: "1px solid var(--background-modifier-border)" });
        dirInp.onchange = (e: any) => {
            window.localStorage.setItem('chem-char-dir', e.target.value.trim());
            void this.loadData();
        };

        // 2. DYNAMIC METRICS SETTING
        const metricWrap = leftTools.createDiv();
        metricWrap.setCssStyles({ display: "flex", alignItems: "center", gap: "6px" });
        const metSpan = metricWrap.createEl("span", { text: "⚙️ Metrics (YAML keys):" });
        metSpan.setCssStyles({ fontSize: "11px", fontWeight: "600", color: "var(--text-muted)" });
        metSpan.title = "Comma separated list of data you want to track.";
        const metricInp = metricWrap.createEl("input", { type: "text", value: window.localStorage.getItem('chem-char-metrics') || "hnmr, cnmr, hrms, ir, mp" });
        metricInp.setCssStyles({ width: "220px", fontSize: "12px", padding: "4px 8px", borderRadius: "4px", height: "26px", border: "1px solid var(--background-modifier-border)" });
        metricInp.onchange = (e: any) => {
            window.localStorage.setItem('chem-char-metrics', e.target.value.trim());
            void this.loadData();
        };

        const searchInp = toolbarEl.createEl("input", { type: "search", placeholder: "Search compound name..." });
        searchInp.setCssStyles({ width: "220px", fontSize: "13px", borderRadius: "6px" });
        searchInp.oninput = (e: any) => { 
            this.searchQuery = e.target.value.toLowerCase(); 
            this.applyFilters(); 
        };

        // --- TABLE ---
        const tableContainer = container.createDiv();
        tableContainer.setCssStyles({ flexGrow: "1", overflow: "auto", padding: "0 30px 30px 30px" });
        const table = tableContainer.createEl("table");
        table.setCssStyles({ width: "100%", borderCollapse: "separate", borderSpacing: "0", textAlign: "center", fontSize: "13px" });
        const thead = table.createEl("thead");
        thead.setCssStyles({ position: "sticky", top: "0", background: "var(--background-primary)", zIndex: "10" });
        
        this.tableHeadTr = thead.createEl("tr");
        this.tableBodyEl = table.createEl("tbody");

        await this.loadData();

        const requestRefresh = debounce(() => { void this.loadData(); }, 2000, true);
        this.registerEvent(this.app.vault.on('modify', requestRefresh));
        this.registerEvent(this.app.vault.on('create', requestRefresh));
        this.registerEvent(this.app.vault.on('delete', requestRefresh));
    }

    private async createNewEntry(folder: string) {
        if (!await this.app.vault.adapter.exists(folder)) await this.app.vault.createFolder(folder);
        
        const name = "Compound_" + window.moment().format("HHmmss");
        
        let metricsYaml = "";
        this.metricsList.forEach(m => { metricsYaml += `${m}: false\n`; });

        const content = `---\ntags: [characterization]\nname: "${name}"\nsmiles: ""\n${metricsYaml}---\n# ${name}\n\n*Drop spectral data files (PDFs, MNova, images) into this folder and link them above!*\n`;
        const file = await this.app.vault.create(`${folder}/${name}.md`, content);
        this.app.workspace.getLeaf(false).openFile(file);
    }

    private async loadData() {
        const targetDir = window.localStorage.getItem('chem-char-dir') || "Characterization";
        const metricsStr = window.localStorage.getItem('chem-char-metrics') || "hnmr, cnmr, hrms, ir, mp";
        
        this.metricsList = metricsStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

        const files = this.app.vault.getMarkdownFiles();
        const entries: CharEntry[] = [];

        for (const file of files) {
            const inFolder = targetDir && file.path.startsWith(targetDir);
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter || {};
            const fmTags = fm.tags || [];
            const isTagged = Array.isArray(fmTags) ? (fmTags.includes('characterization') || fmTags.includes('compound')) : (fmTags === 'characterization' || fmTags === 'compound');

            if (!inFolder && !isTagged) continue;

            const smiles = fm.smiles || "";
            let collectedCount = 0;
            const metricsData: Record<string, any> = {};
            
            this.metricsList.forEach(m => {
                const val = fm[m];
                metricsData[m] = val;
                if (val && val !== 'false' && val !== false) collectedCount++;
            });

            const score = this.metricsList.length > 0 ? Math.round((collectedCount / this.metricsList.length) * 100) : 0;
            const name = fm.name || file.basename;

            entries.push({
                file, name, smiles, metricsData, score, timestamp: file.stat.mtime, searchText: name.toLowerCase()
            });
        }

        this.allEntries = entries.sort((a, b) => a.name.localeCompare(b.name));
        this.buildTableDOM();
        this.applyFilters();
    }

    private buildTableDOM() {
        this.observer.disconnect();

        this.tableHeadTr.empty();
        const formatHeader = (key: string) => {
            if (key === 'hnmr') return '1H NMR';
            if (key === 'cnmr') return '13C NMR';
            if (key === 'mp') return 'M.P.';
            return key.toUpperCase();
        };

        const staticCols = ["Structure", "Compound"];
        const dynamicCols = this.metricsList.map(formatHeader);
        const allCols = [...staticCols, ...dynamicCols, "Readiness"];

        allCols.forEach((c, i) => {
            const th = this.tableHeadTr.createEl("th", { text: c });
            th.setCssStyles({ padding: "16px 10px", borderBottom: "2px solid var(--background-modifier-border)", color: "var(--text-muted)", fontWeight: "600", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px" });
            if (i < 2) th.setCssStyles({ textAlign: "left" });
        });

        const fragment = document.createDocumentFragment();

        if (this.allEntries.length === 0) {
            const emptyTr = document.createElement("tr");
            const emptyTd = document.createElement("td");
            emptyTd.setAttribute("colspan", allCols.length.toString());
            emptyTd.textContent = "No compounds found. Click '+ Add Compound' to start.";
            emptyTd.setCssStyles({ textAlign: "center", padding: "40px", color: "var(--text-muted)", fontStyle: "italic" });
            emptyTr.appendChild(emptyTd);
            fragment.appendChild(emptyTr);
        } else {
            this.allEntries.forEach(e => {
                const tr = document.createElement("tr");
                tr.setCssStyles({ transition: "background 0.2s" });
                e.rowEl = tr;
                tr.onmouseover = () => tr.setCssStyles({ backgroundColor: "var(--background-secondary-alt)" });
                tr.onmouseout = () => tr.setCssStyles({ backgroundColor: "transparent" });

                const tdStruct = document.createElement("td");
                tdStruct.setCssStyles({ padding: "10px", borderBottom: "1px solid var(--background-modifier-border-hover)", textAlign: "left" });
                const structWrap = document.createElement("div");
                structWrap.setAttribute("data-smiles", e.smiles);
                structWrap.setCssStyles({ width: "120px", height: "100px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--background-primary)", border: "1px solid var(--background-modifier-border)", borderRadius: "6px", cursor: "pointer" });
                structWrap.onclick = () => this.app.workspace.getLeaf(false).openFile(e.file);
                
                if (e.smiles) {
                    const l = document.createElement("span"); l.textContent = "⏳"; l.setCssStyles({ color: "var(--text-muted)", fontSize: "11px" });
                    structWrap.appendChild(l);
                    this.observer.observe(structWrap);
                } else {
                    const l = document.createElement("span"); l.textContent = "No Structure"; l.setCssStyles({ color: "var(--text-muted)", fontSize: "11px" });
                    structWrap.appendChild(l);
                }
                tdStruct.appendChild(structWrap);
                tr.appendChild(tdStruct);

                const tdName = document.createElement("td");
                tdName.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)", textAlign: "left" });
                const nameDiv = document.createElement("div");
                nameDiv.textContent = e.name;
                nameDiv.setCssStyles({ fontWeight: "700", color: "var(--text-accent)", fontSize: "14px", cursor: "pointer" });
                nameDiv.onclick = () => this.app.workspace.getLeaf(false).openFile(e.file);
                tdName.appendChild(nameDiv);
                tr.appendChild(tdName);
                
                this.metricsList.forEach(m => {
                    this.createDataCell(tr, e.file, m, e.metricsData[m]);
                });

                const tdProg = document.createElement("td");
                tdProg.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
                const pColor = e.score === 100 ? 'var(--text-success)' : e.score >= 60 ? 'var(--text-warning)' : 'var(--text-error)';
                
                const scoreDiv = document.createElement("div");
                scoreDiv.textContent = `${e.score}%`;
                scoreDiv.setCssStyles({ fontSize: "11px", fontWeight: "bold", marginBottom: "4px", color: pColor });
                
                const track = document.createElement("div");
                track.setCssStyles({ width: "100%", height: "6px", background: "var(--background-modifier-border)", borderRadius: "3px", overflow: "hidden" });
                
                const bar = document.createElement("div");
                bar.setCssStyles({ width: `${e.score}%`, height: "100%", background: pColor, transition: "width 0.3s" });
                track.appendChild(bar);
                
                tdProg.appendChild(scoreDiv);
                tdProg.appendChild(track);
                tr.appendChild(tdProg);
                
                fragment.appendChild(tr);
            });
        }

        this.tableBodyEl.empty();
        this.tableBodyEl.appendChild(fragment);
    }

    private createDataCell(tr: HTMLElement, file: TFile, key: string, val: any) {
        const td = document.createElement("td");
        td.setCssStyles({ padding: "10px", borderBottom: "1px solid var(--background-modifier-border-hover)", verticalAlign: "middle" });
        
        const isDone = !!val && val !== 'false' && val !== false;
        const isLink = typeof val === 'string' && val.includes('[[');
        const displayStr = isLink ? '📄' : (isDone ? '✅' : '❌');
        const color = isDone ? (isLink ? 'var(--text-accent)' : 'var(--text-success)') : 'var(--text-faint)';

        const btn = document.createElement("button");
        btn.textContent = displayStr;
        btn.title = val ? String(val) : "Missing";
        btn.setCssStyles({ background: isDone ? 'var(--background-primary)' : 'transparent', border: `1px solid ${isDone ? color : 'transparent'}`, borderRadius: "6px", fontSize: "14px", padding: "4px 8px", color: color, boxShadow: "none", cursor: "pointer" });

        btn.onclick = (e) => {
            const menu = new Menu();
            if (isLink) {
                menu.addItem(i => i.setTitle(`Extract Link: ${val.replace(/[[\]]/g, '')}`).setIcon("link").onClick(() => {
                    const cleanName = val.replace('[[', '').replace(']]', '');
                    const targetFile = this.app.metadataCache.getFirstLinkpathDest(cleanName, file.path);
                    if (targetFile) this.app.workspace.getLeaf(false).openFile(targetFile);
                    else new Notice("Linked file not found.");
                }));
                menu.addSeparator();
            }
            menu.addItem(i => i.setTitle("Mark as Collected (✅)").setIcon("check").onClick(() => void this.app.fileManager.processFrontMatter(file, fm => fm[key] = true)));
            menu.addItem(i => i.setTitle("Link File / Text (📄)").setIcon("paperclip").onClick(() => {
                new DataPromptModal(this.app, key.toUpperCase(), val?.toString() || "", (newVal) => {
                    void this.app.fileManager.processFrontMatter(file, fm => fm[key] = newVal);
                }).open();
            }));
            menu.addItem(i => i.setTitle("Mark as Missing (❌)").setIcon("cross").onClick(() => void this.app.fileManager.processFrontMatter(file, fm => { fm[key] = false; })));
            menu.showAtMouseEvent(e);
        };
        
        td.appendChild(btn);
        tr.appendChild(td);
    }

    private applyFilters() {
        this.allEntries.forEach(e => {
            if (e.rowEl) e.rowEl.setCssStyles({ display: (!this.searchQuery || e.searchText.includes(this.searchQuery)) ? "" : "none" });
        });
    }

    async onClose() { this.observer.disconnect(); }
}

class DataPromptModal extends Modal {
    onSubmit: (val: string) => void; 
    keyName: string; 
    initialVal: string;
    constructor(app: App, keyName: string, initialVal: string, onSubmit: (val: string) => void) {
        super(app); this.keyName = keyName; this.initialVal = initialVal; this.onSubmit = onSubmit;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: `Set data for ${this.keyName}` });
        contentEl.createEl("p", { text: "Tip: You can paste an Obsidian link here like [[spectra.pdf]]", cls: "color-text-muted" }).setCssStyles({ fontSize: "12px", marginTop: "0" });
        
        const input = contentEl.createEl("input", { type: "text", value: this.initialVal === 'true' || this.initialVal === 'false' ? '' : this.initialVal });
        input.setCssStyles({ width: "100%", marginBottom: "15px" });
        
        const saveBtn = contentEl.createEl("button", { text: "Save", cls: "mod-cta" });
        saveBtn.onclick = () => { this.onSubmit(input.value.trim()); this.close(); };
        input.onkeydown = (e) => { if (e.key === "Enter") saveBtn.click(); };
        window.setTimeout(() => input.focus(), 50);
    }
    onClose() { this.contentEl.empty(); }
}