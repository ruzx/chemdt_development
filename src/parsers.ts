import { DataAdapter } from 'obsidian';
import { SpecData, ChromatogramTrace } from './types';

export async function parseBrukerFiles(acqusPath: string, procsPath: string, r1Path: string, adapter: DataAdapter): Promise<SpecData> {
    const acqusString = await adapter.read(acqusPath);
    const procsString = await adapter.read(procsPath);
    const binary1r = await adapter.readBinary(r1Path);

    const getParam = (text: string, param: string) => {
        const match = text.match(new RegExp(`##\\$${param}\\s*=\\s*([-\\d.]+)`, 'i'));
        return match ? parseFloat(match[1]) : 0;
    };

    const nucleusMatch = acqusString.match(/##\$NUC1=\s*<([^>]+)>/i);
    const solventMatch = acqusString.match(/##\$SOLVENT=\s*<([^>]+)>/i);
    const sf = getParam(procsString, "SF");           
    let sw_p = getParam(procsString, "SW_p");       
    if (sw_p > 1000 || sw_p === 0) sw_p = (getParam(acqusString, "SW_h") > 0) ? getParam(acqusString, "SW_h") / sf : getParam(acqusString, "SW") / sf;

    const dataView = new DataView(binary1r);
    const pointsToRead = Math.min(getParam(procsString, "SI"), Math.floor(binary1r.byteLength / 4));
    const intensities = new Float64Array(pointsToRead);
    const rawPpms = new Float64Array(pointsToRead);
    
    let maxInt = 1;
    const offset = getParam(procsString, "OFFSET");
    const littleEndian = (getParam(procsString, "BYTORDP") === 0);

    for (let i = 0; i < pointsToRead; i++) {
        const val = dataView.getInt32(i * 4, littleEndian);
        intensities[i] = val;
        rawPpms[i] = offset - (i / (pointsToRead - 1)) * sw_p;
        if (val > maxInt) maxInt = val;
    }
    
    return { type: 'NMR', nucleus: nucleusMatch ? nucleusMatch[1] : "1H", solvent: solventMatch ? solventMatch[1] : "Unknown", sf, sw_p, offset, rawPpms, intensities, pointsToRead, maxInt };
}

export function parseSimpleJDX(content: string): SpecData {
    const getTag = (tag: string) => { const match = content.match(new RegExp(`##${tag}=([^\\n]+)`, 'i')); return match ? match[1].trim() : ""; };
    
    const title = getTag("TITLE") || "Imported JDX";
    const firstX = parseFloat(getTag("FIRSTX")) || 10;
    const lastX = parseFloat(getTag("LASTX")) || 0;
    const npoints = parseInt(getTag("NPOINTS")) || 1000;
    
    const dataStart = content.search(/##XYDATA=/i);
    if (dataStart === -1) throw new Error("Could not find valid ##XYDATA block.");
    const dataBlock = content.substring(content.indexOf('\n', dataStart)).split(/##END=/i)[0];
    
    const ys = new Float64Array(npoints);
    const xs = new Float64Array(npoints);
    let maxInt = -Infinity; let minInt = Infinity; let dataIdx = 0; let lastY = 0;
    
    const dataLines = dataBlock.split('\n');
    for (let line of dataLines) {
        line = line.trim();
        if (!line || line.startsWith('##')) continue;
        
        const expanded = line
            .replace(/@/g, ' 0').replace(/[A-I]/g, m => ' ' + (m.charCodeAt(0) - 64)).replace(/[a-i]/g, m => ' -' + (m.charCodeAt(0) - 96))
            .replace(/%/g, ' D0').replace(/[J-R]/g, m => ' D' + (m.charCodeAt(0) - 73)).replace(/[j-r]/g, m => ' D-' + (m.charCodeAt(0) - 105))
            .replace(/(?<![eE\sD])([+-])/g, ' $1'); 
            
        const tokens = expanded.split(/\s+/).filter(t => t);
        if (tokens.length > 1) { 
            for (let j = 1; j < tokens.length; j++) {
                if (dataIdx < npoints) {
                    let token = tokens[j]; let isDif = false;
                    if (token.startsWith('D')) { isDif = true; token = token.substring(1); }
                    let val = parseFloat(token);
                    if (!isNaN(val)) {
                        if (isDif) val = lastY + val;
                        ys[dataIdx] = val; lastY = val;
                        if (val > maxInt) maxInt = val; if (val < minInt) minInt = val;
                        dataIdx++;
                    }
                }
            }
        }
    }

    if (/DATA TYPE=\s*(INFRARED|IR)/i.test(content) || /YUNITS=\s*(TRANSMITTANCE|ABSORBANCE)/i.test(content)) {
        for (let i = 0; i < npoints; i++) xs[i] = firstX + (i / (npoints - 1)) * (lastX - firstX);
        return { type: 'IR', title, xs, ys, npoints, minInt, maxInt };
    } else {
        const sw_p = Math.abs(firstX - lastX) || 10;
        for (let i = 0; i < npoints; i++) xs[i] = firstX - (i / (npoints - 1)) * sw_p;
        return { type: 'NMR', nucleus: "1H", solvent: title, sf: 400, sw_p, offset: firstX, rawPpms: xs, intensities: ys, pointsToRead: npoints, maxInt };
    }
}

export function parseCVFile(content: string): SpecData {
    const lines = content.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n').filter(l => l.trim().length > 0);
    const potentials: number[] = []; const currents: number[] = []; let scanRate = 0.1;

    if (lines.length > 0 && (lines[0].includes("Potential applied (V)") || lines[0].includes("WE(1).Current (A)"))) {
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split('\t').map(s => parseFloat(s.trim()));
            if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[2])) { potentials.push(parts[0]); currents.push(parts[2]); }
        }
    } else {
        let dataStart = 0;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes("Scan Rate (V/s)")) { const match = lines[i].match(/=\s*([\d.]+)/); if (match) scanRate = parseFloat(match[1]); }
            if (lines[i].includes("Potential/V") || lines[i].includes("Potential/V, Current/A")) { dataStart = i + 1; break; }
        }
        for (let i = dataStart; i < lines.length; i++) {
            const parts = lines[i].split(',').map(s => parseFloat(s.trim()));
            if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) { potentials.push(parts[0]); currents.push(parts[1]); } 
            else {
                const genParts = lines[i].replace(/,/g, '\t').split('\t').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
                if (genParts.length >= 2) { potentials.push(genParts[0]); currents.push(genParts[1]); }
            }
        }
    }

    const npoints = potentials.length;
    const xs = new Float64Array(potentials); const ys = new Float64Array(currents);
    let maxInt = -Infinity, minInt = Infinity;
    for (let i = 0; i < npoints; i++) {
        if (ys[i] > maxInt) maxInt = ys[i]; if (ys[i] < minInt) minInt = ys[i];
    }

    const breaks = [0]; let currentDir = 0;
    for (let i = 0; i < npoints - 1; i++) {
        const diff = Math.round(xs[i + 1] * 1000) - Math.round(xs[i] * 1000);
        if (diff !== 0) {
            const dir = Math.sign(diff);
            if (currentDir !== 0 && dir !== currentDir) breaks.push(i + 1);
            currentDir = dir;
        }
    }
    breaks.push(npoints);
    return { type: 'CV', title: "Exported CV", xs, ys, npoints, minInt, maxInt, scanRate, cycleBreaks: breaks };
}

