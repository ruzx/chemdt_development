// AnalyticalEln.ts
import { App, MarkdownView, Notice, Menu } from 'obsidian';

export class AnalyticalCalculator {
    static calculate(data: any) {
        if (!data.type) data.type = 'calibration';

        // ==========================================
        // 1. CALIBRATION CURVE & QUANTIFICATION
        // ==========================================
        if (data.type === 'calibration') {
            if (!data.standards) data.standards = [];
            if (!data.samples) data.samples = [];

            let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
            let n = 0;

            // 1a. Linear Regression (y = mx + b)
            data.standards.forEach((std: any) => {
                if (std.conc !== undefined && std.area !== undefined && std.exclude !== true) {
                    sumX += std.conc;
                    sumY += std.area;
                    sumXY += std.conc * std.area;
                    sumXX += std.conc * std.conc;
                    sumYY += std.area * std.area;
                    n++;
                }
            });

            if (n > 1) {
                const denominator = (n * sumXX - sumX * sumX);
                if (denominator !== 0) {
                    data.slope = (n * sumXY - sumX * sumY) / denominator;
                    data.intercept = (sumY - data.slope * sumX) / n;

                    // Calculate R-squared
                    const meanY = sumY / n;
                    let ssTot = 0, ssRes = 0;
                    data.standards.forEach((std: any) => {
                        if (std.conc !== undefined && std.area !== undefined && std.exclude !== true) {
                            const predY = data.slope * std.conc + data.intercept;
                            ssTot += Math.pow(std.area - meanY, 2);
                            ssRes += Math.pow(std.area - predY, 2);
                        }
                    });
                    data.r_squared = ssTot !== 0 ? 1 - (ssRes / ssTot) : 1;
                }
            } else {
                data.slope = null; data.intercept = null; data.r_squared = null;
            }

            // 1b. Unknowns Quantification
            if (data.slope && data.slope !== 0) {
                data.samples.forEach((samp: any) => {
                    samp.dilution_factor = samp.dilution_factor || 1;
                    if (samp.area !== undefined) {
                        // x = (y - b) / m
                        samp.vial_conc = (samp.area - data.intercept) / data.slope;
                        samp.original_conc = samp.vial_conc * samp.dilution_factor;
                    }
                });
            }
        }

        // ==========================================
        // 2. SERIAL DILUTION PREP
        // ==========================================
        if (data.type === 'serial_dilution') {
            if (!data.targets) data.targets = [];
            const stock = data.stock_conc || 0;

            if (stock > 0) {
                data.targets.forEach((t: any) => {
                    if (t.target_conc && t.target_vol) {
                        // C1V1 = C2V2 => V1 = (C2 * V2) / C1
                        t.stock_vol = (t.target_conc * t.target_vol) / stock;
                        t.diluent_vol = t.target_vol - t.stock_vol;
                    }
                });
            }
        }

        return data;
    }
}

export class AnalyticalElnRenderer {
    plugin: any;

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    async renderAnalyticalBlock(source: string, el: HTMLElement, ctx: any) {
        const { parseYaml, stringifyYaml } = require('obsidian'); 
        
        const wrapper = el.createDiv();
        wrapper.style.position = "relative"; 
        wrapper.style.border = "1px solid #3b82f6"; // Blue theme for Analytical
        wrapper.style.padding = "45px 15px 15px 15px"; 
        wrapper.style.borderRadius = "12px";
        wrapper.style.backgroundColor = "var(--background-primary-alt)";
        wrapper.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.05)";
        wrapper.style.fontFamily = "var(--font-interface)";
        wrapper.style.width = "100%";
        wrapper.innerHTML = `<h3 class="color-text-muted" style="text-align:center;">⏳ Processing Analytical Data...</h3>`;

