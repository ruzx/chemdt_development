import { Plugin, normalizePath, Notice, ItemView, WorkspaceLeaf, FileView, TFile } from 'obsidian';
import { ChemSpecSettings, SpecData, SavedState, NmrParsedData, SpectrumLoadResult } from './types';
import { DEFAULT_SETTINGS, ChemSpecSettingTab } from './settings';
import { predictNMRFromSMILES, predictIRFromSMILES, predictMSFromSMILES } from './predictor';
import { 
    parseBrukerFiles, 
    parseSimpleJDX, 
    parseCVFile, 
    simulateSpectrumFromText,
    parseChromatogramCSV,
    calculateHRMS
} from './parsers';
import { 
    renderIR, 
    renderCV, 
    renderNMR, 
    renderChromatogram, 
    renderTLCPlate,
    renderMS
} from './renderers';

const VIEW_TYPE_CHEMSPEC_APP = "chemspec-standalone-view";
const VIEW_TYPE_CHEMSPEC_FILE = "chemspec-file-view";

export default class ChemSpecPlugin extends Plugin {
    settings!: ChemSpecSettings;
    observer: MutationObserver | null = null;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new ChemSpecSettingTab(this.app, this));

        this.registerView(VIEW_TYPE_CHEMSPEC_APP, (leaf) => new ChemSpecStandaloneView(leaf, this));
        this.addRibbonIcon('activity', 'Open ChemSpec Viewer', () => { this.activateAppView(); });

        this.registerView(VIEW_TYPE_CHEMSPEC_FILE, (leaf) => new ChemSpecFileEmbedView(leaf, this));
        
        const exts = this.settings.supportedExtensions.split(',').map((e: string) => e.trim().toLowerCase()).filter((e: string) => e.length > 0);
        try {
            this.registerExtensions(exts, VIEW_TYPE_CHEMSPEC_FILE);
        } catch (err) {
            console.error("ChemSpec: Could not register some file extensions. Another plugin may be using them.", err);
        }

        this.app.workspace.onLayoutReady(() => {
            this.observer = new MutationObserver((mutations) => {
                mutations.forEach(m => {
                    m.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const el = node as HTMLElement;
                            if (el.classList && el.classList.contains('internal-embed')) this.checkAndInjectEmbed(el);
                            el.querySelectorAll?.('.internal-embed').forEach(e => this.checkAndInjectEmbed(e as HTMLElement));
                        }
                    });
                });
            });
            this.observer.observe(document.body, { childList: true, subtree: true });
            document.querySelectorAll('.internal-embed').forEach(e => this.checkAndInjectEmbed(e as HTMLElement));
        });

        this.registerMarkdownCodeBlockProcessor("nmr", (source, el) => {
            const lines = source.trim().split('\n').filter(l => l.trim().length > 0);
            if (lines.length === 0) return;
            for (const query of lines) {
                const container = this.createEmptyCardContainer(el);
                const status = container.createDiv({ text: `Loading "${query}"...`, cls: "color-text-muted" });
                status.setCssStyles({ padding: "15px" });
                
                void (async () => {
                    try {
                        await this.resolveAndRenderSpectrum(query.trim(), container, status);
                    } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : String(err);
                        status.setText(`Error: ${msg}`);
                        status.setCssStyles({ color: "var(--text-error)" });
                    }
                })();
            }
        });
		
		// --- 1. NMR Predictor & Reference Overlay ---
        this.registerMarkdownCodeBlockProcessor("predict-nmr", (source, el) => {
            const container = this.createEmptyCardContainer(el);
            const status = container.createDiv({ text: "Simulating...", cls: "color-text-muted" });
            status.setCssStyles({ padding: "15px" });
            
            void (async () => {
                try {
                    const lines = source.trim().split('\n');
                    const smiles = lines[0].trim();
                    const nucleus = (lines[1] || '1H').trim().toUpperCase() as '1H' | '13C';
                    
                    const specData = predictNMRFromSMILES(smiles, nucleus);

                    // Look for a reference file request
                    const refLine = lines.find(l => l.startsWith('reference:'));
                    if (refLine) {
                        status.setText("Loading reference spectrum...");
                        const refPath = refLine.split('reference:')[1].trim();
                        const refSpec = await this.loadSpectrumData(refPath);
                        specData.stacked = [refSpec.specData];
                    }
                    
                    status.remove();
                    renderNMR(container, specData, null, "", "Predicted NMR", this.settings, this.app, this.loadSpectrumData.bind(this));
                } catch (err: unknown) {
                    status.setText(`Error: ${err}`);
                    status.setCssStyles({ color: "var(--text-error)" });
                }
            })();
        });

        // --- 2. Mass Spec / Isotope Predictor ---
        this.registerMarkdownCodeBlockProcessor("predict-ms", (source, el) => {
            const container = this.createEmptyCardContainer(el);
            try {
                const lines = source.trim().split('\n');
                const smiles = lines[0].trim();
                const adduct = lines[1] ? lines[1].trim() : "[M+H]+";

                const specData = predictMSFromSMILES(smiles, adduct);
                renderMS(container, specData, this.settings);
            } catch (err: unknown) {
                container.empty();
                container.createDiv({ text: `Failed to predict MS: ${err}` }).setCssStyles({ color: "var(--text-error)", padding: "15px" });
            }
        });

        // --- 3. Infrared (FT-IR) Predictor ---
        this.registerMarkdownCodeBlockProcessor("predict-ir", (source, el) => {
            const container = this.createEmptyCardContainer(el);
            try {
                const smiles = source.trim().split('\n')[0].trim();
                const specData = predictIRFromSMILES(smiles);
                renderIR(container, specData, this.settings);
            } catch (err: unknown) {
                container.empty();
                container.createDiv({ text: `Failed to predict IR: ${err}` }).setCssStyles({ color: "var(--text-error)", padding: "15px" });
            }
        });

        this.registerMarkdownCodeBlockProcessor("pubnmr", (source, el) => {
            const container = this.createEmptyCardContainer(el);
            try {
                const specData = simulateSpectrumFromText(source);
                renderNMR(container, specData, null, "", "Simulated PubNMR", this.settings, this.app, this.loadSpectrumData.bind(this));
            } catch (err: unknown) {
                container.empty();
                const msg = err instanceof Error ? err.message : String(err);
                const errorDiv = container.createDiv({ text: `Failed to simulate spectrum: ${msg}`, cls: "chemspec-error-message" });
                errorDiv.setCssStyles({ padding: "15px", color: "var(--text-error)" });
            }
        });

        this.registerMarkdownCodeBlockProcessor("lcms", (source, el) => {
            const lines = source.trim().split('\n').filter(l => l.trim().length > 0);
            const pathLine = lines.find(l => l.startsWith("file:"));
            const query = pathLine ? pathLine.replace("file:", "").trim() : lines[0];

            const container = this.createEmptyCardContainer(el);
            const status = container.createDiv({ text: `Loading chromatography trace "${query}"...`, cls: "color-text-muted" });
            status.setCssStyles({ padding: "15px" });

            void (async () => {
                try {
                    await this.resolveAndRenderSpectrum(query, container, status);
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    status.setText(`Error loading LC-MS: ${msg}`);
                    status.setCssStyles({ color: "var(--text-error)" });
                }
            })();
        });

        this.registerMarkdownCodeBlockProcessor("tlc", (source, el) => {
            try {
                const lines = source.trim().split('\n');
                let solvent = "30% EtOAc/Hexanes";
                let stain = "UV 254";
                const lanes: { name: string; spots: { rf: number; color?: string; tailing?: number }[] }[] = [];
                let currentLane: { name: string; spots: { rf: number; color?: string; tailing?: number }[] } | null = null;

                lines.forEach(line => {
                    const trimmed = line.trim();
                    if (trimmed.startsWith("solvent:")) {
                        solvent = trimmed.replace("solvent:", "").trim();
                    } else if (trimmed.startsWith("stain:")) {
                        stain = trimmed.replace("stain:", "").trim();
                    } else if (trimmed.startsWith("- lane:")) {
                        currentLane = { name: trimmed.replace("- lane:", "").trim(), spots: [] };
                        lanes.push(currentLane);
                    } else if (trimmed.startsWith("spot:") && currentLane) {
                        const val = parseFloat(trimmed.replace("spot:", "").trim());
                        if (!isNaN(val)) currentLane.spots.push({ rf: val });
                    }
                });

                renderTLCPlate(el, lanes, solvent, stain);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                el.createDiv({ text: `TLC Syntax Error: ${msg}`, cls: "color-text-error" });
            }
        });

        this.registerMarkdownCodeBlockProcessor("hrms", (source, el) => {
            try {
                const lines = source.trim().split('\n');
                let formula = "", adduct = "[M+H]+", observed = 0;

                lines.forEach(line => {
                    const [k, v] = line.split(':').map(s => s.trim());
                    if (k === 'formula') formula = v;
                    if (k === 'adduct') adduct = v;
                    if (k === 'observed') observed = parseFloat(v);
                });

                if (!formula) throw new Error("Missing 'formula' field (e.g., formula: C18H22N2O3).");

                const { theoretical } = calculateHRMS(formula, adduct);
                const errorPpm = observed > 0 ? ((observed - theoretical) / theoretical) * 1e6 : 0;
                const pass = Math.abs(errorPpm) <= 5.0;

                const card = el.createDiv();
                card.setCssStyles({
                    padding: "14px 18px", border: "1px solid var(--background-modifier-border)",
                    borderRadius: "8px", background: "var(--background-primary)",
                    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.05)", display: "inline-flex",
                    flexDirection: "column", gap: "6px", minWidth: "280px"
                });

                const headerRow = card.createDiv();
                headerRow.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center" });
                headerRow.createSpan({ text: `HRMS: ${formula}` }).setCssStyles({ fontWeight: "600", color: "var(--text-accent)" });

                if (observed > 0) {
                    const badge = headerRow.createSpan({ text: pass ? "PASS (< 5 ppm)" : "FAIL (> 5 ppm)" });
                    badge.setCssStyles({
                        fontSize: "0.75em", fontWeight: "700", padding: "2px 6px", borderRadius: "4px",
                        background: pass ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
                        color: pass ? "#16a34a" : "#dc2626"
                    });
                }

                card.createDiv({ 
                    text: `Adduct: ${adduct} | Theoretical m/z: ${theoretical.toFixed(4)}` 
                }).setCssStyles({ fontSize: "0.85em", color: "var(--text-muted)" });

                if (observed > 0) {
                    card.createDiv({ 
                        text: `Observed m/z: ${observed.toFixed(4)} (Δ = ${errorPpm > 0 ? '+' : ''}${errorPpm.toFixed(2)} ppm)` 
                    }).setCssStyles({ fontSize: "0.85em", fontWeight: "500", fontFamily: "monospace" });
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                el.createDiv({ text: `HRMS Error: ${msg}`, cls: "color-text-error" });
            }
        });
    }

    onunload() {
        this.observer?.disconnect();
    }

    createEmptyCardContainer(parent: HTMLElement, fullHeight: boolean = false): HTMLElement {
        const wrapper = parent.createDiv();
        wrapper.addClass("nmr-viewer-card");
        
        const styles: Record<string, string> = {
            display: "flex", flexDirection: "column",
            width: "100%", border: "1px solid var(--background-modifier-border)",
            borderRadius: "10px", background: "var(--background-primary)",
            overflow: "hidden", margin: fullHeight ? "0" : "10px 0"
        };
        
        if (fullHeight) {
            styles.flexGrow = "1";
            styles.height = "100%";
        } else {
            styles.height = `${this.settings.canvasHeight}px`;
            styles.minHeight = `${this.settings.canvasHeight}px`;
        }
        
        wrapper.setCssStyles(styles);
        return wrapper;
    }

    checkAndInjectEmbed(embed: HTMLElement) {
        const src = embed.getAttribute('src');
        if (!src || embed.hasAttribute('data-nmr-injected')) return;

        const file = this.app.metadataCache.getFirstLinkpathDest(src, "");
        if (!file) return;

        const ext = file.extension.toLowerCase();
        const supportedExts = this.settings.supportedExtensions.split(',').map((e: string) => e.trim().toLowerCase());
        
        if (supportedExts.includes(ext)) {
            embed.setAttribute('data-nmr-injected', 'true');
            this.injectNativeEmbed(embed, file);
        }
    }

    injectNativeEmbed(embed: HTMLElement, file: TFile) {
        embed.empty(); 
        const wrapper = this.createEmptyCardContainer(embed);
        const loadingDiv = wrapper.createDiv();
        loadingDiv.addClass("color-text-muted"); 
        loadingDiv.setCssStyles({ padding: "15px" });
        loadingDiv.setText(`⏳ Loading ${file.name}...`);
        
        const stopProp = (e: Event) => { e.stopPropagation(); };
        wrapper.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); });
        wrapper.addEventListener("dblclick", stopProp);

        window.requestAnimationFrame(() => {
            void (async () => {
                try {
                    await this.resolveAndRenderSpectrum(file.path, wrapper, loadingDiv);
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    loadingDiv.setText(`Error: ${msg}`);
                    loadingDiv.setCssStyles({ color: "var(--text-error)" });
                }
            })();
        });
    }

    activateAppView() {
        const { workspace } = this.app;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_CHEMSPEC_APP);
        
        if (leaves.length === 0) {
            const leaf = workspace.getLeaf(true);
            void leaf.setViewState({ type: VIEW_TYPE_CHEMSPEC_APP }).then(() => {
                workspace.setActiveLeaf(leaf, { focus: true });
            });
        } else {
            workspace.setActiveLeaf(leaves[0], { focus: true });
        }
    }

    async loadSpectrumData(query: string): Promise<SpectrumLoadResult> {
        const adapter = this.app.vault.adapter;
        let resolvedPath = normalizePath(query);
        let specData: SpecData | null = null, savedState: SavedState | null = null, saveTarget = "";

        let fileObj = this.app.vault.getAbstractFileByPath(resolvedPath);
        if (!fileObj) {
            fileObj = this.app.metadataCache.getFirstLinkpathDest(query, "");
            if (fileObj) resolvedPath = fileObj.path;
        }

        const determineSaveTarget = async (baseName: string, defaultDir: string) => {
            const saveDir = this.settings.saveFolder ? normalizePath(this.settings.saveFolder) : defaultDir;
            const dirExists = await adapter.exists(saveDir);
            if (this.settings.saveFolder && !dirExists) {
                await adapter.mkdir(saveDir);
            }
            return normalizePath(`${saveDir}/${baseName}_processed.nmr`);
        };
        
        if (query.toLowerCase().endsWith('.nmr') && fileObj instanceof TFile) {
            const dataContent = await this.app.vault.read(fileObj);
            const data = JSON.parse(dataContent) as NmrParsedData;
            const pToRead = data.rawPpms ? data.rawPpms.length : 0;
            
            specData = {
                type: 'NMR', title: fileObj.name, nucleus: data.nucleus || "1H", solvent: data.solvent || "Unknown", 
                sf: data.sf || 400, sw_p: data.sw_p || 10, offset: data.offset || 10,
                rawPpms: new Float64Array(data.rawPpms || []), intensities: new Float64Array(data.intensities || []),
                pointsToRead: pToRead, maxInt: data.maxInt || 1
            };
            
            savedState = { 
                ppmShift: data.ppmShift, multiplets: data.multiplets, integrals: data.integrals, peaks: data.peaks,
                viewOffsetPpm: data.viewOffsetPpm, viewWidthPpm: data.viewWidthPpm, yScale: data.yScale, 
                baselineOffset: data.baselineOffset, phase0: data.phase0, phase1: data.phase1, baselineFlattened: data.baselineFlattened
            };
            saveTarget = fileObj.path; 
        } 
        else if ((query.toLowerCase().endsWith('.jdx') || query.toLowerCase().endsWith('.jcamp')) && fileObj instanceof TFile) {
            const content = await this.app.vault.read(fileObj);
            specData = parseSimpleJDX(content);
            if (specData) {
                specData.title = fileObj.name;
                saveTarget = await determineSaveTarget(fileObj.name.replace(/\.(jdx|jcamp)$/i, ''), fileObj.parent?.path || "");
            }
        } 
        else if ((query.toLowerCase().endsWith('.csv') || query.toLowerCase().endsWith('.txt')) && fileObj instanceof TFile) {
            const content = await this.app.vault.read(fileObj);
            if (/time|min|retention|mAU|wavelength|chromatogram/i.test(content.slice(0, 1000))) {
                specData = parseChromatogramCSV(content, fileObj.name);
            } else {
                specData = parseCVFile(content);
            }
            if (specData) {
                specData.title = fileObj.name;
                saveTarget = await determineSaveTarget(fileObj.name.replace(/\.(csv|txt)$/i, ''), fileObj.parent?.path || "");
            }
        }
        else {
            let folderPath = resolvedPath;
            let abstractFile = this.app.vault.getAbstractFileByPath(folderPath);

            if (!abstractFile) {
                const targetName = query.replace(/^\/+|\/+$/g, '');
                const searchVault = (folder: any, target: string): any => {
                    if (folder.name === target || folder.path === target) return folder;
                    if (folder.children) {
                        for (const child of folder.children) {
                            const found = searchVault(child, target);
                            if (found) return found;
                        }
                    }
                    return null;
                };
                abstractFile = searchVault(this.app.vault.getRoot(), targetName);
                if (abstractFile) {
                    folderPath = abstractFile.path;
                }
            }

            let foundBrukerBase = false;

            if (abstractFile && 'children' in abstractFile) {
                const searchFolderDown = (folder: any): string | null => {
                    if (!folder || !folder.children) return null;
                    for (const child of folder.children) {
                        if (child.name === 'acqus') return folder.path;
                    }
                    for (const child of folder.children) {
                        if ('children' in child) {
                            const res = searchFolderDown(child);
                            if (res) return res;
                        }
                    }
                    return null;
                };
                
                const foundDown = searchFolderDown(abstractFile);
                if (foundDown) {
                    folderPath = foundDown;
                    foundBrukerBase = true;
                }
            }

            if (!foundBrukerBase) {
                let currentPath = folderPath;
                for (let i = 0; i < 5; i++) {
                    if (currentPath && await adapter.exists(normalizePath(`${currentPath}/acqus`))) {
                        folderPath = currentPath;
                        foundBrukerBase = true;
                        break;
                    }
                    const lastSlash = currentPath.lastIndexOf('/');
                    if (lastSlash === -1 || lastSlash === 0) break;
                    currentPath = currentPath.substring(0, lastSlash);
                }
            }
            
            if (!foundBrukerBase) {
                throw new Error(`Could not find dataset matching "${query}". Ensure you are passing the exact folder path.`);
            }

            const subpath = this.settings.pdataSubpath.replace(/^\/+|\/+$/g, '');
            const acqusPath = normalizePath(`${folderPath}/acqus`);
            const procsPath = normalizePath(`${folderPath}/${subpath}/procs`);
            const r1Path = normalizePath(`${folderPath}/${subpath}/1r`);

            const acqusExists = await adapter.exists(acqusPath);
            const r1Exists = await adapter.exists(r1Path);

            if (!acqusExists || !r1Exists) throw new Error(`Missing Bruker files.`);

            specData = await parseBrukerFiles(acqusPath, procsPath, r1Path, adapter);
            const folderTitle = folderPath.split('/').filter(p => p).pop() || 'dataset';
            if (specData) {
                specData.title = folderTitle;
                saveTarget = await determineSaveTarget(specData.title, folderPath);
            }
        }

        if (!specData) throw new Error(`Could not construct spec data for "${query}".`);
        return { specData, savedState, saveTarget, resolvedPath };
    }

    async resolveAndRenderSpectrum(query: string, container: HTMLElement, statusEl: HTMLElement | null = null) {
        const { specData, savedState, saveTarget, resolvedPath } = await this.loadSpectrumData(query);
        if (statusEl) statusEl.remove();

        if (specData.type === 'IR') {
            renderIR(container, specData, this.settings);
        } else if (specData.type === 'CV') {
            renderCV(container, specData, this.settings);
        } else if (specData.type === 'LCMS') {
            renderChromatogram(container, specData, this.settings);
        } else {
            renderNMR(container, specData, savedState, saveTarget, resolvedPath, this.settings, this.app, this.loadSpectrumData.bind(this));
        }
    }

    async loadSettings() { 
        const savedData: unknown = await this.loadData();
        const parsed = (typeof savedData === "object" && savedData !== null) ? savedData as Partial<ChemSpecSettings> : {};
        this.settings = Object.assign({}, DEFAULT_SETTINGS, parsed);
    }

    async saveSettings() { 
        await this.saveData(this.settings); 
    }
}

