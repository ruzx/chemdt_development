// main.ts
import { Plugin, MarkdownView, Editor, Notice, TFile, addIcon, createDiv, createSpan } from 'obsidian';
import React from 'react';
import ReactDOM from 'react-dom';
import SmiDrawer from 'smiles-drawer';
import KetcherReact from './KetcherReact';

import { ChemEditSettings, DEFAULT_SETTINGS, ChemEditSettingTab } from './Settings';
import { ChemEditAPI, buildChemEditAPI } from './ChemEditAPI';
import { SharedElnRenderer, createNewElnExperiment, CreateExperimentModal } from './SharedEln';
import { takeStandardPhoto, saveMediaFile, TlcModal } from './SharedMedia';
import { showChemicalContextMenu, populateChemicalMenu } from './SharedContextMenu';
import { extractDataFromSvg } from './ChemUtils';
import { KetcherModal } from './KetcherModals';
import { CHEM_FILE_VIEW_TYPE, ChemFileView } from './ChemFileView';
import { buildLivePreviewPlugin } from './LivePreview';

let createRoot: any = null;
try { const ReactDomClient = require('react-dom/client'); if (ReactDomClient && ReactDomClient.createRoot) createRoot = ReactDomClient.createRoot; } catch (e) { createRoot = null; }

export default class ChemEditPlugin extends Plugin {
    settings: ChemEditSettings;
    public api: ChemEditAPI; 
    
    hiddenKetcherContainer: HTMLDivElement;
    headlessKetcher: any = null;
    headlessRoot: any = null; 
    isProcessingHeadless = false;
    headlessQueue: { data: string, isInline: boolean, resolve: (el: HTMLElement | null) => void, w?: number, h?: number }[] = [];

    cameraRibbonEl: HTMLElement | null = null;
    tlcRibbonEl: HTMLElement | null = null;
    elnRibbonEl: HTMLElement | null = null;