export function simulateSpectrumFromText(text: string): SpecData {
    const headerMatch = text.match(/^(\d+[A-Za-z]+)\s*NMR\s*\(([^,]+),\s*([^)]+)\)/i);
    let nucleus = "1H", sf = 400, solvent = "CDCl3";
    if (headerMatch) { nucleus = headerMatch[1]; sf = parseFloat(headerMatch[2]) || 400; solvent = headerMatch[3]; }

    const peakRegex = /([\d.]+(?:\s*[-–]\s*[\d.]+)?)\s*\(([^)]+)\)/g;
    let match; const peaks = [];
    while ((match = peakRegex.exec(text)) !== null) {
        const shiftStr = match[1]; const details = match[2];
        let shift = 0, isRange = false, width = 0.005;
        if (shiftStr.includes('-') || shiftStr.includes('–')) {
            const parts = shiftStr.split(/[-–]/).map(s => parseFloat(s.trim()));
            shift = (parts[0] + parts[1]) / 2; width = Math.abs(parts[0] - parts[1]) / 2; isRange = true;
        } else { shift = parseFloat(shiftStr); }

        const multMatch = details.match(/^[a-zA-Z]+/); const mult = multMatch ? multMatch[0].toLowerCase() : 'm';
        const intMatch = details.match(/(\d+(?:\.\d+)?)\s*H/i); const integral = intMatch ? parseFloat(intMatch[1]) : 1;
        const jMatch = details.match(/J\s*=\s*([\d.,]+)/i); const jHz = jMatch ? parseFloat(jMatch[1].replace(',', '.')) : 0;
        peaks.push({ shift, mult, integral, jHz, isRange, width });
    }

    const npoints = 16384;
    const maxShift = peaks.length > 0 ? Math.max(...peaks.map(p => p.shift)) + 1 : 10;
    const minShift = peaks.length > 0 ? Math.min(...peaks.map(p => p.shift)) - 1 : 0;
    const offset = maxShift < 10 ? 10 : maxShift; const sw_p = offset - (minShift > 0 ? 0 : minShift);
    const intensities = new Float64Array(npoints); const rawPpms = new Float64Array(npoints);

    for (let i = 0; i < npoints; i++) {
        rawPpms[i] = offset - (i / (npoints - 1)) * sw_p;
        intensities[i] = (Math.random() - 0.5) * 0.05; 
    }

    peaks.forEach(p => {
        const jPpm = p.jHz / sf; const baseW = p.isRange ? p.width : 0.002;
        let subPeaks: {ppm: number, int: number}[] = [];

        if (p.mult.includes('s')) subPeaks = [{ppm: p.shift, int: 1}];
        else if (p.mult.includes('d')) subPeaks = [{ppm: p.shift - jPpm/2, int: 1}, {ppm: p.shift + jPpm/2, int: 1}];
        else if (p.mult.includes('t')) subPeaks = [{ppm: p.shift - jPpm, int: 1}, {ppm: p.shift, int: 2}, {ppm: p.shift + jPpm, int: 1}];
        else if (p.mult.includes('q')) subPeaks = [{ppm: p.shift - 1.5*jPpm, int: 1}, {ppm: p.shift - 0.5*jPpm, int: 3}, {ppm: p.shift + 0.5*jPpm, int: 3}, {ppm: p.shift + 1.5*jPpm, int: 1}];
        else { for(let i=0; i<5; i++) subPeaks.push({ppm: p.shift + (Math.random()-0.5)*(p.isRange ? p.width*2 : 0.05), int: Math.random()}); }

        const totalSubInt = subPeaks.reduce((sum, sp) => sum + sp.int, 0);
        subPeaks.forEach(sp => {
            const normInt = (sp.int / totalSubInt) * p.integral * 100;
            for (let i = 0; i < npoints; i++) {
                const dx = rawPpms[i] - sp.ppm;
                intensities[i] += normInt * (baseW*baseW) / (dx*dx + baseW*baseW);
            }
        });
    });

    let maxInt = -Infinity;
    for (let i = 0; i < intensities.length; i++) if (intensities[i] > maxInt) maxInt = intensities[i];
    return { type: 'NMR', nucleus, solvent, sf, sw_p, offset, rawPpms, intensities, pointsToRead: npoints, maxInt };
}