        try {
            const safeSource = source.replace(/smiles:\s*(.*)$/gm, (match, p1) => {
                let s = p1.trim(); if (!s) return match;
                let comment = ""; const commentMatch = s.match(/(\s+#.*)$/);
                if (commentMatch) { comment = commentMatch[1]; s = s.substring(0, s.length - comment.length).trim(); }
                if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.substring(1, s.length - 1);
                s = s.replace(/\\"/g, '"'); s = s.replace(/'/g, "''"); 
                return `smiles: '${s}'${comment}`;
            });
            
            let data = parseYaml(safeSource);
            if (!data) throw new Error("Empty YAML Data.");

            data = AnalyticalCalculator.calculate(data);
            wrapper.innerHTML = '';

            const thColor = "var(--background-secondary)"; 
            const bdColor = "var(--background-modifier-border-hover)";
            const textColor = "var(--text-normal)";

            let html = `<div style="font-size: 14px; color: ${textColor}; margin-top:5px;">`;
            
            // Header
            html += `
            <div style="border-bottom: 2px solid #3b82f6; padding-bottom: 10px; margin-bottom: 20px; display:flex; justify-content:space-between; align-items:flex-end;">
                <div>
                    <h2 style="margin: 0; font-size: 22px; font-weight: 700; color: #3b82f6;">${data.title || data.code || 'Analytical Assay'}</h2>
                    <div style="font-size: 13px; color: var(--text-muted); margin-top:4px; text-transform: uppercase;">${data.type.replace('_', ' ')}</div>
                </div>
                <div style="text-align:right; font-size:12px; color:var(--text-muted);">
                    ${data.date ? `<b>Date:</b> ${data.date}<br>` : ''}
                    ${data.instrument ? `<b>Instrument:</b> ${data.instrument}` : ''}
                </div>
            </div>`;

            // Formatting Helpers
            const formatNum = (num: any, dec: number = 2) => {
                const n = Number(num);
                if (isNaN(n)) return '-';
                if (n === 0) return '0';
                if (n > 10000000) return n.toExponential(2);
                return (n % 1 === 0 && dec !== 0) ? n.toString() : n.toFixed(dec);
            };

            const makeEditableTd = (type: string, i: number, key: string, val: any, inputType: 'number'|'text' = 'number', customHtml?: string, extraStyle="") => {
                let innerHTML = customHtml !== undefined ? customHtml : (inputType === 'number' ? formatNum(val) : (val||'-'));
                let rawValAttr = val !== undefined && val !== null ? String(val).replace(/"/g, '&quot;') : "";
                return `<td class="ana-editable" data-type="${type}" data-idx="${i}" data-key="${key}" data-input-type="${inputType}" data-raw-value="${rawValAttr}" title="Double-click to edit" style="padding: 8px 10px; cursor: text; transition: background 0.2s; ${extraStyle}">${innerHTML}</td>`;
            };

            const makeEditableRoot = (key: string, val: any, inputType = 'number', unit = "") => {
                const displayVal = val !== undefined ? (inputType==='number' ? formatNum(val) : val) + unit : '-';
                const rawVal = val !== undefined && val !== null ? String(val).replace(/"/g, '&quot;') : "";
                return `<span class="ana-editable" data-type="root" data-key="${key}" data-input-type="${inputType}" data-raw-value="${rawVal}" title="Double-click to edit" style="cursor: text; border-bottom: 1px dashed #3b82f6; display: inline-block; font-weight: bold; color: var(--text-normal);">${displayVal}</span>`;
            };

            // ==========================================
            // 1. CALIBRATION CURVE MODE
            // ==========================================
            if (data.type === 'calibration') {
                const u = data.units || 'µg/mL';

                // Equation & Stats
                html += `
                <div style="display: flex; gap: 15px; flex-wrap: wrap; margin-bottom: 25px;">
                    <div style="flex: 1; min-width: 140px; background: var(--background-secondary); padding: 12px; border-radius: 6px; border: 1px solid var(--background-modifier-border); text-align:center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px;">Linear Equation</div>
                        <div style="font-size:16px; font-weight:bold; color:#3b82f6; font-family: monospace;">y = ${formatNum(data.slope, 4)}x ${data.intercept >= 0 ? '+' : '-'} ${formatNum(Math.abs(data.intercept), 4)}</div>
                    </div>
                    <div style="flex: 1; min-width: 100px; background: var(--background-secondary); padding: 12px; border-radius: 6px; border: 1px solid var(--background-modifier-border); text-align:center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px;">R-Squared (R²)</div>
                        <div style="font-size:18px; font-weight:bold; color:${data.r_squared >= 0.99 ? 'var(--text-success)' : 'var(--text-warning)'};">${formatNum(data.r_squared, 4)}</div>
                    </div>
                </div>`;

                if (data.smiles) {
                    html += `<div style="display:flex; justify-content:center; margin-bottom:20px;">
                        <div class="ana-struct" data-smiles="${data.smiles}"></div>
                    </div>`;
                }

                // Standards Table
                html += `<h4 style="margin-bottom: 10px; color: var(--text-normal);">Calibration Standards</h4>
                <div style="overflow-x: auto; margin-bottom: 20px;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                    <tr style="background-color: ${thColor}; border-bottom: 2px solid var(--background-modifier-border);">
                        <th style="padding: 10px;">Standard Name</th><th style="padding: 10px;">Conc [${u}]</th><th style="padding: 10px;">Response (Area)</th><th style="padding: 10px; text-align:center;">Include</th>
                    </tr>`;
                
                data.standards.forEach((std: any, i: number) => {
                    const isEx = std.exclude ? `<span style="color:var(--text-error); font-size:10px; font-weight:bold;">EXCLUDED</span>` : `<span style="color:var(--text-success);">✅</span>`;
                    const rowStyle = std.exclude ? 'opacity: 0.5;' : '';
                    html += `<tr style="border-bottom: 1px solid ${bdColor}; ${rowStyle}">
                        ${makeEditableTd('standards', i, 'name', std.name, 'text', std.name, "font-weight:600;")}
                        ${makeEditableTd('standards', i, 'conc', std.conc, 'number')}
                        ${makeEditableTd('standards', i, 'area', std.area, 'number', undefined, "font-weight:bold; color:var(--interactive-accent);")}
                        <td class="ana-exclude-toggle" data-idx="${i}" data-state="${std.exclude ? 'true' : 'false'}" style="padding: 10px; text-align:center; cursor:pointer;" title="Click to toggle inclusion">${isEx}</td>
                    </tr>`;
                });
                html += `</table></div>`;

                // Samples Table
                if (data.samples && data.samples.length > 0) {
                    html += `<h4 style="margin-bottom: 10px; color: var(--text-normal);">Quantified Samples</h4>
                    <div style="overflow-x: auto; margin-bottom: 20px;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                        <tr style="background-color: ${thColor}; border-bottom: 2px solid var(--background-modifier-border);">
                            <th style="padding: 10px;">Sample Name</th><th style="padding: 10px;">Dilution Factor</th><th style="padding: 10px;">Response (Area)</th><th style="padding: 10px; color:#3b82f6;">Vial Conc [${u}]</th><th style="padding: 10px; color:#3b82f6;">Original Conc [${u}]</th>
                        </tr>`;
                    
                    data.samples.forEach((samp: any, i: number) => {
                        html += `<tr style="border-bottom: 1px solid ${bdColor};">
                            ${makeEditableTd('samples', i, 'name', samp.name, 'text', samp.name, "font-weight:600;")}
                            ${makeEditableTd('samples', i, 'dilution_factor', samp.dilution_factor || 1, 'number')}
                            ${makeEditableTd('samples', i, 'area', samp.area, 'number', undefined, "font-weight:bold; color:var(--interactive-accent);")}
                            <td style="padding: 10px; color:var(--text-muted);">${formatNum(samp.vial_conc, 3)}</td>
                            <td style="padding: 10px; font-weight:bold; color:var(--text-normal); font-size:14px;">${formatNum(samp.original_conc, 3)}</td>
                        </tr>`;
                    });
                    html += `</table></div>`;
                }
            }

            // ==========================================
            // 2. SERIAL DILUTION MODE
            // ==========================================
            else if (data.type === 'serial_dilution') {
                const u = data.stock_units || '';
                
                html += `
                <div style="display: flex; gap: 15px; margin-bottom: 20px; font-size: 13px; background: var(--background-secondary); padding: 10px; border-radius: 6px;">
                    <div><span style="color:var(--text-muted)">Stock Concentration:</span> ${makeEditableRoot('stock_conc', data.stock_conc)} ${u}</div>
                    <div><span style="color:var(--text-muted)">Diluent:</span> ${makeEditableRoot('diluent', data.diluent, 'text')}</div>
                </div>`;

                html += `<h4 style="margin-bottom: 10px; color: var(--text-normal);">Dilution Scheme</h4>
                <div style="overflow-x: auto; margin-bottom: 20px;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                    <tr style="background-color: ${thColor}; border-bottom: 2px solid var(--background-modifier-border);">
                        <th style="padding: 10px;">Target Conc [${u}]</th><th style="padding: 10px;">Target Volume</th><th style="padding: 10px; color:#3b82f6;">Vol of Stock Needed</th><th style="padding: 10px; color:#3b82f6;">Vol of Diluent Needed</th>
                    </tr>`;
                
                data.targets.forEach((t: any, i: number) => {
                    html += `<tr style="border-bottom: 1px solid ${bdColor};">
                        ${makeEditableTd('targets', i, 'target_conc', t.target_conc, 'number', undefined, "font-weight:bold; color:var(--text-normal);")}
                        ${makeEditableTd('targets', i, 'target_vol', t.target_vol, 'number')}
                        <td style="padding: 10px; font-weight:bold; color:var(--text-accent);">${formatNum(t.stock_vol)}</td>
                        <td style="padding: 10px; font-weight:bold; color:var(--text-normal);">${formatNum(t.diluent_vol)}</td>
                    </tr>`;
                });
                html += `</table></div>`;
            }

            // ==========================================
            // 3. INSTRUMENT METHOD (HPLC/GC)
            // ==========================================
            else if (data.type === 'hplc_method' || data.type === 'gc_method') {
                html += `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; background: var(--background-secondary-alt); padding: 15px; border-radius: 8px; border: 1px solid #3b82f6; margin-bottom: 20px;">
                    <div><b style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Column</b><br><span style="font-weight:600;">${makeEditableRoot('column', data.column, 'text')}</span></div>
                    <div><b style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Flow Rate / Carrier</b><br><span style="font-weight:600;">${makeEditableRoot('flow_rate', data.flow_rate, 'text')}</span></div>
                    <div><b style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Temperature</b><br><span style="font-weight:600;">${makeEditableRoot('temp', data.temp, 'text')}</span></div>
                    <div><b style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">Detection (UV/MS)</b><br><span style="font-weight:600;">${makeEditableRoot('detection', data.detection, 'text')}</span></div>
                </div>
                
                <div style="display:flex; gap:20px; margin-bottom: 15px; padding: 10px; background: var(--background-primary); border-radius:6px; border: 1px solid var(--background-modifier-border);">
                    <div style="flex:1"><b style="color:var(--text-muted);">Solvent A:</b> ${makeEditableRoot('solvent_a', data.solvent_a, 'text')}</div>
                    <div style="flex:1"><b style="color:var(--text-muted);">Solvent B:</b> ${makeEditableRoot('solvent_b', data.solvent_b, 'text')}</div>
                </div>`;

                if (data.gradient) {
                    html += `<h4 style="margin-bottom: 10px; color: var(--text-normal);">Gradient / Oven Program</h4>
                    <div style="overflow-x: auto; margin-bottom: 20px;">
                    <table style="width: 50%; min-width:300px; border-collapse: collapse; text-align: left; font-size: 13px;">
                        <tr style="background-color: ${thColor}; border-bottom: 2px solid var(--background-modifier-border);">
                            <th style="padding: 8px;">Time (min)</th><th style="padding: 8px;">% B (or °C)</th>
                        </tr>`;
                    
                    data.gradient.forEach((g: any, i: number) => {
                        html += `<tr style="border-bottom: 1px solid ${bdColor};">
                            ${makeEditableTd('gradient', i, 'time', g.time, 'number', undefined, "font-weight:bold;")}
                            ${makeEditableTd('gradient', i, 'b_percent', g.b_percent, 'number')}
                        </tr>`;
                    });
                    html += `</table></div>`;
                }
            }

            html += `</div>`;
            
            // Edit Helper Function
            const attachEditListeners = () => {
                wrapper.addEventListener('dblclick', (e) => {
                    let target = e.target as HTMLElement;
                    while (target && target !== wrapper && !target.classList.contains('ana-editable')) { target = target.parentElement as HTMLElement; }

                    if (target && target.classList.contains('ana-editable') && !target.querySelector('input')) {
                        e.stopPropagation();
                        const type = target.getAttribute('data-type');
                        const idx = parseInt(target.getAttribute('data-idx') || '0', 10);
                        const key = target.getAttribute('data-key');
                        const inputType = target.getAttribute('data-input-type') || 'number';
                        if (!key) return;

                        const originalHTML = target.innerHTML;
                        const currentValText = target.getAttribute('data-raw-value') || '';
                        
                        target.innerHTML = ''; target.style.padding = "4px"; 
                        
                        const input = document.createElement('input');
                        input.type = inputType === 'text' ? 'text' : 'number';
                        if (inputType === 'number') input.step = "any";
                        input.value = currentValText;
                        Object.assign(input.style, { width: "100%", boxSizing: "border-box", padding: "4px 6px", border: "1px solid #3b82f6", borderRadius: "4px", background: "var(--background-primary)" });
                        
                        target.appendChild(input); input.focus();

                        const finishEdit = () => {
                            const newValStr = input.value.trim().replace(/,/g, '.'); 
                            const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
                            let info = ctx.getSectionInfo(el);
                            if (!info && el.parentElement) info = ctx.getSectionInfo(el.parentElement);
                            
                            if (view && info) {
                                const blockText = view.editor.getRange({line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                                try {
                                    let yamlObj = parseYaml(blockText);
                                    let valToSave: any = newValStr;
                                    if (inputType === 'number') { const num = parseFloat(newValStr); valToSave = isNaN(num) ? undefined : num; } 
                                    else { valToSave = newValStr === '' ? undefined : newValStr; }

                                    if (type === 'root') {
                                        if (valToSave === undefined) delete yamlObj[key]; else yamlObj[key] = valToSave;
                                    } else {
                                        if (!yamlObj[type!]) yamlObj[type!] = [];
                                        if (!yamlObj[type!][idx]) yamlObj[type!] = {};
                                        if (valToSave === undefined) delete yamlObj[type!][idx][key];
                                        else yamlObj[type!][idx][key] = valToSave;
                                    }
                                    
                                    yamlObj = AnalyticalCalculator.calculate(yamlObj);
                                    const newYaml = stringifyYaml(yamlObj);
                                    view.editor.replaceRange(newYaml, {line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                                } catch (err) { target.innerHTML = originalHTML; target.style.padding = "8px 10px"; }
                            } else { target.innerHTML = originalHTML; target.style.padding = "8px 10px"; }
                        };

                        input.onblur = finishEdit;
                        input.onkeydown = (ev) => { if (ev.key === 'Enter') input.blur(); else if (ev.key === 'Escape') { target.innerHTML = originalHTML; target.style.padding = "8px 10px"; } };
                    }
                });

                // Checkbox toggle for Calibration exclusions
                const toggles = contentDiv.querySelectorAll('.ana-exclude-toggle');
                toggles.forEach(node => {
                    node.addEventListener('click', (e) => {
                        const elNode = node as HTMLElement;
                        const idx = parseInt(elNode.dataset.idx || '0', 10);
                        const currentState = elNode.dataset.state === 'true';

                        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
                        let info = ctx.getSectionInfo(el);
                        if (!info && el.parentElement) info = ctx.getSectionInfo(el.parentElement);
                        
                        if (view && info) {
                            const blockText = view.editor.getRange({line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                            try {
                                let yamlObj = parseYaml(blockText);
                                yamlObj.standards[idx].exclude = !currentState;
                                yamlObj = AnalyticalCalculator.calculate(yamlObj);
                                const newYaml = stringifyYaml(yamlObj);
                                view.editor.replaceRange(newYaml, {line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                            } catch (err) {}
                        }
                    });
                });
            };

            // Action Bar for copying table
            const actionBar = wrapper.createDiv();
            Object.assign(actionBar.style, { position: "absolute", top: "8px", right: "10px", display: "flex", gap: "5px", zIndex: "10" });
            
            const copyBtn = actionBar.createDiv();
            copyBtn.innerHTML = "📋 Copy Data"; copyBtn.style.cursor = "pointer";
            copyBtn.style.fontSize = "11px"; copyBtn.style.padding = "4px 8px";
            copyBtn.style.backgroundColor = "var(--background-secondary)"; copyBtn.style.border = "1px solid var(--background-modifier-border)";
            copyBtn.style.color = "var(--text-normal)"; copyBtn.style.borderRadius = "4px";
            copyBtn.onclick = () => {
                let txt = "";
                if (data.type === 'calibration') {
                    txt = "Type\tName\tConc\tArea\tCalc Conc\n";
                    data.standards.forEach((s:any) => txt += `Standard\t${s.name||'-'}\t${s.conc||'-'}\t${s.area||'-'}\t-\n`);
                    data.samples.forEach((s:any) => txt += `Sample\t${s.name||'-'}\t-\t${s.area||'-'}\t${s.original_conc?.toFixed(3)||'-'}\n`);
                } else if (data.type === 'serial_dilution') {
                    txt = "Target Conc\tTarget Vol\tStock Vol\tDiluent Vol\n";
                    data.targets.forEach((t:any) => txt += `${t.target_conc||'-'}\t${t.target_vol||'-'}\t${t.stock_vol?.toFixed(2)||'-'}\t${t.diluent_vol?.toFixed(2)||'-'}\n`);
                }
                navigator.clipboard.writeText(txt);
                new Notice("Data copied to clipboard!");
            };

            const styleBlock = document.createElement("style");
            styleBlock.innerHTML = `.ana-editable:hover { background-color: var(--background-modifier-hover); }`;
            wrapper.appendChild(styleBlock);

            const contentDiv = document.createElement("div");
            contentDiv.innerHTML = html;
            wrapper.appendChild(contentDiv);
            
            attachEditListeners();

            // Render Structure if present
            if (data.smiles) {
                const structEl = contentDiv.querySelector('.ana-struct') as HTMLElement;
                if (structEl) {
                    structEl.style.width = `180px`; structEl.style.height = `120px`; 
                    structEl.innerHTML = "⏳";
                    requestAnimationFrame(async () => {
                        const renderEl = await this.plugin.api.renderStructure(data.smiles, 180, 120);
                        structEl.empty();
                        if (renderEl) { renderEl.style.maxWidth='100%'; renderEl.style.maxHeight='100%'; structEl.appendChild(renderEl); } 
                        else structEl.innerHTML = "❌";
                    });
                }
            }

            return wrapper;

        } catch (err: any) {
            wrapper.innerHTML = `<div style="padding: 20px; color: var(--text-error); background: var(--background-secondary); border-radius: 8px;"><b>Analytical ELN Error:</b><br>${err.message}</div>`;
            return wrapper;
        }
    }
}