import * as OCL from 'openchemlib';
import { SpecData, PredictedPeak } from './types';

const J_VICINAL = 7.0;
const J_AROMATIC_ORTHO = 7.8;

export function predictNMRFromSMILES(smiles: string, nucleus: '1H' | '13C' = '1H', sf: number = 400): SpecData {
    const mol = OCL.Molecule.fromSmiles(smiles);
    if (nucleus === '1H') mol.addImplicitHydrogens();
    mol.ensureHelperArrays(OCL.Molecule.cHelperRings | OCL.Molecule.cHelperSymmetrySimple);

    const rawPeaks: { shift: number, mult: string, integral: number, jHz: number, atoms: number[] }[] = [];

    for (let atom = 0; atom < mol.getAllAtoms(); atom++) {
        const atomicNo = mol.getAtomicNo(atom);
        if ((nucleus === '13C' && atomicNo !== 6) || (nucleus === '1H' && atomicNo !== 1)) continue;

        if (nucleus === '13C') {
            rawPeaks.push({ shift: estimateCarbonShift(mol, atom), mult: 's', integral: 1, jHz: 0, atoms: [atom] });
        } else if (nucleus === '1H') {
            const host = mol.getConnAtom(atom, 0); 
            if (host < 0) continue;

            let shift = 1.0, mult = 's', jHz = 0;
            const hostAtomicNo = mol.getAtomicNo(host);
            
            if (hostAtomicNo === 8) {
                shift = estimateOxygenProton(mol, host); 
            } else if (hostAtomicNo === 7) {
                shift = 5.0; 
            } else if (hostAtomicNo === 6) {
                shift = estimateProtonShift(mol, host); 
                const mData = computeProtonMultiplet(mol, host);
                mult = mData.mult;
                jHz = mData.jHz;
            }
            // Map the peak to the HOST heavy atom so it highlights properly on the 2D skeleton
            rawPeaks.push({ shift, mult, integral: 1, jHz, atoms: [host] });
        }
    }

    const groupedPeaks: PredictedPeak[] = [];
    rawPeaks.forEach(p => {
        const existing = groupedPeaks.find(gp => Math.abs(gp.shift - p.shift) < 0.05 && gp.mult === p.mult);
        if (existing) {
            existing.integral += p.integral;
            if (!existing.atoms.includes(p.atoms[0])) existing.atoms.push(p.atoms[0]);
        } else {
            groupedPeaks.push({ ...p, atoms: [...p.atoms] });
        }
    });

    return generateSpectrumData(groupedPeaks, nucleus, smiles, sf);
}

function estimateProtonShift(mol: OCL.Molecule, host: number): number {
    if (mol.getAllHydrogens(host) === 1) {
        for (let i = 0; i < mol.getConnAtoms(host); i++) {
            if (mol.getAtomicNo(mol.getConnAtom(host, i)) === 8 && mol.getBondOrder(mol.getConnBond(host, i)) === 2) return 9.7;
        }
    }
    if (mol.isAromaticAtom(host)) return calculateAromaticShift(mol, host);
    
    let maxCarbonOrder = 1;
    for (let i = 0; i < mol.getConnAtoms(host); i++) {
        if (mol.getAtomicNo(mol.getConnAtom(host, i)) === 6) maxCarbonOrder = Math.max(maxCarbonOrder, mol.getBondOrder(mol.getConnBond(host, i)));
    }
    if (maxCarbonOrder === 3) return 2.4; 
    if (maxCarbonOrder === 2) return 5.7;

    let shift = mol.getAllHydrogens(host) === 3 ? 0.9 : (mol.getAllHydrogens(host) === 2 ? 1.2 : 1.5);
    for (let i = 0; i < mol.getConnAtoms(host); i++) {
        const neighbor = mol.getConnAtom(host, i);
        if (mol.getAtomicNo(neighbor) === 1) continue;
        shift += getAliphaticAlphaIncrement(mol, neighbor, host);
    }
    return shift;
}