class ChemSpecFileEmbedView extends FileView {
    plugin: ChemSpecPlugin;
    constructor(leaf: WorkspaceLeaf, plugin: ChemSpecPlugin) { super(leaf); this.plugin = plugin; }
    getViewType() { return VIEW_TYPE_CHEMSPEC_FILE; }
    getDisplayText() { return this.file ? this.file.name : "ChemSpec File"; }
    getIcon() { return "activity"; }

    async onLoadFile(file: TFile) {
        this.contentEl.empty();
        this.contentEl.setCssStyles({ overflow: "hidden", padding: "0" });
        const container = this.contentEl.createDiv();
        container.setCssStyles({ width: "100%", height: "100%", display: "flex", flexDirection: "column" });

        try {
            await this.plugin.resolveAndRenderSpectrum(file.path, container);
        } catch (err: unknown) {
            container.empty();
            const msg = err instanceof Error ? err.message : String(err);
            container.createDiv({ text: `Failed to load view: ${msg}` }).setCssStyles({ color: "var(--text-error)", padding: "20px" });
        }
    }
}

class ChemSpecStandaloneView extends ItemView {
    plugin: ChemSpecPlugin;
    constructor(leaf: WorkspaceLeaf, plugin: ChemSpecPlugin) { super(leaf); this.plugin = plugin; }
    getViewType() { return VIEW_TYPE_CHEMSPEC_APP; }
    getDisplayText() { return "ChemSpec Viewer"; }
    getIcon() { return "activity"; }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();

