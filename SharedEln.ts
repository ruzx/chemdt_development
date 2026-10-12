// SharedEln.ts
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises */

import { App, Modal, Notice, requestUrl, MarkdownView, TFile, Menu, FuzzySuggestModal, parseYaml, stringifyYaml } from 'obsidian';
import { takeStandardPhoto, saveMediaFile, TlcModal } from './SharedMedia';
import { ChemDataEngine } from './ChemDataEngine';

// ------------------------------------------------------------------
// OFFLINE MOLECULAR WEIGHT CALCULATOR (Indigo Primary + OpenChemLib + Web Fallback)
// ------------------------------------------------------------------
export async function calculateMwOffline(smiles: string, plugin?: any): Promise<{ mw: number, formula: string }> {
    try {
        let cleanSmiles = smiles.split(' |')[0].trim();
        const sForMw = cleanSmiles.replace(/[\/\\]/g, '');

        if (plugin) {
            let bootWait = 0;
            while (!plugin.headlessKetcher && bootWait < 50) {
                await new Promise(r => window.setTimeout(r, 100));
                bootWait++;
            }

            if (plugin.headlessKetcher && typeof plugin.headlessKetcher.calculate === 'function') {
                let timeout = 0;
                while (plugin.isProcessingHeadless && timeout < 100) { 
                    await new Promise(r => window.setTimeout(r, 50));
                    timeout++;
                }
                
                if (!plugin.isProcessingHeadless) {
                    plugin.isProcessingHeadless = true; 
                    try {
                        const calcTask = async () => {
                            await plugin.headlessKetcher.setMolecule("");
                            await plugin.headlessKetcher.setMolecule(sForMw);
                            await new Promise(r => window.setTimeout(r, 50)); 
                            return await plugin.headlessKetcher.calculate();
                        };

                        const ketcherProps = await Promise.race([
                            calcTask(),
                            new Promise<any>((_, reject) => window.setTimeout(() => reject(new Error("Ketcher timeout")), 3000))
                        ]);

                        if (ketcherProps && ketcherProps['molecular-weight']) {
                            const mw = Number(ketcherProps['molecular-weight']);
                            const formula = ketcherProps['gross'] || "";
                            if (!isNaN(mw) && mw > 0) return { mw, formula };
                        }
                    } catch(e) {
                        console.warn("ChemEdit: Headless MW calculation failed, falling back to OCL/Web.", e);
                    } finally {
                        plugin.isProcessingHeadless = false; 
                        if (plugin.headlessQueue && plugin.headlessQueue.length > 0) {
                            window.setTimeout(() => plugin.processHeadlessQueue(), 10);
                        }
                    }
                }
            }
        }

        const props = ChemDataEngine.getPropertiesFromSmiles(sForMw);
        if (props && props.mw > 0) return { mw: props.mw, formula: props.formula };

        try {
            const mwRes = await requestUrl(`https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(sForMw)}/mw`);
            const formulaRes = await requestUrl(`https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(sForMw)}/formula`);
            if (mwRes.status === 200 && formulaRes.status === 200) {
                return { mw: parseFloat(mwRes.text), formula: formulaRes.text.trim() };
            }
        } catch (e) {}

        try {
            const res = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(sForMw)}/property/MolecularWeight,MolecularFormula/JSON`);
            if (res.status === 200) {
                const p = res.json.PropertyTable.Properties[0];
                return { mw: parseFloat(p.MolecularWeight), formula: p.MolecularFormula };
            }
        } catch(e) {}

    } catch(e) {}
    
    return fallbackMW(smiles);
}

export function fallbackMW(smiles: string) {
    let mw = 0;
    const els = smiles.match(/(Cl|Br|Na|Mg|Ca|Fe|Pd|Si|Se|Te|Zn|Cu|Ni|Co|Mn|Cr|V|Ti|Sc|K|Li|B|C|N|O|F|P|S|I|c|n|o|p|s)/g);
    if (els) {
         const masses: Record<string, number> = {
            'C':12.011, 'c':12.011, 'N':14.007, 'n':14.007, 'O':15.999, 'o':15.999, 
            'S':32.065, 's':32.065, 'P':30.974, 'p':30.974, 'F':18.998, 
            'Cl':35.45, 'Br':79.904, 'I':126.90, 'B':10.81,
            'Pd':106.42, 'Fe':55.845, 'K':39.098, 'Na':22.99, 'Mg':24.305, 'Ca':40.078
         };
         els.forEach(e => {
             if (masses[e]) mw += masses[e];
             else if (masses[e.toUpperCase()]) mw += masses[e.toUpperCase()];
         });
         mw += els.length * 1.008; 
         return { mw, formula: "Est." };
    }
    return { mw: 0, formula: "Unknown" };
}

export const DEFAULT_LIBRARY = [
    { name: "DCM (Dichloromethane)", smiles: "ClCCl" },
    { name: "THF (Tetrahydrofuran)", smiles: "C1CCOC1" },
    { name: "EtOAc (Ethyl Acetate)", smiles: "CCOC(C)=O" },
    { name: "DMF (Dimethylformamide)", smiles: "CN(C)C=O" },
    { name: "DMSO (Dimethyl Sulfoxide)", smiles: "CS(C)=O" },
    { name: "MeOH (Methanol)", smiles: "CO" },
    { name: "EtOH (Ethanol)", smiles: "CCO" },
    { name: "DIPEA (Hünig's Base)", smiles: "CCN(C(C)C)C(C)C" },
    { name: "TEA (Triethylamine)", smiles: "CCN(CC)CC" },
    { name: "DMAP", smiles: "CN(C)c1ccncc1" },
    { name: "HATU", smiles: "CN(C)C(=[N+](C)C)N1N=NC2=CC=CC=C21.F[P-](F)(F)(F)(F)F" },
    { name: "NaOH (Sodium Hydroxide)", smiles: "[OH-].[Na+]" },
    { name: "NaHCO3 (Sodium Bicarbonate)", smiles: "OC([O-])=O.[Na+]" },
    { name: "Na2SO4 (Sodium Sulfate)", smiles: "[Na+].[Na+].[O-]S(=O)(=O)[O-]" },
    { name: "MgSO4 (Magnesium Sulfate)", smiles: "[Mg+2].[O-]S(=O)(=O)[O-]" }
];

export async function getCompoundLibrary(plugin: any): Promise<{name: string, smiles: string}[]> {
    const path = plugin.settings?.libraryFilePath;
    if (!path) return DEFAULT_LIBRARY;

    const file = plugin.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
        try {
            const content = await plugin.app.vault.read(file);
            const results: {name: string, smiles: string}[] = [];
            
            const lines = content.split('\n');
            for (const line of lines) {
                if (line.trim().startsWith('|')) {
                    const parts = line.split('|').map((p: string) => p.trim());
                    if (parts.length >= 3 && parts[1] && parts[2] && !parts[1].includes('---') && parts[1].toLowerCase() !== 'name') {
                        results.push({name: parts[1], smiles: parts[2]});
                    }
                }
                const listMatch = line.match(/^-\s+(.+?):\s+(.+)$/);
                if (listMatch) results.push({name: listMatch[1].trim(), smiles: listMatch[2].trim()});
            }
            if (results.length > 0) return results;
        } catch (e) {}
    }
    return DEFAULT_LIBRARY;
}

export async function addCompoundToLibrary(plugin: any, name: string, smiles: string) {
    const path = plugin.settings?.libraryFilePath;
    if (path) {
        let file = plugin.app.vault.getAbstractFileByPath(path);
        if (!file) {
            const header = `# Compound Library\n\n| Name | SMILES |\n|---|---|\n`;
            file = await plugin.app.vault.create(path, header);
        }
        if (file instanceof TFile) {
            const content = await plugin.app.vault.read(file);
            const newEntry = `| ${name} | ${smiles} |`;
            await plugin.app.vault.modify(file, content + (content.endsWith('\n') ? '' : '\n') + newEntry + '\n');
            new Notice(`${name} added to library file!`);
            return;
        }
    }
    
    if (!plugin.settings.compoundLibrary) plugin.settings.compoundLibrary = [];
    plugin.settings.compoundLibrary.push({ name, smiles });
    await plugin.saveSettings();
    new Notice(`${name} added to internal library!`);
}

export class CompoundSuggestModal extends FuzzySuggestModal<{name: string, smiles: string}> {
    library: {name: string, smiles: string}[];
    onChoose: (result: {name: string, smiles: string}) => void;
    constructor(app: App, library: {name: string, smiles: string}[], onChoose: (result: {name: string, smiles: string}) => void) {
        super(app); this.library = library; this.onChoose = onChoose; this.setPlaceholder("Search compound library...");
    }
    getItems() { return this.library; }
    getItemText(item: {name: string, smiles: string}) { return item.name; }
    onChooseItem(item: {name: string, smiles: string}, evt: MouseEvent | KeyboardEvent) { this.onChoose(item); }
}

export class AddToLibraryModal extends Modal {
    name: string = ""; smiles: string; onSubmit: (name: string, smiles: string) => void;
    constructor(app: App, smiles: string, onSubmit: (name: string, smiles: string) => void) { super(app); this.smiles = smiles; this.onSubmit = onSubmit; }
    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "Add to Compound Library" });
        
        const p = contentEl.createEl("p", { text: `SMILES: ${this.smiles.substring(0, 50)}${this.smiles.length > 50 ? '...' : ''}` });
        p.setCssStyles({ color: "var(--text-muted)", fontFamily: "monospace", fontSize: "11px", wordBreak: "break-all" });
        
        const input = contentEl.createEl("input", { type: "text", placeholder: "Compound Name (e.g. THF)" });
        input.setCssStyles({ width: "100%", marginBottom: "15px" });
        input.onchange = (e: any) => this.name = e.target.value;
        
        const btnRow = contentEl.createDiv();
        btnRow.setCssStyles({ display: "flex", justifyContent: "flex-end", gap: "10px" });
        const cancelBtn = btnRow.createEl("button", { text: "Cancel" }); cancelBtn.onclick = () => this.close();
        const btn = btnRow.createEl("button", { text: "Add to Library", cls: "mod-cta" });
        
        btn.onclick = () => { if (!this.name.trim()) { new Notice("Please enter a name."); return; } this.onSubmit(this.name.trim(), this.smiles); this.close(); };
        input.addEventListener("keypress", (e) => { if (e.key === "Enter") btn.click(); });
        window.setTimeout(() => input.focus(), 50);
    }
    onClose() { this.contentEl.empty(); }
}