function calculateAromaticShift(mol: OCL.Molecule, host: number): number {
    let shift = 7.26;
    const distances = new Map<number, number>();
    distances.set(host, 0);
    const queue = [host];
    while (queue.length > 0) {
        const current = queue.shift()!;
        const d = distances.get(current)!;
        for (let i = 0; i < mol.getConnAtoms(current); i++) {
            const neighbor = mol.getConnAtom(current, i);
            if (mol.isAromaticAtom(neighbor) && !distances.has(neighbor)) {
                distances.set(neighbor, d + 1);
                queue.push(neighbor);
            }
        }
    }

    distances.forEach((dist, atom) => {
        if (dist >= 1 && dist <= 3) {
            let subType = 'None';
            for (let i = 0; i < mol.getConnAtoms(atom); i++) {
                const sub = mol.getConnAtom(atom, i);
                if (!mol.isAromaticAtom(sub) && mol.getAtomicNo(sub) !== 1) {
                    subType = getSubstituentType(mol, sub, atom);
                    break;
                }
            }
            const increments: Record<string, number[]> = {
                'alkyl': [-0.15, -0.1, -0.15], 'OH': [-0.50, -0.14, -0.40], 'OR': [-0.48, -0.09, -0.44],
                'OC(=O)R': [-0.25, 0.03, -0.13], 'C(=O)R': [0.62, 0.14, 0.21], 'COOH': [0.85, 0.18, 0.27],      
                'NO2': [0.95, 0.17, 0.33], 'Halogen': [0.10, -0.05, -0.10], 'NH2': [-0.70, -0.20, -0.60]
            };
            if (increments[subType]) shift += increments[subType][dist - 1];
        }
    });
    return shift;
}

function getAliphaticAlphaIncrement(mol: OCL.Molecule, atom: number, from: number): number {
    const z = mol.getAtomicNo(atom);
    if (z === 8) return getSubstituentType(mol, atom, from) === 'OC(=O)R' ? 2.8 : 2.3;
    if (z === 6) {
        if (mol.isAromaticAtom(atom)) return 1.4;
        const sub = getSubstituentType(mol, atom, from);
        if (sub === 'COOH') return 1.1;
        if (sub === 'C(=O)R') return 1.2;
    }
    if (z === 7) return 1.5; 
    if ([9, 17, 35, 53].includes(z)) return 2.1; 
    return 0; 
}

function getSubstituentType(mol: OCL.Molecule, sub: number, from: number): string {
    const z = mol.getAtomicNo(sub);
    if (z === 8) {
        for (let i = 0; i < mol.getConnAtoms(sub); i++) {
            const next = mol.getConnAtom(sub, i);
            if (next !== from && mol.getAtomicNo(next) === 6) {
                for (let j = 0; j < mol.getConnAtoms(next); j++) {
                    if (mol.getAtomicNo(mol.getConnAtom(next, j)) === 8 && mol.getBondOrder(mol.getConnBond(next, j)) === 2) return 'OC(=O)R';
                }
                return 'OR';
            }
        }
        return 'OH';
    }
    if (z === 6) { 
        let isCarbonyl = false, hasOH = false;
        for (let i = 0; i < mol.getConnAtoms(sub); i++) {
            const next = mol.getConnAtom(sub, i);
            if (mol.getAtomicNo(next) === 8) {
                if (mol.getBondOrder(mol.getConnBond(sub, i)) === 2) isCarbonyl = true;
                if (mol.getBondOrder(mol.getConnBond(sub, i)) === 1) hasOH = true;
            }
        }
        if (isCarbonyl) return hasOH ? 'COOH' : 'C(=O)R';
        return 'alkyl';
    }
    if (z === 7) { 
        for (let i = 0; i < mol.getConnAtoms(sub); i++) {
            const next = mol.getConnAtom(sub, i);
            if (mol.getAtomicNo(next) === 8 && mol.getBondOrder(mol.getConnBond(sub, i)) === 2) return 'NO2';
        }
        return 'NH2';
    }
    if ([9, 17, 35, 53].includes(z)) return 'Halogen';
    return 'alkyl';
}

