export interface WellData {
    well: string; // e.g. "A1", "C4"
    conversion: number; // 0 to 100%
    productArea?: number;
    selected?: boolean;
}

export class PlateRenderer {
    public static render96Well(
        canvas: HTMLCanvasElement,
        data: Map<string, WellData>,
        onSelectWell: (well: string) => void
    ) {
        const ctx = canvas.getContext("2d")!;
        const dpr = window.devicePixelRatio || 1;
        const rows = ["A", "B", "C", "D", "E", "F", "G", "H"];
        const cols = 12;

        const cellW = 16;
        const cellH = 16;
        const gap = 3;

        canvas.width = (cols * (cellW + gap) + 30) * dpr;
        canvas.height = (rows.length * (cellH + gap) + 30) * dpr;
        ctx.scale(dpr, dpr);

        rows.forEach((row, rIdx) => {
            for (let c = 1; c <= cols; c++) {
                const wellId = `${row}${c}`;
                const x = 20 + (c - 1) * (cellW + gap);
                const y = 20 + rIdx * (cellH + gap);

                const info = data.get(wellId);
                const conv = info ? info.conversion : 0;

                // Color scale from cold teal to rich green / amber
                if (info?.selected) {
                    ctx.fillStyle = "#0284c7"; // Selected well
                } else if (conv > 0) {
                    ctx.fillStyle = `rgba(16, 185, 129, ${Math.max(0.2, conv / 100)})`; // Conversion gradient
                } else {
                    ctx.fillStyle = "#f1f5f9"; // Empty well
                }

                ctx.fillRect(x, y, cellW, cellH);
                ctx.strokeStyle = info?.selected ? "#0369a1" : "rgba(203, 213, 225, 0.6)";
                ctx.strokeRect(x, y, cellW, cellH);
            }
        });
    }
}