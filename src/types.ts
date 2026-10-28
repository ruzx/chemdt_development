export interface ChemSpecSettings {
    canvasHeight: number;
    lineColor: string;
    integralColor: string;
    multipletColor: string;
    peakColor: string;
    lineWidth: number;
    numTicks: number;
    ppmDecimals: number;
    showMetadata: boolean;
    showSolventLines: boolean;
    pdataSubpath: string;
    saveFolder: string;
    hotkeyPan: string;
    hotkeyZoom: string;
    hotkeyIntegrate: string;
    hotkeyMultiplet: string;
    hotkeyPeak: string;
    defaultNmrRangeMax: number;
    defaultNmrRangeMin: number;
    supportedExtensions: string;
}

export interface PredictedPeak {
    shift: number;
    atoms: number[];
    mult: string;
    integral: number;
}




export interface UserMultiplet {
    startPpm: number;
    endPpm: number;
    peaks: { ppm: number; intensity: number; index: number }[];
    centerPpm: number;
    multiplicity: string;
    jCouplings: number[];
    integral: number;
    normalizedIntegral: number;
    lIndex: number;
    rIndex: number;
}

export interface UserIntegral {
    startPpm: number;
    endPpm: number;
    lIdx: number;
    rIdx: number;
    sum: number;
    norm: number;
}

export interface PeakIntegralData {
    id: string;
    label: string;
    retentionTime: number;
    startRT: number;
    endRT: number;
    area: number;
    relativeAreaPercent: number;
    color: string;
}

export interface ChromatogramTrace {
    name: string;
    times: Float64Array;
    intensities: Float64Array;
    maxInt: number;
    integrals: PeakIntegralData[];
}

export interface TLCSpot {
    rf: number;
    intensity?: number;
    color?: string;
    tailing?: number;
}

export interface TLCLane {
    name: string;
    spots: TLCSpot[];
}

export interface SpecData {
    type: string;
    title?: string;
    nucleus?: string;
    solvent?: string;
    sf?: number;
    sw_p?: number;
    offset?: number;
    rawPpms?: Float64Array;
    intensities?: Float64Array;
    pointsToRead?: number;
    maxInt?: number;
    minInt?: number;
    xs?: Float64Array;
    ys?: Float64Array;
    npoints?: number;
    scanRate?: number;
    cycleBreaks?: number[];
    traces?: ChromatogramTrace[];
	smiles?: string;
    predictedPeaks?: PredictedPeak[];
    stacked?: SpecData[];
}






export interface SavedState {
    ppmShift?: number;
    multiplets?: UserMultiplet[];
    integrals?: UserIntegral[];
    peaks?: number[];
    viewOffsetPpm?: number;
    viewWidthPpm?: number;
    yScale?: number;
    baselineOffset?: number;
    phase0?: number;
    phase1?: number;
    baselineFlattened?: boolean;
}

export interface NmrParsedData {
    nucleus?: string;
    solvent?: string;
    sf?: number;
    sw_p?: number;
    offset?: number;
    rawPpms?: number[];
    intensities?: number[];
    maxInt?: number;
    ppmShift?: number;
    multiplets?: UserMultiplet[];
    integrals?: UserIntegral[];
    peaks?: number[];
    viewOffsetPpm?: number;
    viewWidthPpm?: number;
    yScale?: number;
    baselineOffset?: number;
    phase0?: number;
    phase1?: number;
    baselineFlattened?: boolean;
}

export interface SpectrumLoadResult {
    specData: SpecData;
    savedState: SavedState | null;
    saveTarget: string;
    resolvedPath: string;
}

export const SOLVENT_PEAKS: Record<string, number> = {
    'CDCl3': 7.26,
    'DMSO': 2.50,
    'CD3OD': 3.31,
    'CD3CN': 1.94,
    'Acetone': 2.05,
    'D2O': 4.79,
    'Benzene': 7.16
};