function estimateOxygenProton(mol: OCL.Molecule, host: number): number {
    for (let i = 0; i < mol.getConnAtoms(host); i++) {
        const neighbor = mol.getConnAtom(host, i);
        if (mol.getAtomicNo(neighbor) === 6) {
            for (let j = 0; j < mol.getConnAtoms(neighbor); j++) {
                const next = mol.getConnAtom(neighbor, j);
                if (mol.getAtomicNo(next) === 8 && mol.getBondOrder(mol.getConnBond(neighbor, j)) === 2) return 11.5; 
            }
            if (mol.isAromaticAtom(neighbor)) return 5.0; 
        }
    }
    return 2.0; 
}

function computeProtonMultiplet(mol: OCL.Molecule, host: number): { mult: string, jHz: number } {
    let equivalentPartners = 0, mainJ = 0;
    for (let i = 0; i < mol.getConnAtoms(host); i++) {
        const neighbor = mol.getConnAtom(host, i);
        if (mol.getAtomicNo(neighbor) !== 6) continue;
        const hydrogens = mol.getAllHydrogens(neighbor);
        if (hydrogens > 0) {
            equivalentPartners += hydrogens;
            mainJ = (mol.isAromaticAtom(host) && mol.isAromaticAtom(neighbor)) ? J_AROMATIC_ORTHO : J_VICINAL;
        }
    }
    const NAMES: Record<number, string> = { 0: 's', 1: 'd', 2: 't', 3: 'q', 4: 'quint', 5: 'sext', 6: 'sept' };
    return { mult: NAMES[equivalentPartners] || 'm', jHz: mainJ };
}

function estimateCarbonShift(mol: OCL.Molecule, atom: number): number {
    let maxOxygenOrder = 0, oxygenCount = 0;
    for (let i = 0; i < mol.getConnAtoms(atom); i++) {
        const neighbor = mol.getConnAtom(atom, i);
        if (mol.getAtomicNo(neighbor) === 8) {
            oxygenCount++;
            maxOxygenOrder = Math.max(maxOxygenOrder, mol.getBondOrder(mol.getConnBond(atom, i)));
        }
    }

    if (maxOxygenOrder === 2) { 
        if (oxygenCount >= 2) return 172; 
        return mol.getAllHydrogens(atom) === 1 ? 192 : 205; 
    }
    if (mol.isAromaticAtom(atom)) {
        if (oxygenCount > 0) return 155;
        let bondedToCarbonyl = false;
        for (let i = 0; i < mol.getConnAtoms(atom); i++) {
             const neighbor = mol.getConnAtom(atom, i);
             if (mol.getAtomicNo(neighbor) === 6) {
                 for (let j = 0; j < mol.getConnAtoms(neighbor); j++) {
                     if (mol.getAtomicNo(mol.getConnAtom(neighbor, j)) === 8 && mol.getBondOrder(mol.getConnBond(neighbor, j)) === 2) bondedToCarbonyl = true;
                 }
             }
        }
        if (bondedToCarbonyl) return 130;
        return 125;
    }
    
    let maxCarbonOrder = 1;
    for (let i = 0; i < mol.getConnAtoms(atom); i++) {
        if (mol.getAtomicNo(mol.getConnAtom(atom, i)) === 6) maxCarbonOrder = Math.max(maxCarbonOrder, mol.getBondOrder(mol.getConnBond(atom, i)));
    }
    if (maxCarbonOrder === 3) return 80;  
    if (maxCarbonOrder === 2) return 125; 
    if (oxygenCount > 0) return 55; 
    return 21; 
}

