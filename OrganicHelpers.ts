// OrganicHelpers.ts
import { App, MarkdownView, Notice, Menu } from 'obsidian';

export class OrgHelperCalculator {
    static calculate(data: any) {
        if (!data.type) return data;

        // ==========================================
        // 1. NMR YIELD CALCULATOR
        // ==========================================
        if (data.type === 'nmr_yield') {
            const stdMass = data.standard_mass_mg || 0;
            const stdMw = data.standard_mw || 1;
            const stdInt = data.standard_integral || 1;
            const stdH = data.standard_protons || 1;

            const prodMw = data.product_mw || 1;
            const prodInt = data.product_integral || 0;
            const prodH = data.product_protons || 1;
            const theoryMmol = data.theory_mmol || 1;

            const stdMmol = stdMass / stdMw;
            const normStdInt = stdInt / stdH;
            const normProdInt = prodInt / prodH;

            if (normStdInt > 0) {
                data.product_mmol = stdMmol * (normProdInt / normStdInt);
                data.product_mass_mg = data.product_mmol * prodMw;
                data.yield_percent = (data.product_mmol / theoryMmol) * 100;
            } else {
                data.product_mmol = 0; data.product_mass_mg = 0; data.yield_percent = 0;
            }
        }

        // ==========================================
        // 2. FARADAIC EFFICIENCY CALCULATOR
        // ==========================================
        if (data.type === 'faradaic_efficiency') {
            const mA = data.current_mA || 0;
            const h = data.time_hours || 0;
            const z = data.electrons_z || 2;
            const prodMmol = data.product_mmol || 0;

            // Q (Coulombs) = I (Amps) * t (seconds) => 1 mA * 1 hour = 3.6 C
            data.total_coulombs = mA * h * 3.6;

            // Faraday's Constant = 96485 C/mol
            const molesOfElectrons = data.total_coulombs / 96485;
            
            // Theoretical max moles of product = Moles e- / z
            data.theory_max_mmol = (molesOfElectrons / z) * 1000;

            if (data.theory_max_mmol > 0) {
                data.faradaic_efficiency = (prodMmol / data.theory_max_mmol) * 100;
            } else {
                data.faradaic_efficiency = 0;
            }
        }

        // ==========================================
        // 3. REACTION SCREENING (MASTER MIX)
        // ==========================================
        if (data.type === 'reaction_screening') {
            if (!data.components) data.components = [];
            
            const rxns = data.reactions || 1;
            const overage = data.overage_percent !== undefined ? data.overage_percent : 10;
            const calcRxns = rxns * (1 + overage / 100);
            
            const scaleMmol = data.scale_mmol || 0.1;
            const volPerVial = data.vol_per_vial_ml || 1.0;

            data.calculated_reactions = calcRxns;
            data.total_stock_vol_ml = calcRxns * volPerVial;

            data.components.forEach((c: any) => {
                c.eq = c.eq || 1;
                c.total_mmol = scaleMmol * c.eq * calcRxns;
                if (c.mw) c.total_mass_mg = c.total_mmol * c.mw;
                else c.total_mass_mg = 0;
                if (c.density) c.total_vol_ul = (c.total_mass_mg / c.density) * 1000; 
            });
        }

        // ==========================================
        // 4. CATALYST METRICS (TON/TOF)
        // ==========================================
        if (data.type === 'catalyst_metrics') {
            const pMmol = data.product_mmol || 0;
            const cMmol = data.catalyst_mmol || 1;
            const t = data.time_hours || 1;
            
            data.ton = pMmol / cMmol;
            data.tof = data.ton / t;
        }

        return data;
    }
}

export class OrganicHelpersRenderer {
    plugin: any;
    constructor(plugin: any) { this.plugin = plugin; }