class ElnCalculator {
    static calculate(data: any) {
        if (!data.reactants) data.reactants = [];
        if (!data.products) data.products = [];

        let limitingR = data.reactants.find((r: any) => r.is_limiting);
        if (!limitingR && data.reactants.length > 0) {
            limitingR = data.reactants.find((r: any) => r.eq === 1) || data.reactants[0];
            limitingR.is_limiting = true;
        }

        let refMmol = 0;
        if (limitingR) {
            const eq = limitingR.eq || 1;
            if (limitingR.mmol !== undefined && limitingR.mmol !== null && limitingR.mmol !== 0) {
                refMmol = limitingR.mmol / eq;
            } else if (limitingR.mass !== undefined && limitingR.mass !== null && limitingR.mass !== 0 && limitingR.mw) {
                const pureMass = limitingR.mass * ((limitingR.purity || 100) / 100);
                refMmol = (pureMass / limitingR.mw) / eq;
            } else if (limitingR.volume !== undefined && limitingR.volume !== null && limitingR.volume !== 0 && limitingR.molarity) {
                refMmol = (limitingR.volume * limitingR.molarity) / eq;
            }
        }

        data.reactants.forEach((r: any) => {
            r.eq = r.eq !== undefined ? r.eq : 1;
            r.mmol = refMmol * r.eq;
            
            if (r.molarity && r.molarity > 0) {
                r.volume = r.mmol / r.molarity; 
                if (r.mw && r.mass === undefined) r.mass = r.mmol * r.mw; 
            } else if (r.mw) {
                const neededPureMass = r.mmol * r.mw;
                r.mass = neededPureMass / ((r.purity || 100) / 100);
                if (r.density && r.density > 0) r.volume = (r.mass / 1000) / r.density;
            }
        });

        data.products.forEach((p: any) => {
            p.eq = p.eq !== undefined ? p.eq : 1; 
            p.theory_mmol = refMmol * p.eq; 
            if (p.mw) p.theory_mass = p.theory_mmol * p.mw;

            if (p.mmol_isolated !== undefined && p.mw && p.mass_isolated === undefined) {
                p.mass_isolated = p.mmol_isolated * p.mw;
            } else if (p.mass_isolated !== undefined && p.mw && p.mmol_isolated === undefined) {
                p.mmol_isolated = p.mass_isolated / p.mw;
            }

            if (p.mmol_isolated !== undefined && p.theory_mmol) { 
                p.yield = ((p.mmol_isolated / p.theory_mmol) * 100).toFixed(1); 
            } else if (p.mass_isolated !== undefined && p.theory_mass) {
                p.yield = ((p.mass_isolated / p.theory_mass) * 100).toFixed(1);
            }
        });

        return data;
    }
}

export class SharedElnRenderer {
    plugin: any;

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    async renderElnBlock(source: string, el: HTMLElement, ctx: any) {
        const wrapper = el.createDiv();
        wrapper.setCssStyles({ 
            position: "relative", 
            border: "1px solid var(--background-modifier-border)", 
            padding: "45px 15px 15px 15px", 
            borderRadius: "12px", 
            backgroundColor: "var(--background-primary)", 
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)", 
            fontFamily: "var(--font-interface)", 
            width: "100%" 
        });
        
        wrapper.createEl("h3", { cls: "color-text-muted", text: "⏳ Calculating..." }).setCssStyles({ textAlign: "center" });

