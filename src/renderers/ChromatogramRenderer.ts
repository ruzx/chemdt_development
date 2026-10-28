export interface PeakIntegral {
    id: string;
    label: string;
    retentionTime: number; // in minutes
    startRT: number;
    endRT: number;
    area: number;
    relativeAreaPercent: number;
    color: string; // e.g. '#3b82f6'
}

export interface TraceData {
    name: string; // e.g. "UV 254 nm" or "MS ES+ EIC"
    times: number[];
    intensities: number[];
    integrals?: PeakIntegral[];
}

export class ChromatogramRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private dpr: number;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        this.dpr = window.devicePixelRatio || 1;
    }

    public render(trace: TraceData, width: number, height: number, rangeX: [number, number], maxY: number) {
        this.canvas.width = width * this.dpr;
        this.canvas.height = height * this.dpr;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;

        const ctx = this.ctx;
        ctx.scale(this.dpr, this.dpr);
        ctx.clearRect(0, 0, width, height);

        const padLeft = 60, padRight = 30, padTop = 30, padBottom = 35;
        const plotW = width - padLeft - padRight;
        const plotH = height - padTop - padBottom;

        const toScreenX = (t: number) => padLeft + ((t - rangeX[0]) / (rangeX[1] - rangeX[0])) * plotW;
        const toScreenY = (v: number) => padTop + plotH - (v / maxY) * plotH;

        // 1. Draw Grid Lines (Subtle Obsidian theme aware)
        ctx.strokeStyle = "rgba(128, 128, 128, 0.15)";
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const y = padTop + (plotH / 5) * i;
            ctx.beginPath();
            ctx.moveTo(padLeft, y);
            ctx.lineTo(padLeft + plotW, y);
            ctx.stroke();
        }

        // 2. Draw Elsci-Style Shaded Integrals
        if (trace.integrals) {
            trace.integrals.forEach(peak => {
                const pStartIndex = trace.times.findIndex(t => t >= peak.startRT);
                const pEndIndex = trace.times.findIndex(t => t >= peak.endRT);
                if (pStartIndex === -1 || pEndIndex === -1) return;

                // Fill polygon under peak
                ctx.beginPath();
                ctx.moveTo(toScreenX(trace.times[pStartIndex]), toScreenY(0));
                for (let i = pStartIndex; i <= pEndIndex; i++) {
                    ctx.lineTo(toScreenX(trace.times[i]), toScreenY(trace.intensities[i]));
                }
                ctx.lineTo(toScreenX(trace.times[pEndIndex]), toScreenY(0));
                ctx.closePath();

                // Semi-transparent fill
                ctx.fillStyle = this.hexToRgba(peak.color, 0.35);
                ctx.fill();

                // Peak boundaries (Drop lines)
                ctx.strokeStyle = this.hexToRgba(peak.color, 0.8);
                ctx.lineWidth = 1.2;
                ctx.setLineDash([3, 2]);

                ctx.beginPath();
                ctx.moveTo(toScreenX(peak.startRT), toScreenY(0));
                ctx.lineTo(toScreenX(peak.startRT), toScreenY(trace.intensities[pStartIndex]));
                ctx.moveTo(toScreenX(peak.endRT), toScreenY(0));
                ctx.lineTo(toScreenX(peak.endRT), toScreenY(trace.intensities[pEndIndex]));
                ctx.stroke();
                ctx.setLineDash([]); // Reset dash

                // 3. Floating Peak Diagnostic Badge (Elsci style)
                this.renderPeakBadge(
                    ctx,
                    peak.label,
                    peak.retentionTime,
                    peak.area,
                    peak.relativeAreaPercent,
                    toScreenX(peak.retentionTime),
                    toScreenY(Math.max(...trace.intensities.slice(pStartIndex, pEndIndex)))
                );
            });
        }

        // 4. Draw Main Chromatographic Trace
        ctx.beginPath();
        ctx.strokeStyle = "#1e293b"; // or var(--text-normal)
        ctx.lineWidth = 1.6;
        for (let i = 0; i < trace.times.length; i++) {
            const x = toScreenX(trace.times[i]);
            const y = toScreenY(trace.intensities[i]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 5. Draw Axes
        ctx.strokeStyle = "rgba(128, 128, 128, 0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padLeft, padTop + plotH);
        ctx.lineTo(padLeft + plotW, padTop + plotH);
        ctx.stroke();
    }

    private renderPeakBadge(
        ctx: CanvasRenderingContext2D,
        label: string,
        rt: number,
        area: number,
        areaPct: number,
        x: number,
        y: number
    ) {
        ctx.save();
        const badgeW = 95;
        const badgeH = 34;
        const badgeX = x - badgeW / 2;
        const badgeY = Math.max(10, y - badgeH - 12);

        // Leader line
        ctx.strokeStyle = "rgba(100, 116, 139, 0.5)";
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, badgeY + badgeH);
        ctx.stroke();
        ctx.setLineDash([]);

        // Card Box
        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.shadowColor = "rgba(0, 0, 0, 0.08)";
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
        ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
        ctx.strokeStyle = "rgba(226, 232, 240, 0.8)";
        ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);

        // Text
        ctx.shadowColor = "transparent";
        ctx.fillStyle = "#0f172a";
        ctx.font = "600 10px sans-serif";
        ctx.fillText(label, badgeX + 6, badgeY + 12);

        ctx.fillStyle = "#64748b";
        ctx.font = "400 9px monospace";
        ctx.fillText(`RT: ${rt.toFixed(2)} min`, badgeX + 6, badgeY + 22);
        ctx.fillText(`Area: ${areaPct.toFixed(1)}%`, badgeX + 6, badgeY + 31);
        ctx.restore();
    }

    private hexToRgba(hex: string, alpha: number): string {
        const r = parseInt(hex.slice(1, 3), 16) || 0;
        const g = parseInt(hex.slice(3, 5), 16) || 0;
        const b = parseInt(hex.slice(5, 7), 16) || 0;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
}