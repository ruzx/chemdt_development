// SharedGallery.ts
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises */

import { TFile } from 'obsidian';

export class SharedGalleryRenderer {
    plugin: any;

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    async renderChemGallery(source: string, el: HTMLElement, ctx: any) {
        // Parse the folder path
        const match = source.match(/path:\s*['"]?(.*?)['"]?(?:\n|$)/);
        const folderPath = match ? match[1].trim() : "";

        if (!folderPath) {
            const err = document.createElement("div");
            err.textContent = "⚠️ Please specify a folder path (e.g., path: Molecules/)";
            err.className = "color-text-error";
            el.appendChild(err);
            return;
        }

        const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
        if (!folder || !('children' in folder)) {
            const err = document.createElement("div");
            err.textContent = `⚠️ Folder not found: ${folderPath}`;
            err.className = "color-text-error";
            el.appendChild(err);
            return;
        }

        const validExts = ['mol', 'cdxml', 'sdf', 'rxn', 'ket', 'smi', 'smiles', 'md'];
        const files = folder.children.filter((f: any) => f instanceof TFile && validExts.includes(f.extension.toLowerCase()));

        if (files.length === 0) {
            const err = document.createElement("div");
            err.textContent = "No supported files found in this folder.";
            err.className = "color-text-muted";
            el.appendChild(err);
            return;
        }

        // --- HEADER & SEARCH BAR ---
        const header = document.createElement("div");
        header.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px", flexWrap: "wrap", gap: "10px" });
        const countLabel = document.createElement("div");
        countLabel.textContent = `Loading...`;
        countLabel.setCssStyles({ fontSize: "13px", color: "var(--text-muted)", fontWeight: "500" });
        header.appendChild(countLabel);
        
        const searchInput = document.createElement("input");
        searchInput.type = "search";
        searchInput.placeholder = "Search name or SMILES...";
        searchInput.setCssStyles({ width: "250px", padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--background-modifier-border)", background: "var(--background-primary)" });
        header.appendChild(searchInput);
        
        el.appendChild(header);

        // --- GRID CONTAINER ---
        const container = document.createElement("div");
        container.className = "chem-gallery-container";
        container.setCssStyles({ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "15px", padding: "5px 0" });
        el.appendChild(container);

        const cards: { el: HTMLElement, text: string }[] = [];
        let renderCount = 0;

        for (const file of files) {
            let dataToRender = "";
            let renderFormat = file.extension.toLowerCase();
            let searchableText = file.name.toLowerCase();

            // Handle MD files (extract first SMILES)
            if (renderFormat === 'md') {
                const content = await this.plugin.app.vault.cachedRead(file);
                
                // Match ```smiles block
                const blockMatch = content.match(/```smiles\s*\n([\s\S]*?)\n```/);
                
                // Match inline $smiles=
                const prefix = this.plugin.settings.inlineSmilesPrefix || '$smiles=';
                const escapedPrefix = prefix.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                const inlineRegex = new RegExp(`${escapedPrefix}([^\\s]+)`);
                const inlineMatch = content.match(inlineRegex);

                if (blockMatch) {
                    dataToRender = blockMatch[1].trim();
                } else if (inlineMatch) {
                    dataToRender = inlineMatch[1].trim();
                } else {
                    continue; // Skip MD files that have no SMILES strings inside them
                }
                renderFormat = 'smiles';
                searchableText += " " + dataToRender.toLowerCase(); // Allow searching by the SMILES string itself
            } else {
                dataToRender = await this.plugin.app.vault.read(file);
                if (renderFormat === 'smi') renderFormat = 'smiles';
                if (renderFormat === 'smiles') searchableText += " " + dataToRender.toLowerCase();
            }

            renderCount++;

            // --- CREATE CARD ---
            const card = document.createElement("div");
            card.className = "chem-gallery-card";
            card.setCssStyles({ border: "1px solid var(--background-modifier-border)", borderRadius: "8px", padding: "10px", display: "flex", flexDirection: "column", alignItems: "center", backgroundColor: "var(--background-primary)", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.05)", transition: "border-color 0.2s ease" });
            
            card.onmouseover = () => card.setCssStyles({ borderColor: "var(--interactive-accent)" });
            card.onmouseout = () => card.setCssStyles({ borderColor: "var(--background-modifier-border)" });

            // Image wrapper
            const previewWrapper = document.createElement("div");
            previewWrapper.setCssStyles({ width: "100%", height: "100px", display: "flex", justifyContent: "center", alignItems: "center" });
            const pText = document.createElement("span");
            pText.textContent = "⏳ Loading...";
            pText.className = "color-text-muted";
            pText.setCssStyles({ fontSize: "12px" });
            previewWrapper.appendChild(pText);
            card.appendChild(previewWrapper);

            // Label
            const label = document.createElement("div");
            label.textContent = file.name;
            label.setCssStyles({ fontSize: "12px", marginTop: "10px", textAlign: "center", wordBreak: "break-word", color: "var(--text-normal)", fontWeight: "500" });
            
            if (file.extension.toLowerCase() === 'md') {
                label.setCssStyles({ color: "var(--text-accent)" }); 
            }
            card.appendChild(label);
            container.appendChild(card);

            cards.push({ el: card, text: searchableText });

            // --- CLICK BEHAVIOR ---
            card.onclick = async () => {
                if (file.extension.toLowerCase() === 'md') {
                    // Open the markdown note in Obsidian
                    this.plugin.app.workspace.getLeaf(false).openFile(file);
                } else {
                    // Open Ketcher editor for pure chemical files
                    const freshData = await this.plugin.app.vault.read(file);
                    this.plugin.openKetcherForFile(file, freshData, renderFormat, previewWrapper);
                }
            };

            // --- RENDER IMAGE ---
            window.requestAnimationFrame(async () => {
                const originalW = this.plugin.settings.width; 
                const originalH = this.plugin.settings.height;
                this.plugin.settings.width = 120; 
                this.plugin.settings.height = 100; // force tiny render
                
                try {
                    const previewEl = await this.plugin.renderMoleculeToPreview(dataToRender, renderFormat, false);
                    previewWrapper.empty();
                    if (previewEl) {
                        previewEl.setCssStyles({ maxWidth: '100%', maxHeight: '100%' });
                        previewWrapper.appendChild(previewEl);
                    } else {
                        const err = document.createElement("span");
                        err.textContent = "❌ Error";
                        previewWrapper.appendChild(err);
                    }
                } catch(e) {
                    previewWrapper.empty();
                    const err = document.createElement("span");
                    err.textContent = "❌ Error";
                    previewWrapper.appendChild(err);
                } finally {
                    this.plugin.settings.width = originalW;
                    this.plugin.settings.height = originalH;
                }
            });
        }

        countLabel.textContent = `${renderCount} molecules`;

        // --- REAL-TIME SEARCH LOGIC ---
        searchInput.addEventListener("input", (e: any) => {
            const query = e.target.value.toLowerCase();
            let visibleCount = 0;
            cards.forEach(c => {
                if (c.text.includes(query)) {
                    c.el.setCssStyles({ display: "flex" });
                    visibleCount++;
                } else {
                    c.el.setCssStyles({ display: "none" });
                }
            });
            countLabel.textContent = `${visibleCount} / ${renderCount} molecules`;
        });
    }
}