function generateSpectrumData(peaks: PredictedPeak[], nucleus: string, smiles: string, sf: number): SpecData {
    const npoints = 16384;
    const buffer = nucleus === '13C' ? 20 : 1.5;
    const maxShift = peaks.length > 0 ? Math.max(...peaks.map(p => p.shift)) + buffer : 10;
    const minShift = peaks.length > 0 ? Math.min(...peaks.map(p => p.shift)) - buffer : 0;
    
    const offset = maxShift; 
    const sw_p = offset - minShift;
    const intensities = new Float64Array(npoints);
    const rawPpms = new Float64Array(npoints);

    for (let i = 0; i < npoints; i++) {
        rawPpms[i] = offset - (i / (npoints - 1)) * sw_p;
        intensities[i] = (Math.random() - 0.5) * 0.02; 
    }

    peaks.forEach(p => {
        // ... (Line-broadening logic remains exactly the same as previously provided) ...
        const jPpm = (p as any).jHz / sf; 
        const baseW = nucleus === '13C' ? 0.05 : 0.0025; 
        let subPeaks: {ppm: number, int: number}[] = [];

        if (p.mult.includes('s')) subPeaks = [{ppm: p.shift, int: 1}];
        else if (p.mult.includes('d')) subPeaks = [{ppm: p.shift - jPpm/2, int: 1}, {ppm: p.shift + jPpm/2, int: 1}];
        else if (p.mult.includes('t')) subPeaks = [{ppm: p.shift - jPpm, int: 1}, {ppm: p.shift, int: 2}, {ppm: p.shift + jPpm, int: 1}];
        else if (p.mult.includes('q')) subPeaks = [{ppm: p.shift - 1.5*jPpm, int: 1}, {ppm: p.shift - 0.5*jPpm, int: 3}, {ppm: p.shift + 0.5*jPpm, int: 3}, {ppm: p.shift + 1.5*jPpm, int: 1}];
        else { subPeaks = [{ppm: p.shift, int: 1}]; }

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
    
    return { 
        type: 'NMR', nucleus, solvent: 'Simulation', title: `SMILES: ${smiles}`, 
        sf, sw_p, offset, rawPpms, intensities, pointsToRead: npoints, maxInt,
        smiles, predictedPeaks: peaks // Attach peaks and smiles here!
    };
}

// --- MASS SPEC / ISOTOPIC ENVELOPE SIMULATOR ---
export function predictMSFromSMILES(smiles: string, adduct: string = "[M+H]+"): SpecData {
    const mol = OCL.Molecule.fromSmiles(smiles);
    const formula = mol.getMolecularFormula();
    const exactMass = formula.absoluteWeight; 

    // Adducts
    let mz = exactMass;
    if (adduct === "[M+H]+") mz += 1.007276;
    else if (adduct === "[M+Na]+") mz += 22.989218;
    else if (adduct === "[M-H]-") mz -= 1.007276;

    // Simple isotopic distribution (M, M+1, M+2, M+4)
    const cCount = countElements(mol, 6);
    const clCount = countElements(mol, 17);
    const brCount = countElements(mol, 35);
    const sCount = countElements(mol, 16);

    const xs: number[] = [];
    const ys: number[] = [];

    // M peak (100% relative)
    xs.push(mz); ys.push(100);

    // M+1
    const m1 = cCount * 1.1; 
    if (m1 > 0.1) { xs.push(mz + 1.003); ys.push(m1); }

    // M+2 (Cl 32%, Br 97.3%, S 4.5%)
    const m2 = (clCount * 32.0) + (brCount * 97.3) + (sCount * 4.5);
    if (m2 > 0.1) { xs.push(mz + 1.997); ys.push(m2); }

    // M+4
    const m4 = (clCount > 1 ? 10.2 : 0) + (brCount > 1 ? 23.6 : 0) + ((clCount > 0 && brCount > 0) ? 31.1 : 0);
    if (m4 > 0.1) { xs.push(mz + 3.994); ys.push(m4); }

    return {
        type: 'MS',
        title: `${formula.formula} ${adduct}`,
        xs: new Float64Array(xs),
        ys: new Float64Array(ys),
        npoints: xs.length,
        maxInt: 100,
        smiles: smiles
    };
}

function countElements(mol: OCL.Molecule, atomicNo: number): number {
    let count = 0;
    for (let i = 0; i < mol.getAllAtoms(); i++) if (mol.getAtomicNo(i) === atomicNo) count++;
    return count;
}


// --- INFRARED (FT-IR) SIMULATOR ---
export function predictIRFromSMILES(smiles: string): SpecData {
    const mol = OCL.Molecule.fromSmiles(smiles);
    mol.addImplicitHydrogens();
    
    // Define IR absorptions: [Wavenumber (cm-1), Intensity (0-1), Width (broadness)]
    const bands: { wn: number, intensity: number, width: number }[] = [];

    // Basic functional group heuristics
    for (let i = 0; i < mol.getAllAtoms(); i++) {
        const z = mol.getAtomicNo(i);
        
        if (z === 8) {
            let isCarbonyl = false;
            for (let j = 0; j < mol.getConnAtoms(i); j++) {
                if (mol.getBondOrder(mol.getConnBond(i, j)) === 2) isCarbonyl = true;
            }
            if (isCarbonyl) bands.push({ wn: 1715 + (Math.random()*30-15), intensity: 0.95, width: 25 }); // C=O
            if (mol.getAllHydrogens(i) > 0) bands.push({ wn: 3300 + (Math.random()*200-100), intensity: 0.85, width: 150 }); // O-H (Broad)
        }
        
        if (z === 7 && mol.getAllHydrogens(i) > 0) {
            bands.push({ wn: 3400, intensity: 0.6, width: 40 }); // N-H
        }

        if (z === 6) {
            if (mol.getAllHydrogens(i) > 0) {
                if (mol.isAromaticAtom(i)) bands.push({ wn: 3050, intensity: 0.4, width: 20 }); // sp2 C-H
                else bands.push({ wn: 2950, intensity: 0.7, width: 30 }); // sp3 C-H
            }
            
            let maxOrder = 1;
            let hasNitrogen = false;
            for (let j = 0; j < mol.getConnAtoms(i); j++) {
                maxOrder = Math.max(maxOrder, mol.getBondOrder(mol.getConnBond(i, j)));
                if (mol.getAtomicNo(mol.getConnAtom(i, j)) === 7) hasNitrogen = true;
            }
            
            if (maxOrder === 3 && hasNitrogen) bands.push({ wn: 2250, intensity: 0.8, width: 15 }); // C#N
            if (maxOrder === 3 && !hasNitrogen) bands.push({ wn: 2150, intensity: 0.3, width: 15 }); // C#C
            if (maxOrder === 2 && !mol.isAromaticAtom(i)) bands.push({ wn: 1650, intensity: 0.5, width: 20 }); // C=C
            if (mol.isAromaticAtom(i)) {
                bands.push({ wn: 1600, intensity: 0.6, width: 15 }); // Aromatic C=C
                bands.push({ wn: 1500, intensity: 0.6, width: 15 }); 
            }
        }
    }

    // Generate Transmittance curve (4000 to 400 cm-1)
    const npoints = 4000;
    const xs = new Float64Array(npoints);
    const ys = new Float64Array(npoints);
    
    for (let i = 0; i < npoints; i++) {
        xs[i] = 4000 - (i / (npoints - 1)) * 3600; // 4000 to 400
        ys[i] = 1.0 - (Math.random() * 0.02); // Baseline transmittance ~ 100%
    }

    bands.forEach(b => {
        for (let i = 0; i < npoints; i++) {
            const dx = xs[i] - b.wn;
            // Add Lorentzian absorption dip
            ys[i] -= b.intensity * (b.width * b.width) / (dx * dx + b.width * b.width);
        }
    });

    return { type: 'IR', title: `Simulated IR: ${smiles}`, xs, ys, npoints, minInt: 0, maxInt: 1.1 };
}