        const searchContainer = container.createDiv();
        searchContainer.setCssStyles({ padding: "15px 20px", display: "flex", gap: "10px", alignItems: "center" });

        const input = searchContainer.createEl("input", { type: "text", placeholder: "Enter path or drag folder/file here" });
        input.setCssStyles({ flexGrow: "1" });

        const btn = searchContainer.createEl("button", { text: "Load Spectrum" });
        const spectrumContainer = container.createDiv();
        spectrumContainer.setCssStyles({ flexGrow: "1", display: "flex", flexDirection: "column", height: "calc(100% - 65px)", padding: "0 20px 20px 20px" });

        const loadSpectrum = (path: string) => {
            if (!path) return;
            spectrumContainer.empty();
            const viewerCard = this.plugin.createEmptyCardContainer(spectrumContainer, true);
            const status = viewerCard.createDiv({ cls: "color-text-muted", text: "Loading..." });
            status.setCssStyles({ padding: "20px" });
            
            void (async () => {
                try {
                    await this.plugin.resolveAndRenderSpectrum(path.trim(), viewerCard, status);
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    status.setText(msg); status.setCssStyles({ color: "var(--text-error)" });
                }
            })();
        };

        btn.onclick = () => loadSpectrum(input.value);
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") loadSpectrum(input.value); });

        spectrumContainer.addEventListener("dragover", (e) => { e.preventDefault(); });
        spectrumContainer.addEventListener("drop", (e) => {
            e.preventDefault();
            
            const fileRef = e.dataTransfer?.getData("application/vnd.obsidian.file-path") || e.dataTransfer?.getData("text/plain");
            
            if (fileRef) {
                let cleanPath = fileRef;
                if (cleanPath.includes('obsidian://')) { 
                    try { 
                        const url = new URL(cleanPath); 
                        const f = url.searchParams.get('file'); 
                        if (f) cleanPath = decodeURIComponent(f); 
                    } catch (err) { 
                        console.debug("Invalid obsidian URI", err); 
                    } 
                }
                input.value = cleanPath; 
                loadSpectrum(cleanPath);
            } else { 
                new Notice("Drag a folder or file directly from the Obsidian file explorer tree."); 
            }
        });
    }
}