        try {
            const safeSource = source.replace(/smiles:\s*(.*)$/gm, (match, p1) => {
                let s = p1.trim();
                if (!s) return match;
                let comment = "";
                const commentMatch = s.match(/(\s+#.*)$/);
                if (commentMatch) { comment = commentMatch[1]; s = s.substring(0, s.length - comment.length).trim(); }
                if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.substring(1, s.length - 1);
                s = s.replace(/\\"/g, '"'); s = s.replace(/'/g, "''"); 
                return `smiles: '${s}'${comment}`;
            });
            
            let data = parseYaml(safeSource);
            if (!data) throw new Error("Empty YAML Data.");
            if (!data.reactants) data.reactants = [];
            if (!data.products) data.products = [];

            // Auto-heal missing MW (Silent, Fast)
            for (const r of data.reactants) { 
                const mwNum = Number(r.mw);
                if (r.smiles && (isNaN(mwNum) || mwNum <= 0 || r.formula === 'Est.')) { 
                    const p = await calculateMwOffline(r.smiles, this.plugin); 
                    if (p && p.mw > 0) { r.mw = p.mw; r.formula = p.formula; } 
                } 
            }
            for (const p of data.products) { 
                const mwNum = Number(p.mw);
                if (p.smiles && (isNaN(mwNum) || mwNum <= 0 || p.formula === 'Est.')) { 
                    const p2 = await calculateMwOffline(p.smiles, this.plugin); 
                    if (p2 && p2.mw > 0) { p.mw = p2.mw; p.formula = p2.formula; } 
                } 
            }

            data = ElnCalculator.calculate(data);

            const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            const currentFile = view ? view.file : null;
            const expCode = data.code || (currentFile ? currentFile.basename : "EXP");
            const filePrefix = expCode ? `${expCode.replace(/[/\\?%*:|"<>]/g, '-')}_` : "";

            wrapper.empty();

            // --- INLINE EDITING LISTENER (TEXT CELLS) ---
            wrapper.addEventListener('dblclick', (e) => {
                let target = e.target as HTMLElement;
                while (target && target !== wrapper && !target.classList.contains('eln-editable')) {
                    target = target.parentElement as HTMLElement;
                }

                if (target && target.classList.contains('eln-editable') && !target.querySelector('input')) {
                    e.stopPropagation();
                    const type = target.getAttribute('data-type');
                    const idx = parseInt(target.getAttribute('data-idx') || '0', 10);
                    const key = target.getAttribute('data-key');
                    const inputType = target.getAttribute('data-input-type') || 'number';
                    if (!key) return;

                    const originalChildren = Array.from(target.childNodes);
                    const currentValText = target.getAttribute('data-raw-value') || '';
                    
                    target.empty();
                    target.setCssStyles({ padding: "4px" });
                    
                    const input = document.createElement('input');
                    input.type = inputType === 'text' ? 'text' : 'number';
                    if (inputType === 'number') input.step = "any";
                    input.value = currentValText;
                    
                    input.setCssStyles({ width: "100%", boxSizing: "border-box", padding: "4px 6px", border: "1px solid var(--interactive-accent)", borderRadius: "4px", background: "var(--background-primary)" });
                    
                    target.appendChild(input);
                    input.focus();

                    const finishEdit = () => {
                        const newValStr = input.value.trim().replace(/,/g, '.'); 
                        let info = ctx.getSectionInfo(el);
                        if (!info && el.parentElement) info = ctx.getSectionInfo(el.parentElement);
                        
                        if (view && info) {
                            const scrollInfo = view.editor.getScrollInfo();
                            const cursor = view.editor.getCursor();
                            
                            const blockText = view.editor.getRange({line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                            try {
                                let yamlObj = parseYaml(blockText);
                                
                                let valToSave: any = newValStr;
                                if (inputType === 'number') {
                                    const num = parseFloat(newValStr);
                                    valToSave = isNaN(num) ? undefined : num;
                                } else { valToSave = newValStr === '' ? undefined : newValStr; }

                                if (type === 'root') {
                                    if (valToSave === undefined) delete yamlObj[key];
                                    else yamlObj[key] = valToSave;
                                } else {
                                    if (!yamlObj[type!]) yamlObj[type!] = [];
                                    if (!yamlObj[type!][idx]) yamlObj[type!] = {};
                                    
                                    if (valToSave === undefined) { delete yamlObj[type!][idx][key]; } 
                                    else {
                                        yamlObj[type!][idx][key] = valToSave;
                                        if (key === 'mmol') { delete yamlObj[type!][idx].mass; delete yamlObj[type!][idx].volume; }
                                        else if (key === 'mass') { delete yamlObj[type!][idx].mmol; delete yamlObj[type!][idx].volume; }
                                        else if (key === 'volume') { delete yamlObj[type!][idx].mmol; delete yamlObj[type!][idx].mass; }
                                        else if (key === 'mmol_isolated') { delete yamlObj[type!][idx].mass_isolated; }
                                        else if (key === 'mass_isolated') { delete yamlObj[type!][idx].mmol_isolated; }
                                    }
                                }
                                
                                yamlObj = ElnCalculator.calculate(yamlObj);
                                const newYaml = stringifyYaml(yamlObj);
                                view.editor.replaceRange(newYaml, {line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                                
                                window.setTimeout(() => {
                                    view.editor.scrollTo(scrollInfo.left, scrollInfo.top);
                                    view.editor.setCursor(cursor);
                                }, 15);
                                
                            } catch (err) { 
                                target.empty(); originalChildren.forEach(c => target.appendChild(c)); target.setCssStyles({ padding: "10px" }); 
                            }
                        } else { 
                            target.empty(); originalChildren.forEach(c => target.appendChild(c)); target.setCssStyles({ padding: "10px" }); 
                        }
                    };

                    input.onblur = finishEdit;
                    input.onkeydown = (ev) => { 
                        if (ev.key === 'Enter') input.blur(); 
                        else if (ev.key === 'Escape') { target.empty(); originalChildren.forEach(c => target.appendChild(c)); target.setCssStyles({ padding: "10px" }); }
                    };
                }
            });

            // --- ACTION BAR ---
            const actionBar = wrapper.createDiv();
            actionBar.setCssStyles({ position: "absolute", top: "8px", right: "10px", display: "flex", gap: "5px", zIndex: "10", flexWrap: "wrap", justifyContent: "flex-end" });

            const createBtn = (text: string, title: string, onClick: (e?: MouseEvent) => void) => {
                const btn = actionBar.createDiv();
                btn.setText(text);
                btn.title = title;
                btn.setCssStyles({ cursor: "pointer", fontSize: "11px", padding: "4px 8px", backgroundColor: "var(--background-secondary)", border: "1px solid var(--background-modifier-border)", color: "var(--text-normal)", borderRadius: "4px" });
                btn.onmouseover = () => btn.setCssStyles({ backgroundColor: "var(--background-modifier-hover)" });
                btn.onmouseout = () => btn.setCssStyles({ backgroundColor: "var(--background-secondary)" });
                btn.onclick = onClick; return btn;
            };

            const appendSmart = (text: string, keyword: string) => {
                if (!view) return;
                const editor = view.editor;
                const lines = editor.getValue().split('\n');
                
                let targetLine = lines.findIndex((line: string) => line.includes(`## 📝 Procedure`));
                if (targetLine === -1 && keyword === "Analytical Data") {
                    targetLine = lines.findIndex((line: string) => line.includes(`## 🔬 Analytical Data`));
                }
                
                if (targetLine !== -1) {
                    let insertLine = targetLine + 1;
                    while (insertLine < lines.length && !lines[insertLine].startsWith('##')) {
                        insertLine++;
                    }
                    while (insertLine > targetLine + 1 && lines[insertLine - 1].trim() === '') {
                        insertLine--;
                    }
                    editor.replaceRange(`\n${text}\n`, { line: insertLine, ch: 0 });
                } else {
                    let info = ctx.getSectionInfo(el);
                    if (!info && el.parentElement) info = ctx.getSectionInfo(el.parentElement);
                    if (info) editor.replaceRange(`\n${text}\n`, { line: info.lineEnd + 1, ch: 0 });
                }
            };

            const updateYamlState = (mutate: (y: any) => void) => {
                if (!view) return;
                let info = ctx.getSectionInfo(el);
                if (!info && el.parentElement) info = ctx.getSectionInfo(el.parentElement);
                if (!info) return;
                const blockText = view.editor.getRange({line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                try {
                    const yamlObj = parseYaml(blockText);
                    mutate(yamlObj);
                    const newYaml = stringifyYaml(yamlObj);
                    view.editor.replaceRange(newYaml, {line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                } catch (err) {}
            };

            createBtn("⚙️ Status", "Change Experiment Status", (e?: MouseEvent) => {
                if (!e) return;
                const menu = new Menu();
                menu.addItem((item) => item.setTitle("Mark as Planned").setIcon("calendar").onClick(() => updateYamlState(y => y.status = "Planned")));
                menu.addItem((item) => item.setTitle("Mark as Running").setIcon("play").onClick(() => updateYamlState(y => y.status = "Running")));
                menu.addItem((item) => item.setTitle("Mark as Completed").setIcon("check").onClick(() => updateYamlState(y => y.status = "Completed")));
                menu.addItem((item) => item.setTitle("Mark as Failed").setIcon("cross").onClick(() => updateYamlState(y => y.status = "Failed")));
                menu.addSeparator();
                menu.addItem((item) => item.setTitle("Recalculate MWs").setIcon("refresh-cw").onClick(() => {
                    updateYamlState(y => {
                        y.reactants?.forEach((r:any) => { delete r.mw; delete r.formula; });
                        y.products?.forEach((p:any) => { delete p.mw; delete p.formula; });
                    });
                    new Notice("Molecular weights recalculated!");
                }));
                menu.showAtMouseEvent(e);
            });

            createBtn("⚡ Macros", "Insert useful text snippets", (e?: MouseEvent) => {
                if (!e) return;
                const menu = new Menu();
                menu.addItem((item) => item.setTitle("🕒 Insert Current Time").setIcon("clock").onClick(() => {
                    const time = window.moment().format("HH:mm"); appendSmart(`**[${time}]:** `, "Procedure");
                }));
                menu.addItem((item) => item.setTitle("🧪 Aqueous Workup (EtOAc)").setIcon("beaker").onClick(() => {
                    appendSmart(`The reaction mixture was quenched with saturated aqueous NaHCO3 and extracted with EtOAc (3x). The combined organic layers were washed with brine, dried over anhydrous Na2SO4, filtered, and concentrated in vacuo.`, "Procedure");
                }));
                menu.addItem((item) => item.setTitle("⚗️ Column Chromatography").setIcon("filter").onClick(() => {
                    appendSmart(`The crude residue was purified by flash column chromatography on silica gel (Hexanes/EtOAc) to afford the desired product.`, "Procedure");
                }));
                menu.showAtMouseEvent(e);
            });

            createBtn("📷 Photo", "Add Photo", () => {
                takeStandardPhoto(async (buffer, ext) => {
                    const filename = `${filePrefix}Photo_${window.moment().format("HHmmss")}.${ext}`;
                    const link = await saveMediaFile(this.plugin.app, buffer, this.plugin.settings.mediaSavePath, filename);
                    appendSmart(`\n![[${link}]]\n`, "Photo"); new Notice(`Added ${filename}`);
                });
            });

            createBtn("🧪 TLC", "Add Digital TLC", () => {
                new TlcModal(this.plugin.app, async (pngData, rfData) => {
                    const filename = `${filePrefix}TLC_${window.moment().format("HHmmss")}.png`;
                    const link = await saveMediaFile(this.plugin.app, pngData, this.plugin.settings.mediaSavePath, filename);
                    let md = `\n![[${link}]]\n\n| Spot | $R_f$ |\n|---|---|\n`;
                    rfData.forEach((s, i) => md += `| ${i+1} | **${s.rf.toFixed(2)}** |\n`);
                    appendSmart(md, "Analytical Data"); new Notice(`Added ${filename}`);
                }).open();
            });
			
            createBtn("🌐 Share", "Create Web Link for Collaborators", () => {
                try {
                    const exportData = { reactants: [] as any[], products: [] as any[] };
                    const mapCompound = (c: any) => ({
                        id: Math.random().toString(36).substring(2, 9),
                        smiles: c.smiles || "",
                        name: c.name || "Compound",
                        mw: c.mw || 0,
                        eq: c.eq || null,
                        mmol: c.mmol || null,
                        mass: c.mass || null,
                        mass_isolated: c.mass_isolated || null,
                        yield: c.yield || null,
                        theory_mmol: c.theory_mmol || null
                    });

                    if (data.reactants) exportData.reactants = data.reactants.map(mapCompound);
                    if (data.products) exportData.products = data.products.map(mapCompound);

                    const jsonStr = JSON.stringify(exportData);
                    const binString = Array.from(new TextEncoder().encode(jsonStr), (byte) => String.fromCharCode(byte)).join("");
                    const b64 = btoa(binString);
                    const viewerUrl = `https://ruzx.github.io/elnviewer.html#eln=${b64}`;

                    navigator.clipboard.writeText(viewerUrl);
                    new Notice("🔗 Web link copied to clipboard!");
                } catch (e) {
                    new Notice("Failed to generate share link.");
                }
            });

            createBtn("📋 Copy", "Copy Stoichiometry Table to Clipboard", () => {
                let tsv = "Type\tName\tSMILES\tEq\tMW\tm [mg]\tn [mmol]\tV [mL]\tYield [%]\n";
                data.reactants.forEach((r: any) => tsv += `Reactant\t${r.name||''}\t${r.smiles||''}\t${r.eq||'-'}\t${r.mw?.toFixed(2)||'-'}\t${r.mass?.toFixed(1)||'-'}\t${r.mmol?.toFixed(2)||'-'}\t${r.volume?.toFixed(3)||'-'}\t-\n`);
                data.products.forEach((p: any) => tsv += `Product\t${p.name||''}\t${p.smiles||''}\t${p.eq||'-'}\t${p.mw?.toFixed(2)||'-'}\t${p.mass_isolated?.toFixed(1)||'-'}\t${p.mmol_isolated?.toFixed(2)||'-'}\t-\t${p.yield||'-'}\n`);
                navigator.clipboard.writeText(tsv); new Notice("Table copied to clipboard! Paste into Excel.");
            });

            createBtn("🗐 Clone", "Duplicate this experiment into a new file", () => {
                new CloneExperimentModal(this.plugin.app, this.plugin, expCode, currentFile, data).open();
            });

            createBtn("📝 Edit", "Edit Metadata & Conditions", () => {
                if (!view) return;
                let info = ctx.getSectionInfo(el);
                if (!info && el.parentElement) info = ctx.getSectionInfo(el.parentElement);
                if (info) {
                    new ElnMetaEditorModal(this.plugin.app, this.plugin, data, async (updatedYamlObj, shouldRename) => {
                        const newYaml = stringifyYaml(updatedYamlObj);
                        view.editor.replaceRange(`\`\`\`eln\n${newYaml}\`\`\``, {line: info.lineStart, ch: 0}, {line: info.lineEnd, ch: view.editor.getLine(info.lineEnd).length});
                        
                        if (shouldRename && currentFile && updatedYamlObj.code) {
                            const newName = updatedYamlObj.code.trim();
                            const folderPath = currentFile.parent?.path;
                            const newPath = (!folderPath || folderPath === "/") ? `${newName}.md` : `${folderPath}/${newName}.md`;
                            try {
                                await this.plugin.app.fileManager.renameFile(currentFile, newPath);
                                new Notice(`File renamed to ${newName}.md`);
                            } catch (e: any) { new Notice(`Note updated, but could not rename file.`); }
                        }
                    }).open();
                }
            });

            const contentDiv = wrapper.createDiv();
            const textColor = "var(--text-normal)";
            contentDiv.setCssStyles({ fontSize: "14px", color: textColor, marginTop: "5px" });

            const headerDiv = contentDiv.createDiv();
            headerDiv.setCssStyles({ borderBottom: "2px solid var(--background-modifier-border)", paddingBottom: "10px", marginBottom: "20px", display: "flex", alignItems: "center" });
            const h2 = headerDiv.createEl("h2");
            h2.setCssStyles({ margin: "0", fontSize: "20px", fontWeight: "700", display: "flex", alignItems: "center" });
            h2.setText(expCode + " ");

            let statusColor = "var(--text-muted)";
            if (data.status === "Completed") statusColor = "var(--text-success)";
            else if (data.status === "Running") statusColor = "var(--text-warning)";
            else if (data.status === "Failed") statusColor = "var(--text-error)";
            else if (data.status === "Planned") statusColor = "var(--text-accent)";
            
            if (data.status && data.status !== "None") {
                const badge = h2.createSpan({ text: data.status });
                badge.setCssStyles({ fontSize: "11px", padding: "2px 8px", borderRadius: "12px", background: "var(--background-primary)", border: `1px solid ${statusColor}`, color: statusColor, verticalAlign: "middle", marginLeft: "10px", fontWeight: "500" });
            }

            if (data.project) {
                const projBadge = h2.createSpan({ text: `📁 ${data.project}` });
                projBadge.setCssStyles({ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: "var(--background-secondary-alt)", color: "var(--text-muted)", border: "1px solid var(--background-modifier-border)", verticalAlign: "middle", marginLeft: "10px", textTransform: "uppercase" });
            }

            const uniqueId = Math.random().toString(36).substring(2, 9); 

            const rxnContainer = contentDiv.createDiv();
            rxnContainer.setCssStyles({ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: "10px", padding: "15px", marginBottom: "20px", background: "var(--background-secondary)", borderRadius: "8px", border: "1px solid var(--background-modifier-border)" });
            
            data.reactants.forEach((r: any, i: number) => {
                if(i > 0) rxnContainer.createDiv({ text: "+" }).setCssStyles({ fontSize: "20px", fontWeight: "bold", color: "var(--text-muted)" });
                const col = rxnContainer.createDiv();
                col.setCssStyles({ display: "flex", flexDirection: "column", alignItems: "center" });
                const sDiv = col.createDiv(); sDiv.id = `eln_${uniqueId}_r_scheme_${i}`;
                col.createDiv({ text: `${r.eq || 1} eq` }).setCssStyles({ color: "var(--text-muted)", fontSize: "11px", marginTop: "4px" });
            });
            
            const arrDiv = rxnContainer.createDiv();
            arrDiv.setCssStyles({ display: "flex", flexDirection: "column", alignItems: "center", margin: "10px" });
            arrDiv.createDiv({ text: data.temperature || '' }).setCssStyles({ fontSize: "11px", color: "var(--text-muted)", textAlign: "center", fontWeight: "500" });
            arrDiv.createDiv({ text: data.duration || '' }).setCssStyles({ fontSize: "11px", color: "var(--text-muted)", textAlign: "center", fontWeight: "500" });
            arrDiv.createDiv({ text: "⟶" }).setCssStyles({ fontSize: "28px", fontWeight: "bold", lineHeight: "0.8", margin: "4px 0" });
            arrDiv.createDiv({ text: data.solvent || '' }).setCssStyles({ fontSize: "11px", color: "var(--text-muted)", textAlign: "center", fontWeight: "500" });

            data.products.forEach((p: any, i: number) => {
                if(i > 0) rxnContainer.createDiv({ text: "+" }).setCssStyles({ fontSize: "20px", fontWeight: "bold", color: "var(--text-muted)" });
                const col = rxnContainer.createDiv();
                col.setCssStyles({ display: "flex", flexDirection: "column", alignItems: "center" });
                const sDiv = col.createDiv(); sDiv.id = `eln_${uniqueId}_p_scheme_${i}`;
                col.createDiv({ text: `${p.eq || 1} eq` }).setCssStyles({ color: "var(--text-muted)", fontSize: "11px", marginTop: "4px" });
            });

            // INLINE EDITABLE ROOT PROPERTIES
            const makeEditableRoot = (parent: HTMLElement, key: string, val: any) => {
                const displayVal = val || '-';
                const rawVal = val !== undefined && val !== null ? String(val) : "";
                const span = parent.createSpan({ text: displayVal });
                span.addClass("eln-editable");
                span.setAttribute("data-type", "root");
                span.setAttribute("data-key", key);
                span.setAttribute("data-input-type", "text");
                span.setAttribute("data-raw-value", rawVal);
                span.title = "Double-click to edit";
                span.setCssStyles({ cursor: "text", borderBottom: "1px dashed transparent", display: "inline-block" });
                span.onmouseover = () => span.setCssStyles({ backgroundColor: "var(--background-modifier-hover)" });
                span.onmouseout = () => span.setCssStyles({ backgroundColor: "transparent" });
                return span;
            };

            const conditionsDiv = contentDiv.createDiv();
            conditionsDiv.setCssStyles({ display: "flex", flexWrap: "wrap", justifyContent: "flex-start", gap: "15px", background: "var(--background-secondary-alt)", padding: "10px 15px", borderRadius: "6px", marginBottom: "25px", fontSize: "13px" });
            
            const c1 = conditionsDiv.createDiv(); c1.setCssStyles({ flex: "1 1 100px", display: "flex", alignItems: "center", gap: "5px" }); c1.createEl("b", { text: "Duration: " }).setCssStyles({ color: "var(--text-muted)" }); makeEditableRoot(c1, 'duration', data.duration);
            const c2 = conditionsDiv.createDiv(); c2.setCssStyles({ flex: "1 1 100px", display: "flex", alignItems: "center", gap: "5px" }); c2.createEl("b", { text: "Solvent: " }).setCssStyles({ color: "var(--text-muted)" }); makeEditableRoot(c2, 'solvent', data.solvent);
            const c3 = conditionsDiv.createDiv(); c3.setCssStyles({ flex: "1 1 100px", display: "flex", alignItems: "center", gap: "5px" }); c3.createEl("b", { text: "Temp: " }).setCssStyles({ color: "var(--text-muted)" }); makeEditableRoot(c3, 'temperature', data.temperature);
            
            // CLEAN INLINE EDITABLE TABLE CELLS
            const makeEditableTd = (tr: HTMLElement, type: string, i: number, key: string, val: any, inputType: 'number' | 'text' = 'number', customHtmlContainer?: HTMLElement, extraStyles?: any) => {
                const td = tr.createEl("td");
                td.addClass("eln-editable");
                td.setAttribute("data-type", type);
                td.setAttribute("data-idx", i.toString());
                td.setAttribute("data-key", key);
                td.setAttribute("data-input-type", inputType);
                
                let rawValAttr = val !== undefined && val !== null ? String(val) : "";
                td.setAttribute("data-raw-value", rawValAttr);
                td.title = "Double-click to edit text";
                
                let defaultStyles: any = { padding: "10px", cursor: "text", transition: "background 0.2s" };
                
                if (customHtmlContainer !== undefined) {
                    td.appendChild(customHtmlContainer);
                } else {
                    if (inputType === 'text') {
                        td.setText(val ? String(val) : '-');
                    } else {
                        const numVal = Number(val);
                        if (!isNaN(numVal) && numVal > 0) { 
                            td.setText(numVal.toFixed(2)); 
                        } else { 
                            td.setText('-'); 
                            if (key === 'mw') {
                                defaultStyles.color = "var(--text-error)";
                                defaultStyles.fontWeight = "bold";
                            }
                        }
                    }
                }
                
                if (extraStyles) Object.assign(defaultStyles, extraStyles);
                td.setCssStyles(defaultStyles);
                td.onmouseover = () => td.setCssStyles({ backgroundColor: "var(--background-modifier-hover)" });
                td.onmouseout = () => td.setCssStyles({ backgroundColor: "transparent" });
                return td;
            };

            contentDiv.createEl("h4", { text: "Reactants" }).setCssStyles({ marginBottom: "10px", marginTop: "0" });
            const rTableWrap = contentDiv.createDiv(); rTableWrap.setCssStyles({ width: "100%", overflowX: "auto", marginBottom: "30px" });
            const rTable = rTableWrap.createEl("table"); rTable.setCssStyles({ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px", minWidth: "650px" });
            
            const thColor = "var(--background-secondary-alt)"; 
            const bdColor = "var(--background-modifier-border-hover)";
            const rThead = rTable.createEl("tr"); rThead.setCssStyles({ backgroundColor: thColor, borderBottom: "2px solid var(--background-modifier-border)" });
            ["Type", "Eq", "Structure", "Name", "MW", "n [mmol]", "Purity/Conc.", "m [mg]", "V [ml]"].forEach(t => rThead.createEl("th", { text: t }).setCssStyles({ padding: "10px" }));

            data.reactants.forEach((r: any, i: number) => {
                const tr = rTable.createEl("tr"); tr.setCssStyles({ borderBottom: `1px solid ${bdColor}` });
                
                const tdType = tr.createEl("td"); tdType.setCssStyles({ padding: "10px" });
                if (r.is_limiting) tdType.createSpan({ text: "LIMITING" }).setCssStyles({ background: "var(--interactive-accent)", color: "var(--text-on-accent)", padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: "bold" });
                
                makeEditableTd(tr, 'reactants', i, 'eq', r.eq, 'number', undefined, { fontWeight: "500" });
                const cTd = tr.createEl("td"); cTd.setCssStyles({ padding: "10px" }); cTd.createDiv({ attr: { id: `eln_${uniqueId}_r_table_${i}` } });
                
                const nameContainer = document.createElement("div");
                if (r.name) {
                    const b = document.createElement("b"); b.textContent = r.name; nameContainer.appendChild(b);
                } else nameContainer.appendChild(document.createTextNode("-"));
                if (r.ghs && r.ghs.length > 0) {
                    const sp = document.createElement("span"); sp.textContent = " " + r.ghs.join(' '); sp.title = "GHS Hazards"; nameContainer.appendChild(sp);
                }
                makeEditableTd(tr, 'reactants', i, 'name', r.name, 'text', nameContainer);
                
                makeEditableTd(tr, 'reactants', i, 'mw', r.mw, 'number', undefined, { color: "var(--text-muted)" });
                makeEditableTd(tr, 'reactants', i, 'mmol', r.mmol, 'number');
                
                let concStr = "-"; let concKey = "purity"; let concVal = r.purity || 100;
                if (r.molarity) { concStr = `${r.molarity} M`; concKey = "molarity"; concVal = r.molarity; }
                else if (r.purity && r.purity !== 100) { concStr = `${r.purity}%`; }
                else if (r.purity === 100) { concStr = `Pure`; }
                const concDiv = document.createElement("div"); concDiv.textContent = concStr;
                makeEditableTd(tr, 'reactants', i, concKey, concVal, 'number', concDiv, { color: "var(--text-muted)" });
                
                makeEditableTd(tr, 'reactants', i, 'mass', r.mass, 'number');
                makeEditableTd(tr, 'reactants', i, 'volume', r.volume, 'number');
            });
            
            contentDiv.createEl("h4", { text: "Products" }).setCssStyles({ marginBottom: "10px" });
            const pTableWrap = contentDiv.createDiv(); pTableWrap.setCssStyles({ width: "100%", overflowX: "auto", marginBottom: "20px" });
            const pTable = pTableWrap.createEl("table"); pTable.setCssStyles({ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px", minWidth: "600px" });
            
            const pThead = pTable.createEl("tr"); pThead.setCssStyles({ backgroundColor: thColor, borderBottom: "2px solid var(--background-modifier-border)" });
            ["Eq", "Structure", "Name", "MW", "n [mmol]", "Isol. [mg]", "Yield [%]"].forEach(t => pThead.createEl("th", { text: t }).setCssStyles({ padding: "10px" }));

            data.products.forEach((p: any, i: number) => {
                const tr = pTable.createEl("tr"); tr.setCssStyles({ borderBottom: `1px solid ${bdColor}` });
                makeEditableTd(tr, 'products', i, 'eq', p.eq, 'number', undefined, { fontWeight: "500" });
                const cTd = tr.createEl("td"); cTd.setCssStyles({ padding: "10px" }); cTd.createDiv({ attr: { id: `eln_${uniqueId}_p_table_${i}` } });
                
                const nameContainer = document.createElement("div");
                if (p.name) {
                    const b = document.createElement("b"); b.textContent = p.name; nameContainer.appendChild(b);
                } else nameContainer.appendChild(document.createTextNode("-"));
                if (p.ghs && p.ghs.length > 0) {
                    const sp = document.createElement("span"); sp.textContent = " " + p.ghs.join(' '); sp.title = "GHS Hazards"; nameContainer.appendChild(sp);
                }
                makeEditableTd(tr, 'products', i, 'name', p.name, 'text', nameContainer);
                
                makeEditableTd(tr, 'products', i, 'mw', p.mw, 'number', undefined, { color: "var(--text-muted)" });
                
                const prodMmolDisplay = document.createElement("div");
                if (p.mmol_isolated !== undefined) { prodMmolDisplay.textContent = p.mmol_isolated.toFixed(2); } 
                else if (p.theory_mmol) { 
                    const sp = document.createElement("span"); sp.textContent = `(${p.theory_mmol.toFixed(2)})`; sp.style.opacity = "0.6"; prodMmolDisplay.appendChild(sp);
                } 
                else { prodMmolDisplay.textContent = "-"; }
                makeEditableTd(tr, 'products', i, 'mmol_isolated', p.mmol_isolated, 'number', prodMmolDisplay);
                
                makeEditableTd(tr, 'products', i, 'mass_isolated', p.mass_isolated, 'number');
                
                let yieldColor = "var(--text-normal)";
                if (p.yield) {
                    const yVal = parseFloat(p.yield);
                    if (yVal >= 90) yieldColor = "var(--text-success)";
                    else if (yVal <= 30) yieldColor = "var(--text-error)";
                    else yieldColor = "var(--text-warning)";
                }
                const yieldTd = tr.createEl("td"); yieldTd.setCssStyles({ padding: "10px", fontSize: "14px", fontWeight: "bold", color: yieldColor });
                yieldTd.setText(p.yield ? p.yield + '%' : '-');
            });

            const attachStructure = (parent: HTMLElement, smiles: string, type: 'reactants'|'products', index: number, w: number, h: number) => {
                parent.setCssStyles({ width: `${w}px`, height: `${h}px`, cursor: "pointer" }); parent.title = "Double-click to edit structure"; parent.setText("⏳");
                
                window.requestAnimationFrame(async () => {
                    const renderEl = await this.plugin.api.renderStructure(smiles, w, h);
                    parent.empty();
                    if (renderEl) { renderEl.setCssStyles({ maxWidth: '100%', maxHeight: '100%' }); parent.appendChild(renderEl); } 
                    else { parent.setText("❌"); }
                });

                parent.addEventListener("contextmenu", (e) => {
                    if (smiles) {
                        try {
                            const { showChemicalContextMenu } = require('./SharedContextMenu');
                            if (showChemicalContextMenu) showChemicalContextMenu(this.plugin, e, smiles);
                        } catch(err) {}
                    }
                });

                parent.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
                    let info = ctx.getSectionInfo(el);
                    if (!info && el.parentElement) info = ctx.getSectionInfo(el.parentElement);
                    if (!view || !info) return;

                    this.plugin.api.ketcher.openEditor(smiles || "", "smiles", (newData: string, isFile: boolean, newFormat: string) => {
                        if (newFormat === "ket") { new Notice("ELN tables only support SMILES."); return; }
                        const blockText = view.editor.getRange({line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                        try {
                            const yamlObj = parseYaml(blockText);
                            yamlObj[type][index].smiles = newData;
                            delete yamlObj[type][index].mw; delete yamlObj[type][index].formula;
                            const newYaml = stringifyYaml(yamlObj);
                            view.editor.replaceRange(newYaml, {line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                        } catch (err) { new Notice("Error updating ELN YAML."); }
                    });
                });
            };

            data.reactants.forEach((r: any, i: number) => {
                const schemeEl = contentDiv.querySelector(`#eln_${uniqueId}_r_scheme_${i}`);
                if (schemeEl) attachStructure(schemeEl as HTMLElement, r.smiles, 'reactants', i, 110, 110);
                const tableEl = contentDiv.querySelector(`#eln_${uniqueId}_r_table_${i}`);
                if (tableEl) attachStructure(tableEl as HTMLElement, r.smiles, 'reactants', i, 90, 90);
            });
            
            data.products.forEach((p: any, i: number) => {
                const schemeEl = contentDiv.querySelector(`#eln_${uniqueId}_p_scheme_${i}`);
                if (schemeEl) attachStructure(schemeEl as HTMLElement, p.smiles, 'products', i, 110, 110);
                const tableEl = contentDiv.querySelector(`#eln_${uniqueId}_p_table_${i}`);
                if (tableEl) attachStructure(tableEl as HTMLElement, p.smiles, 'products', i, 90, 90);
            });
			
            if (currentFile && currentFile.parent && data.reactants.length > 0 && data.products.length > 0) {
                const folderFiles = currentFile.parent.children.filter((f: any) => f instanceof TFile && f.extension.toLowerCase() === 'md' && f.path !== currentFile.path);
                const matchRows: any[] = [];
                
                const currReactantSmi = data.reactants[0].smiles?.trim() || "A";
                const currProductSmi = data.products[0].smiles?.trim() || "B";

                for (const f of folderFiles) {
                    const content = await this.plugin.app.vault.cachedRead(f as TFile);
                    const bMatch = content.match(/```eln\s*\n([\s\S]*?)\n```/);
                    if (bMatch) {
                        try {
                            const otherData = parseYaml(bMatch[1]);
                            const otherRSmi = otherData.reactants?.[0]?.smiles?.trim();
                            const otherPSmi = otherData.products?.[0]?.smiles?.trim();
                            
                            if (otherRSmi === currReactantSmi && otherPSmi === currProductSmi) {
                                matchRows.push({
                                    file: f,
                                    code: otherData.code || f.basename,
                                    yield: parseFloat(otherData.products[0].yield) || 0,
                                    yieldStr: otherData.products[0].yield ? `${otherData.products[0].yield}%` : 'N/A',
                                    scale: otherData.reactants[0].mass ? `${otherData.reactants[0].mass} mg` : '-',
                                    temp: otherData.temperature || '-',
                                    solvent: otherData.solvent || '-'
                                });
                            }
                        } catch(e) {}
                    }
                }

                if (matchRows.length > 0) {
                    matchRows.sort((a, b) => b.yield - a.yield);
                    
                    const optDiv = wrapper.createDiv();
                    optDiv.setCssStyles({ marginTop: "30px", borderTop: "2px dashed var(--background-modifier-border)", paddingTop: "15px" });

                    const optH4 = optDiv.createEl("h4");
                    optH4.setCssStyles({ margin: "0 0 10px 0", display: "flex", alignItems: "center", gap: "5px" });
                    optH4.createSpan({ text: "🔄" }).setCssStyles({ color: "var(--text-accent)" });
                    optH4.appendText(" Optimization History (Same Step)");

                    const optTable = optDiv.createEl("table");
                    optTable.setCssStyles({ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "12px", background: "var(--background-secondary)", borderRadius: "6px", overflow: "hidden" });

                    const optTr = optTable.createEl("tr");
                    optTr.setCssStyles({ background: "var(--background-secondary-alt)", borderBottom: "1px solid var(--background-modifier-border)" });
                    ["Experiment", "Yield", "Scale", "Solvent", "Temp"].forEach(t => {
                        optTr.createEl("th", { text: t }).setCssStyles({ padding: "6px 10px" });
                    });

                    matchRows.forEach(row => {
                        const tr = optTable.createEl("tr");
                        tr.setCssStyles({ borderBottom: "1px solid var(--background-modifier-border-hover)" });
                        
                        const tdLink = tr.createEl("td");
                        tdLink.setCssStyles({ padding: "6px 10px" });
                        tdLink.createEl("a", { text: row.code, cls: "internal-link", href: row.file.path });
                        
                        tr.createEl("td", { text: row.yieldStr }).setCssStyles({ padding: "6px 10px", fontWeight: "bold", color: row.yield >= 80 ? "var(--text-success)" : "var(--text-muted)" });
                        tr.createEl("td", { text: row.scale }).setCssStyles({ padding: "6px 10px" });
                        tr.createEl("td", { text: row.solvent }).setCssStyles({ padding: "6px 10px" });
                        tr.createEl("td", { text: row.temp }).setCssStyles({ padding: "6px 10px" });
                    });
                }
            }

            return wrapper;

        } catch (err: any) {
            wrapper.empty();
            const errDiv = wrapper.createDiv();
            errDiv.setCssStyles({ padding: "20px", color: "var(--text-error)", background: "var(--background-secondary)", borderRadius: "8px" });
            errDiv.createEl("b", { text: "ELN Formatting Error:" });
            errDiv.createEl("br");
            errDiv.appendText(err.message);
            return wrapper;
        }
    }
}

// ------------------------------------------------------------------
// ELN GALLERY RENDERER
// ------------------------------------------------------------------
export class ElnGalleryRenderer {
    plugin: any;
    constructor(plugin: any) { this.plugin = plugin; }
    
    async renderGalleryBlock(source: string, el: HTMLElement, ctx: any) {
        const match = source.match(/path:\s*['"]?(.*?)['"]?(?:\n|$)/);
        const folderPath = match ? match[1].trim() : "";
        
        if (!folderPath) { el.createEl("div", { text: "⚠️ Please specify a folder path (e.g., path: Experiments/)", cls: "color-text-error" }); return; }
        const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
        if (!folder || !('children' in folder)) { el.createEl("div", { text: `⚠️ Folder not found: ${folderPath}`, cls: "color-text-error" }); return; }

        const files = folder.children.filter((f: any) => f instanceof TFile && f.extension.toLowerCase() === 'md');
        
        const header = el.createDiv(); 
        header.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px", flexWrap: "wrap", gap: "10px" });
        const countLabel = header.createDiv({ text: `Loading...` }); 
        countLabel.setCssStyles({ fontSize: "13px", color: "var(--text-muted)", fontWeight: "500" });
        const searchInput = header.createEl("input", { type: "search", placeholder: "Search experiments..." }); 
        searchInput.setCssStyles({ width: "250px", padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--background-modifier-border)", background: "var(--background-primary)" });

        const container = el.createDiv({ cls: "chem-gallery-container" });
        container.setCssStyles({ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "15px", padding: "5px 0" });

        const cards: { el: HTMLElement, text: string }[] = [];
        let renderCount = 0;

        for (const file of files) {
            const content = await this.plugin.app.vault.cachedRead(file);
            const blockMatch = content.match(/```eln\s*\n([\s\S]*?)\n```/);
            if (!blockMatch) continue;
            
            try {
                // Apply strict YAML quoting fix to gallery previews as well!
                const safeSource = blockMatch[1].replace(/smiles:\s*(.*)$/gm, (match: any, p1: string) => {
                    let s = p1.trim();
                    if (!s) return match;
                    let comment = "";
                    const commentMatch = s.match(/(\s+#.*)$/);
                    if (commentMatch) {
                        comment = commentMatch[1];
                        s = s.substring(0, s.length - comment.length).trim();
                    }
                    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
                        s = s.substring(1, s.length - 1);
                    }
                    s = s.replace(/\\"/g, '"');
                    s = s.replace(/'/g, "''");
                    return `smiles: '${s}'${comment}`;
                });
                
                const yamlObj = parseYaml(safeSource);
                let dataToRender = "";
                
                if (yamlObj.products && yamlObj.products.length > 0 && typeof yamlObj.products[0].smiles === 'string' && yamlObj.products[0].smiles.trim()) {
                    dataToRender = yamlObj.products[0].smiles.trim();
                } else if (yamlObj.reactants && yamlObj.reactants.length > 0 && typeof yamlObj.reactants[0].smiles === 'string' && yamlObj.reactants[0].smiles.trim()) {
                    dataToRender = yamlObj.reactants[0].smiles.trim();
                } else { continue; }
                
                const searchableText = `${file.name.toLowerCase()} ${yamlObj.code?.toLowerCase() || ''}`;
                renderCount++;

                const card = container.createDiv({ cls: "chem-gallery-card" });
                card.setCssStyles({ border: "1px solid var(--background-modifier-border)", borderRadius: "8px", padding: "10px", display: "flex", flexDirection: "column", alignItems: "center", backgroundColor: "var(--background-primary)", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" });
                card.onmouseover = () => card.setCssStyles({ borderColor: "var(--interactive-accent)" });
                card.onmouseout = () => card.setCssStyles({ borderColor: "var(--background-modifier-border)" });

                const previewWrapper = card.createDiv();
                previewWrapper.setCssStyles({ width: "100%", height: "100px", display: "flex", justifyContent: "center", alignItems: "center" });
                
                const label = card.createDiv();
                label.textContent = yamlObj.code || file.basename;
                label.setCssStyles({ fontSize: "12px", marginTop: "10px", textAlign: "center", wordBreak: "break-word", color: "var(--text-normal)", fontWeight: "500" });

                cards.push({ el: card, text: searchableText });
                card.onclick = () => this.plugin.app.workspace.getLeaf(false).openFile(file);

                if (!dataToRender) {
                    previewWrapper.createSpan({ text: "No Structure", cls: "color-text-muted" }).setCssStyles({ fontSize: "12px" });
                    continue;
                }

                previewWrapper.createSpan({ text: "⏳", cls: "color-text-muted" }).setCssStyles({ fontSize: "12px" });

                window.requestAnimationFrame(async () => {
                    try {
                        const previewEl = await this.plugin.api.renderStructure(dataToRender, 120, 100);
                        previewWrapper.empty();
                        if (previewEl) { previewEl.setCssStyles({ maxWidth: '100%', maxHeight: '100%' }); previewWrapper.appendChild(previewEl); } 
                        else { previewWrapper.createSpan({ text: "Invalid", cls: "color-text-muted" }).setCssStyles({ fontSize: "12px" }); }
                    } catch(e) { previewWrapper.createSpan({ text: "Invalid", cls: "color-text-muted" }).setCssStyles({ fontSize: "12px" }); } 
                });
            } catch(e) {}
        }
        
        countLabel.textContent = `${renderCount} experiments`;
        searchInput.addEventListener("input", (e: any) => {
            const query = e.target.value.toLowerCase(); let visibleCount = 0;
            cards.forEach(c => { if (c.text.includes(query)) { c.el.setCssStyles({ display: "flex" }); visibleCount++; } else { c.el.setCssStyles({ display: "none" }); } });
            countLabel.textContent = `${visibleCount} / ${renderCount} experiments`;
        });
    }

    async renderChemGallery(source: string, el: HTMLElement, ctx: any) {
        const match = source.match(/path:\s*['"]?(.*?)['"]?(?:\n|$)/);
        const folderPath = match ? match[1].trim() : "";
        if (!folderPath) { el.createEl("div", { text: "⚠️ Please specify a folder path", cls: "color-text-error" }); return; }
        const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
        if (!folder || !('children' in folder)) { el.createEl("div", { text: `⚠️ Folder not found`, cls: "color-text-error" }); return; }

        const files = (folder as any).children.filter((f: any) => f instanceof TFile && f.extension.toLowerCase() === 'md');
        const container = el.createDiv({ cls: "chem-gallery-container" });
        container.setCssStyles({ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "15px", padding: "5px 0" });

        for (const file of files) {
            const content = await this.plugin.app.vault.cachedRead(file);
            const blockMatch = content.match(/```(smiles|mol)\s*\n([\s\S]*?)\n```/);
            if (!blockMatch) continue;
            
            const format = blockMatch[1];
            const dataToRender = blockMatch[2].trim();

            if (!dataToRender) continue;

            const card = container.createDiv({ cls: "chem-gallery-card" });
            card.setCssStyles({ border: "1px solid var(--background-modifier-border)", borderRadius: "8px", padding: "10px", display: "flex", flexDirection: "column", alignItems: "center", backgroundColor: "var(--background-primary)", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" });
            
            const previewWrapper = card.createDiv();
            previewWrapper.setCssStyles({ width: "100%", height: "100px", display: "flex", justifyContent: "center", alignItems: "center" });
            previewWrapper.createSpan({ text: "⏳", cls: "color-text-muted" }).setCssStyles({ fontSize: "12px" });
            
            const label = card.createDiv();
            label.textContent = file.basename;
            label.setCssStyles({ fontSize: "12px", marginTop: "10px", textAlign: "center", wordBreak: "break-word", color: "var(--text-normal)", fontWeight: "500" });

            card.onclick = () => this.plugin.app.workspace.getLeaf(false).openFile(file);

            window.requestAnimationFrame(async () => {
                try {
                    const previewEl = await this.plugin.api.renderStructure(dataToRender, 120, 100);
                    previewWrapper.empty();
                    if (previewEl) { previewEl.setCssStyles({ maxWidth: '100%', maxHeight: '100%' }); previewWrapper.appendChild(previewEl); } 
                    else { previewWrapper.createSpan({ text: "Invalid", cls: "color-text-muted" }).setCssStyles({ fontSize: "12px" }); }
                } catch(e) { previewWrapper.createSpan({ text: "Invalid", cls: "color-text-muted" }).setCssStyles({ fontSize: "12px" }); } 
            });
        }
    }
}

// ------------------------------------------------------------------
// CREATE BLANK EXPERIMENT HELPER
// ------------------------------------------------------------------
export async function createNewElnExperiment(app: App, code: string, folderPath: string = "", sectionsString: string = "TLC, LCMS, NMR") {
    const baseCode = code.trim() || "Experiment";
    
    const defaultData = {
        code: baseCode,
        project: "", 
        status: "Planned",
        solvent: "",
        temperature: "rt",
        duration: "12 h",
        reactants: [],
        products: []
    };
    
    const yaml = stringifyYaml(defaultData);
    const dateStr = window.moment().format("YYYY-MM-DD");
    
    const sections = sectionsString.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    let analyticalDataStr = "";
    sections.forEach((sec: string) => analyticalDataStr += `- **${sec}:**\n`);

    const template = `---
tags: [experiment]
date: ${dateStr}
---

\`\`\`eln
${yaml}
\`\`\`

## 📝 Procedure & Observations
1. Add reactant A to the flask...
2. Stir at room temperature...
3. 

## 🔬 Analytical Data
${analyticalDataStr}`;
    
    let safeCode = baseCode.replace(/[/\\?%*:|"<>]/g, '-');
    let path = folderPath && folderPath !== "/" ? `${folderPath}/${safeCode}.md` : `${safeCode}.md`;

    let finalPath = path;
    let counter = 1;
    while (app.vault.getAbstractFileByPath(finalPath)) {
        finalPath = folderPath && folderPath !== "/" ? `${folderPath}/${safeCode}-${counter}.md` : `${safeCode}-${counter}.md`;
        counter++;
    }

    try {
        const newFile = await app.vault.create(finalPath, template);
        app.workspace.getLeaf(false).openFile(newFile);
        new Notice(`Created new experiment: ${newFile.basename}`);
    } catch(e: any) {
        new Notice(`Error creating experiment: ${e.message}`);
    }
}

// ------------------------------------------------------------------
// MODALS
// ------------------------------------------------------------------

export class CreateExperimentModal extends Modal {
    plugin: any; onSubmit: (code: string) => void;
    code: string; folderPath: string;

    constructor(app: App, plugin: any, defaultPrefix: string, folderPath: string, onSubmit: (code: string) => void) {
        super(app); 
        this.plugin = plugin; 
        this.onSubmit = onSubmit; 
        this.folderPath = folderPath;
        
        let nextNum = 1;
        const folder = app.vault.getAbstractFileByPath(folderPath || "/");
        if (folder && (folder as any).children) {
            (folder as any).children.forEach((f: any) => {
                if (f.name.endsWith('.md')) {
                    const match = f.basename.match(new RegExp(`^${defaultPrefix}-(\\d+)$`));
                    if (match) {
                        const num = parseInt(match[1], 10);
                        if (num >= nextNum) nextNum = num + 1;
                    }
                }
            });
        }
        const paddedNum = nextNum.toString().padStart(3, '0');
        this.code = `${defaultPrefix}-${paddedNum}`;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "Create New Experiment" });

        const wrap = contentEl.createDiv();
        wrap.setCssStyles({ marginBottom: "20px" });
        wrap.createEl("div", { text: "Experiment Code (e.g. EXP-001)", cls: "color-text-muted" }).setCssStyles({ fontSize: "12px", marginBottom: "5px" });
        
        const input = wrap.createEl("input", { type: "text", value: this.code });
        input.setCssStyles({ width: "100%" });
        input.onchange = (e: any) => this.code = e.target.value;

        const attemptSubmit = () => {
            if (!this.code.trim()) { new Notice("Please enter a code"); return; }
            this.onSubmit(this.code.trim()); 
            this.close();
        };

        input.addEventListener("keypress", (e: KeyboardEvent) => { if (e.key === "Enter") attemptSubmit(); });

        const btnRow = contentEl.createDiv();
        btnRow.setCssStyles({ display: "flex", justifyContent: "flex-end", gap: "10px" });
        const cancel = btnRow.createEl("button", { text: "Cancel" }); cancel.onclick = () => this.close();
        const create = btnRow.createEl("button", { text: "Create Template", cls: "mod-cta" });
        create.onclick = attemptSubmit;

        window.setTimeout(() => {
            input.focus();
            input.select();
        }, 50);
    }
    onClose() { this.contentEl.empty(); }
}

export class CloneExperimentModal extends Modal {
    plugin: any; currentCode: string; currentFile: TFile | null; sourceData: any; newCode: string;

    constructor(app: App, plugin: any, currentCode: string, currentFile: TFile | null, sourceData: any) {
        super(app); this.plugin = plugin; this.currentCode = currentCode; this.currentFile = currentFile; this.sourceData = sourceData;
        
        let base = currentCode;
        let suffixNum = 1;
        const match = currentCode.match(/^(.*?)-copy(?:-(\d+))?$/);
        if (match) {
            base = match[1];
            suffixNum = match[2] ? parseInt(match[2], 10) + 1 : 2;
            this.newCode = `${base}-copy-${suffixNum}`;
        } else {
            this.newCode = `${currentCode}-copy`;
        }
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "Clone Experiment" });
        contentEl.createEl("p", { text: "This will create a new file, copy the reaction scheme, and wipe the product yields for a fresh run.", cls: "color-text-muted" }).setCssStyles({ fontSize: "13px", marginTop: "0" });

        const wrap = contentEl.createDiv();
        wrap.setCssStyles({ marginBottom: "20px" });
        wrap.createEl("div", { text: "New Experiment Code", cls: "color-text-muted" }).setCssStyles({ fontSize: "12px", marginBottom: "5px" });
        const input = wrap.createEl("input", { type: "text", value: this.newCode });
        input.setCssStyles({ width: "100%" });
        input.onchange = (e: any) => this.newCode = e.target.value;

        const btnRow = contentEl.createDiv();
        btnRow.setCssStyles({ display: "flex", justifyContent: "flex-end", gap: "10px" });
        const cancel = btnRow.createEl("button", { text: "Cancel" }); cancel.onclick = () => this.close();
        const cloneBtn = btnRow.createEl("button", { text: "Clone File", cls: "mod-cta" });
        
        const doClone = async () => {
            if (!this.newCode.trim()) return; const code = this.newCode.trim();
            const folderPath = this.currentFile?.parent?.path || "";
            let newPath = folderPath && folderPath !== "/" ? `${folderPath}/${code}.md` : `${code}.md`;

            // Auto-increment if file exists
            let counter = 1;
            while (this.plugin.app.vault.getAbstractFileByPath(newPath)) {
                newPath = folderPath && folderPath !== "/" ? `${folderPath}/${code}-${counter}.md` : `${code}-${counter}.md`;
                counter++;
            }

            const cloneData = JSON.parse(JSON.stringify(this.sourceData));
            cloneData.code = code; cloneData.status = "Planned";
            if (cloneData.products) { cloneData.products.forEach((p: any) => { delete p.mass_isolated; delete p.yield; delete p.mmol_isolated; }); }
            
            const newYaml = stringifyYaml(cloneData);
            
            let currentSections = "## 📝 Procedure & Observations\n- \n\n## 🔬 Analytical Data\n- **TLC:**\n- **LCMS:**\n- **NMR:**";
            if (this.currentFile) {
                const content = await this.plugin.app.vault.cachedRead(this.currentFile);
                const procMatch = content.indexOf("## 📝 Procedure");
                if (procMatch !== -1) currentSections = content.substring(procMatch);
            }

            const template = `---
tags: [experiment]
date: ${window.moment().format("YYYY-MM-DD")}
---

\`\`\`eln\n${newYaml}\`\`\`\n\n${currentSections}`;

            try {
                const newFile = await this.plugin.app.vault.create(newPath, template);
                this.plugin.app.workspace.getLeaf(false).openFile(newFile);
                new Notice(`Experiment cloned to ${newFile.basename}`);
            } catch(e: any) { new Notice(`Error cloning: ${e.message}`); }
            this.close();
        };

        input.addEventListener("keypress", (e: KeyboardEvent) => { if (e.key === "Enter") doClone(); });
        cloneBtn.onclick = () => doClone();

        window.setTimeout(() => input.focus(), 50);
    }
    onClose() { this.contentEl.empty(); }
}

export class ElnMetaEditorModal extends Modal {
    plugin: any; data: any; originalCode: string; onSave: (updated: any, shouldRename: boolean) => void;
    advancedMode = false;
    
    constructor(app: App, plugin: any, yamlObj: any, onSave: (updated: any, shouldRename: boolean) => void) {
        super(app); this.plugin = plugin; this.data = JSON.parse(JSON.stringify(yamlObj));
        this.originalCode = this.data.code || "";
        if (!this.data.reactants) this.data.reactants = [];
        if (!this.data.products) this.data.products = [];
        this.onSave = onSave;
    }

    async fetchSmilesFromName(name: string): Promise<string> {
        try {
            const opsin = await requestUrl(`https://opsin.ch.cam.ac.uk/opsin/${encodeURIComponent(name)}.smi`);
            if (opsin.status === 200) return opsin.text.trim();
        } catch (e) {}
        try {
            const cactus = await requestUrl(`https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(name)}/smiles`);
            if (cactus.status === 200) return cactus.text.trim();
        } catch (e) {}
        try {
            const pubchem = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/property/IsomericSMILES/JSON`);
            if (pubchem.status === 200) return pubchem.json.PropertyTable.Properties[0].IsomericSMILES;
        } catch (e) {}
        return "";
    }
    
    onOpen() { this.render(); }
    
    async processReactionSmiles(rxnSmiles: string) {
        if (!rxnSmiles.includes('>')) return;
        
        const parts = rxnSmiles.split('>');
        const reactSmilesList = parts[0].split('.').filter((s: string)=>s);
        const prodSmilesList = parts[parts.length-1].split('.').filter((s: string)=>s);

        const newReactants = [];
        for (const s of reactSmilesList) {
            const existing = this.data.reactants.find((r:any) => r.smiles === s);
            if (existing) newReactants.push(existing);
            else {
                const props = await calculateMwOffline(s, this.plugin);
                newReactants.push({ name: "Compound", smiles: s, eq: 1, mw: props?.mw||0, formula: props?.formula||"" });
            }
        }

        const newProducts = [];
        for (const s of prodSmilesList) {
            const existing = this.data.products.find((p:any) => p.smiles === s);
            if (existing) newProducts.push(existing);
            else {
                const props = await calculateMwOffline(s, this.plugin);
                newProducts.push({ name: "Product", smiles: s, eq: 1, mw: props?.mw||0, formula: props?.formula||"" });
            }
        }

        this.data.reactants = newReactants;
        this.data.products = newProducts;
        this.render();
        new Notice("Reaction successfully parsed and calculated!");
    }

    render() {
        const { contentEl } = this; contentEl.empty();
        
        const header = contentEl.createDiv();
        header.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px", borderBottom: "1px solid var(--background-modifier-border)", paddingBottom: "10px" });
        header.createEl("h2", { text: "Edit ELN Meta" }).setCssStyles({ margin: "0", fontSize: "1.2em" });
        
        const hActions = header.createDiv();
        hActions.setCssStyles({ display: "flex", gap: "10px" });
        
        const rxnBtn = hActions.createEl("button", { text: "✏️ Draw Reaction" });
        rxnBtn.onclick = () => {
            const currentR = this.data.reactants.map((r:any)=>r.smiles).join('.');
            const currentP = this.data.products.map((p:any)=>p.smiles).join('.');
            const rxnStr = currentR && currentP ? `${currentR}>>${currentP}` : "";
            
            // USE SAFE API CALL!
            this.plugin.api.ketcher.openEditor(rxnStr, "smiles", (smi: string) => {
                if (smi.includes('>')) this.processReactionSmiles(smi);
                else new Notice("Please draw a reaction arrow to split reactants and products.");
            });
        };

        const saveBtn = hActions.createEl("button", { text: "Save", cls: "mod-cta" });
        saveBtn.onclick = () => { 
            const shouldRename = this.originalCode !== "" && this.data.code && this.originalCode !== this.data.code;
            this.onSave(ElnCalculator.calculate(this.data), shouldRename); 
            this.close(); 
        };

        const metaGrid = contentEl.createDiv();
        metaGrid.setCssStyles({ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "20px" });
        
        const addInput = (parent: HTMLElement, label: string, key: string, placeholder = "") => {
            const wrap = parent.createDiv(); wrap.createEl("div", { text: label, cls: "color-text-muted" }).setCssStyles({ fontSize: "12px", marginBottom: "3px" });
            const inp = wrap.createEl("input", { type: "text", value: this.data[key] || "" });
            inp.placeholder = placeholder;
            inp.setCssStyles({ width: "100%" });
            inp.onchange = (e: any) => this.data[key] = e.target.value;
        };
        
        addInput(metaGrid, "Reaction Code (Renames File)", "code"); 
        addInput(metaGrid, "Project Name", "project");
        
        const statusWrap = metaGrid.createDiv(); 
        statusWrap.createEl("div", { text: "Status", cls: "color-text-muted" }).setCssStyles({ fontSize: "12px", marginBottom: "3px" });
        const statusSelect = statusWrap.createEl("select");
        statusSelect.setCssStyles({ width: "100%", padding: "4px", borderRadius: "4px", background: "var(--background-primary)", border: "1px solid var(--background-modifier-border)", color: "var(--text-normal)" });
        ["None", "Planned", "Running", "Completed", "Failed"].forEach(opt => {
            const o = statusSelect.createEl("option", { text: opt, value: opt === "None" ? "" : opt });
            if (this.data.status === opt || (opt === "None" && !this.data.status)) o.selected = true;
        });
        statusSelect.onchange = (e: any) => this.data.status = e.target.value;

        addInput(metaGrid, "Solvent", "solvent");
        addInput(metaGrid, "Temperature", "temperature"); 
        addInput(metaGrid, "Duration", "duration");

        const advToggle = contentEl.createEl("button", { text: this.advancedMode ? "Hide Advanced Fields" : "⚙️ Show Advanced Fields (Purity, Molarity...)" });
        advToggle.setCssStyles({ width: "100%", marginBottom: "15px", fontSize: "11px" });
        advToggle.onclick = () => { this.advancedMode = !this.advancedMode; this.render(); };

        const renderChemRow = (item: any, type: 'reactants'|'products', idx: number) => {
            const row = contentEl.createDiv();
            row.setCssStyles({ background: "var(--background-secondary-alt)", padding: "12px", borderRadius: "8px", marginBottom: "12px", border: "1px solid var(--background-modifier-border)", display: "flex", flexDirection: "column", gap: "10px" });
            
            const topWrap = row.createDiv();
            topWrap.setCssStyles({ display: "flex", gap: "10px", alignItems: "center" });
            const nameInp = topWrap.createEl("input", { type: "text", value: item.name || "" });
            nameInp.placeholder = "Chemical Name";
            nameInp.setCssStyles({ width: "100%", fontWeight: "bold" });
            nameInp.onchange = (e: any) => item.name = e.target.value;
            
            if (type === 'reactants') {
                const lrWrap = topWrap.createDiv();
                lrWrap.setCssStyles({ display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" });
                const lrRadio = lrWrap.createEl("input", { type: "radio", name: "limiting_reagent", value: idx.toString() });
                if (item.is_limiting) lrRadio.checked = true;
                lrRadio.onchange = () => { this.data.reactants.forEach((r:any) => r.is_limiting = false); item.is_limiting = true; this.render(); };
                lrWrap.createEl("span", { text: "LIMITING" }).setCssStyles({ background: "var(--interactive-accent)", color: "var(--text-on-accent)", padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: "bold" });
            }

            const actionRow = row.createDiv();
            actionRow.setCssStyles({ display: "flex", gap: "6px", justifyContent: "flex-start", flexWrap: "wrap" });
            
            const drawBtn = actionRow.createEl("button", { text: "✏️ Draw" });
            drawBtn.setCssStyles({ fontSize: "11px", padding: "4px 8px" });
            drawBtn.onclick = () => {
                // USE SAFE API CALL!
                this.plugin.api.ketcher.openEditor(item.smiles || "", "smiles", (newSmiles: string) => {
                    item.smiles = newSmiles;
                    this.render();
                });
            };

            const libBtn = actionRow.createEl("button", { text: "📚 Lib" });
            libBtn.setCssStyles({ fontSize: "11px", padding: "4px 8px" });
            libBtn.onclick = async () => {
                const lib = await getCompoundLibrary(this.plugin);
                new CompoundSuggestModal(this.plugin.app, lib, (selected) => {
                    item.name = selected.name;
                    item.smiles = selected.smiles;
                    this.render();
                }).open();
            };

            const fetchSmilesBtn = actionRow.createEl("button", { text: "🧪 N \u2192 S (Web)", title: "Name to Structure (Requires Internet)" });
            fetchSmilesBtn.setCssStyles({ fontSize: "11px", padding: "4px 8px" });
            fetchSmilesBtn.onclick = async () => {
                if (!item.name) { new Notice("Enter a name first."); return; }
                fetchSmilesBtn.innerText = "⏳...";
                const smiles = await this.fetchSmilesFromName(item.name);
                if (smiles) { item.smiles = smiles; new Notice(`Structure found for ${item.name}`); this.render(); } 
                else { new Notice("Structure not found."); fetchSmilesBtn.innerText = "🧪 N \u2192 S (Web)"; }
            };

            const fetchDataBtn = actionRow.createEl("button", { text: "🔍 S \u2192 D", title: "Calculate Data from Structure (Offline)" });
            fetchDataBtn.setCssStyles({ fontSize: "11px", padding: "4px 8px" });
            fetchDataBtn.onclick = async () => {
                if (!item.smiles) { new Notice("Draw a structure first."); return; }
                fetchDataBtn.innerText = "⏳...";
                const d = await calculateMwOffline(item.smiles, this.plugin);
                if (d.mw) item.mw = d.mw; if (d.formula) item.formula = d.formula;
                
                // Fetch standard name and extra GHS props safely from Web as bonus
                if (!item.name) {
                    try {
                        const res = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(item.smiles)}/property/Title/JSON`);
                        if (res.status === 200) item.name = res.json.PropertyTable.Properties[0].Title;
                    } catch(e) {}
                }
                try {
                    const cidRes = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(item.smiles)}/cids/JSON`);
                    if (cidRes.status === 200) {
                        const cid = cidRes.json.IdentifierList.CID[0];
                        const ghsRes = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=GHS+Classification`);
                        const str = JSON.stringify(ghsRes.json);
                        const emojis = [];
                        if (str.includes("GHS01")) emojis.push("💣"); if (str.includes("GHS02")) emojis.push("🔥");
                        if (str.includes("GHS03") || str.includes("GHS04") || str.includes("GHS05")) emojis.push("🧪");
                        if (str.includes("GHS06")) emojis.push("☠️"); if (str.includes("GHS07")) emojis.push("⚠️");
                        if (str.includes("GHS08")) emojis.push("⚕️"); if (str.includes("GHS09")) emojis.push("🌳");
                        item.ghs = [...new Set(emojis)];
                    }
                } catch(e) {}

                nameInp.value = item.name || ""; 
                new Notice(`Calculated offline MW for ${item.name || 'Structure'}`);
                
                fetchDataBtn.innerText = "🔍 S \u2192 D";
                this.render();
            };

            const delBtn = actionRow.createEl("button", { text: "🗑️ Remove" });
            delBtn.setCssStyles({ color: "var(--text-error)", fontSize: "11px", padding: "4px 8px", marginLeft: "auto" });
            delBtn.onclick = () => { this.data[type].splice(idx, 1); this.render(); };

            const botRow = row.createDiv();
            botRow.setCssStyles({ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(75px, 1fr))", gap: "8px", marginTop: "5px" });
            
            const makeNumInp = (key: string, label: string, onUpdate?: (val: number) => void) => {
                const wrap = botRow.createDiv();
                wrap.setCssStyles({ display: "flex", flexDirection: "column" });
                wrap.createEl("span", { text: label }).setCssStyles({ fontSize: "10px", color: "var(--text-muted)", marginBottom: "2px", whiteSpace: "nowrap" });
                const inp = wrap.createEl("input", { type: "number", value: item[key] !== undefined ? String(item[key]) : "" });
                inp.setCssStyles({ width: "100%", padding: "4px", boxSizing: "border-box" });
                inp.onchange = (e: any) => {
                    const val = parseFloat(e.target.value.replace(/,/g, '.'));
                    if (isNaN(val)) delete item[key];
                    else item[key] = val;
                    if (onUpdate && !isNaN(val)) onUpdate(val);
                    this.data = ElnCalculator.calculate(this.data);
                    this.render();
                };
            };
            
            if (type === 'reactants') { 
                makeNumInp('eq', 'Eq'); 
                if (this.advancedMode) { makeNumInp('mmol', 'n(mmol)', () => { delete item.mass; delete item.volume; }); }
                makeNumInp('mass', 'm(mg)', () => { delete item.mmol; delete item.volume; }); 
            } else { 
                makeNumInp('eq', 'Eq'); 
                makeNumInp('mass_isolated', 'Isol(mg)', () => { delete item.mmol_isolated; }); 
            }
        };

        const rHeader = contentEl.createDiv();
        rHeader.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" });
        rHeader.createEl("h3", { text: "Reactants" }).setCssStyles({ margin: "0", fontSize: "1.1em" });
        const addRBtn = rHeader.createEl("button", { text: "+ Add Reactant" });
        addRBtn.onclick = () => { this.data.reactants.push({ name: "", smiles: "", eq: 1 }); this.render(); };
        this.data.reactants.forEach((r: any, idx: number) => renderChemRow(r, 'reactants', idx));

        const pHeader = contentEl.createDiv();
        pHeader.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", marginTop: "20px" });
        pHeader.createEl("h3", { text: "Products" }).setCssStyles({ margin: "0", fontSize: "1.1em" });
        const addPBtn = pHeader.createEl("button", { text: "+ Add Product" });
        addPBtn.onclick = () => { this.data.products.push({ name: "", smiles: "", eq: 1 }); this.render(); };
        this.data.products.forEach((p: any, idx: number) => renderChemRow(p, 'products', idx));
        
        contentEl.createDiv().setCssStyles({ height: "50px" }); 
    }
    onClose() { this.contentEl.empty(); }
}