    getSupportedExts(): string[] { return this.settings.supportedEmbedExtensions.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0); }

    public openKetcherModal(initialData: string, format: string, onSave: (data: string, isFile: boolean, newFormat?: string) => void) {
        new KetcherModal(this, initialData, format, (newData: string, isFile: boolean, newFormat?: string) => {
            onSave(newData, isFile, newFormat);
        }).open();
    }

    public openKetcherForFile(file: TFile, data: string, format: string, wrapper: HTMLElement) {
        let openData = data;
        let openFormat = format;
        
        if (format === 'svg') {
            const ex = extractDataFromSvg(data);
            if (ex) { openData = ex.data; openFormat = 'svg'; } 
            else { new Notice("Not a Ketcher SVG"); return; }
        }
        new KetcherModal(this, openData, openFormat, async (newData: string, isFile: boolean, newFormat?: string) => {
            if (isFile) { new Notice(`Saved as new file: ${newData}. Please update the link.`); return; }
            if (newFormat && newFormat !== format && format !== 'svg') { new Notice(`Format upgraded to ${newFormat}. Remember to rename your file.`); }
            await this.app.vault.modify(file, newData);
            wrapper.empty(); wrapper.createSpan({ text: "Updating...", cls: "color-text-muted" });
            if ((newFormat || format) === 'svg') {
                wrapper.empty(); 
                const svgContainer = createDiv(); 
                svgContainer.innerHTML = this.namespaceSvgIds(newData); // Only allowed use for SVG rendering
                const svgNode = svgContainer.querySelector('svg'); 
                if (svgNode) { svgNode.setCssStyles({ width: '100%', height: '100%' }); } 
                wrapper.appendChild(svgContainer);
            } else {
                const updatedEl = await this.renderMoleculeToPreview(newData, newFormat || format, false);
                if (updatedEl) { wrapper.empty(); wrapper.appendChild(updatedEl); }
                else { wrapper.empty(); wrapper.createSpan({ text: "Error", cls: "color-red" }); }
            }
        }).open();
    }

    namespaceSvgIds(svgText: string): string {
        const uniquePrefix = `k-${Math.random().toString(36).substring(2, 9)}-`;
        return svgText
            .replace(/\bid="(?!ketcher-data)([^"]+)"/g, `id="${uniquePrefix}$1"`)
            .replace(/\bid='(?!ketcher-data)([^']+)'/g, `id='${uniquePrefix}$1'`)
            .replace(/(xlink:href|href)="\#([^"]+)"/g, `$1="#${uniquePrefix}$2"`)
            .replace(/(xlink:href|href)='\#([^']+)'/g, `$1='#${uniquePrefix}$2'`)
            .replace(/url\(\#([^)]+)\)/g, `url(#${uniquePrefix}$1)`);
    }

    refreshRibbonIcons() {
        if (this.settings.showMediaRibbonIcons) {
            if (!this.cameraRibbonEl) {
                this.cameraRibbonEl = this.addRibbonIcon('camera', 'Take Lab Photo', () => {
                    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                    if (!view) { new Notice("Place cursor in a Markdown file first."); return; }
                    takeStandardPhoto(async (buffer, ext) => {
                        const link = await saveMediaFile(this.app, buffer, this.settings.mediaSavePath, `Photo_${window.moment().format("YYYYMMDD_HHmmss")}.${ext}`);
                        view.editor.replaceSelection(`\n![[${link}]]\n`);
                    });
                });
            } else { this.cameraRibbonEl.style.display = ''; }
            
            if (!this.tlcRibbonEl) {
                this.tlcRibbonEl = this.addRibbonIcon('image-file', 'Add TLC Plate', () => {
                    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                    if (!view) { new Notice("Place cursor in a Markdown file first."); return; }
                    new TlcModal(this.app, async (pngData, rfData) => {
                        const link = await saveMediaFile(this.app, pngData, this.settings.mediaSavePath, `TLC_${window.moment().format("YYYYMMDD_HHmmss")}.png`);
                        let md = `\n![[${link}]]\n\n| Spot | $R_f$ |\n|---|---|\n`;
                        rfData.forEach((s, i) => md += `| ${i+1} | **${s.rf.toFixed(2)}** |\n`);
                        view.editor.replaceSelection(md);
                    }).open();
                });
            } else { this.tlcRibbonEl.style.display = ''; }
        } else {
            if (this.cameraRibbonEl) this.cameraRibbonEl.style.display = 'none';
            if (this.tlcRibbonEl) this.tlcRibbonEl.style.display = 'none';
        }

        if (this.settings.showElnRibbonIcon && this.settings.enableEln) {
            if (!this.elnRibbonEl) {
                this.elnRibbonEl = this.addRibbonIcon('flask-round', 'Create Blank ELN Experiment', () => {
                    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                    const currentFolder = this.settings.elnDirectory ? this.settings.elnDirectory : (view?.file?.parent?.path || "");
                    new CreateExperimentModal(this.app, this, this.settings.elnPrefix, currentFolder, async (expCode) => {
                        await createNewElnExperiment(this.app, expCode, currentFolder, this.settings.elnSections);
                    }).open();
                });
            } else { this.elnRibbonEl.style.display = ''; }
        } else {
            if (this.elnRibbonEl) this.elnRibbonEl.style.display = 'none';
        }
    }

    async onload() {
        addIcon('flask-round', `<polygon fill="none" stroke="currentColor" stroke-width="6" points="50,5 89,27.5 89,72.5 50,95 11,72.5 11,27.5" stroke-linejoin="round"/><path fill="none" stroke="currentColor" stroke-width="5" d="M 42 35 L 42 55 A 18 18 0 1 0 58 55 L 58 35 Z" stroke-linejoin="round"/><line x1="36" y1="35" x2="64" y2="35" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><line x1="32" y1="65" x2="68" y2="65" stroke="currentColor" stroke-width="4" stroke-dasharray="4 4"/>`);
        
        await this.loadSettings();
        this.api = buildChemEditAPI(this);
        this.addSettingTab(new ChemEditSettingTab(this.app, this));

        this.hiddenKetcherContainer = document.body.createDiv({ cls: 'chemedit-headless-ketcher' });
        this.hiddenKetcherContainer.setCssStyles({ position: 'absolute', top: '-10000px', left: '-10000px', width: '800px', height: '600px', opacity: '0', pointerEvents: 'none', zIndex: '-1' });
        
        this.app.workspace.onLayoutReady(() => { this.bootHeadlessKetcher(); });

        const extsForView = this.getSupportedExts().filter(ext => ext !== 'svg');
        this.registerView(CHEM_FILE_VIEW_TYPE, (leaf) => new ChemFileView(leaf, this));
        this.registerExtensions(extsForView, CHEM_FILE_VIEW_TYPE);
        
        this.registerEditorExtension(buildLivePreviewPlugin(this));
        this.addRibbonIcon('hexagon', 'Draw New Molecule', () => { this.openNewDrawingModal(); });

        this.refreshRibbonIcons();

        if (this.settings.enableContextMenu) {
            this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
                if (file instanceof TFile) {
                    const ext = file.extension.toLowerCase();
                    if (ext === 'svg') {
                        menu.addItem((item) => {
                            item.setTitle("Edit SVG in Ketcher").setIcon("hexagon").onClick(async () => {
                                const data = await this.app.vault.read(file);
                                const extracted = extractDataFromSvg(data);
                                if (extracted) {
                                    new KetcherModal(this, data, "svg", async (newData) => {
                                        await this.app.vault.modify(file, newData); new Notice(`Saved ${file.name}`);
                                    }).open();
                                } else { new Notice("This SVG does not contain editable Ketcher metadata."); }
                            });
                        });
                    }
                    const activeExts = this.getSupportedExts();
                    if (activeExts.includes(ext) && ext !== 'svg') {
                        menu.addSeparator();
                        menu.addItem((item) => {
                            item.setTitle("📈 Predict 1H NMR").setIcon("activity").onClick(async () => {
                                const data = await this.app.vault.read(file);
                                const smiles = data.trim();
                                if (smiles) window.open(`https://www.nmrdb.org/simulator/?smiles=${encodeURIComponent(smiles)}`);
                            });
                        });
                    }
                }
            }));

            this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor) => {
                const selection = editor.getSelection().trim();
                if (selection && selection.length < 500 && !selection.includes('\n')) {
                    menu.addSeparator();
                    populateChemicalMenu(menu, this, selection);
                }
            }));
        }

        if (this.settings.enableEln) {
            this.registerMarkdownCodeBlockProcessor("eln", async (source, el, ctx) => { const elnRenderer = new SharedElnRenderer(this); await elnRenderer.renderElnBlock(source, el, ctx); });
        }

        // --- CORE COMMANDS ---
        this.addCommand({
            id: 'draw-molecule', name: 'Draw new SMILES molecule',
            editorCallback: (editor: Editor) => {
                new KetcherModal(this, "", "smiles", (newData, isFile, newFormat) => {
                    if (isFile) { const cursor = editor.getCursor(); editor.replaceRange(`!${newData}\n`, cursor); editor.setCursor({ line: cursor.line + 1, ch: 0 }); } 
                    else { this.insertSmilesAtCursor(editor, newData, newFormat || "smiles"); }
                }).open();
            }
        });

        this.addCommand({
            id: 'draw-inline-molecule', name: 'Draw new inline molecule',
            editorCallback: (editor: Editor) => {
                new KetcherModal(this, "", "smiles", (newData, isFile, newFormat) => {
                    const cursor = editor.getCursor();
                    if (isFile) { editor.replaceRange(`!${newData} `, cursor); editor.setCursor({ line: cursor.line, ch: cursor.ch + newData.length + 2 }); } 
                    else {
                        if (newFormat === "ket") { new Notice("Cannot save inline reaction. Inserting as block."); this.insertSmilesAtCursor(editor, newData, "ket"); return; }
                        const textToInsert = `${this.settings.inlineSmilesPrefix}${newData} `;
                        editor.replaceRange(textToInsert, cursor); editor.setCursor({ line: cursor.line, ch: cursor.ch + textToInsert.length });
                    }
                }).open();
            }
        });

        // --- CORE PROCESSORS ---
        this.registerMarkdownPostProcessor(async (el, ctx) => {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null); const nodes: Text[] = []; let node;
            while ((node = walker.nextNode())) nodes.push(node as Text);
            for (const n of nodes) {
                const text = n.nodeValue || "";
                if (this.settings.inlineSmilesPrefix && text.includes(this.settings.inlineSmilesPrefix)) { void this.processInlineString(n, text, this.settings.inlineSmilesPrefix, 'smiles', ctx.sourcePath); }
                else if (this.settings.inlineMolPrefix && text.includes(this.settings.inlineMolPrefix)) { void this.processInlineString(n, text, this.settings.inlineMolPrefix, 'file', ctx.sourcePath); }
            }
            const embeds = Array.from(el.querySelectorAll('.internal-embed'));
            if (el.classList?.contains('internal-embed')) embeds.push(el);
            const activeExts = this.getSupportedExts();
            for (const embed of embeds) {
                const src = embed.getAttribute('src'); if (!src) continue; const lowerSrc = src.toLowerCase(); const hasExt = activeExts.some(ext => lowerSrc.endsWith(`.${ext}`));
                if (hasExt) { if (embed.hasAttribute('data-chem-preview-done')) continue; embed.setAttribute('data-chem-preview-done', 'true'); void this.injectNativeEmbed(embed as HTMLElement, src, ctx.sourcePath); }
            }
        });

        this.registerEvent(
            this.app.workspace.on('editor-paste', (evt: ClipboardEvent, editor: Editor) => {
                if (evt.defaultPrevented) return;
                const text = evt.clipboardData?.getData('text/plain'); if (!text) return; const cleanText = text.trim();
                if (this.settings.smartPasteMol && (cleanText.includes('V2000') || cleanText.includes('V3000'))) { evt.preventDefault(); const cursor = editor.getCursor(); editor.replaceRange(`\`\`\`mol\n${cleanText}\n\`\`\`\n`, cursor); return; }
                const smilesRegex = /^([BCNOPSFIcbcnops@+\-\[\]\(\)\\\/=#%0-9]{4,})$/;
                if (this.settings.smartPasteSmiles && smilesRegex.test(cleanText) && /[CNOcno]/.test(cleanText)) { evt.preventDefault(); const cursor = editor.getCursor(); editor.replaceRange(`\`\`\`smiles\n${cleanText}\n\`\`\`\n`, cursor); }
            })
        );

        const fileCodeblockProcessor = async (source: string, el: HTMLElement, ctx: any, defaultFormat: string) => {
            const wrapper = this.createBaseWrapper(`Loading preview...`); el.appendChild(wrapper);
            const rawData = source.trim(); const bracketMatch = rawData.match(/\[\[(.*?)\]\]/); let filenameToSearch = "";
            if (bracketMatch && bracketMatch[1]) filenameToSearch = bracketMatch[1];
            else { const exts = this.getSupportedExts(); const hasExt = exts.some(ext => rawData.toLowerCase().endsWith(`.${ext}`)); if (hasExt) filenameToSearch = rawData; }

            if (filenameToSearch) {
                const cleanLink = decodeURIComponent(filenameToSearch).split('#')[0].split('?')[0].trim(); const file = this.app.metadataCache.getFirstLinkpathDest(cleanLink, ctx.sourcePath);
                if (file && file instanceof TFile) {
                    const format = file.extension.toLowerCase(); const fileData = await this.app.vault.read(file);
                    if (format === 'svg') {
                        const extracted = extractDataFromSvg(fileData);
                        if (extracted) { 
                            wrapper.title = `Double-click to edit ${file.name}`; wrapper.empty(); 
                            const svgContainer = createDiv(); svgContainer.innerHTML = this.namespaceSvgIds(fileData); 
                            const svgNode = svgContainer.querySelector('svg'); if (svgNode) { svgNode.setCssStyles({ width: '100%', height: '100%' }); } 
                            wrapper.appendChild(svgContainer);
                        } else { wrapper.empty(); wrapper.createSpan({ text: "Not a Ketcher SVG", cls: "color-red" }); return;  }
                    } else { wrapper.title = `Double-click to edit ${file.name}`; const previewEl = await this.renderMoleculeToPreview(fileData, format, false); wrapper.empty();  if (previewEl) wrapper.appendChild(previewEl); else wrapper.appendChild(this.createErrorCard(`Invalid format in ${file.name}`)); }

                    wrapper.addEventListener("dblclick", async (e) => {
                        e.stopPropagation(); const freshData = await this.app.vault.read(file); let openData = freshData; let openFormat = format;
                        if (format === 'svg') { const ex = extractDataFromSvg(freshData); if (ex) { openData = ex.data; openFormat = 'svg'; } else { new Notice("Not a Ketcher SVG"); return; } }
                        new KetcherModal(this, openData, openFormat, async (newData, isFile, newFormat) => {
                            if (isFile) { new Notice(`Saved as new file: ${newData}. Please update the link.`); return; }
                            await this.app.vault.modify(file, newData); wrapper.empty(); wrapper.createSpan({ text: "Updating...", cls: "color-text-muted" });
                            if ((newFormat || format) === 'svg') { wrapper.empty(); const svgContainer = createDiv(); svgContainer.innerHTML = this.namespaceSvgIds(newData); const svgNode = svgContainer.querySelector('svg'); if (svgNode) { svgNode.setCssStyles({ width: '100%', height: '100%' }); } wrapper.appendChild(svgContainer);
                            } else { const updatedEl = await this.renderMoleculeToPreview(newData, newFormat || format, false); if (updatedEl) { wrapper.empty(); wrapper.appendChild(updatedEl); } }
                        }).open();
                    }); return;
                }
                if (bracketMatch) { wrapper.empty(); wrapper.createSpan({ text: `File not found: ${cleanLink}`, cls: "color-red" }); return; }
            }

            if (!source.trim()) { wrapper.empty(); wrapper.createSpan({ text: "Empty block." }); return; }
            wrapper.title = `Double-click to edit structure`;
            window.requestAnimationFrame(async () => { const previewEl = await this.renderMoleculeToPreview(source, defaultFormat, false); wrapper.empty();  if (previewEl) wrapper.appendChild(previewEl); else wrapper.appendChild(this.createErrorCard("Invalid chemical format")); });
            wrapper.addEventListener("dblclick", async (e) => {
                e.stopPropagation(); const view = this.app.workspace.getActiveViewOfType(MarkdownView); if (!view) return; const info = ctx.getSectionInfo(el);
                new KetcherModal(this, source, defaultFormat, (newData, isFile, newFormat) => {
                    const editor = view.editor;
                    if (info) {
                        if (isFile) { editor.replaceRange(`!${newData}\n`, { line: info.lineStart, ch: 0 }, { line: info.lineEnd, ch: editor.getLine(info.lineEnd).length }); } 
                        else { const finalFormat = newFormat || defaultFormat; editor.replaceRange(`\`\`\`${finalFormat}\n${newData}\n\`\`\``, { line: info.lineStart, ch: 0 }, { line: info.lineEnd, ch: editor.getLine(info.lineEnd).length }); }
                    }
                }).open();
            });
        };

        const builtInCodeblocks = ["mol", "cdxml", "ket", "sdf", "rxn", "inchi", "smarts", "fasta", "sequence", "idt", "helm", "biln"];
        const allCodeblocks = [...new Set([...builtInCodeblocks, ...this.getSupportedExts()])];
        allCodeblocks.forEach(fmt => { if (fmt !== 'svg') { this.registerMarkdownCodeBlockProcessor(fmt, (s, e, c) => { void fileCodeblockProcessor(s, e, c, fmt); }); } });

        this.registerMarkdownCodeBlockProcessor("smiles", (source, el, ctx) => {
            const cleanSmiles = source.trim(); const lines = cleanSmiles.split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length > 1) {
                const grid = el.createDiv(); grid.setCssStyles({ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "10px", margin: "10px 0" });
                for (const line of lines) { const cell = grid.createDiv(); this.renderSmilesBlock(line, cell, ctx, true, 140, 140); }
            } else { this.renderSmilesBlock(cleanSmiles, el, ctx, false, this.settings.width, this.settings.height); }
        });
    }

    onunload() {
        this.destroyHeadlessKetcher();
        if (this.hiddenKetcherContainer) {
            this.hiddenKetcherContainer.remove();
        }
    }

    openNewDrawingModal() {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView); if (!view) { new Notice("Please open a Markdown file first to insert a drawing."); return; }
        new KetcherModal(this, "", "smiles", (newData: string, isFile: boolean, newFormat?: string) => {
            if (isFile) { const cursor = view.editor.getCursor(); view.editor.replaceRange(`!${newData}\n`, cursor); view.editor.setCursor({ line: cursor.line + 1, ch: 0 }); } 
            else { this.insertSmilesAtCursor(view.editor, newData, newFormat || "smiles"); }
        }).open();
    }

    insertSmilesAtCursor(editor: Editor, data: string, format: string) {
        const cursor = editor.getCursor(); editor.replaceRange(`\`\`\`${format}\n${data}\n\`\`\`\n`, cursor); editor.setCursor({ line: cursor.line + 3, ch: 0 }); 
    }

    renderSmilesBlock(smiles: string, el: HTMLElement, ctx: any, isGridItem: boolean, w: number, h: number) {
        const wrapper = createDiv(); wrapper.setCssStyles({ cursor: "pointer", display: isGridItem ? "flex" : "inline-block", alignItems: "center", justifyContent: "center" }); wrapper.title = "Double-click to edit structure"; 
        if (isGridItem) { wrapper.setCssStyles({ padding: "10px", backgroundColor: "var(--background-primary)", border: "1px solid var(--background-modifier-border)", borderRadius: "8px" }); }
        el.appendChild(wrapper);

        const theme = document.body.hasClass("theme-dark") ? this.settings.darkTheme : this.settings.lightTheme;
        const drawerOptions = { width: w * 2, height: h * 2 };

        window.requestAnimationFrame(() => {
            try {
                // @ts-ignore
                const Smi: any = SmiDrawer; 
                if (smiles.includes('>')) {
                    const rxnContainer = createSpan(); rxnContainer.setCssStyles({ display: "inline-flex", alignItems: "center" }); wrapper.appendChild(rxnContainer);
                    Smi.parseReaction(smiles, (tree: any) => {
                        if (this.settings.useSvgSmiles) { new Smi.ReactionDrawer({width: w, height: h}, {width: w, height: h}).draw(tree, rxnContainer, theme); } 
                        else { new Smi.ReactionDrawer(drawerOptions, drawerOptions).draw(tree, rxnContainer, theme); const canvases = rxnContainer.querySelectorAll('canvas'); canvases.forEach(c => { c.setCssStyles({ width: `${c.width / 2}px`, height: `${c.height / 2}px` }); }); }
                    });
                } else {
                    if (this.settings.useSvgSmiles) {
                        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("width", `${w}px`); svg.setAttribute("height", `${h}px`); wrapper.appendChild(svg);
                        Smi.parse(smiles, (tree: any) => new Smi.SvgDrawer({width: w, height: h}).draw(tree, svg, theme));
                    } else {
                        const canvas = document.createElement("canvas"); canvas.setAttribute("width", `${w}px`); canvas.setAttribute("height", `${h}px`); wrapper.appendChild(canvas);
                        Smi.parse(smiles, (tree: any) => new Smi.Drawer(drawerOptions).draw(tree, canvas, theme));
                    }
                }
            } catch (err: any) { wrapper.empty(); wrapper.createSpan({ text: `Error: ${err.message}`, cls: 'color-red' }); }
        });

        if (this.settings.enableContextMenu) {
            wrapper.addEventListener("contextmenu", (e) => {
                showChemicalContextMenu(this, e, smiles);
            });
        }
        
        wrapper.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            if (isGridItem) { new Notice("Cannot inline-edit grids yet. Edit code block manually."); return; }
            const view = this.app.workspace.getActiveViewOfType(MarkdownView); if (!view) return; const info = ctx.getSectionInfo(el.parentElement || el);
            new KetcherModal(this, smiles, "smiles", (newData, isFile, newFormat) => {
                const editor = view.editor;
                if (info) {
                    if (isFile) { editor.replaceRange(`!${newData}\n`, { line: info.lineStart, ch: 0 }, { line: info.lineEnd, ch: editor.getLine(info.lineEnd).length }); } 
                    else { const finalFormat = newFormat || "smiles"; editor.replaceRange(`\`\`\`${finalFormat}\n${newData}\n\`\`\``, { line: info.lineStart, ch: 0 }, { line: info.lineEnd, ch: editor.getLine(info.lineEnd).length }); }
                }
            }).open();
        });
    }

    createBaseWrapper(titleText: string): HTMLDivElement {
        const wrapper = createDiv(); wrapper.setCssStyles({ cursor: "pointer", border: "1px solid var(--background-modifier-border)", borderRadius: "8px", padding: "10px", textAlign: "center", display: "block", margin: "10px 0", backgroundColor: "var(--background-primary)" }); wrapper.title = titleText; 
        wrapper.createSpan({ text: "Loading preview...", cls: "color-text-muted" });
        return wrapper;
    }

    destroyHeadlessKetcher() {
        this.isProcessingHeadless = false;
        if (this.hiddenKetcherContainer) {
            if (this.headlessRoot) { this.headlessRoot.unmount(); this.headlessRoot = null; } 
            else { ReactDOM.unmountComponentAtNode(this.hiddenKetcherContainer); }
            this.headlessKetcher = null;
        }
    }

    bootHeadlessKetcher() {
        if (this.headlessKetcher || this.headlessRoot) return;
        const element = React.createElement(KetcherReact, {
            data: "", onInit: async (ketcher: any) => { this.headlessKetcher = ketcher; if (this.settings.useAcsSettings) { try { await ketcher.setSettings({ bondThickness: 1.2, bondLength: 20, stereoBondWidth: 3, fontsz: 10, fontszsub: 7, hashSpacing: 1.5 }); } catch (e) {} } window.setTimeout(() => this.processHeadlessQueue(), 500); }, onChange: () => {}
        });
        if (createRoot) { this.headlessRoot = createRoot(this.hiddenKetcherContainer); this.headlessRoot.render(element); } else { ReactDOM.render(element, this.hiddenKetcherContainer); }
    }

    rebootHeadlessKetcher() { this.destroyHeadlessKetcher(); window.setTimeout(() => this.bootHeadlessKetcher(), 100); }

    createErrorCard(msg: string): HTMLElement {
        const div = createDiv(); div.setCssStyles({ padding: '10px', border: '1px dashed var(--text-error)', color: 'var(--text-error)', borderRadius: '5px', textAlign: 'center', display: 'inline-block' });
        const b = div.createEl("b", { text: msg }); div.prepend(document.createTextNode("🧪 ")); div.createEl("br");
        div.createSpan({ text: "Double-click to open editor", cls: "color-text-muted" }).setCssStyles({ fontSize: "0.8em" });
        return div;
    }

    async processInlineString(textNode: Text, fullText: string, prefix: string, type: 'smiles'|'file', sourcePath: string) {
        const startIndex = fullText.indexOf(prefix); let endIndex = fullText.indexOf(' ', startIndex); if (endIndex === -1) endIndex = fullText.length;
        const rawData = fullText.substring(startIndex + prefix.length, endIndex).trim(); if (!rawData) return;
        const beforeText = fullText.substring(0, startIndex); const afterText = fullText.substring(endIndex);
        const parent = textNode.parentNode; if (!parent) return;

        const wrapper = createSpan({ cls: "chem-inline-wrapper" }); wrapper.setCssStyles({ display: "inline-block", verticalAlign: "middle", cursor: "pointer", margin: "0 4px" }); wrapper.title = "Double-click to edit"; 
        wrapper.createSpan({ text: "⏳", cls: "color-text-muted" });
        parent.insertBefore(document.createTextNode(beforeText), textNode); parent.insertBefore(wrapper, textNode); parent.insertBefore(document.createTextNode(afterText), textNode); parent.removeChild(textNode);

        const theme = document.body.hasClass("theme-dark") ? this.settings.darkTheme : this.settings.lightTheme;
        const cssW = this.settings.inlineWidth; const cssH = this.settings.inlineHeight; const drawerOptions = { width: cssW * 2, height: cssH * 2 };

        if (type === 'smiles') {
            window.requestAnimationFrame(() => {
                try {
                    // @ts-ignore
                    const Smi: any = SmiDrawer; wrapper.empty();
                    if (rawData.includes('>')) {
                        const rxnContainer = createSpan(); rxnContainer.setCssStyles({ display: "inline-flex", alignItems: "center" }); wrapper.appendChild(rxnContainer);
                        Smi.parseReaction(rawData, (tree: any) => {
                            if (this.settings.useSvgSmiles) { new Smi.ReactionDrawer({width: cssW, height: cssH}, {width: cssW, height: cssH}).draw(tree, rxnContainer, theme); } 
                            else { new Smi.ReactionDrawer(drawerOptions, drawerOptions).draw(tree, rxnContainer, theme); const canvases = rxnContainer.querySelectorAll('canvas'); canvases.forEach(c => { c.setCssStyles({ width: `${c.width / 2}px`, height: `${c.height / 2}px` }); }); }
                        });
                    } else {
                        if (this.settings.useSvgSmiles) {
                            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("width", `${cssW}px`); svg.setAttribute("height", `${cssH}px`); wrapper.appendChild(svg);
                            Smi.parse(rawData, (tree: any) => { new Smi.SvgDrawer({width: cssW, height: cssH}).draw(tree, svg, theme); });
                        } else {
                            const canvas = document.createElement("canvas"); canvas.setAttribute("width", `${cssW}px`); canvas.setAttribute("height", `${cssH}px`); wrapper.appendChild(canvas);
                            Smi.parse(rawData, (tree: any) => { new Smi.Drawer(drawerOptions).draw(tree, canvas, theme); });
                        }
                    }
                } catch(e) { wrapper.empty(); wrapper.appendChild(document.createTextNode('❌')); }
            });

            wrapper.addEventListener("dblclick", (e) => {
                e.stopPropagation(); const view = this.app.workspace.getActiveViewOfType(MarkdownView); if (!view) return;
                new KetcherModal(this, rawData, "smiles", (newData, isFile, newFormat) => {
                    const editor = view.editor; const content = editor.getValue();
                    if (isFile) { const updatedContent = content.replace(prefix + rawData, `!${newData}`); editor.setValue(updatedContent); return; }
                    if (newFormat === "ket") { new Notice("Inline reactions not supported. Inserted as block."); const updatedContent = content.replace(prefix + rawData, `\n\`\`\`ket\n${newData}\n\`\`\`\n`); editor.setValue(updatedContent); return; }
                    const updatedContent = content.replace(prefix + rawData, prefix + newData); editor.setValue(updatedContent);
                }).open();
            });
        } else if (type === 'file') {
            const cleanFileName = rawData.replace('[[', '').replace(']]', ''); const file = this.app.metadataCache.getFirstLinkpathDest(cleanFileName, sourcePath);
            if (file && file instanceof TFile) {
                const format = file.extension.toLowerCase(); const fileData = await this.app.vault.read(file);
                window.requestAnimationFrame(async () => { 
                    if (format === 'svg') {
                        const ex = extractDataFromSvg(fileData);
                        if (ex) {
                            wrapper.empty(); const svgContainer = createSpan(); svgContainer.innerHTML = this.namespaceSvgIds(fileData); const svgNode = svgContainer.querySelector('svg');
                            if (svgNode) { svgNode.setCssStyles({ width: `${this.settings.inlineWidth}px`, height: `${this.settings.inlineHeight}px` }); } wrapper.appendChild(svgContainer);
                        } else { wrapper.empty(); wrapper.appendChild(document.createTextNode(`❌`)); }
                    } else {
                        const previewEl = await this.renderMoleculeToPreview(fileData, format, true); 
                        if (previewEl) { wrapper.empty(); wrapper.appendChild(previewEl); } else { wrapper.empty(); wrapper.appendChild(document.createTextNode(`❌`)); } 
                    }
                });
                wrapper.addEventListener("dblclick", async (e) => {
                    e.stopPropagation(); const freshData = await this.app.vault.read(file);
                    let openData = freshData; let openFormat = format;
                    if (format === 'svg') { const ex = extractDataFromSvg(freshData); if (ex) { openData = ex.data; openFormat = 'svg'; } else { new Notice("Not a Ketcher SVG"); return; } }
                    new KetcherModal(this, openData, openFormat, async (newData, isFile, newFormat) => {
                        if (isFile) { new Notice(`Saved as new file: ${newData}. Please manually update the link in your document.`); return; }
                        if (newFormat && newFormat !== format && format !== 'svg') { new Notice(`Format upgraded to ${newFormat}. Remember to rename your inline file.`); }
                        await this.app.vault.modify(file, newData); wrapper.empty(); wrapper.appendChild(document.createTextNode(`⏳`));
                        if (format === 'svg') {
                            wrapper.empty(); const svgContainer = createDiv(); svgContainer.innerHTML = this.namespaceSvgIds(newData); const svgNode = svgContainer.querySelector('svg'); if (svgNode) { svgNode.setCssStyles({ width: '100%', height: '100%' }); } wrapper.appendChild(svgContainer);
                        } else { const updatedEl = await this.renderMoleculeToPreview(newData, newFormat || format, true); if (updatedEl) { wrapper.empty(); wrapper.appendChild(updatedEl); } }
                    }).open();
                });
            } else { wrapper.empty(); wrapper.appendChild(document.createTextNode(`❌`)); }
        }
    }

    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); }
	
	async renderMoleculeToPreview(data: string, format: string, isInline: boolean = false, overrideW?: number, overrideH?: number): Promise<HTMLElement | null> {
        if (!data) return null;
        const normalizedFormat = format ? format.toLowerCase() : 'smiles'; const cleanData = normalizedFormat === 'smiles' || normalizedFormat === 'eln' ? data.trim() : data; 
        const w = overrideW ? overrideW : (isInline ? this.settings.inlineWidth : this.settings.width); 
        const h = overrideH ? overrideH : (isInline ? this.settings.inlineHeight : this.settings.height); 
        const theme = document.body.hasClass("theme-dark") ? this.settings.darkTheme : this.settings.lightTheme; const drawerOptions = { width: w * 2, height: h * 2 };

        try {
            if (normalizedFormat === 'smiles' || normalizedFormat === 'eln') {
                // @ts-ignore
                const Smi: any = SmiDrawer;
                if (cleanData.includes('>')) {
                    const rxnContainer = createDiv(); rxnContainer.setCssStyles({ display: "flex", alignItems: "center", justifyContent: "center" });
                    Smi.parseReaction(cleanData, (tree: any) => {
                        if (this.settings.useSvgSmiles) { const rxnDrawer = new Smi.ReactionDrawer({width: w, height: h}, {width: w, height: h}); rxnDrawer.draw(tree, rxnContainer, theme); } 
                        else { const rxnDrawer = new Smi.ReactionDrawer(drawerOptions, drawerOptions); rxnDrawer.draw(tree, rxnContainer, theme); const canvases = rxnContainer.querySelectorAll('canvas'); canvases.forEach(c => { c.setCssStyles({ width: `${c.width / 2}px`, height: `${c.height / 2}px` }); }); }
                    }); return rxnContainer;
                } else {
                    if (this.settings.useSvgSmiles) {
                        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("width", `${w}px`); svg.setAttribute("height", `${h}px`); Smi.parse(cleanData, (tree: any) => { const drawer = new Smi.SvgDrawer({width: w, height: h}); drawer.draw(tree, svg, theme); }); return svg;
                    } else {
                        const canvas = document.createElement("canvas"); canvas.setAttribute("width", `${w}px`); canvas.setAttribute("height", `${h}px`); Smi.parse(cleanData, (tree: any) => { const drawer = new Smi.Drawer(drawerOptions); drawer.draw(tree, canvas, theme); }); return canvas;
                    }
                }
            } else if (['mol', 'cdxml', 'sdf', 'rxn', 'rdf', 'cml', 'ket', 'inchi', 'smarts', 'fasta', 'sequence', 'idt', 'helm', 'biln'].includes(normalizedFormat)) {
                return new Promise((resolve) => { this.headlessQueue.push({ data: cleanData, isInline, resolve, w, h }); this.processHeadlessQueue(); });
            } return null;
        } catch (e) { return null; }
    }

    async processHeadlessQueue() {
        if (this.isProcessingHeadless || !this.headlessKetcher || this.headlessQueue.length === 0) return;
        this.isProcessingHeadless = true; const task = this.headlessQueue.shift(); if (!task) { this.isProcessingHeadless = false; return; }
        let isResolved = false; const timeoutId = window.setTimeout(() => { if (isResolved) return; isResolved = true; task.resolve(this.createErrorCard("Preview timed out")); this.rebootHeadlessKetcher(); }, 12000); 

        try {
            let img;
            try { img = await this.headlessKetcher.generateImage(task.data, { outputFormat: 'svg' }); } 
            catch (err) { await this.headlessKetcher.setMolecule(task.data); const ket = await this.headlessKetcher.getKet(); img = await this.headlessKetcher.generateImage(ket, { outputFormat: 'svg' }); }
            
            let svgText = "";
            if (typeof img === 'string') {
                if (img.startsWith('data:image/svg+xml;base64,')) { svgText = atob(img.split(',')[1]); } 
                else if (img.startsWith('data:image/svg+xml;utf8,')) { svgText = decodeURIComponent(img.split(',')[1]); } 
                else { svgText = img; }
            } else if (img instanceof Blob) { svgText = await img.text(); } 
            else if (img && img.data) { svgText = img.data; }

            if (svgText && svgText.includes('<svg')) {
                svgText = this.namespaceSvgIds(svgText);
                const parser = new DOMParser(); const doc = parser.parseFromString(svgText, 'image/svg+xml'); const svgEl = doc.documentElement;
                const wAttr = svgEl.getAttribute('width'); const hAttr = svgEl.getAttribute('height');
                if (wAttr && hAttr && !svgEl.hasAttribute('viewBox')) { const parsedW = parseFloat(wAttr.replace(/px/g, '')); const parsedH = parseFloat(hAttr.replace(/px/g, '')); if (!isNaN(parsedW) && !isNaN(parsedH)) { svgEl.setAttribute('viewBox', `0 0 ${parsedW} ${parsedH}`); } }

                svgEl.removeAttribute('width'); svgEl.removeAttribute('height'); svgEl.setCssStyles({ width: '100%', height: '100%' });
                const w = task.w ? task.w : (task.isInline ? this.settings.inlineWidth : this.settings.width); const h = task.h ? task.h : (task.isInline ? this.settings.inlineHeight : this.settings.height);
                const container = createDiv({ cls: 'chemedit-svg-preview' }); container.setCssStyles({ width: `${w}px`, height: `${h}px`, display: 'flex', justifyContent: 'center', alignItems: 'center', lineHeight: 'normal', fontFamily: 'Arial, Helvetica, sans-serif', letterSpacing: 'normal', textAlign: 'left' }); container.appendChild(svgEl);

                isResolved = true; window.clearTimeout(timeoutId); task.resolve(container); this.finishHeadlessTask(); return;
            } throw new Error("Empty image returned");
        } catch (e) { if (!isResolved) { isResolved = true; window.clearTimeout(timeoutId); task.resolve(this.createErrorCard("Invalid chemical format")); this.finishHeadlessTask(); } }
    }

    finishHeadlessTask() { this.isProcessingHeadless = false; window.setTimeout(() => this.processHeadlessQueue(), 25); }
    
    async injectNativeEmbed(embed: HTMLElement, src: string, sourcePath: string) {
        const file = this.app.metadataCache.getFirstLinkpathDest(src, sourcePath); if (!(file instanceof TFile)) { embed.empty(); embed.createDiv({ text: `File not found: ${src}`, cls: "chem-native-embed-wrapper color-red" }); return; }
        const format = file.extension.toLowerCase(); const fileData = await this.app.vault.read(file);
        let extractedSvgData = null; if (format === 'svg') { extractedSvgData = extractDataFromSvg(fileData); if (!extractedSvgData) return;  }
        embed.classList.add('chem-custom-embed');
        const wrapper = createDiv({ cls: "chem-native-embed-wrapper" }); wrapper.setCssStyles({ cursor: "pointer", display: "flex", justifyContent: "center", margin: "10px 0" }); wrapper.title = `Double-click to edit ${file.name}`;
        const loadingDiv = wrapper.createDiv({ text: `⏳ Loading ${file.extension.toUpperCase()}...`, cls: "color-text-muted" }); loadingDiv.setCssStyles({ padding: "15px", border: "1px solid var(--background-modifier-border)", borderRadius: "8px" });
        embed.empty(); embed.appendChild(wrapper);
        const observer = new MutationObserver(() => { if (!embed.contains(wrapper)) { embed.empty(); embed.appendChild(wrapper); } }); observer.observe(embed, { childList: true });

        window.requestAnimationFrame(async () => {
            let previewEl: HTMLElement | null = null;
            if (format === 'svg') { previewEl = createDiv(); previewEl.innerHTML = this.namespaceSvgIds(fileData); const svgNode = previewEl.querySelector('svg'); if (svgNode) { svgNode.setCssStyles({ width: '100%', height: '100%' }); } } 
            else { previewEl = await this.renderMoleculeToPreview(fileData, format, false);  }
            if (previewEl) { wrapper.empty(); previewEl.setCssStyles({ border: "1px solid var(--background-modifier-border)", borderRadius: "8px", padding: "10px", backgroundColor: "var(--background-primary)" }); wrapper.appendChild(previewEl); } 
            else { wrapper.empty(); wrapper.appendChild(this.createErrorCard(`Failed to render ${file.name}`)); }
        });

        wrapper.addEventListener("dblclick", async (e) => {
            e.stopPropagation(); e.preventDefault(); const freshData = await this.app.vault.read(file); let openData = freshData; let openFormat = format;
            if (format === 'svg' && extractedSvgData) { openData = extractedSvgData.data; openFormat = 'svg';  }
            new KetcherModal(this, openData, openFormat, async (newData, isFile, newFormat) => {
                if (isFile) { new Notice(`Saved as new file: ${newData}. Please manually update the link in your document.`); return; }
                if (newFormat && newFormat !== format && format !== 'svg') { new Notice(`Format upgraded to ${newFormat}. Remember to rename your inline file.`); }
                await this.app.vault.modify(file, newData); wrapper.empty(); wrapper.createDiv({ text: "⏳ Updating...", cls: "color-text-muted" }).setCssStyles({ padding: "15px", border: "1px solid var(--background-modifier-border)", borderRadius: "8px" });
                if (format === 'svg') { wrapper.empty(); const svgContainer = createDiv(); svgContainer.innerHTML = this.namespaceSvgIds(newData); const svgNode = svgContainer.querySelector('svg'); if (svgNode) { svgNode.setCssStyles({ width: '100%', height: '100%' }); } svgContainer.setCssStyles({ border: "1px solid var(--background-modifier-border)", borderRadius: "8px", padding: "10px", backgroundColor: "var(--background-primary)" }); wrapper.appendChild(svgContainer); } 
                else { const updatedEl = await this.renderMoleculeToPreview(newData, newFormat || format, false); if (updatedEl) {  wrapper.empty(); updatedEl.setCssStyles({ border: "1px solid var(--background-modifier-border)", borderRadius: "8px", padding: "10px", backgroundColor: "var(--background-primary)" }); wrapper.appendChild(updatedEl); } }
            }).open();
        });
    }
}