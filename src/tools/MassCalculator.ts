export interface Adduct {
    name: string;
    massDelta: number;
    charge: number;
}

export const COMMON_ADDUCTS_POS: Adduct[] = [
    { name: "[M+H]+", massDelta: 1.007276, charge: 1 },
    { name: "[M+Na]+", massDelta: 22.989218, charge: 1 },
    { name: "[M+K]+", massDelta: 38.963158, charge: 1 },
    { name: "[M+NH4]+", massDelta: 18.033823, charge: 1 },
    { name: "[2M+H]+", massDelta: 1.007276, charge: 1 } // dimer
];

export const COMMON_ADDUCTS_NEG: Adduct[] = [
    { name: "[M-H]-", massDelta: -1.007276, charge: 1 },
    { name: "[M+Cl]-", massDelta: 34.969402, charge: 1 },
    { name: "[M+FA-H]-", massDelta: 44.998201, charge: 1 } // Formate adduct
];

export class MassCalculator {
    // Monoisotopic atomic weights
    private static ATOMIC_WEIGHTS: Record<string, number> = {
        H: 1.007825,
        C: 12.000000,
        N: 14.003074,
        O: 15.994915,
        F: 18.998403,
        P: 30.973762,
        S: 31.972071,
        Cl: 34.968853,
        Br: 78.918338,
        I: 126.904473
    };

    public static parseFormula(formula: string): Record<string, number> {
        const regex = /([A-Z][a-z]*)(\d*)/g;
        let match;
        const composition: Record<string, number> = {};
        while ((match = regex.exec(formula)) !== null) {
            if (!match[1]) continue;
            const element = match[1];
            const count = match[2] ? parseInt(match[2], 10) : 1;
            composition[element] = (composition[element] || 0) + count;
        }
        return composition;
    }

    public static calculateExactMass(formula: string): number {
        const comp = this.parseFormula(formula);
        let mass = 0;
        for (const [el, count] of Object.entries(comp)) {
            if (!this.ATOMIC_WEIGHTS[el]) throw new Error(`Unknown element: ${el}`);
            mass += this.ATOMIC_WEIGHTS[el] * count;
        }
        return mass;
    }

    public static calculatePpmError(observedMZ: number, theoreticalMZ: number): number {
        return ((observedMZ - theoreticalMZ) / theoreticalMZ) * 1e6;
    }
}