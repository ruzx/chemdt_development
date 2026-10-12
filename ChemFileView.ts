// ChemFileView.ts
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises */

import { TextFileView, WorkspaceLeaf, Notice } from 'obsidian';
import type ChemEditPlugin from './main';
import { KetcherModal } from './KetcherModals';

export const CHEM_FILE_VIEW_TYPE = "chem-file-view";

export class ChemFileView extends TextFileView {
    plugin: ChemEditPlugin; 
    
    constructor(leaf: WorkspaceLeaf, plugin: ChemEditPlugin) { 
        super(leaf); 
        this.plugin = plugin; 
    }
    
    getViewType() { return CHEM_FILE_VIEW_TYPE; } 
    getDisplayText() { return this.file ? this.file.name : "Molecule View"; } 
    getIcon() { return "hexagon"; } 
    getViewData() { return this.data; }
    
    async setViewData(data: string, clear: boolean) {
        this.data = data; 
        const container = this.contentEl; 
        container.empty();
        
        const wrapper = container.createDiv(); 
        wrapper.setCssStyles({ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", cursor: "pointer" });
        wrapper.title = "Double-click to edit"; 
        wrapper.createDiv({ cls: "color-text-muted", text: "Loading preview..." });
        
        const format = this.file?.extension === 'cdxml' ? 'cdxml' : 'mol';
        
        window.requestAnimationFrame(async () => { 
            const previewEl = await this.plugin.renderMoleculeToPreview(data, format); 
            wrapper.empty(); 
            if (previewEl) { 
                wrapper.appendChild(previewEl); 
            } else { 
                wrapper.appendChild(this.plugin.createErrorCard("Failed to load view")); 
            } 
        });
        
        wrapper.ondblclick = () => {
            new KetcherModal(this.plugin, this.data, format, async (newData, isFile, newFormat) => {
                if (isFile) { new Notice(`Saved as new file: ${newData}`); return; }
                if (newFormat && newFormat !== format) { new Notice(`Format was upgraded to ${newFormat}. Please rename the file extension!`); }
                this.data = newData; 
                this.requestSave(); 
                void this.setViewData(newData, false); 
            }).open();
        };
    }
    
    clear() { 
        this.data = ""; 
        this.contentEl.empty(); 
    }
}