    async renderBlock(source: string, el: HTMLElement, ctx: any) {
        const { parseYaml, stringifyYaml } = require('obsidian'); 
        
        const wrapper = el.createDiv();
        
        // Amber/Orange theme for Organic Tools
        const themeColor = "#f59e0b"; 
        const bgSec = "var(--background-secondary)";
        const bdColor = "var(--background-modifier-border)";

        wrapper.style.position = "relative"; 
        wrapper.style.border = `1px solid ${bdColor}`; 
        wrapper.style.borderRadius = "12px";
        wrapper.style.backgroundColor = "var(--background-primary)";
        wrapper.style.padding = "24px";
        wrapper.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.03)";
        wrapper.style.fontFamily = "var(--font-interface)";
        wrapper.style.width = "100%";
        wrapper.style.marginBottom = "15px";

        // Reusable SVG Icons
        const icons = {
            flask: `<svg stroke="${themeColor}" fill="rgba(245,158,11,0.15)" width="48" height="48" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a2 2 0 0 0 1.8 2.45h10.96a2 2 0 0 0 1.8-2.45L14.21 10.42a2 2 0 0 1-.21-.896V2"/><path d="M8.5 2h7"/><path d="M14 16H5.5"/></svg>`,
            pipette: `<svg stroke="var(--text-muted)" fill="none" width="32" height="32" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m18 2 4 4"/><path d="m17 7 3-3"/><path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5"/><path d="m9 11 4 4"/><path d="m5 19-3 3"/></svg>`,
            vial: `<svg stroke="var(--text-muted)" fill="none" width="24" height="24" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v17.5A2.5 2.5 0 0 1 6.5 22v0A2.5 2.5 0 0 1 4 19.5V2"/><path d="M3 2h5"/><path d="M4 14h5"/></svg>`,
            zap: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${themeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
            clock: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
            current: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>`,
            nmrTube: `<svg stroke="${themeColor}" fill="none" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v18a2 2 0 0 0 4 0V2"/><path d="M8 2h8"/><path d="M10 16h4"/></svg>`,
        };

        try {
            let data = parseYaml(source);
            if (!data) throw new Error("Empty YAML Data.");
            data = OrgHelperCalculator.calculate(data);

            let html = `
            <div style="position: relative; margin-bottom: 24px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div style="display:flex; flex-direction:column;">
                        <div class="org-editable" data-type="root" data-key="title" data-input-type="text" data-raw-value="${data.title?.replace(/"/g, '&quot;') || ''}" title="Double-click to edit title" style="margin: 0; font-size: 24px; font-weight: 700; color: ${themeColor}; cursor: text; border-bottom: 2px dotted ${themeColor}; display: inline-block; width: max-content;">${data.title || 'Organic Helper'}</div>
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${data.type.replace('_', ' ')}</div>
                    </div>
                </div>
                <div style="height: 2px; background-color: ${themeColor}; margin-top: 12px; opacity: 0.5;"></div>
            </div>`;

            const formatNum = (num: any, decimals: number = 2) => {
                const n = Number(num);
                if (isNaN(n) || n === 0) return '-';
                return (n % 1 === 0) ? n.toString() : n.toFixed(decimals);
            };

            const makeEditableTd = (type: string, i: number, key: string, val: any, inputType: 'number'|'text'|'string' = 'number', customHtml?: string) => {
                let innerHTML = customHtml !== undefined ? customHtml : (inputType === 'number' ? formatNum(val) : (val||'-'));
                let rawValAttr = val !== undefined && val !== null ? String(val).replace(/"/g, '&quot;') : "";
                return `<td class="org-editable" data-type="${type}" data-idx="${i}" data-key="${key}" data-input-type="${inputType}" data-raw-value="${rawValAttr}" title="Double-click to edit" style="padding: 12px 10px; cursor: text; border-bottom: 1px solid ${bdColor};">${innerHTML}</td>`;
            };

            const makeEditableRoot = (key: string, val: any, inputType = 'number', unit = "") => {
                const displayVal = val !== undefined ? (inputType==='number' ? formatNum(val, 2) : val) : '-';
                const rawVal = val !== undefined && val !== null ? String(val).replace(/"/g, '&quot;') : "";
                return `<span class="org-editable" data-type="root" data-key="${key}" data-input-type="${inputType}" data-raw-value="${rawVal}" title="Double-click to edit" style="cursor: text; border-bottom: 2px dotted ${themeColor}; font-weight: 700; color: var(--text-normal); padding: 0 2px;">${displayVal}${unit}</span>`;
            };

            // ==========================================
            // 1. NMR YIELD
            // ==========================================
            if (data.type === 'nmr_yield') {
                html += `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px;">
                        <h4 style="margin: 0 0 15px 0; color: var(--text-normal); font-size: 14px; display:flex; align-items:center; gap:6px;">${icons.nmrTube} Internal Standard</h4>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Name:</span> ${makeEditableRoot('standard_name', data.standard_name, 'text')}
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">MW (g/mol):</span> ${makeEditableRoot('standard_mw', data.standard_mw)}
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Mass added (mg):</span> ${makeEditableRoot('standard_mass_mg', data.standard_mass_mg)}
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Protons (N):</span> ${makeEditableRoot('standard_protons', data.standard_protons)}
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Integration (I):</span> ${makeEditableRoot('standard_integral', data.standard_integral)}
                        </div>
                    </div>

                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px;">
                        <h4 style="margin: 0 0 15px 0; color: var(--text-normal); font-size: 14px; display:flex; align-items:center; gap:6px;">${icons.nmrTube} Target Product</h4>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Theory Scale (mmol):</span> ${makeEditableRoot('theory_mmol', data.theory_mmol)}
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">MW (g/mol):</span> ${makeEditableRoot('product_mw', data.product_mw)}
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Protons (N):</span> ${makeEditableRoot('product_protons', data.product_protons)}
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Integration (I):</span> ${makeEditableRoot('product_integral', data.product_integral)}
                        </div>
                    </div>
                </div>

                <div style="display: flex; gap: 15px;">
                    <div style="flex: 1; background: var(--background-primary); border: 2px solid ${themeColor}; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1);">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">Calculated Amount</div>
                        <div style="font-size:26px; font-weight:800; color:var(--text-normal);">${data.product_mmol ? data.product_mmol.toFixed(3) : '-'} <span style="font-size:14px; color:var(--text-muted); font-weight:500;">mmol</span> &nbsp;<span style="color:var(--background-modifier-border);">|</span>&nbsp; ${data.product_mass_mg ? data.product_mass_mg.toFixed(1) : '-'} <span style="font-size:14px; color:var(--text-muted); font-weight:500;">mg</span></div>
                    </div>
                    <div style="flex: 1; background: var(--background-primary); border: 2px solid ${themeColor}; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1);">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">NMR Yield</div>
                        <div style="font-size:32px; font-weight:800; color:${data.yield_percent >= 80 ? 'var(--text-success)' : (data.yield_percent >= 40 ? 'var(--text-warning)' : 'var(--text-error)')};">${data.yield_percent ? data.yield_percent.toFixed(1) + '%' : '-'}</div>
                        <div style="width:100%; background:var(--background-modifier-border); height:6px; border-radius:3px; overflow:hidden; margin-top: 12px;">
                            <div style="width:${Math.min(data.yield_percent || 0, 100)}%; background:${data.yield_percent >= 80 ? 'var(--text-success)' : (data.yield_percent >= 40 ? 'var(--text-warning)' : 'var(--text-error)')}; height:100%; transition:width 0.3s;"></div>
                        </div>
                    </div>
                </div>`;
            }

            // ==========================================
            // 2. FARADAIC EFFICIENCY
            // ==========================================
            else if (data.type === 'faradaic_efficiency') {
                html += `
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px;">
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Product Formed</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('product_mmol', data.product_mmol)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">mmol</span></div>
                    </div>
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center; position:relative;">
                        <div style="position:absolute; top:10px; left:10px; opacity:0.5;">${icons.zap}</div>
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Electrons (z)</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('electrons_z', data.electrons_z)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">e⁻</span></div>
                    </div>
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center; position:relative;">
                        <div style="position:absolute; top:10px; left:10px; opacity:0.5;">${icons.current}</div>
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Current</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('current_mA', data.current_mA)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">mA</span></div>
                    </div>
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center; position:relative;">
                        <div style="position:absolute; top:10px; left:10px; opacity:0.5;">${icons.clock}</div>
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Time</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('time_hours', data.time_hours)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">h</span></div>
                    </div>
                </div>

                <div style="display: flex; gap: 15px;">
                    <div style="flex: 1; background: var(--background-primary); border: 2px solid ${themeColor}; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1);">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">Total Charge (Q)</div>
                        <div style="font-size:26px; font-weight:800; color:var(--text-normal);">${data.total_coulombs ? data.total_coulombs.toFixed(1) : '-'} <span style="font-size:16px; color:var(--text-muted); font-weight:500;">C</span></div>
                    </div>
                    <div style="flex: 1; background: var(--background-primary); border: 2px solid ${themeColor}; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1);">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">Theoretical Max</div>
                        <div style="font-size:26px; font-weight:800; color:var(--text-normal);">${data.theory_max_mmol ? data.theory_max_mmol.toFixed(3) : '-'} <span style="font-size:16px; color:var(--text-muted); font-weight:500;">mmol</span></div>
                    </div>
                    <div style="flex: 1.5; background: var(--background-primary); border: 2px solid ${themeColor}; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1);">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">Faradaic Efficiency</div>
                        <div style="font-size:32px; font-weight:800; color:${data.faradaic_efficiency >= 80 ? 'var(--text-success)' : (data.faradaic_efficiency >= 40 ? 'var(--text-warning)' : 'var(--text-error)')};">${data.faradaic_efficiency ? data.faradaic_efficiency.toFixed(1) + '%' : '-'}</div>
                        <div style="width:100%; background:var(--background-modifier-border); height:6px; border-radius:3px; overflow:hidden; margin-top: 12px;">
                            <div style="width:${Math.min(data.faradaic_efficiency || 0, 100)}%; background:${data.faradaic_efficiency >= 80 ? 'var(--text-success)' : (data.faradaic_efficiency >= 40 ? 'var(--text-warning)' : 'var(--text-error)')}; height:100%; transition:width 0.3s;"></div>
                        </div>
                    </div>
                </div>`;
            }

            // ==========================================
            // 3. REACTION SCREENING (MASTER MIX)
            // ==========================================
            else if (data.type === 'reaction_screening') {
                
                // Visual Diagram (Replaces the text boxes)
                html += `
                <div style="display: flex; align-items: stretch; background: var(--background-secondary-alt); border-radius: 8px; border: 1px solid var(--background-modifier-border); padding: 20px 10px; gap: 15px; margin-bottom: 24px;">
                    
                    <!-- Box 1: Master Mix -->
                    <div style="flex: 1; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                        ${icons.flask}
                        <div style="font-weight: 700; font-size: 15px; color: var(--text-normal); margin-top: 10px;">Master Vial</div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 5px;">Fill to Total Volume:</div>
                        <div style="font-size: 24px; font-weight: 800; color: ${themeColor}; margin-top: 4px;">${formatNum(data.total_stock_vol_ml)} <span style="font-size:14px; font-weight:500;">mL</span></div>
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">(Includes ${makeEditableRoot('overage_percent', data.overage_percent, 'number')}% overage)</div>
                    </div>

                    <!-- Box 2: Pipette -->
                    <div style="flex: 1; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative;">
                        <div style="position: absolute; top: 50%; left: 0; right: 0; height: 2px; background: ${themeColor}; z-index: 0; border-style: dashed; opacity: 0.5;"></div>
                        <div style="background: var(--background-primary); padding: 15px; z-index: 1; display: flex; flex-direction: column; align-items: center; border-radius: 8px; border: 1px solid var(--background-modifier-border); box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                            ${icons.pipette}
                            <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); margin-top: 10px; text-transform: uppercase;">Dispense</div>
                            <div style="font-size: 18px; font-weight: 800; color: var(--text-normal); margin-top: 4px;">${makeEditableRoot('vol_per_vial_ml', data.vol_per_vial_ml)} <span style="font-size:12px; font-weight:500;">mL / vial</span></div>
                        </div>
                    </div>

                    <!-- Box 3: Target Vials -->
                    <div style="flex: 1; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                        <div style="display: flex; gap: 4px; justify-content: center; align-items: center;">
                            ${Array.from({length: Math.min(data.reactions, 4)}).map(() => icons.vial).join('')}
                            ${data.reactions > 4 ? `<div style="font-weight:bold; color:var(--text-muted); margin-left:4px;">...</div>` : ''}
                        </div>
                        <div style="font-weight: 700; font-size: 15px; color: var(--text-normal); margin-top: 10px;">Reaction Vials</div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 5px;">Total Vials Prepared:</div>
                        <div style="font-size: 24px; font-weight: 800; color: var(--text-normal); margin-top: 4px;">${makeEditableRoot('reactions', data.reactions)}</div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 6px;">Scale: ${makeEditableRoot('scale_mmol', data.scale_mmol)} mmol / vial</div>
                    </div>
                </div>`;

                // Table
                html += `<div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 14px;">
                    <tr>
                        <th style="padding: 10px; border-bottom: 2px solid ${bdColor}; font-weight: 600; color: var(--text-normal);">Component</th>
                        <th style="padding: 10px; border-bottom: 2px solid ${bdColor}; font-weight: 600; color: var(--text-normal);">MW (g/mol)</th>
                        <th style="padding: 10px; border-bottom: 2px solid ${bdColor}; font-weight: 600; color: var(--text-normal);">Equiv.</th>
                        <th style="padding: 10px; border-bottom: 2px solid ${bdColor}; font-weight: 600; color: var(--text-muted);">Total mmol</th>
                        <th style="padding: 10px; border-bottom: 2px solid ${bdColor}; font-weight: 700; color: ${themeColor};">Mass to Weigh (mg)</th>
                    </tr>`;
                
                data.components.forEach((c: any, i: number) => {
                    html += `<tr>
                        ${makeEditableTd('components', i, 'name', c.name, 'text', c.name, "font-weight:600; color:var(--text-normal);")}
                        ${makeEditableTd('components', i, 'mw', c.mw, 'number')}
                        ${makeEditableTd('components', i, 'eq', c.eq, 'number', undefined, "font-weight:bold;")}
                        <td style="padding: 12px 10px; color:var(--text-muted); border-bottom: 1px solid ${bdColor};">${formatNum(c.total_mmol, 3)}</td>
                        <td style="padding: 12px 10px; font-weight:700; color:var(--text-normal); border-bottom: 1px solid ${bdColor}; font-size: 16px;">${c.total_mass_mg !== undefined && c.total_mass_mg > 0 ? c.total_mass_mg.toFixed(1) : '<span style="color:var(--text-muted); font-weight:normal;">-</span>'}</td>
                    </tr>`;
                });
                html += `</table></div>`;
            }

            // ==========================================
            // 4. CATALYST METRICS (TON/TOF)
            // ==========================================
            else if (data.type === 'catalyst_metrics') {
                html += `
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px;">
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Product Formed</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('product_mmol', data.product_mmol)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">mmol</span></div>
                    </div>
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Catalyst Loading</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('catalyst_mmol', data.catalyst_mmol)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">mmol</span></div>
                    </div>
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Time</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('time_hours', data.time_hours)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">h</span></div>
                    </div>
                </div>

                <div style="display: flex; gap: 15px;">
                    <div style="flex: 1; background: var(--background-primary); border: 2px solid ${themeColor}; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1);">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">Turnover Number (TON)</div>
                        <div style="font-size:32px; font-weight:800; color:var(--text-normal);">${data.ton ? data.ton.toLocaleString(undefined, {maximumFractionDigits: 1}) : '-'}</div>
                    </div>
                    <div style="flex: 1; background: var(--background-primary); border: 2px solid ${themeColor}; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1);">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">Turnover Frequency (TOF)</div>
                        <div style="font-size:32px; font-weight:800; color:${themeColor};">${data.tof ? data.tof.toLocaleString(undefined, {maximumFractionDigits: 2}) : '-'} <span style="font-size:16px; color:var(--text-muted); font-weight:500;">h⁻¹</span></div>
                    </div>
                </div>`;
            }

            html += `</div>`; // End main wrapper
            
            // --- EVENT LISTENERS ---
            const styleBlock = document.createElement("style");
            styleBlock.innerHTML = `.org-editable:hover { background-color: rgba(245, 158, 11, 0.1); border-radius: 4px; }`;
            wrapper.appendChild(styleBlock);

            const contentDiv = document.createElement("div");
            contentDiv.innerHTML = html;
            wrapper.appendChild(contentDiv);

            // Double-Click Inline Editing
            wrapper.addEventListener('dblclick', (e) => {
                let target = e.target as HTMLElement;
                while (target && target !== wrapper && !target.classList.contains('org-editable')) { target = target.parentElement as HTMLElement; }

                if (target && target.classList.contains('org-editable') && !target.querySelector('input')) {
                    e.stopPropagation();
                    const type = target.getAttribute('data-type');
                    const idx = parseInt(target.getAttribute('data-idx') || '0', 10);
                    const key = target.getAttribute('data-key');
                    const inputType = target.getAttribute('data-input-type') || 'number';
                    if (!key) return;

                    const originalHTML = target.innerHTML;
                    const currentValText = target.getAttribute('data-raw-value') || '';
                    
                    target.innerHTML = ''; 
                    
                    const input = document.createElement('input');
                    input.type = inputType === 'text' || inputType === 'string' ? 'text' : 'number';
                    if (inputType === 'number') input.step = "any";
                    input.value = currentValText;
                    Object.assign(input.style, { width: "100%", boxSizing: "border-box", padding: "4px 6px", border: `2px solid ${themeColor}`, borderRadius: "4px", background: "var(--background-primary)", fontSize: "inherit", fontWeight: "inherit", color: "var(--text-normal)" });
                    
                    target.appendChild(input); input.focus();

                    const finishEdit = () => {
                        const newValStr = input.value.trim().replace(/,/g, '.'); 
                        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
                        let info = ctx.getSectionInfo(el);
                        if (!info && el.parentElement) info = ctx.getSectionInfo(el.parentElement);
                        
                        if (view && info) {
                            const { parseYaml, stringifyYaml } = require('obsidian');
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
                                
                                yamlObj = OrgHelperCalculator.calculate(yamlObj);
                                const newYaml = stringifyYaml(yamlObj);
                                view.editor.replaceRange(newYaml, {line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                            } catch (err) { target.innerHTML = originalHTML; }
                        } else { target.innerHTML = originalHTML; }
                    };

                    input.onblur = finishEdit;
                    input.onkeydown = (ev) => { if (ev.key === 'Enter') input.blur(); else if (ev.key === 'Escape') { target.innerHTML = originalHTML; } };
                }
            });

            // Action Bar (Excel Copy Output)
            const actionBar = wrapper.createDiv();
            Object.assign(actionBar.style, { position: "absolute", top: "15px", right: "15px", display: "flex", gap: "8px", zIndex: "10" });
            
            const createActionBarBtn = (text: string, onClick: () => void) => {
                const btn = actionBar.createDiv();
                btn.innerHTML = text; btn.style.cursor = "pointer";
                btn.style.fontSize = "11px"; btn.style.padding = "4px 10px"; btn.style.fontWeight = "600";
                btn.style.backgroundColor = "transparent"; btn.style.border = "1px solid var(--background-modifier-border)";
                btn.style.color = "var(--text-muted)"; btn.style.borderRadius = "4px";
                btn.onmouseover = () => { btn.style.borderColor = themeColor; btn.style.color = themeColor; };
                btn.onmouseout = () => { btn.style.borderColor = "var(--background-modifier-border)"; btn.style.color = "var(--text-muted)"; };
                btn.onclick = onClick; return btn;
            };

            createActionBarBtn("📋 Copy Data", () => {
                let txt = "";
                if (data.type === 'nmr_yield') {
                    txt = `Parameter\tValue\n`;
                    txt += `Internal Standard\t${data.standard_name || '-'}\n`;
                    txt += `Standard Mass (mg)\t${data.standard_mass_mg}\n`;
                    txt += `Theory (mmol)\t${data.theory_mmol}\n`;
                    txt += `Calculated Amount (mmol)\t${data.product_mmol?.toFixed(3)}\n`;
                    txt += `Calculated Amount (mg)\t${data.product_mass_mg?.toFixed(1)}\n`;
                    txt += `NMR Yield (%)\t${data.yield_percent?.toFixed(1)}\n`;
                } else if (data.type === 'faradaic_efficiency') {
                    txt = `Parameter\tValue\n`;
                    txt += `Product Formed (mmol)\t${data.product_mmol}\n`;
                    txt += `Electrons (z)\t${data.electrons_z}\n`;
                    txt += `Current (mA)\t${data.current_mA}\n`;
                    txt += `Time (h)\t${data.time_hours}\n`;
                    txt += `Total Charge (C)\t${data.total_coulombs?.toFixed(1)}\n`;
                    txt += `Theoretical Max (mmol)\t${data.theory_max_mmol?.toFixed(3)}\n`;
                    txt += `Faradaic Efficiency (%)\t${data.faradaic_efficiency?.toFixed(1)}\n`;
                } else if (data.type === 'reaction_screening') {
                    txt = `Component\tMW\tEq\tTotal mmol\tMass to Weigh (mg)\n`;
                    data.components.forEach((c:any) => txt += `${c.name||'-'}\t${c.mw||'-'}\t${c.eq||'-'}\t${c.total_mmol?.toFixed(3)||'-'}\t${c.total_mass_mg?.toFixed(1)||'-'}\n`);
                    txt += `\nMaster Mix Total Volume (mL)\t${data.total_stock_vol_ml?.toFixed(2)}\n`;
                    txt += `Dispense Volume per Vial (mL)\t${data.vol_per_vial_ml}\n`;
                } else if (data.type === 'catalyst_metrics') {
                    txt = `Parameter\tValue\n`;
                    txt += `Product (mmol)\t${data.product_mmol}\n`;
                    txt += `Catalyst (mmol)\t${data.catalyst_mmol}\n`;
                    txt += `Time (h)\t${data.time_hours}\n`;
                    txt += `TON\t${data.ton?.toFixed(1)}\n`;
                    txt += `TOF (h-1)\t${data.tof?.toFixed(2)}\n`;
                } else {
                    txt = JSON.stringify(data, null, 2);
                }
                navigator.clipboard.writeText(txt);
                new Notice("Table copied to clipboard (Excel ready)!");
            });

            return wrapper;

        } catch (err: any) {
            wrapper.innerHTML = `<div style="padding: 20px; color: var(--text-error); background: var(--background-secondary); border-radius: 8px;"><b>Organic Helper Error:</b><br>${err.message}</div>`;
            return wrapper;
        }
    }
}