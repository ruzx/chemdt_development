export interface TLCSpot {
    rf: number; // 0.0 to 1.0
    intensity?: number; // 0 to 1
    color?: string; // override color
    tailing?: number;
}

export interface TLCLane {
    name: string;
    spots: TLCSpot[];
}

export class TLCRenderer {
    public static renderPlate(container: HTMLElement, lanes: TLCLane[], solvent: string, stain: string) {
        const wrapper = container.createDiv({ cls: "chemspec-tlc-container" });
        const canvas = wrapper.createEl("canvas");
        const ctx = canvas.getContext("2d")!;
        const dpr = window.devicePixelRatio || 1;

        const w = Math.max(180, lanes.length * 60 + 40);
        const h = 260;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx.scale(dpr, dpr);

        // Plate Background (Silica gel look with subtle gradient)
        const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
        if (stain === "UV 254") {
            bgGrad.addColorStop(0, "#86efac"); // Green fluorescence under 254 nm
            bgGrad.addColorStop(1, "#4ade80");
        } else if (stain === "KMnO4") {
            bgGrad.addColorStop(0, "#fbcfe8"); // Pink permanganate background
            bgGrad.addColorStop(1, "#f472b6");
        } else {
            bgGrad.addColorStop(0, "#f8fafc"); // Standard white silica
            bgGrad.addColorStop(1, "#f1f5f9");
        }
        ctx.fillStyle = bgGrad;
        ctx.roundRect(10, 10, w - 20, h - 20, 6);
        ctx.fill();
        ctx.strokeStyle = "#cbd5e1";
        ctx.stroke();

        const baselineY = h - 35;
        const frontY = 30;

        // Origin and Solvent Front Lines (pencil line look)
        ctx.strokeStyle = "rgba(71, 85, 105, 0.6)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 2]);
        ctx.beginPath();
        ctx.moveTo(20, baselineY);
        ctx.lineTo(w - 20, baselineY); // Baseline
        ctx.moveTo(20, frontY);
        ctx.lineTo(w - 20, frontY); // Solvent Front
        ctx.stroke();
        ctx.setLineDash([]);

        // Solvent Front Text
        ctx.fillStyle = "#64748b";
        ctx.font = "9px sans-serif";
        ctx.fillText("Front", w - 48, frontY - 4);
        ctx.fillText("Origin", w - 48, baselineY + 12);

        // Draw Lanes and Spots
        const spacing = (w - 60) / (lanes.length + 1);
        lanes.forEach((lane, i) => {
            const laneX = 40 + (i + 1) * spacing;

            // Lane label at bottom
            ctx.fillStyle = "#1e293b";
            ctx.font = "600 11px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(lane.name, laneX, h - 12);

            // Spots
            lane.spots.forEach(spot => {
                const spotY = baselineY - spot.rf * (baselineY - frontY);
                const radiusX = 10;
                const radiusY = 6 + (spot.tailing ? spot.tailing * 30 : 0);

                ctx.beginPath();
                ctx.ellipse(laneX, spotY, radiusX, radiusY, 0, 0, 2 * Math.PI);

                // Spot color based on stain
                if (stain === "UV 254") {
                    ctx.fillStyle = "rgba(15, 23, 42, 0.75)"; // Dark quenching spot
                } else if (stain === "KMnO4") {
                    ctx.fillStyle = "rgba(254, 240, 138, 0.9)"; // Yellow oxidizable spot
                } else {
                    ctx.fillStyle = spot.color || "rgba(71, 85, 105, 0.75)";
                }
                ctx.fill();

                // Rf badge on hover or side
                ctx.fillStyle = "#334155";
                ctx.font = "9px monospace";
                ctx.textAlign = "left";
                ctx.fillText(`Rf ${spot.rf.toFixed(2)}`, laneX + 13, spotY + 3);
            });
        });
    }
}