export function parseChromatogramCSV(content: string, filename: string): SpecData {
    const lines = content.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) throw new Error("Empty chromatography file.");

    let headerIdx = 0;
    for (let i = 0; i < Math.min(20, lines.length); i++) {
        if (/time|min|retention/i.test(lines[i])) {
            headerIdx = i;
            break;
        }
    }

    const headers = lines[headerIdx].split(/,|\t/).map(h => h.trim().replace(/^["']|["']$/g, ''));
    const numCols = headers.length;
    const dataLines = lines.slice(headerIdx + 1);

    const times: number[] = [];
    const channels: number[][] = Array.from({ length: Math.max(1, numCols - 1) }, () => []);

    for (const line of dataLines) {
        const parts = line.split(/,|\t/).map(s => parseFloat(s.trim()));
        if (parts.length >= 2 && !isNaN(parts[0])) {
            times.push(parts[0]);
            for (let c = 1; c < numCols; c++) {
                channels[c - 1].push(isNaN(parts[c]) ? 0 : parts[c]);
            }
        }
    }

    const n = times.length;
    const timeArr = new Float64Array(times);
    const traces: ChromatogramTrace[] = [];

    for (let c = 0; c < channels.length; c++) {
        const intArr = new Float64Array(channels[c]);
        let maxVal = -Infinity;
        for (let i = 0; i < n; i++) if (intArr[i] > maxVal) maxVal = intArr[i];

        traces.push({
            name: headers[c + 1] || `Trace ${c + 1}`,
            times: timeArr,
            intensities: intArr,
            maxInt: maxVal > 0 ? maxVal : 1,
            integrals: []
        });
    }

    return {
        type: 'LCMS',
        title: filename,
        traces,
        npoints: n
    };
}

export function calculateHRMS(formula: string, adduct: string = "[M+H]+"): { theoretical: number; formula: string } {
    const weights: Record<string, number> = {
        H: 1.007825, C: 12.000000, N: 14.003074, O: 15.994915,
        F: 18.998403, Na: 22.989769, P: 30.973762, S: 31.972071,
        Cl: 34.968853, K: 38.963706, Br: 78.918338, I: 126.904473
    };

    const regex = /([A-Z][a-z]*)(\d*)/g;
    let match;
    let monoisotopicMass = 0;

    while ((match = regex.exec(formula)) !== null) {
        if (!match[1]) continue;
        const el = match[1];
        const count = match[2] ? parseInt(match[2], 10) : 1;
        if (!weights[el]) throw new Error(`Unknown element: ${el}`);
        monoisotopicMass += weights[el] * count;
    }

    let finalMass = monoisotopicMass;
    if (adduct === "[M+H]+") finalMass += 1.007276;
    else if (adduct === "[M+Na]+") finalMass += 22.989218;
    else if (adduct === "[M+K]+") finalMass += 38.963158;
    else if (adduct === "[M-H]-") finalMass -= 1.007276;

    return { theoretical: finalMass, formula };
}