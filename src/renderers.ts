import { App, Menu, Notice, MenuItem } from 'obsidian';
import * as OCL from 'openchemlib';
import { 
    SpecData, 
    SavedState, 
    ChemSpecSettings, 
    UserMultiplet, 
    UserIntegral, 
    SOLVENT_PEAKS, 
    SpectrumLoadResult,
    TLCLane 
} from './types';

// Helper to convert hex colors to RGBA for semi-transparent peak shading
function hexToRgba(hex: string, alpha: number): string {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16) || 0;
    const g = parseInt(clean.substring(2, 4), 16) || 0;
    const b = parseInt(clean.substring(4, 6), 16) || 0;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function renderIR(container: HTMLElement, data: SpecData, settings: ChemSpecSettings) {
    const xs = data.xs || new Float64Array(); const ys = data.ys || new Float64Array();
    const npoints = data.npoints || 0; const title = data.title || "";
    
    let viewMaxX = Math.max(xs[0], xs[npoints-1]); let viewMinX = Math.min(xs[0], xs[npoints-1]); 
    let initialMaxY = -Infinity, initialMinY = Infinity;
    for (let i = 0; i < ys.length; i++) {
        if (ys[i] > initialMaxY) initialMaxY = ys[i]; if (ys[i] < initialMinY) initialMinY = ys[i];
    }
    let viewMaxY = data.maxInt || initialMaxY; let viewMinY = data.minInt || initialMinY;

    const header = container.createDiv();
    const titleSpan = header.createSpan();
    header.setCssStyles({ padding: "8px 14px", background: "var(--background-secondary)", borderBottom: "1px solid var(--background-modifier-border)", fontSize: "0.85em", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "8px" });
    
    titleSpan.empty();
    titleSpan.createSpan({ text: "FT-IR SPECTRUM" }).setCssStyles({ fontWeight: "600", color: "var(--text-accent)" });
    titleSpan.createSpan({ text: " | " }).setCssStyles({ color: "var(--text-muted)" });
    titleSpan.createSpan({ text: title });
    
    const toolsContainer = header.createDiv(); toolsContainer.setCssStyles({ display: "flex", gap: "4px", flexWrap: "wrap" });
    const resetBtn = toolsContainer.createEl("button", { text: "Reset View" }); resetBtn.setCssStyles({ padding: "4px 8px", fontSize: "0.8em", borderRadius: "4px" });

    const canvasContainer = container.createDiv(); canvasContainer.setCssStyles({ flexGrow: "1", position: "relative", cursor: "grab", touchAction: "none" });
    const canvas = canvasContainer.createEl("canvas"); canvas.setCssStyles({ width: "100%", height: "100%", display: "block" });

    const draw = () => {
        const rect = canvasContainer.getBoundingClientRect(); if (rect.width === 0 || rect.height === 0) return; 
        canvas.width = rect.width * window.devicePixelRatio; canvas.height = rect.height * window.devicePixelRatio;
        const ctx = canvas.getContext("2d"); if (!ctx) return;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        
        const w = rect.width; const h = rect.height; const padBottom = 25; const padTop = 15;
        ctx.clearRect(0, 0, w, h);

        ctx.beginPath(); ctx.moveTo(0, h - padBottom); ctx.lineTo(w, h - padBottom);
        ctx.strokeStyle = "var(--background-modifier-border)"; ctx.lineWidth = 1.5; ctx.stroke();

        ctx.beginPath(); ctx.strokeStyle = settings.lineColor; ctx.lineWidth = settings.lineWidth; ctx.lineJoin = "round";

        const getX = (val: number) => ((viewMaxX - val) / (viewMaxX - viewMinX)) * w;
        const getY = (val: number) => h - padBottom - ((val - viewMinY) / (viewMaxY - viewMinY)) * (h - padBottom - padTop);

        let started = false; const step = Math.max(1, Math.floor(npoints / (w * 4)));
        for (let i = 0; i < npoints; i+=step) {
            const x = getX(xs[i]); const y = getY(ys[i]);
            if (x < -20 || x > w + 20) continue;
            if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();

        ctx.fillStyle = "var(--text-normal)"; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
        const ticks = 8;
        for (let i = 0; i < ticks; i++) {
            const fraction = i / (ticks - 1); const xPos = fraction * w;
            const currentWn = viewMaxX - fraction * (viewMaxX - viewMinX);
            ctx.beginPath(); ctx.moveTo(xPos, h - padBottom); ctx.lineTo(xPos, h - padBottom + 6);
            ctx.strokeStyle = "var(--text-muted)"; ctx.stroke();
            ctx.fillText(currentWn.toFixed(0), xPos, h - padBottom + 20);
        }
    };

    resetBtn.onclick = () => { viewMaxX = Math.max(xs[0], xs[npoints-1]); viewMinX = Math.min(xs[0], xs[npoints-1]); window.requestAnimationFrame(draw); };

    let isDragging = false; let dragStartX = 0; let dragStartMax = 0; let dragStartMin = 0;
    canvasContainer.addEventListener("pointerdown", (e) => {
        canvasContainer.setPointerCapture(e.pointerId); isDragging = true; dragStartX = e.clientX; 
        dragStartMax = viewMaxX; dragStartMin = viewMinX; canvasContainer.setCssStyles({ cursor: "grabbing" });
    });
    canvasContainer.addEventListener("pointermove", (e) => {
        if (isDragging) {
            const deltaX = e.clientX - dragStartX; const range = dragStartMax - dragStartMin;
            const shift = (deltaX / canvasContainer.getBoundingClientRect().width) * range;
            viewMaxX = dragStartMax + shift; viewMinX = dragStartMin + shift; window.requestAnimationFrame(draw);
        }
    });
    canvasContainer.addEventListener("pointerup", (e) => { canvasContainer.releasePointerCapture(e.pointerId); isDragging = false; canvasContainer.setCssStyles({ cursor: "grab" }); });
    canvasContainer.addEventListener("wheel", (e) => {
        e.preventDefault(); const rect = canvasContainer.getBoundingClientRect(); const mouseX = e.clientX - rect.left;
        const zoomFactor = (e.deltaY < 0) ? 0.8 : 1.25; const mouseWn = viewMaxX - (mouseX / rect.width) * (viewMaxX - viewMinX);
        const range = (viewMaxX - viewMinX) * zoomFactor; viewMaxX = mouseWn + (mouseX / rect.width) * range; viewMinX = viewMaxX - range;
        window.requestAnimationFrame(draw);
    });
    canvasContainer.addEventListener("dblclick", () => { viewMaxX = Math.max(xs[0], xs[npoints-1]); viewMinX = Math.min(xs[0], xs[npoints-1]); window.requestAnimationFrame(draw); });

    const resizeObserver = new ResizeObserver(() => window.requestAnimationFrame(draw)); resizeObserver.observe(canvasContainer);
    window.setTimeout(draw, 100);
}

export function renderCV(container: HTMLElement, data: SpecData, settings: ChemSpecSettings) {
    const rawXs = data.xs || new Float64Array();
    const rawYs = data.ys || new Float64Array();
    const npoints = data.npoints || 0;
    const title = data.title || "";
    const cycleBreaks = data.cycleBreaks || [0, npoints];
    const numCycles = Math.max(1, Math.floor((cycleBreaks.length - 1) / 2));
    
    let selectedCycle = 0;
    let fcShift = 0.0;
    let detectedPeaks: {x: number, y: number, type: string}[] = [];
    
    let currentXs = new Float64Array(); let currentYs = new Float64Array();
    let viewMinX = 0, viewMaxX = 0, viewMinY = 0, viewMaxY = 0;
    let dStartMinX = 0, dStartMaxX = 0, dStartMinY = 0, dStartMaxY = 0;
    let currentScale = 1e6; let currentUnit = "µA";

    const header = container.createDiv();
    header.setCssStyles({ padding: "8px 14px", background: "var(--background-secondary)", borderBottom: "1px solid var(--background-modifier-border)", fontSize: "0.85em", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "10px" });
    
    const titleSpan = header.createSpan();
    titleSpan.createSpan({ text: "CYCLIC VOLTAMMOGRAM" }).setCssStyles({ fontWeight: "600", color: "var(--text-accent)" });
    titleSpan.createSpan({ text: " | " }).setCssStyles({ color: "var(--text-muted)" });
    titleSpan.createSpan({ text: title });
    
    const toolsContainer = header.createDiv();
    toolsContainer.setCssStyles({ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" });
    
    if (numCycles > 1) {
        const cycleLabel = toolsContainer.createSpan({ text: "Cycle:" });
        cycleLabel.setCssStyles({ color: "var(--text-muted)", fontSize: "0.9em" });
        const cycleSelect = toolsContainer.createEl("select");
        cycleSelect.setCssStyles({ fontSize: "0.85em", padding: "2px", background: "var(--background-primary)", border: "1px solid var(--background-modifier-border)", borderRadius: "4px" });
        cycleSelect.createEl("option", { text: "All Cycles", value: "0" });
        for (let i = 1; i <= numCycles; i++) cycleSelect.createEl("option", { text: `${i}`, value: i.toString() });
        cycleSelect.onchange = () => { selectedCycle = parseInt(cycleSelect.value); detectedPeaks = []; updateViewData(); };
    }

    const shiftLabel = toolsContainer.createSpan({ text: "Shift (V):" });
    shiftLabel.setCssStyles({ color: "var(--text-muted)", fontSize: "0.9em", marginLeft: "4px" });
    const shiftInput = toolsContainer.createEl("input", { type: "number", value: "0" });
    shiftInput.setCssStyles({ width: "60px", fontSize: "0.85em", padding: "2px 4px", background: "var(--background-primary)", border: "1px solid var(--background-modifier-border)", borderRadius: "4px" });
    shiftInput.step = "0.01";
    shiftInput.onchange = () => { fcShift = parseFloat(shiftInput.value) || 0; updateViewData(); };

    const findTruePeaks = () => {
        let startIdx = 0, endIdx = npoints;
        if (selectedCycle > 0 && selectedCycle <= numCycles) {
            startIdx = cycleBreaks[(selectedCycle - 1) * 2]; endIdx = cycleBreaks[(selectedCycle - 1) * 2 + 2] || npoints;
        }
        const segXs = rawXs.slice(startIdx, endIdx);
        const segYs = rawYs.slice(startIdx, endIdx);
        const len = segXs.length;

        if (len < 10) return null;

        const smoothYs = new Float64Array(len);
        for(let i=0; i<len; i++) {
            let sum = 0, count = 0;
            for(let j=Math.max(0, i-2); j<=Math.min(len-1, i+2); j++) { sum += segYs[j]; count++; }
            smoothYs[i] = sum / count;
        }

        let maxLocalI = -Infinity, minLocalI = Infinity;
        let epa = segXs[0], epc = segXs[0];
        
        const margin = Math.floor(len * 0.05); 

        for(let i = margin; i < len - margin; i++) {
            if (smoothYs[i] > smoothYs[i-1] && smoothYs[i] > smoothYs[i+1] && smoothYs[i] > maxLocalI) {
                maxLocalI = smoothYs[i]; epa = segXs[i];
            }
            if (smoothYs[i] < smoothYs[i-1] && smoothYs[i] < smoothYs[i+1] && smoothYs[i] < minLocalI) {
                minLocalI = smoothYs[i]; epc = segXs[i];
            }
        }

        if (maxLocalI === -Infinity) {
            for(let i=margin; i<len-margin; i++) { if(smoothYs[i] > maxLocalI) { maxLocalI = smoothYs[i]; epa = segXs[i]; } }
        }
        if (minLocalI === Infinity) {
            for(let i=margin; i<len-margin; i++) { if(smoothYs[i] < minLocalI) { minLocalI = smoothYs[i]; epc = segXs[i]; } }
        }

        return { epa, epc, maxI: maxLocalI, minI: minLocalI };
    };

    const peakBtn = toolsContainer.createEl("button", { text: "Find Peaks", title: "Auto-detect true E_pa and E_pc" });
    peakBtn.setCssStyles({ padding: "4px 8px", fontSize: "0.8em", borderRadius: "4px", background: "transparent", border: "1px solid var(--background-modifier-border)" });
    peakBtn.onclick = () => {
        const peaks = findTruePeaks();
        if (!peaks) { new Notice("Not enough data to find peaks."); return; }
        
        detectedPeaks = [ { x: peaks.epa - fcShift, y: peaks.maxI, type: 'Epa' }, { x: peaks.epc - fcShift, y: peaks.minI, type: 'Epc' } ];
        window.requestAnimationFrame(draw);
    };

    const calcBtn = toolsContainer.createEl("button", { text: "Auto Fc Calc", title: "Calculate true E1/2 and apply shift" });
    calcBtn.setCssStyles({ padding: "4px 8px", fontSize: "0.8em", borderRadius: "4px", background: "var(--interactive-accent)", color: "var(--text-on-accent)" });
    calcBtn.onclick = () => {
        const peaks = findTruePeaks();
        if (!peaks) { new Notice("Not enough data to calculate Fc shift."); return; }
        
        const eHalf = (peaks.epa + peaks.epc) / 2.0; 
        const deltaE = Math.abs(peaks.epa - peaks.epc) * 1000.0;
        
        fcShift = eHalf; 
        shiftInput.value = fcShift.toFixed(4);
        detectedPeaks = []; 
        updateViewData();
        new Notice(`Ferrocene Shift (E1/2): ${fcShift.toFixed(4)} V\nΔE: ${deltaE.toFixed(1)} mV`);
    };

    const resetBtn = toolsContainer.createEl("button", { text: "Reset View" });
    resetBtn.setCssStyles({ padding: "4px 8px", fontSize: "0.8em", borderRadius: "4px" });

    const canvasContainer = container.createDiv();
    canvasContainer.setCssStyles({ flexGrow: "1", position: "relative", cursor: "grab", minHeight: "300px", touchAction: "none" });
    const canvas = canvasContainer.createEl("canvas");
    canvas.setCssStyles({ width: "100%", height: "100%", display: "block" });

    const updateViewData = () => {
        let startIdx = 0; let endIdx = npoints;
        if (selectedCycle > 0 && selectedCycle <= numCycles) {
            const startSeg = (selectedCycle - 1) * 2; const endSeg = startSeg + 2;
            startIdx = cycleBreaks[startSeg]; endIdx = endSeg < cycleBreaks.length ? cycleBreaks[endSeg] : npoints;
        }

        const len = endIdx - startIdx;
        currentXs = new Float64Array(len); currentYs = new Float64Array(len);
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity; let maxAbsI = 0;

        for (let i = 0; i < len; i++) {
            const x = rawXs[startIdx + i] - fcShift; const y = rawYs[startIdx + i];
            currentXs[i] = x; currentYs[i] = y;
            if (Math.abs(y) > maxAbsI) maxAbsI = Math.abs(y);
        }

        if (maxAbsI < 0.002) { currentScale = 1e6; currentUnit = "µA"; } else { currentScale = 1e3; currentUnit = "mA"; }

        for (let i = 0; i < len; i++) {
            const sx = currentXs[i]; const sy = currentYs[i] * currentScale;
            if (sx > maxX) maxX = sx; if (sx < minX) minX = sx;
            if (sy > maxY) maxY = sy; if (sy < minY) minY = sy;
        }

        const xPad = (maxX - minX) * 0.05 || 0.1; const yPad = (maxY - minY) * 0.05 || 0.1;
        viewMinX = minX - xPad; viewMaxX = maxX + xPad; viewMinY = minY - yPad; viewMaxY = maxY + yPad;
        window.requestAnimationFrame(draw);
    };

    const draw = () => {
        const rect = canvasContainer.getBoundingClientRect(); if (rect.width === 0 || rect.height === 0) return; 
        canvas.width = rect.width * window.devicePixelRatio; canvas.height = rect.height * window.devicePixelRatio;
        const ctx = canvas.getContext("2d"); if (!ctx) return;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        
        const w = rect.width; const h = rect.height; 
        const padLeft = 65, padRight = 25, padBottom = 50, padTop = 20;
        const plotW = w - padLeft - padRight;
        const plotH = h - padTop - padBottom;

        ctx.clearRect(0, 0, w, h);

        const getX = (val: number) => padLeft + ((val - viewMinX) / (viewMaxX - viewMinX)) * plotW;
        const getY = (val: number) => h - padBottom - ((val - viewMinY) / (viewMaxY - viewMinY)) * plotH;

        ctx.beginPath(); ctx.strokeStyle = "var(--text-normal)"; ctx.lineWidth = 1.5;
        ctx.strokeRect(padLeft, padTop, plotW, plotH);

        if (0 >= viewMinX && 0 <= viewMaxX) {
            ctx.beginPath(); ctx.setLineDash([2, 4]); ctx.moveTo(getX(0), padTop); ctx.lineTo(getX(0), h - padBottom); ctx.stroke(); ctx.setLineDash([]);
        }
        if (0 >= viewMinY && 0 <= viewMaxY) {
            ctx.beginPath(); ctx.lineWidth = 0.8; ctx.moveTo(padLeft, getY(0)); ctx.lineTo(w - padRight, getY(0)); ctx.stroke();
        }

        ctx.beginPath(); ctx.strokeStyle = settings.lineColor; ctx.lineWidth = settings.lineWidth || 1.8; ctx.lineJoin = "round";
        let started = false;
        for (let i = 0; i < currentXs.length; i++) {
            const x = getX(currentXs[i]); const y = getY(currentYs[i] * currentScale);
            if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();

        detectedPeaks.forEach(p => {
            const px = getX(p.x); const py = getY(p.y * currentScale);
            ctx.fillStyle = settings.peakColor;
            ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = "var(--text-normal)"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
            ctx.fillText(`${p.type}: ${p.x.toFixed(3)} V`, px, p.type === 'Epa' ? py - 12 : py + 20);
        });
        
        ctx.fillStyle = "var(--text-normal)"; ctx.strokeStyle = "var(--text-normal)"; ctx.lineWidth = 1.2;
        ctx.font = "bold 12px serif";
        
        const numTicksX = 6; ctx.textAlign = "center"; ctx.textBaseline = "top";
        for (let i = 0; i <= numTicksX; i++) {
            const val = viewMinX + i * (viewMaxX - viewMinX) / numTicksX;
            const x = getX(val);
            ctx.beginPath(); ctx.moveTo(x, h - padBottom); ctx.lineTo(x, h - padBottom - 6); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x, padTop); ctx.lineTo(x, padTop + 6); ctx.stroke();
            ctx.fillText(val.toFixed(2), x, h - padBottom + 8);
        }

        const numTicksY = 5; ctx.textAlign = "right"; ctx.textBaseline = "middle";
        for (let i = 0; i <= numTicksY; i++) {
            const val = viewMinY + i * (viewMaxY - viewMinY) / numTicksY;
            const y = getY(val);
            ctx.beginPath(); ctx.moveTo(padLeft, y); ctx.lineTo(padLeft + 6, y); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(w - padRight, y); ctx.lineTo(w - padRight - 6, y); ctx.stroke();
            ctx.fillText(val.toFixed(1), padLeft - 8, y);
        }

        ctx.font = "bold 13px serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        ctx.fillText(`Potential (V)`, padLeft + plotW / 2, h - 5);
        ctx.save(); ctx.translate(15, padTop + plotH / 2); ctx.rotate(-Math.PI / 2);
        ctx.fillText(`Current (${currentUnit})`, 0, 0); ctx.restore();
    };

    resetBtn.onclick = () => { detectedPeaks = []; updateViewData(); };

    let isDragging = false; let dragStartX = 0; let dragStartY = 0; 
    canvasContainer.addEventListener("pointerdown", (e) => {
        canvasContainer.setPointerCapture(e.pointerId); isDragging = true; dragStartX = e.clientX; dragStartY = e.clientY;
        dStartMinX = viewMinX; dStartMaxX = viewMaxX; dStartMinY = viewMinY; dStartMaxY = viewMaxY;
        canvasContainer.setCssStyles({ cursor: "grabbing" });
    });
    canvasContainer.addEventListener("pointermove", (e) => {
        if (isDragging) {
            const dX = e.clientX - dragStartX; const dY = e.clientY - dragStartY; const rect = canvasContainer.getBoundingClientRect();
            const shiftX = (dX / rect.width) * (dStartMaxX - dStartMinX); const shiftY = (dY / rect.height) * (dStartMaxY - dStartMinY);
            viewMinX = dStartMinX - shiftX; viewMaxX = dStartMaxX - shiftX; viewMinY = dStartMinY + shiftY; viewMaxY = dStartMaxY + shiftY;
            window.requestAnimationFrame(draw);
        }
    });
    canvasContainer.addEventListener("pointerup", (e) => { canvasContainer.releasePointerCapture(e.pointerId); isDragging = false; canvasContainer.setCssStyles({ cursor: "grab" }); });
    canvasContainer.addEventListener("wheel", (e) => {
        e.preventDefault(); const zoomFactor = (e.deltaY < 0) ? 0.8 : 1.25;
        const rX = (viewMaxX - viewMinX) * zoomFactor; const rY = (viewMaxY - viewMinY) * zoomFactor;
        const cX = (viewMaxX + viewMinX) / 2; const cY = (viewMaxY + viewMinY) / 2;
        viewMinX = cX - rX/2; viewMaxX = cX + rX/2; viewMinY = cY - rY/2; viewMaxY = cY + rY/2;
        window.requestAnimationFrame(draw);
    });
    canvasContainer.addEventListener("dblclick", () => { detectedPeaks = []; updateViewData(); });

    updateViewData();
    const resizeObserver = new ResizeObserver(() => window.requestAnimationFrame(draw)); resizeObserver.observe(canvasContainer);
}

export function renderNMR(container: HTMLElement, specData: SpecData, savedState: SavedState | null, saveTarget: string, originalPath: string, settings: ChemSpecSettings, app: App, loadSpectrumData: (path: string) => Promise<SpectrumLoadResult>) {
    
    // State variable to track currently hovered atoms from 2D molecule / spectrum
    let hoveredAtoms = new Set<number>();

    const nucleus = specData.nucleus || "1H"; const solvent = specData.solvent || "Unknown";
    const sf = specData.sf || 400; const sw_p = specData.sw_p || 10;
    const rawPpms = specData.rawPpms || new Float64Array(); const intensities = specData.intensities || new Float64Array();
    const pointsToRead = specData.pointsToRead || 0; const maxInt = specData.maxInt || 1;
    
    let ppmShiftCorrection = savedState?.ppmShift || 0;
    let phase0 = savedState?.phase0 || 0, phase1 = savedState?.phase1 || 0, baselineFlattened = savedState?.baselineFlattened || false;
    
    let userMultiplets: UserMultiplet[] = savedState?.multiplets || [];
    let userIntegrals: UserIntegral[] = savedState?.integrals || [];
    let userPeaks: number[] = savedState?.peaks || [];
    const stateHistory: { multiplets: UserMultiplet[]; integrals: UserIntegral[]; peaks: number[] }[] = [];
    
    let showPeakLabels = true; 
    
    // 1. Declare stack variables and defaults FIRST
    const stackColors = ['#3b82f6', '#22c55e', '#a855f7', '#ec4899', '#06b6d4', '#f97316', '#eab308'];
    // If there is a reference spectrum, default to overlapping them 
	let stackMode: 'overlay' | 'stack' = specData.stacked ? 'overlay' : 'stack';
    let defaultMax = settings.defaultNmrRangeMax ?? 12.0; 
    let defaultMin = settings.defaultNmrRangeMin ?? -1.0;

    if (!savedState) {
        if (nucleus && nucleus.toUpperCase().includes('13C')) { defaultMax = 220; defaultMin = -10; }
        else if (nucleus && nucleus.toUpperCase().includes('19F')) { defaultMax = 100; defaultMin = -250; }
        else if (nucleus && nucleus.toUpperCase().includes('31P')) { defaultMax = 100; defaultMin = -100; }
    }

    // 2. NOW handle the stack and bounding box calculation
    const stackedSpectra: SpecData[] = specData.stacked ? [...specData.stacked] : [];
    
    let calcMax = specData.offset ?? defaultMax;
    let calcMin = calcMax - (specData.sw_p ?? (defaultMax - defaultMin));
    
    stackedSpectra.forEach(s => {
        if (s.offset !== undefined && s.sw_p !== undefined) {
            calcMax = Math.max(calcMax, s.offset);
            calcMin = Math.min(calcMin, s.offset - s.sw_p);
        }
    });

    let viewOffsetPpm = savedState?.viewOffsetPpm ?? calcMax; 
    let viewWidthPpm = savedState?.viewWidthPpm ?? (calcMax - calcMin);
    let yScale = savedState?.yScale ?? 1.0; 
    let baselineOffset = savedState?.baselineOffset ?? 0;

    const getProcessedIntensities = () => {
        const processed = new Float64Array(pointsToRead); const p0Rad = (phase0 * Math.PI) / 180;
        for (let i = 0; i < pointsToRead; i++) {
            let val = intensities[i]; if (baselineFlattened) val -= (maxInt * 0.002); 
            processed[i] = val * Math.cos(p0Rad + ((i / pointsToRead) * phase1 * Math.PI) / 180);
        }
        return processed;
    };

    const getCorrectedPpms = () => {
        const corrected = new Float64Array(pointsToRead);
        for (let i = 0; i < pointsToRead; i++) corrected[i] = rawPpms[i] + ppmShiftCorrection;
        return corrected;
    };
    
    const saveStateToHistory = () => {
        const snapshotData = JSON.stringify({ multiplets: userMultiplets, integrals: userIntegrals, peaks: userPeaks });
        const parsed = JSON.parse(snapshotData) as { multiplets: UserMultiplet[]; integrals: UserIntegral[]; peaks: number[] };
        stateHistory.push(parsed);
    };

    let activeMode = 'Pan', isDragging = false, isBoxDragging = false;
    let dragStartX = 0, dragStartY = 0, dragStartOffset = 0, dragStartBaseline = 0;
    let boxStartX = -1, boxEndX = -1, boxEndY = -1;

    const header = container.createDiv();
    const titleSpan = header.createSpan();
    header.setCssStyles({ padding: "8px 10px", background: "var(--background-secondary)", borderBottom: "1px solid var(--background-modifier-border)", fontSize: "0.85em", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" });
    
    titleSpan.empty();
    titleSpan.createSpan({ text: `${nucleus} NMR` }).setCssStyles({ fontWeight: "600", color: "var(--text-accent)" });
    titleSpan.createSpan({ text: " | " }).setCssStyles({ color: "var(--text-muted)" });
    titleSpan.createSpan({ text: `${solvent} (${sf.toFixed(1)} MHz)` });
    
    const toolsContainer = header.createDiv(); toolsContainer.setCssStyles({ display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap", flexGrow: "1", justifyContent: "flex-end" });

    // --- SPLIT LAYOUT WRAPPER ---
    const layoutWrapper = container.createDiv();
    layoutWrapper.setCssStyles({ display: "flex", width: "100%", flexGrow: "1", overflow: "hidden", position: "relative" });

    let molCanvas: HTMLCanvasElement | null = null;
    let activeMol: OCL.Molecule | null = null;
    let molAtomCoords: {x: number, y: number, r: number, atom: number}[] = [];

    // Initialize 2D Molecule Viewer if SMILES data exists
    if (specData.smiles && specData.predictedPeaks) {
        const molContainer = layoutWrapper.createDiv();
        molContainer.setCssStyles({ 
            width: "30%", minWidth: "220px", borderRight: "1px solid var(--background-modifier-border)",
            background: "var(--background-primary)", display: "flex", alignItems: "center", justifyContent: "center"
        });
        
        molCanvas = molContainer.createEl("canvas");
        molCanvas.setCssStyles({ width: "100%", height: "100%", cursor: "crosshair" });
        
        activeMol = OCL.Molecule.fromSmiles(specData.smiles);
        activeMol.inventCoordinates();

        // Molecule Canvas Hover Detection
        molCanvas.addEventListener("pointermove", (e) => {
            const rect = molCanvas!.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            let foundAtom = -1;
            for (const ac of molAtomCoords) {
                const dist = Math.sqrt((ac.x - mouseX) ** 2 + (ac.y - mouseY) ** 2);
                if (dist <= ac.r + 5) { 
                    foundAtom = ac.atom;
                    break;
                }
            }

            if (foundAtom !== -1) {
                const peak = specData.predictedPeaks!.find(p => p.atoms.includes(foundAtom));
                if (peak) hoveredAtoms = new Set(peak.atoms);
                else hoveredAtoms = new Set([foundAtom]);
            } else {
                hoveredAtoms.clear();
            }
            
            drawMolecule();
            window.requestAnimationFrame(draw);
        });
        
        molCanvas.addEventListener("mouseleave", () => {
            hoveredAtoms.clear();
            drawMolecule();
            window.requestAnimationFrame(draw);
        });
    }

    const canvasContainer = layoutWrapper.createDiv();
    canvasContainer.setCssStyles({ flexGrow: "1", position: "relative", outline: "none", cursor: "grab", touchAction: "none" });
    canvasContainer.tabIndex = 0; 
    const canvas = canvasContainer.createEl("canvas"); canvas.setCssStyles({ width: "100%", height: "100%", display: "block" });

    const getCursorSvg = (letter: string, color: string) => {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 2v20M2 12h20" stroke="rgba(150,150,150,0.6)" stroke-width="1.5"/><text x="14" y="22" font-family="sans-serif" font-weight="bold" font-size="14" fill="${color}">${letter}</text></svg>`;
        return `url('data:image/svg+xml,${encodeURIComponent(svg)}') 12 12, crosshair`;
    };

    const updateCursor = () => {
        if (activeMode === 'Pan') canvasContainer.setCssStyles({ cursor: 'grab' });
        else if (activeMode === 'Zoom') canvasContainer.setCssStyles({ cursor: 'zoom-in' });
        else if (activeMode === 'Integrate') canvasContainer.setCssStyles({ cursor: getCursorSvg('∫', settings.integralColor) });
        else if (activeMode === 'Multiplet') canvasContainer.setCssStyles({ cursor: getCursorSvg('m', settings.multipletColor) });
        else if (activeMode === 'Peak') canvasContainer.setCssStyles({ cursor: getCursorSvg('p', settings.peakColor) });
    };

    const modes = ['Pan', 'Zoom', 'Integrate', 'Multiplet', 'Peak'];
    const modeBtns: Record<string, HTMLElement> = {};

    modes.forEach(m => {
        const btn = toolsContainer.createEl("button", { text: m });
        btn.setCssStyles({ padding: "4px 8px", fontSize: "0.8em", borderRadius: "4px", boxShadow: "none", height: "auto", lineHeight: "1.2" });
        btn.onclick = () => {
            activeMode = m; Object.values(modeBtns).forEach(b => { b.setCssStyles({ background: "transparent", color: "var(--text-normal)" }); });
            btn.setCssStyles({ background: "var(--interactive-accent)", color: "var(--text-on-accent)" }); updateCursor();
        };
        modeBtns[m] = btn;
    });
    modeBtns['Pan'].click();

    const zoomManualBtn = toolsContainer.createEl("button", { text: "🔍 Range", title: "Manual Zoom" });
    zoomManualBtn.setCssStyles({ padding: "4px 8px", fontSize: "0.8em", borderRadius: "4px", boxShadow: "none", height: "auto", lineHeight: "1.2" });
    zoomManualBtn.onclick = () => {
        const existingDialog = canvasContainer.querySelector('.chemspec-zoom-dialog');
        if (existingDialog) { existingDialog.remove(); return; }

        const dialog = canvasContainer.createDiv({ cls: 'chemspec-zoom-dialog' });
        dialog.setCssStyles({
            position: "absolute", top: "10px", left: "10px", background: "var(--background-primary)",
            border: "1px solid var(--background-modifier-border)", padding: "12px", borderRadius: "8px", zIndex: "100",
            boxShadow: "0 4px 10px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", gap: "10px"
        });
        
        const currentFrom = viewOffsetPpm.toFixed(4); const currentTo = (viewOffsetPpm - viewWidthPpm).toFixed(4);
        
        const titleDiv = dialog.createDiv();
        titleDiv.setCssStyles({ fontWeight: "600", fontSize: "0.9em", borderBottom: "1px solid var(--background-modifier-border)", paddingBottom: "4px" });
        titleDiv.setText("Manual Zoom");

        const fromRow = dialog.createDiv();
        fromRow.setCssStyles({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", fontSize: "0.85em", marginTop: "5px" });
        fromRow.createEl("label", { text: "From (ppm):" });
        const fromInput = fromRow.createEl("input", { type: "number", value: currentFrom });
        fromInput.setCssStyles({ width: "80px", padding: "2px 4px" });

        const toRow = dialog.createDiv();
        toRow.setCssStyles({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", fontSize: "0.85em" });
        toRow.createEl("label", { text: "To (ppm):" });
        const toInput = toRow.createEl("input", { type: "number", value: currentTo });
        toInput.setCssStyles({ width: "80px", padding: "2px 4px" });

        const btnRow = dialog.createDiv();
        btnRow.setCssStyles({ display: "flex", justifyContent: "flex-end", gap: "6px", marginTop: "4px" });
        
        const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
        cancelBtn.setCssStyles({ padding: "4px 8px", fontSize: "0.85em" });

        const okBtn = btnRow.createEl("button", { text: "OK" });
        okBtn.setCssStyles({ padding: "4px 8px", fontSize: "0.85em", background: "var(--interactive-accent)", color: "var(--text-on-accent)" });

        dialog.addEventListener('pointerdown', (e) => e.stopPropagation()); 
        dialog.addEventListener('wheel', (e) => e.stopPropagation()); 
        dialog.addEventListener('dblclick', (e) => e.stopPropagation());
        
        cancelBtn.addEventListener('click', () => dialog.remove());
        okBtn.addEventListener('click', () => {
            const from = parseFloat(fromInput.value);
            const to = parseFloat(toInput.value);
            if (!isNaN(from) && !isNaN(to)) { viewOffsetPpm = Math.max(from, to); viewWidthPpm = Math.abs(from - to); window.requestAnimationFrame(draw); }
            dialog.remove();
        });
        
        fromInput.focus(); fromInput.select();
    };

    if (saveTarget) {
        const saveNativeBtn = toolsContainer.createEl("button", { text: "Save", cls: "mod-cta" });
        saveNativeBtn.setCssStyles({ padding: "4px 8px", fontSize: "0.8em", borderRadius: "4px", boxShadow: "none", height: "auto", lineHeight: "1.2" });
        saveNativeBtn.onclick = () => {
            void (async () => {
                const stateData: SavedState = { ppmShift: ppmShiftCorrection, multiplets: userMultiplets, integrals: userIntegrals, peaks: userPeaks, viewOffsetPpm, viewWidthPpm, yScale, baselineOffset, phase0, phase1, baselineFlattened };
                const exportData = { nucleus, solvent, sf, sw_p, offset: rawPpms[0], maxInt, rawPpms: Array.from(rawPpms), intensities: Array.from(intensities), ...stateData };
                await app.vault.adapter.write(saveTarget, JSON.stringify(exportData, null, 2));
                new Notice(`Saved state to ${saveTarget}`);
            })();
        };
    }

    const triggerDownload = (filename: string, content: string, type: string) => {
        const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
        const a = document.body.createEl("a"); a.href = url; a.download = filename; a.click(); a.remove(); URL.revokeObjectURL(url);
    };

    const moreBtn = toolsContainer.createEl("button", { text: "More ▾" });
    moreBtn.setCssStyles({ padding: "4px 8px", fontSize: "0.8em", borderRadius: "4px", boxShadow: "none", height: "auto", lineHeight: "1.2" });
    moreBtn.onclick = (e) => {
        const menu = new Menu();
        
        if (stackedSpectra.length > 0) {
            menu.addItem((item: MenuItem) => item.setTitle(stackMode === 'stack' ? "Switch to Overlay Mode" : "Switch to Stack Mode").setIcon("layers").onClick(() => { stackMode = stackMode === 'stack' ? 'overlay' : 'stack'; window.requestAnimationFrame(draw); }));
            menu.addItem((item: MenuItem) => item.setTitle("Clear Stacked Spectra").setIcon("trash").onClick(() => { stackedSpectra.length = 0; window.requestAnimationFrame(draw); }));
            menu.addSeparator();
        }

        menu.addItem((item: MenuItem) => item.setTitle("Copy Draft Text").setIcon("documents").onClick(() => {
            if (userMultiplets.length === 0) { new Notice("Select multiplets first to copy draft text."); return; }
            const dataParts = userMultiplets.sort((a,b) => b.centerPpm - a.centerPpm).map(m => {
                const shift = m.centerPpm.toFixed(2); const jStr = m.jCouplings.length > 0 ? `, J = ${m.jCouplings.map((j: number) => j.toFixed(1)).join(', ')} Hz` : '';
                return `${shift} (${m.multiplicity}${jStr}, ${Math.round(m.normalizedIntegral)}H)`;
            });
            void navigator.clipboard.writeText(`${nucleus} NMR (${sf.toFixed(0)} MHz, ${solvent}) δ ${dataParts.join(", ")};`);
            new Notice("Draft text copied to clipboard!");
        }));

        if (originalPath) {
            menu.addItem((item: MenuItem) => item.setTitle("Copy Embed Block").setIcon("code").onClick(() => { void navigator.clipboard.writeText(`\`\`\`nmr\n${originalPath}\n\`\`\``); new Notice("Embed block copied to clipboard!"); }));
        }

        menu.addSeparator();
        menu.addItem((item: MenuItem) => item.setTitle(showPeakLabels ? "Hide Peak Labels" : "Show Peak Labels").setIcon("eye").onClick(() => { showPeakLabels = !showPeakLabels; window.requestAnimationFrame(draw); }));
        menu.addItem((item: MenuItem) => item.setTitle("Clear Peaks").setIcon("trash").onClick(() => { saveStateToHistory(); userPeaks = []; window.requestAnimationFrame(draw); }));
        menu.addItem((item: MenuItem) => item.setTitle("Clear Integrals").setIcon("trash").onClick(() => { saveStateToHistory(); userIntegrals = []; window.requestAnimationFrame(draw); }));
        menu.addItem((item: MenuItem) => item.setTitle("Clear Multiplets").setIcon("trash").onClick(() => { saveStateToHistory(); userMultiplets = []; window.requestAnimationFrame(draw); }));
        menu.addItem((item: MenuItem) => item.setTitle("Clear All").setIcon("trash").onClick(() => { saveStateToHistory(); userMultiplets = []; userIntegrals = []; userPeaks = []; window.requestAnimationFrame(draw); }));
        menu.addSeparator();

        menu.addItem((item: MenuItem) => item.setTitle("Calibrate Solvent").setIcon("target").onClick(() => {
            const solventKey = Object.keys(SOLVENT_PEAKS).find(s => solvent.toLowerCase().includes(s.toLowerCase()));
            if (!solventKey) { new Notice(`No reference for ${solvent}`); return; }
            const targetPpm = SOLVENT_PEAKS[solventKey]; if (targetPpm === undefined) return;
            
            const currentPpms = getCorrectedPpms(); const procInt = getProcessedIntensities();
            const threshold = maxInt * 0.02; const currentPeaks = [];
            for(let i = 2; i < pointsToRead - 2; i++) { if (procInt[i] > threshold && procInt[i] > procInt[i-1] && procInt[i] > procInt[i+1]) currentPeaks.push(currentPpms[i]); }
            if (currentPeaks.length === 0) { new Notice("No peaks found to calibrate."); return; }
            
            let closest = currentPeaks[0]; let minDist = Math.abs(closest - targetPpm);
            for (const p of currentPeaks) { if (Math.abs(p - targetPpm) < minDist) { minDist = Math.abs(p - targetPpm); closest = p; } }
            ppmShiftCorrection += (targetPpm - closest); viewOffsetPpm += (targetPpm - closest); userMultiplets = []; userIntegrals = []; userPeaks = []; window.requestAnimationFrame(draw);
            new Notice(`Calibrated ${solvent} to ${targetPpm} ppm`);
        }));

        menu.addItem((item: MenuItem) => item.setTitle(baselineFlattened ? "Reset Baseline" : "Flatten Baseline").setIcon("activity").onClick(() => { baselineFlattened = !baselineFlattened; window.requestAnimationFrame(draw); new Notice(baselineFlattened ? "Baseline flattened" : "Baseline reset"); }));
        menu.addItem((item: MenuItem) => item.setTitle("Phase +15°").setIcon("rotate-cw").onClick(() => { phase0 = (phase0 + 15) % 360; window.requestAnimationFrame(draw); }));
        menu.addItem((item: MenuItem) => item.setTitle("Phase -15°").setIcon("rotate-ccw").onClick(() => { phase0 = (phase0 - 15) % 360; window.requestAnimationFrame(draw); }));
        menu.addSeparator();

        menu.addItem((item: MenuItem) => item.setTitle("Export as SVG").setIcon("image").onClick(() => {
            const w = 1200; const h = 600; const axisY = h - 40; const spectrumBaseY = axisY + baselineOffset;
            const currentPpms = getCorrectedPpms(); const procInt = getProcessedIntensities(); const maxDrawHeight = (h * 0.82);
            let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="none" /><line x1="0" y1="${axisY}" x2="${w}" y2="${axisY}" stroke="black" stroke-width="1.5" />`;
            
            const ticks = Math.max(2, settings.numTicks);
            for (let i = 0; i < ticks; i++) {
                const fraction = i / (ticks - 1); const xPos = fraction * w; const currentPpm = viewOffsetPpm - (fraction * viewWidthPpm);
                svg += `<line x1="${xPos}" y1="${axisY}" x2="${xPos}" y2="${axisY+8}" stroke="black" stroke-width="1" />`;
                svg += `<text x="${xPos}" y="${axisY+25}" font-family="sans-serif" font-size="14" text-anchor="middle" fill="black">${currentPpm.toFixed(settings.ppmDecimals)}</text>`;
            }

            let d = ""; let started = false; const step = Math.max(1, Math.floor(pointsToRead / (w * 2)));
            for (let i = 0; i < pointsToRead; i += step) {
                const x = ((viewOffsetPpm - currentPpms[i]) / viewWidthPpm) * w; const y = spectrumBaseY - ((procInt[i] / maxInt) * maxDrawHeight * yScale);
                if (x < -20 || x > w + 20) continue; if (!started) { d += `M ${x} ${y} `; started = true; } else d += `L ${x} ${y} `;
            }
            svg += `<path d="${d}" stroke="${settings.lineColor}" stroke-width="${settings.lineWidth}" fill="none" stroke-linejoin="round" />`;

            const sortedPeaks = [...userPeaks].sort((a, b) => b - a);
            let svgLastLabelX = -999;
            const svgMinLabelSpacing = 14;

            sortedPeaks.forEach(ppm => {
                if (ppm < viewOffsetPpm - viewWidthPpm || ppm > viewOffsetPpm) return;
                const cX = ((viewOffsetPpm - ppm) / viewWidthPpm) * w;
                let pInt = 0; let bDiff = Infinity;
                for(let i=0; i<pointsToRead; i++) { const dist = Math.abs(currentPpms[i] - ppm); if(dist < bDiff) { bDiff = dist; pInt = procInt[i]; } }

                const peakY = spectrumBaseY - (pInt / maxInt) * maxDrawHeight * yScale;
                
                if (showPeakLabels && (cX - svgLastLabelX > svgMinLabelSpacing)) {
                    svg += `<line x1="${cX}" y1="${peakY}" x2="${cX}" y2="${peakY - 6}" stroke="${settings.peakColor}" stroke-width="1" />`;
                    svg += `<text x="${cX}" y="${peakY - 10}" font-family="sans-serif" font-size="11" text-anchor="start" alignment-baseline="middle" fill="${settings.peakColor}" transform="rotate(-90 ${cX} ${peakY - 10})">${ppm.toFixed(3)}</text>`;
                    svgLastLabelX = cX;
                } else {
                    svg += `<line x1="${cX}" y1="${peakY}" x2="${cX}" y2="${peakY - 6}" stroke="${settings.peakColor}" stroke-width="1" />`;
                }
            });

            userIntegrals.forEach(intg => {
                if (Math.max(intg.startPpm, intg.endPpm) < viewOffsetPpm - viewWidthPpm || Math.min(intg.startPpm, intg.endPpm) > viewOffsetPpm) return;
                let runningSum = 0; let intD = ""; let intStarted = false;
                for (let i = intg.lIdx; i <= intg.rIdx; i+=step) {
                    runningSum += procInt[i]; const x = ((viewOffsetPpm - currentPpms[i]) / viewWidthPpm) * w;
                    const y = spectrumBaseY - Math.abs((runningSum / intg.sum) * 50);
                    if (!intStarted) { intD += `M ${x} ${y} `; intStarted = true; } else intD += `L ${x} ${y} `;
                }
                svg += `<path d="${intD}" stroke="${settings.integralColor}" stroke-width="1.5" fill="none" />`;
                const cX = ((viewOffsetPpm - ((intg.startPpm + intg.endPpm)/2)) / viewWidthPpm) * w;
                svg += `<text x="${cX}" y="${axisY - 8}" font-family="sans-serif" font-size="11" text-anchor="middle" fill="${settings.integralColor}">${intg.norm.toFixed(2)}</text>`;
            });

            userMultiplets.forEach(m => {
                if (Math.max(m.startPpm, m.endPpm) < viewOffsetPpm - viewWidthPpm || Math.min(m.startPpm, m.endPpm) > viewOffsetPpm) return;
                const cX = ((viewOffsetPpm - m.centerPpm) / viewWidthPpm) * w;
                const localMax = m.peaks.length > 0 ? Math.max(...m.peaks.map((p: {intensity: number})=>p.intensity)) : maxInt*0.1;
                const bracketY = spectrumBaseY - ((localMax / maxInt) * maxDrawHeight * yScale) - 15;
                const wX = Math.abs(m.startPpm - m.endPpm) / viewWidthPpm * w / 2;

                svg += `<polyline points="${cX - wX},${bracketY + 4} ${cX - wX},${bracketY} ${cX + wX},${bracketY} ${cX + wX},${bracketY + 4}" stroke="${settings.multipletColor}" stroke-width="1.5" fill="none" />`;
                const jStr = m.jCouplings.length > 0 ? `, ${m.jCouplings[0].toFixed(1)}` : '';
                svg += `<text x="${cX}" y="${bracketY - 6}" font-family="sans-serif" font-size="11" text-anchor="middle" fill="${settings.multipletColor}">${m.multiplicity}${jStr}</text>`;
                
                let rSum = 0; let mD = ""; let mStarted = false;
                for (let i = m.lIndex; i <= m.rIndex; i+=step) {
                    rSum += procInt[i]; const x = ((viewOffsetPpm - currentPpms[i]) / viewWidthPpm) * w;
                    const y = spectrumBaseY - Math.abs((rSum / m.integral) * 50);
                    if (!mStarted) { mD += `M ${x} ${y} `; mStarted = true; } else mD += `L ${x} ${y} `;
                }
                svg += `<path d="${mD}" stroke="${settings.integralColor}" stroke-width="1.5" fill="none" />`;
                svg += `<text x="${cX}" y="${axisY - 8}" font-family="sans-serif" font-size="11" text-anchor="middle" fill="${settings.integralColor}">${m.normalizedIntegral.toFixed(2)}</text>`;
            });

            svg += `</svg>`;
            triggerDownload('spectrum_publication.svg', svg, 'image/svg+xml');
        }));

        menu.showAtMouseEvent(e);
    };

    // --- MOLECULE RENDERER LOGIC ---
    const drawMolecule = () => {
        if (!molCanvas || !activeMol) return;
        const rect = molCanvas.parentElement!.getBoundingClientRect();
        if (rect.width === 0) return;
        
        const dpr = window.devicePixelRatio || 1;
        molCanvas.width = rect.width * dpr;
        molCanvas.height = rect.height * dpr;
        const ctx = molCanvas.getContext("2d")!;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, rect.width, rect.height);

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < activeMol.getAllAtoms(); i++) {
            const x = activeMol.getAtomX(i); const y = activeMol.getAtomY(i);
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }

        const padding = 30;
        const scaleX = (rect.width - padding * 2) / Math.max(0.1, (maxX - minX));
        const scaleY = (rect.height - padding * 2) / Math.max(0.1, (maxY - minY));
        const scale = Math.min(scaleX, scaleY, 40); 
        
        const cx = (maxX + minX) / 2; const cy = (maxY + minY) / 2;
        const toX = (x: number) => rect.width / 2 + (x - cx) * scale;
        const toY = (y: number) => rect.height / 2 + (y - cy) * scale;

        molAtomCoords = []; 

        hoveredAtoms.forEach(atomIdx => {
            if (atomIdx >= activeMol!.getAllAtoms()) return;
            const hx = toX(activeMol!.getAtomX(atomIdx));
            const hy = toY(activeMol!.getAtomY(atomIdx));
            ctx.beginPath();
            ctx.arc(hx, hy, 18, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(59, 130, 246, 0.25)"; 
            ctx.fill();
        });

        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "var(--text-normal)";
        ctx.lineCap = "round";

        for (let i = 0; i < activeMol.getAllBonds(); i++) {
            const a1 = activeMol.getBondAtom(0, i);
            const a2 = activeMol.getBondAtom(1, i);
            const x1 = toX(activeMol.getAtomX(a1)); const y1 = toY(activeMol.getAtomY(a1));
            const x2 = toX(activeMol.getAtomX(a2)); const y2 = toY(activeMol.getAtomY(a2));
            const order = activeMol.getBondOrder(i);

            if (order === 1) {
                ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
            } else if (order === 2) {
                const dx = x2 - x1, dy = y2 - y1;
                const len = Math.sqrt(dx*dx + dy*dy);
                const nx = (dy / len) * 3; const ny = (-dx / len) * 3;
                
                ctx.beginPath(); 
                ctx.moveTo(x1 + nx, y1 + ny); ctx.lineTo(x2 + nx, y2 + ny);
                ctx.moveTo(x1 - nx, y1 - ny); ctx.lineTo(x2 - nx, y2 - ny);
                ctx.stroke();
            }
        }

        ctx.font = "bold 14px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        for (let i = 0; i < activeMol.getAllAtoms(); i++) {
            const atomicNo = activeMol.getAtomicNo(i);
            const x = toX(activeMol.getAtomX(i));
            const y = toY(activeMol.getAtomY(i));
            
            if (atomicNo !== 6) {
                const symbol = OCL.Molecule.cAtomLabel[atomicNo];
                ctx.fillStyle = "var(--background-primary)";
                ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill(); 
                
                ctx.fillStyle = atomicNo === 8 ? "#ef4444" : (atomicNo === 7 ? "#3b82f6" : "var(--text-normal)");
                ctx.fillText(symbol, x, y + 1);
            }
            molAtomCoords.push({ x, y, r: 15, atom: i });
        }
    };

    // --- NMR RENDERER LOGIC ---
    const draw = () => {
        const rect = canvasContainer.getBoundingClientRect(); if (rect.width === 0 || rect.height === 0) return; 
        canvas.width = rect.width * window.devicePixelRatio; canvas.height = rect.height * window.devicePixelRatio;
        const ctx = canvas.getContext("2d"); if (!ctx) return;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        const w = rect.width; const h = rect.height; ctx.clearRect(0, 0, w, h);

        const axisY = h - 25; const spectrumBaseY = axisY + baselineOffset; 
        const currentPpms = getCorrectedPpms(); const procInt = getProcessedIntensities(); const maxDrawHeight = (h * 0.82); 

        ctx.beginPath(); ctx.moveTo(0, axisY); ctx.lineTo(w, axisY);
        ctx.strokeStyle = "var(--background-modifier-border)"; ctx.lineWidth = 1.5; ctx.stroke();

        // Highlight Predicted Region if hovering molecule
        if (specData.predictedPeaks && hoveredAtoms.size > 0) {
            const matchingPeaks = specData.predictedPeaks.filter(p => p.atoms.some(a => hoveredAtoms.has(a)));
            ctx.fillStyle = "rgba(59, 130, 246, 0.15)";
            matchingPeaks.forEach(peak => {
                const cX = ((viewOffsetPpm - peak.shift) / viewWidthPpm) * w;
                ctx.fillRect(cX - 15, 0, 30, h);
            });
        }

        const allSpecs = [specData, ...stackedSpectra];
        
        for (let idx = allSpecs.length - 1; idx >= 0; idx--) {
            const spec = allSpecs[idx];
            const isHighlighted = idx === 0 && hoveredAtoms.size > 0;
            const color = idx === 0 ? (isHighlighted ? "#2563eb" : settings.lineColor) : stackColors[(idx - 1) % stackColors.length];
            
            let specPpms = idx === 0 ? currentPpms : (spec.rawPpms || new Float64Array());
            let specInts = idx === 0 ? procInt : (spec.intensities || new Float64Array());
            let specMaxInt = idx === 0 ? maxInt : (spec.maxInt || 1);
            
            const specPoints = spec.pointsToRead || 0;
            const drawHeightFactor = (stackMode === 'stack' && allSpecs.length > 1) ? 0.7 : 1.0;
            const stackOffsetY = (stackMode === 'stack') ? (idx * maxDrawHeight * 0.2 * yScale) : 0;
            
            ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = isHighlighted ? settings.lineWidth + 0.5 : settings.lineWidth; ctx.lineJoin = "round";
            const step = Math.max(1, Math.floor(specPoints / (w * 4))); let started = false;
            
            for (let i = 0; i < specPoints; i += step) {
                const x = ((viewOffsetPpm - specPpms[i]) / viewWidthPpm) * w;
                const normalizedY = (specInts[i] / specMaxInt) * (maxDrawHeight * drawHeightFactor) * yScale;
                const y = spectrumBaseY - normalizedY - stackOffsetY;
                if (x < -20 || x > w + 20) continue;
                if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // Draw User Peaks
        ctx.save(); ctx.strokeStyle = settings.peakColor; ctx.fillStyle = settings.peakColor; ctx.lineWidth = 1.0; ctx.font = "11px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        const sortedPeaks = [...userPeaks].sort((a, b) => b - a);
        let lastLabelX = -999;
        const minLabelSpacing = 14; 

        sortedPeaks.forEach(ppm => {
            if (ppm < viewOffsetPpm - viewWidthPpm || ppm > viewOffsetPpm) return;
            const cX = ((viewOffsetPpm - ppm) / viewWidthPpm) * w;
            
            let pInt = 0; let bDiff = Infinity;
            for(let i=0; i<pointsToRead; i++) {
                const d = Math.abs(currentPpms[i] - ppm);
                if(d < bDiff) { bDiff = d; pInt = procInt[i]; }
            }

            const drawHeightFactor = (stackMode === 'stack' && allSpecs.length > 1) ? 0.7 : 1.0;
            const peakY = spectrumBaseY - (pInt / maxInt) * (maxDrawHeight * drawHeightFactor) * yScale;

            if (showPeakLabels && (cX - lastLabelX > minLabelSpacing)) {
                ctx.beginPath(); ctx.moveTo(cX, peakY); ctx.lineTo(cX, peakY - 6); ctx.stroke();
                
                ctx.save();
                ctx.translate(cX, peakY - 10);
                ctx.rotate(-Math.PI / 2);
                ctx.fillText(ppm.toFixed(3), 0, 0);
                ctx.restore();
                
                lastLabelX = cX;
            } else {
                ctx.beginPath(); ctx.moveTo(cX, peakY); ctx.lineTo(cX, peakY - 6); ctx.stroke();
            }
        });
        ctx.restore();

        // Draw User Integrals
        const intColor = settings.integralColor; const multColor = settings.multipletColor;
        ctx.strokeStyle = intColor; ctx.fillStyle = intColor; ctx.lineWidth = 1.5; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
        
        const step = Math.max(1, Math.floor(pointsToRead / (w * 4)));
        userIntegrals.forEach(intg => {
            if (Math.max(intg.startPpm, intg.endPpm) < viewOffsetPpm - viewWidthPpm || Math.min(intg.startPpm, intg.endPpm) > viewOffsetPpm) return;
            let runningSum = 0; ctx.beginPath(); let intStarted = false;
            for (let i = intg.lIdx; i <= intg.rIdx; i+=step) {
                runningSum += procInt[i]; const x = ((viewOffsetPpm - currentPpms[i]) / viewWidthPpm) * w;
                const y = spectrumBaseY - Math.abs((runningSum / intg.sum) * 50);
                if (!intStarted) { ctx.moveTo(x, y); intStarted = true; } else ctx.lineTo(x, y);
            }
            ctx.stroke(); const cX = ((viewOffsetPpm - ((intg.startPpm + intg.endPpm)/2)) / viewWidthPpm) * w; ctx.fillText(intg.norm.toFixed(2), cX, axisY - 8);
        });

        // Draw User Multiplets
        ctx.strokeStyle = multColor; ctx.fillStyle = multColor;
        userMultiplets.forEach(m => {
            if (Math.max(m.startPpm, m.endPpm) < viewOffsetPpm - viewWidthPpm || Math.min(m.startPpm, m.endPpm) > viewOffsetPpm) return;
            const cX = ((viewOffsetPpm - m.centerPpm) / viewWidthPpm) * w; const localMax = m.peaks.length > 0 ? Math.max(...m.peaks.map((p: {intensity: number})=>p.intensity)) : maxInt*0.1;
            const drawHeightFactor = (stackMode === 'stack' && allSpecs.length > 1) ? 0.7 : 1.0;
            const bracketY = spectrumBaseY - ((localMax / maxInt) * (maxDrawHeight * drawHeightFactor) * yScale) - 15;
            const wX = Math.abs(m.startPpm - m.endPpm) / viewWidthPpm * w / 2;

            ctx.beginPath(); ctx.moveTo(cX - wX, bracketY + 4); ctx.lineTo(cX - wX, bracketY); ctx.lineTo(cX + wX, bracketY); ctx.lineTo(cX + wX, bracketY + 4); ctx.stroke();
            const jStr = m.jCouplings.length > 0 ? `, ${m.jCouplings[0].toFixed(1)}` : ''; ctx.fillText(`${m.multiplicity}${jStr}`, cX, bracketY - 6);
            
            ctx.beginPath(); let rSum = 0, iStarted = false;
            for (let i = m.lIndex; i <= m.rIndex; i+=step) {
                rSum += procInt[i]; const x = ((viewOffsetPpm - currentPpms[i]) / viewWidthPpm) * w;
                const y = spectrumBaseY - Math.abs((rSum / m.integral) * 50);
                if (!iStarted) { ctx.moveTo(x, y); iStarted = true; } else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = intColor; ctx.stroke(); ctx.fillStyle = intColor; ctx.fillText(m.normalizedIntegral.toFixed(2), cX, axisY - 8);
        });

        if (isBoxDragging && boxStartX !== -1 && boxEndX !== -1) {
            ctx.fillStyle = activeMode === 'Peak' ? 'rgba(234, 179, 8, 0.15)' : 'rgba(59, 130, 246, 0.2)';
            const startX = Math.min(boxStartX, boxEndX); const bWidth = Math.abs(boxStartX - boxEndX);
            if (activeMode === 'Peak' && boxEndY !== -1) {
                ctx.fillRect(startX, 0, bWidth, boxEndY); ctx.beginPath(); ctx.moveTo(startX, boxEndY); ctx.lineTo(startX + bWidth, boxEndY); ctx.strokeStyle = settings.peakColor; ctx.lineWidth = 1; ctx.stroke();
            } else { ctx.fillRect(startX, 0, bWidth, h); ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)'; ctx.strokeRect(startX, 0, bWidth, h); }
        }

        ctx.fillStyle = "var(--text-normal)"; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
        const ticks = Math.max(2, settings.numTicks);
        for (let i = 0; i < ticks; i++) {
            const fraction = i / (ticks - 1); const xPos = fraction * w; const currentPpm = viewOffsetPpm - (fraction * viewWidthPpm);
            ctx.beginPath(); ctx.moveTo(xPos, axisY); ctx.lineTo(xPos, axisY + 6); ctx.strokeStyle = "var(--text-muted)"; ctx.stroke(); ctx.fillText(currentPpm.toFixed(settings.ppmDecimals), xPos, axisY + 20);
        }
    };

    canvasContainer.addEventListener('mouseenter', () => canvasContainer.focus());
    canvasContainer.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase(); if (k === settings.hotkeyPan) modeBtns['Pan'].click();
        if (k === settings.hotkeyZoom) modeBtns['Zoom'].click(); if (k === settings.hotkeyIntegrate) modeBtns['Integrate'].click();
        if (k === settings.hotkeyMultiplet) modeBtns['Multiplet'].click(); if (k === settings.hotkeyPeak) modeBtns['Peak'].click();
    });

    canvasContainer.addEventListener("pointerdown", (e) => {
        canvasContainer.setPointerCapture(e.pointerId); const rect = canvasContainer.getBoundingClientRect(); const x = e.clientX - rect.left;
        if (activeMode === 'Pan') { isDragging = true; dragStartX = e.clientX; dragStartY = e.clientY; dragStartOffset = viewOffsetPpm; dragStartBaseline = baselineOffset; canvasContainer.setCssStyles({ cursor: "grabbing" }); } 
        else { isBoxDragging = true; boxStartX = x; boxEndX = x; boxEndY = e.clientY - rect.top; }
    });

    canvasContainer.addEventListener("pointermove", (e) => {
        const rect = canvasContainer.getBoundingClientRect(); const x = e.clientX - rect.left;
        
        if (isDragging && activeMode === 'Pan') {
            const deltaX = e.clientX - dragStartX; const deltaY = e.clientY - dragStartY;
            viewOffsetPpm = dragStartOffset + (deltaX * (viewWidthPpm / rect.width)); baselineOffset = dragStartBaseline + deltaY; 
            window.requestAnimationFrame(draw);
        } else if (isBoxDragging) { 
            boxEndX = Math.max(0, Math.min(rect.width, x)); boxEndY = e.clientY - rect.top; 
            window.requestAnimationFrame(draw); 
        } else if (specData.predictedPeaks) {
            const mousePpm = viewOffsetPpm - (x / rect.width) * viewWidthPpm;
            const closestPeak = specData.predictedPeaks.find(p => Math.abs(p.shift - mousePpm) < 0.1); 
            
            if (closestPeak) {
                const newHover = new Set(closestPeak.atoms);
                if (hoveredAtoms.size !== newHover.size || [...hoveredAtoms].some(a => !newHover.has(a))) {
                    hoveredAtoms = newHover;
                    drawMolecule();
                    window.requestAnimationFrame(draw);
                }
            } else if (hoveredAtoms.size > 0) {
                hoveredAtoms.clear();
                drawMolecule();
                window.requestAnimationFrame(draw);
            }
        }
    });

    canvasContainer.addEventListener("pointerup", (e) => {
        canvasContainer.releasePointerCapture(e.pointerId);
        if (isDragging) { isDragging = false; updateCursor(); }
        if (isBoxDragging) {
            isBoxDragging = false; const rect = canvasContainer.getBoundingClientRect();
            if (Math.abs(boxStartX - boxEndX) > 5) {
                saveStateToHistory(); const p1 = viewOffsetPpm - (boxStartX / rect.width) * viewWidthPpm; const p2 = viewOffsetPpm - (boxEndX / rect.width) * viewWidthPpm;
                const sPpm = Math.max(p1, p2); const ePpm = Math.min(p1, p2); const currentPpms = getCorrectedPpms(); const procInt = getProcessedIntensities();
                let lIdx = 0, rIdx = pointsToRead - 1; for(let i=0; i<pointsToRead; i++) if (currentPpms[i] <= sPpm) { lIdx = i; break; }
                for(let i=pointsToRead-1; i>=0; i--) if (currentPpms[i] >= ePpm) { rIdx = i; break; }
                const minIdx = Math.min(lIdx, rIdx); const maxIdx = Math.max(lIdx, rIdx);

                if (activeMode === 'Zoom') { viewOffsetPpm = sPpm; viewWidthPpm = sPpm - ePpm; } 
                else if (activeMode === 'Integrate') {
                    let sum = 0; for (let i = minIdx; i <= maxIdx; i++) sum += procInt[i];
                    userIntegrals.push({ startPpm: sPpm, endPpm: ePpm, lIdx: minIdx, rIdx: maxIdx, sum, norm: 1 }); const ref = userIntegrals[0].sum; userIntegrals.forEach(i => i.norm = Math.abs(i.sum / ref));
                } 
                else if (activeMode === 'Multiplet') {
                    let sum = 0; for (let i = minIdx; i <= maxIdx; i++) sum += procInt[i];
                    const regPeaks: { ppm: number; intensity: number; index: number }[] = [];
                    userPeaks.filter(p => p <= sPpm && p >= ePpm).forEach(ppm => { let idx = 0; let bestDiff = Infinity; for(let i=minIdx; i<=maxIdx; i++) { const d = Math.abs(currentPpms[i] - ppm); if(d < bestDiff) { bestDiff = d; idx = i; } } regPeaks.push({ ppm, intensity: procInt[idx], index: idx }); });
                    if (regPeaks.length === 0) {
                        let localMax = 0; for(let i=minIdx; i<=maxIdx; i++) if(procInt[i] > localMax) localMax = procInt[i];
                        const localThreshold = localMax * 0.05; for(let i=minIdx; i<=maxIdx; i++) { if (procInt[i] > localThreshold && procInt[i] > procInt[i-1] && procInt[i] > procInt[i+1]) { regPeaks.push({ ppm: currentPpms[i], intensity: procInt[i], index: i }); } }
                    }
                    regPeaks.sort((a,b) => b.ppm - a.ppm);
                    if (regPeaks.length > 0) {
                        const center = regPeaks.reduce((s, p) => s + p.ppm, 0) / regPeaks.length; let mult = 'm'; let J: number[] = [];
                        if (regPeaks.length === 1) mult = 's'; if (regPeaks.length === 2) { mult = 'd'; J = [Math.abs(regPeaks[0].ppm - regPeaks[1].ppm) * sf]; }
                        if (regPeaks.length === 3) { mult = 't'; J = [Math.abs(regPeaks[0].ppm - regPeaks[2].ppm) / 2 * sf]; } if (regPeaks.length === 4) { mult = 'q'; J = [Math.abs(regPeaks[0].ppm - regPeaks[3].ppm) / 3 * sf]; }
                        userMultiplets.push({ startPpm: sPpm, endPpm: ePpm, peaks: regPeaks, centerPpm: center, multiplicity: mult, jCouplings: J, integral: sum, normalizedIntegral: 1, lIndex: minIdx, rIndex: maxIdx });
                        const ref = userMultiplets[0].integral; userMultiplets.forEach(m => m.normalizedIntegral = Math.abs(m.integral / ref));
                    }
                }
                else if (activeMode === 'Peak') {
                    const drawHeightFactor = (stackMode === 'stack' && stackedSpectra.length > 0) ? 0.7 : 1.0; const maxDrawHeight = (rect.height * 0.82 * drawHeightFactor); const spectrumBaseY = (rect.height - 25) + baselineOffset;
                    const thresholdIntensity = Math.max(0, (spectrumBaseY - boxEndY) * maxInt / (maxDrawHeight * yScale)); const newPeaks: number[] = [];
                    for (let i = minIdx; i <= maxIdx; i++) { if (procInt[i] >= thresholdIntensity && procInt[i] > procInt[i-1] && procInt[i] > procInt[i+1]) newPeaks.push(currentPpms[i]); }
                    userPeaks = userPeaks.filter(p => p > sPpm || p < ePpm); userPeaks.push(...newPeaks);
                }
            }
            boxStartX = -1; boxEndX = -1; boxEndY = -1; window.requestAnimationFrame(draw);
        }
    });

    canvasContainer.addEventListener("mouseleave", () => {
        hoveredAtoms.clear();
        drawMolecule();
        window.requestAnimationFrame(draw);
    });

    canvasContainer.addEventListener("wheel", (e) => {
        e.preventDefault(); const rect = canvasContainer.getBoundingClientRect();
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
            const mouseX = e.clientX - rect.left; const zoomFactor = (e.deltaY < 0) ? 0.8 : 1.25;
            const mousePpm = viewOffsetPpm - (mouseX / rect.width) * viewWidthPpm; viewWidthPpm *= zoomFactor; viewOffsetPpm = mousePpm + (mouseX / rect.width) * viewWidthPpm;
        } else { yScale *= (e.deltaY < 0) ? 1.2 : 0.8; }
        window.requestAnimationFrame(draw);
    });

    canvasContainer.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; });
    canvasContainer.addEventListener("drop", (e) => {
        e.preventDefault(); e.stopPropagation(); const fileRef = e.dataTransfer?.getData("text/plain") || e.dataTransfer?.getData("application/vnd.obsidian.file-path");
        if (fileRef) {
            let cleanPath = fileRef; if (cleanPath.includes('obsidian://')) { try { const url = new URL(cleanPath); const f = url.searchParams.get('file'); if (f) cleanPath = decodeURIComponent(f); } catch (err) { console.debug(err); } }
            void (async () => {
                try {
                    const { specData: newSpec } = await loadSpectrumData(cleanPath);
                    if (newSpec.type === 'NMR') { stackedSpectra.push(newSpec); window.requestAnimationFrame(draw); new Notice(`Stacked: ${newSpec.title || cleanPath.split('/').pop()}`); } else { new Notice("Only NMR spectra can be stacked directly."); }
                } catch (err) { new Notice("Failed to load stacked spectrum: " + String(err)); }
            })();
        }
    });

    const resizeObserver = new ResizeObserver(() => { window.requestAnimationFrame(draw); drawMolecule(); }); 
    resizeObserver.observe(layoutWrapper);
    window.setTimeout(() => { drawMolecule(); draw(); }, 100);
}

// 4. Elsci-Style Multi-Trace Chromatography Viewer
export function renderChromatogram(container: HTMLElement, data: SpecData, settings: ChemSpecSettings) {
    const traces = data.traces || [];
    if (traces.length === 0) return;

    const elsciColors = ['#3b82f6', '#f97316', '#10b981', '#a855f7', '#eab308', '#ec4899', '#06b6d4'];

    const header = container.createDiv();
    header.setCssStyles({
        padding: "8px 14px", background: "var(--background-secondary)",
        borderBottom: "1px solid var(--background-modifier-border)",
        fontSize: "0.85em", display: "flex", justifyContent: "space-between", alignItems: "center"
    });
    
    const titleSpan = header.createSpan();
    titleSpan.createSpan({ text: "CHROMATOGRAPHY / LC-MS" }).setCssStyles({ fontWeight: "600", color: "var(--text-accent)" });
    titleSpan.createSpan({ text: " | " }).setCssStyles({ color: "var(--text-muted)" });
    titleSpan.createSpan({ text: data.title || "Chromatogram" });

    const toolsContainer = header.createDiv({ cls: "chemspec-tools" });
    toolsContainer.setCssStyles({ display: "flex", gap: "6px" });
    const resetBtn = toolsContainer.createEl("button", { text: "Reset Zoom" });
    resetBtn.setCssStyles({ padding: "4px 8px", fontSize: "0.8em", borderRadius: "4px" });

    const mainContainer = container.createDiv();
    mainContainer.setCssStyles({ 
        flexGrow: "1", overflowY: "auto", position: "relative", 
        display: "flex", flexDirection: "column", gap: "8px", padding: "10px" 
    });

    let minTime = traces[0].times[0];
    let maxTime = traces[0].times[traces[0].times.length - 1];
    let viewMinTime = minTime;
    let viewMaxTime = maxTime;

    let isSelecting = false;
    let selStart = -1, selEnd = -1;
    let crosshairTime: number | null = null;

    const canvasElements: HTMLCanvasElement[] = [];

    const redrawAll = () => {
        canvasElements.forEach((canvas, idx) => {
            const trace = traces[idx];
            const rect = canvas.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            const dpr = window.devicePixelRatio || 1;
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.scale(dpr, dpr);

            const w = rect.width, h = rect.height;
            const padLeft = 60, padRight = 30, padTop = 32, padBottom = 26;
            const plotW = w - padLeft - padRight;
            const plotH = h - padTop - padBottom;

            ctx.clearRect(0, 0, w, h);

            const toX = (t: number) => padLeft + ((t - viewMinTime) / Math.max(1e-5, (viewMaxTime - viewMinTime))) * plotW;
            const toY = (v: number) => padTop + plotH - (trace.maxInt > 0 ? (v / trace.maxInt) * plotH : 0);

            // Subtle Grid
            ctx.strokeStyle = "rgba(128, 128, 128, 0.12)";
            ctx.lineWidth = 1;
            for (let i = 0; i <= 4; i++) {
                const y = padTop + (plotH / 4) * i;
                ctx.beginPath(); ctx.moveTo(padLeft, y); ctx.lineTo(padLeft + plotW, y); ctx.stroke();
            }

            // Draw Shaded Peaks (Elsci aesthetic)
            trace.integrals.forEach((peak) => {
                const pStartIdx = trace.times.findIndex(t => t >= peak.startRT);
                const pEndIdx = trace.times.findIndex(t => t >= peak.endRT);
                if (pStartIdx === -1 || pEndIdx === -1) return;

                ctx.beginPath();
                ctx.moveTo(toX(trace.times[pStartIdx]), toY(0));
                for (let i = pStartIdx; i <= pEndIdx; i++) {
                    ctx.lineTo(toX(trace.times[i]), toY(trace.intensities[i]));
                }
                ctx.lineTo(toX(trace.times[pEndIdx]), toY(0));
                ctx.closePath();
                ctx.fillStyle = hexToRgba(peak.color, 0.35);
                ctx.fill();

                // Dotted drop lines
                ctx.strokeStyle = peak.color;
                ctx.lineWidth = 1.2;
                ctx.setLineDash([3, 2]);
                ctx.beginPath();
                ctx.moveTo(toX(peak.startRT), toY(0));
                ctx.lineTo(toX(peak.startRT), toY(trace.intensities[pStartIdx]));
                ctx.moveTo(toX(peak.endRT), toY(0));
                ctx.lineTo(toX(peak.endRT), toY(trace.intensities[pEndIdx]));
                ctx.stroke();
                ctx.setLineDash([]);

                // Pinned Peak Diagnostic Badge
                const subIntensities = trace.intensities.slice(pStartIdx, Math.max(pStartIdx + 1, pEndIdx));
                let peakMax = -Infinity;
                for (let i = 0; i < subIntensities.length; i++) {
                    if (subIntensities[i] > peakMax) peakMax = subIntensities[i];
                }
                const topY = toY(peakMax > -Infinity ? peakMax : trace.maxInt * 0.5);
                const badgeX = toX(peak.retentionTime);
                const badgeW = 95, badgeH = 34;

                ctx.save();
                ctx.fillStyle = "var(--background-primary)";
                ctx.shadowColor = "rgba(0, 0, 0, 0.12)";
                ctx.shadowBlur = 6;
                ctx.fillRect(badgeX - badgeW/2, topY - badgeH - 6, badgeW, badgeH);
                ctx.strokeStyle = "var(--background-modifier-border)";
                ctx.strokeRect(badgeX - badgeW/2, topY - badgeH - 6, badgeW, badgeH);

                ctx.shadowColor = "transparent";
                ctx.fillStyle = "var(--text-normal)";
                ctx.font = "bold 10px sans-serif";
                ctx.textAlign = "left";
                ctx.textBaseline = "alphabetic";
                ctx.fillText(peak.label, badgeX - badgeW/2 + 6, topY - badgeH + 6);
                ctx.font = "9px monospace";
                ctx.fillStyle = "var(--text-muted)";
                ctx.fillText(`RT: ${peak.retentionTime.toFixed(2)} min`, badgeX - badgeW/2 + 6, topY - badgeH + 16);
                ctx.fillText(`Area: ${peak.relativeAreaPercent.toFixed(1)}%`, badgeX - badgeW/2 + 6, topY - badgeH + 26);
                ctx.restore();
            });

            // Main Trace Line
            ctx.beginPath();
            ctx.strokeStyle = "var(--text-normal)";
            ctx.lineWidth = 1.5;
            for (let i = 0; i < trace.times.length; i++) {
                const x = toX(trace.times[i]);
                const y = toY(trace.intensities[i]);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Trace Name Pill
            ctx.fillStyle = "var(--text-accent)";
            ctx.font = "600 11px sans-serif";
            ctx.textAlign = "left";
            ctx.textBaseline = "alphabetic";
            ctx.fillText(trace.name, padLeft + 10, padTop - 12);

            // Time Axis Ticks
            ctx.fillStyle = "var(--text-muted)";
            ctx.font = "10px monospace";
            ctx.textAlign = "center";
            for (let i = 0; i <= 6; i++) {
                const t = viewMinTime + (i / 6) * (viewMaxTime - viewMinTime);
                const x = toX(t);
                ctx.fillText(`${t.toFixed(2)} min`, x, h - 8);
            }

            // Interactive Selection Highlight
            if (isSelecting && selStart !== -1 && selEnd !== -1) {
                const sx = Math.min(selStart, selEnd);
                const sw = Math.abs(selStart - selEnd);
                ctx.fillStyle = "rgba(59, 130, 246, 0.2)";
                ctx.fillRect(sx, padTop, sw, plotH);
            }

            // Synced Crosshair
            if (crosshairTime !== null && crosshairTime >= viewMinTime && crosshairTime <= viewMaxTime) {
                const cx = toX(crosshairTime);
                ctx.strokeStyle = "rgba(239, 68, 68, 0.6)";
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 2]);
                ctx.beginPath(); ctx.moveTo(cx, padTop); ctx.lineTo(cx, padTop + plotH); ctx.stroke();
                ctx.setLineDash([]);
            }
        });
    };

    traces.forEach((trace) => {
        const card = mainContainer.createDiv();
        card.setCssStyles({
            border: "1px solid var(--background-modifier-border)",
            borderRadius: "8px", background: "var(--background-primary)",
            height: "170px", minHeight: "170px", position: "relative"
        });

        const canvas = card.createEl("canvas");
        canvas.setCssStyles({ width: "100%", height: "100%", display: "block", cursor: "crosshair" });
        canvasElements.push(canvas);

        canvas.addEventListener("pointerdown", (e) => {
            const rect = canvas.getBoundingClientRect();
            isSelecting = true;
            selStart = e.clientX - rect.left;
            selEnd = selStart;
        });

        canvas.addEventListener("pointermove", (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const padLeft = 60, plotW = rect.width - 90;
            crosshairTime = viewMinTime + ((x - padLeft) / Math.max(1, plotW)) * (viewMaxTime - viewMinTime);

            if (isSelecting) {
                selEnd = x;
            }
            window.requestAnimationFrame(redrawAll);
        });

        canvas.addEventListener("pointerup", (e) => {
            if (isSelecting && Math.abs(selStart - selEnd) > 10) {
                const rect = canvas.getBoundingClientRect();
                const padLeft = 60, plotW = rect.width - 90;
                const toT = (sx: number) => viewMinTime + ((sx - padLeft) / Math.max(1, plotW)) * (viewMaxTime - viewMinTime);
                const t1 = toT(Math.min(selStart, selEnd));
                const t2 = toT(Math.max(selStart, selEnd));

                let maxVal = -Infinity, maxT = t1, sumArea = 0;
                for (let i = 0; i < trace.times.length; i++) {
                    const t = trace.times[i];
                    if (t >= t1 && t <= t2) {
                        sumArea += trace.intensities[i];
                        if (trace.intensities[i] > maxVal) {
                            maxVal = trace.intensities[i];
                            maxT = t;
                        }
                    }
                }

                if (sumArea > 0) {
                    const color = elsciColors[trace.integrals.length % elsciColors.length];
                    trace.integrals.push({
                        id: String(Date.now()),
                        label: `Peak ${trace.integrals.length + 1}`,
                        retentionTime: maxT,
                        startRT: t1,
                        endRT: t2,
                        area: sumArea,
                        relativeAreaPercent: 100,
                        color
                    });

                    const totalA = trace.integrals.reduce((a, b) => a + b.area, 0);
                    if (totalA > 0) {
                        trace.integrals.forEach(p => p.relativeAreaPercent = (p.area / totalA) * 100);
                    }
                }
            }
            isSelecting = false;
            selStart = -1; selEnd = -1;
            window.requestAnimationFrame(redrawAll);
        });
    });

    mainContainer.addEventListener("mouseleave", () => {
        crosshairTime = null;
        window.requestAnimationFrame(redrawAll);
    });

    resetBtn.onclick = () => {
        viewMinTime = minTime; viewMaxTime = maxTime;
        window.requestAnimationFrame(redrawAll);
    };

    const resizeObs = new ResizeObserver(() => window.requestAnimationFrame(redrawAll));
    resizeObs.observe(mainContainer);
    window.setTimeout(redrawAll, 50);
}

// 5. Electronic TLC Plate Renderer
export function renderTLCPlate(container: HTMLElement, lanes: TLCLane[], solvent: string = "30% EtOAc/Hexanes", stain: string = "UV 254") {
    const card = container.createDiv();
    card.setCssStyles({
        padding: "12px", border: "1px solid var(--background-modifier-border)",
        borderRadius: "8px", background: "var(--background-primary)",
        display: "inline-flex", flexDirection: "column", gap: "8px"
    });

    const info = card.createDiv({ text: `TLC: ${solvent} (${stain})` });
    info.setCssStyles({ fontSize: "0.85em", color: "var(--text-muted)", fontWeight: "600" });

    const canvas = card.createEl("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;

    const w = Math.max(200, lanes.length * 60 + 40);
    const h = 240;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = stain === "UV 254" ? "#86efac" : (stain === "KMnO4" ? "#fbcfe8" : "#f8fafc");
    ctx.fillRect(10, 10, w - 20, h - 20);
    ctx.strokeStyle = "#cbd5e1"; ctx.strokeRect(10, 10, w - 20, h - 20);

    const baseLine = h - 35, frontLine = 30;
    ctx.strokeStyle = "rgba(100, 116, 139, 0.6)";
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(15, baseLine); ctx.lineTo(w - 15, baseLine);
    ctx.moveTo(15, frontLine); ctx.lineTo(w - 15, frontLine);
    ctx.stroke(); ctx.setLineDash([]);

    const spacing = (w - 40) / (lanes.length + 1);
    lanes.forEach((lane, i) => {
        const lx = 20 + (i + 1) * spacing;
        ctx.fillStyle = "#1e293b"; ctx.font = "600 11px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(lane.name, lx, h - 14);

        lane.spots.forEach(sp => {
            const sy = baseLine - sp.rf * (baseLine - frontLine);
            ctx.beginPath();
            ctx.ellipse(lx, sy, 9, 6 + (sp.tailing || 0) * 15, 0, 0, Math.PI * 2);
            ctx.fillStyle = sp.color || (stain === "UV 254" ? "rgba(15, 23, 42, 0.75)" : "rgba(245, 158, 11, 0.8)");
            ctx.fill();

            ctx.fillStyle = "#334155"; ctx.font = "9px monospace";
            ctx.textAlign = "left";
            ctx.fillText(sp.rf.toFixed(2), lx + 14, sy + 3);
        });
    });
}

export function renderMS(container: HTMLElement, specData: SpecData, settings: ChemSpecSettings) {
    const xs = specData.xs || new Float64Array();
    const ys = specData.ys || new Float64Array();
    const minMz = Math.min(...xs) - 5;
    const maxMz = Math.max(...xs) + 5;

    const header = container.createDiv();
    header.setCssStyles({ padding: "8px 14px", background: "var(--background-secondary)", borderBottom: "1px solid var(--background-modifier-border)", fontSize: "0.85em", display: "flex", justifyContent: "space-between", alignItems: "center" });
    const titleSpan = header.createSpan();
    titleSpan.createSpan({ text: "MASS SPECTRUM (Predicted)" }).setCssStyles({ fontWeight: "600", color: "var(--text-accent)" });
    titleSpan.createSpan({ text: " | " }).setCssStyles({ color: "var(--text-muted)" });
    titleSpan.createSpan({ text: specData.title || "" });

    const layoutWrapper = container.createDiv();
    layoutWrapper.setCssStyles({ display: "flex", width: "100%", flexGrow: "1", overflow: "hidden" });

    // Molecule Viewer
    const molContainer = layoutWrapper.createDiv();
    molContainer.setCssStyles({ width: "30%", minWidth: "220px", borderRight: "1px solid var(--background-modifier-border)", background: "var(--background-primary)", display: "flex", alignItems: "center", justifyContent: "center" });
    const molCanvas = molContainer.createEl("canvas");
    molCanvas.setCssStyles({ width: "100%", height: "100%" });

    if (specData.smiles) {
        const dpr = window.devicePixelRatio || 1;
        const activeMol = OCL.Molecule.fromSmiles(specData.smiles);
        activeMol.inventCoordinates();
        
        window.requestAnimationFrame(() => {
            const rect = molContainer.getBoundingClientRect();
            molCanvas.width = rect.width * dpr; molCanvas.height = rect.height * dpr;
            const ctx = molCanvas.getContext("2d")!; ctx.scale(dpr, dpr);

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i < activeMol.getAllAtoms(); i++) {
                const x = activeMol.getAtomX(i); const y = activeMol.getAtomY(i);
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
            const scale = Math.min((rect.width - 60) / Math.max(0.1, (maxX - minX)), (rect.height - 60) / Math.max(0.1, (maxY - minY)), 40);
            const cx = (maxX + minX) / 2; const cy = (maxY + minY) / 2;
            const toX = (x: number) => rect.width / 2 + (x - cx) * scale;
            const toY = (y: number) => rect.height / 2 + (y - cy) * scale;

            ctx.lineWidth = 1.5; ctx.strokeStyle = "var(--text-normal)"; ctx.lineCap = "round";
            for (let i = 0; i < activeMol.getAllBonds(); i++) {
                const a1 = activeMol.getBondAtom(0, i); const a2 = activeMol.getBondAtom(1, i);
                ctx.beginPath(); ctx.moveTo(toX(activeMol.getAtomX(a1)), toY(activeMol.getAtomY(a1))); ctx.lineTo(toX(activeMol.getAtomX(a2)), toY(activeMol.getAtomY(a2))); ctx.stroke();
            }
            ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            for (let i = 0; i < activeMol.getAllAtoms(); i++) {
                const atomicNo = activeMol.getAtomicNo(i);
                if (atomicNo !== 6) {
                    const x = toX(activeMol.getAtomX(i)); const y = toY(activeMol.getAtomY(i));
                    ctx.fillStyle = "var(--background-primary)"; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = atomicNo === 8 ? "#ef4444" : (atomicNo === 7 ? "#3b82f6" : "var(--text-normal)"); ctx.fillText(OCL.Molecule.cAtomLabel[atomicNo], x, y + 1);
                }
            }
        });
    }

    // MS Viewer
    const canvasContainer = layoutWrapper.createDiv();
    canvasContainer.setCssStyles({ flexGrow: "1", position: "relative" });
    const canvas = canvasContainer.createEl("canvas");
    canvas.setCssStyles({ width: "100%", height: "100%", display: "block" });

    window.requestAnimationFrame(() => {
        const rect = canvasContainer.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
        const ctx = canvas.getContext("2d")!; ctx.scale(dpr, dpr);
        
        const w = rect.width; const h = rect.height; const padB = 25; const padT = 20;
        
        // Axis
        ctx.beginPath(); ctx.moveTo(0, h - padB); ctx.lineTo(w, h - padB);
        ctx.strokeStyle = "var(--background-modifier-border)"; ctx.lineWidth = 1.5; ctx.stroke();
        
        ctx.fillStyle = "var(--text-normal)"; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
        
        // Draw Peaks
        for (let i = 0; i < xs.length; i++) {
            const xPos = ((xs[i] - minMz) / (maxMz - minMz)) * w;
            const yPos = h - padB - (ys[i] / 100) * (h - padB - padT);
            
            ctx.beginPath(); ctx.moveTo(xPos, h - padB); ctx.lineTo(xPos, yPos);
            ctx.strokeStyle = settings.lineColor; ctx.lineWidth = 2; ctx.stroke();
            
            // Peak label
            ctx.fillText(xs[i].toFixed(2), xPos, yPos - 5);
        }

        // Ticks
        for (let i = 0; i <= 5; i++) {
            const val = minMz + i * (maxMz - minMz) / 5;
            const xPos = ((val - minMz) / (maxMz - minMz)) * w;
            ctx.beginPath(); ctx.moveTo(xPos, h - padB); ctx.lineTo(xPos, h - padB + 6);
            ctx.strokeStyle = "var(--text-muted)"; ctx.lineWidth = 1; ctx.stroke();
            ctx.fillText(val.toFixed(1), xPos, h - padB + 20);
        }
    });
}