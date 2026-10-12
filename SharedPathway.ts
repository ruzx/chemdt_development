// SharedPathway.ts
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises */

import { App, TFile, MarkdownView, Notice, Modal } from 'obsidian';
import { CreateExperimentModal, CloneExperimentModal } from './SharedEln';

interface GraphNode {
    id: string;          
    type: 'smiles' | 'eln' | 'text';
    label: string;
    smiles: string;
    data?: any;          
    rank: number;
    color?: string;      
    el?: HTMLElement;    
    rawToken?: string;   
}

interface GraphEdge {
    source: string; 
    target: string;
    color?: string;      
}

const PATH_COLORS = [
    "#4e79a7", "#f28e2c", "#e15759", "#76b7b2", "#59a14f",
    "#edc949", "#af7aa1", "#ff9da7", "#9c755f", "#bab0ab"
];

export class SynthesisMapRenderer {
    plugin: any;

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    async renderMap(source: string, el: HTMLElement, ctx: any) {
        const pathLine = source.split('\n').find(l => l.trim().startsWith('path:'));
        let folderPath = pathLine ? pathLine.replace('path:', '').trim() : "";
        
        const projectLine = source.split('\n').find(l => l.trim().startsWith('project:'));
        const targetProject = projectLine ? projectLine.replace('project:', '').trim() : "";

        if (!folderPath) {
            const activeFile = this.plugin.app.workspace.getActiveFile();
            if (activeFile && activeFile.parent) folderPath = activeFile.parent.path === "/" ? "" : activeFile.parent.path;
        }

        const folder = folderPath === "" ? this.plugin.app.vault.getRoot() : this.plugin.app.vault.getAbstractFileByPath(folderPath);
        if (!folder || !('children' in folder)) { 
            const err = el.createDiv();
            err.setText(`⚠️ Folder not found: ${folderPath || "Root Vault"}`);
            err.addClass("color-text-error");
            return; 
        }

        const files = (folder as any).children.filter((f: any) => f instanceof TFile && f.extension.toLowerCase() === 'md');
        const mapTitle = targetProject ? `🗺️ Synthesis Map: ${targetProject}` : "🗺️ Synthesis Map";
        const wrapper = this.createBaseWrapper(el, folderPath, mapTitle, false, ctx);
        const container = wrapper.querySelector('.chem-pathway-grid') as HTMLElement;
        
        container.setCssStyles({ flexDirection: "column", alignItems: "stretch", gap: "15px" });

        let renderedCount = 0;

        for (const file of files) {
            const exp = await this.fetchChemicalData(file);
            if (!exp || exp.type !== 'eln') continue;

            if (targetProject && exp.data?.project !== targetProject) continue;

            const reactantSmi = exp.data?.reactants?.[0]?.smiles || "";
            const productSmi = exp.data?.products?.[0]?.smiles || "";
            const yieldNum = parseFloat(exp.data?.products?.[0]?.yield);
            const yieldStr = isNaN(yieldNum) ? 'N/A' : `${yieldNum}%`;
            const code = exp.data?.code || file.basename;

            if (!reactantSmi && !productSmi) continue;
            
            const color = PATH_COLORS[renderedCount % PATH_COLORS.length];
            renderedCount++;

            const rowWrapper = container.createDiv();
            rowWrapper.setCssStyles({ display: "flex", flexDirection: "row", flexWrap: "nowrap", alignItems: "center", justifyContent: "flex-start", gap: "25px", width: "100%", padding: "15px 25px", background: `linear-gradient(90deg, ${color}11, var(--background-primary) 30%)`, border: "1px solid var(--background-modifier-border)", borderLeft: `5px solid ${color}`, borderRadius: "8px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" });

            if (reactantSmi) this.drawChemicalNode(rowWrapper, reactantSmi, exp.data?.reactants?.[0]?.name || "Starting Material", null, null, null, undefined, false, undefined, undefined, color);

            const arrowWrapper = rowWrapper.createDiv({ cls: "chem-exp-node" });
            arrowWrapper.setAttribute("data-search", `${code} ${productSmi} ${reactantSmi} ${exp.data?.project || ''}`.toLowerCase());
            arrowWrapper.setCssStyles({ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s ease", padding: "15px", borderRadius: "6px", border: "1px solid transparent", minWidth: "100px" });
            
            const badgeColor = yieldNum >= 80 ? 'var(--text-success)' : yieldNum <= 30 ? 'var(--text-error)' : 'var(--text-warning)';
            
            const codeDiv = arrowWrapper.createDiv();
            codeDiv.setText(code);
            codeDiv.setCssStyles({ fontSize: "11px", color: "var(--text-accent)", fontWeight: "700", background: "var(--background-primary)", padding: "4px 10px", borderRadius: "12px", border: "1px solid var(--background-modifier-border)", boxShadow: "0 1px 2px rgba(0,0,0,0.05)", textAlign: "center" });
            
            const arrowDiv = arrowWrapper.createDiv();
            arrowDiv.setText("⟶");
            arrowDiv.setCssStyles({ fontSize: "20px", color: color, lineHeight: "1", margin: "8px 0", textAlign: "center" });
            
            const yieldDiv = arrowWrapper.createDiv();
            yieldDiv.setText(yieldStr);
            yieldDiv.setCssStyles({ fontSize: "12px", color: badgeColor, fontWeight: "800", textAlign: "center" });
            
            if (exp.data?.project) {
                const projDiv = arrowWrapper.createDiv();
                projDiv.setText(exp.data.project);
                projDiv.setCssStyles({ fontSize: "9px", color: "var(--text-muted)", textTransform: "uppercase", marginTop: "6px", letterSpacing: "0.5px" });
            }
            
            arrowWrapper.onmouseover = () => { arrowWrapper.setCssStyles({ backgroundColor: "var(--background-modifier-hover)", borderColor: "var(--interactive-accent)", transform: "scale(1.02)" }); };
            arrowWrapper.onmouseout = () => { arrowWrapper.setCssStyles({ backgroundColor: "transparent", borderColor: "transparent", transform: "scale(1)" }); };
            arrowWrapper.onclick = () => this.plugin.app.workspace.getLeaf(false).openFile(file);

            if (productSmi) this.drawChemicalNode(rowWrapper, productSmi, exp.data?.products?.[0]?.name || "Product", null, null, null, undefined, false, undefined, undefined, color);
        }

        if (renderedCount === 0) {
            container.empty();
            const msg = container.createSpan({ cls: "color-text-muted" });
            msg.setText("No experiments found matching these criteria.");
            msg.setCssStyles({ padding: "20px", fontStyle: "italic" });
        }
        this.attachSearchLogic(wrapper);
    }

    async renderPlan(source: string, el: HTMLElement, ctx: any) {
        const lines = source.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('path:') && !l.startsWith('project:'));
        
        const projectLine = source.split('\n').find(l => l.trim().startsWith('project:'));
        const targetProject = projectLine ? projectLine.replace('project:', '').trim() : "";
        const mapTitle = targetProject ? `🎯 Synthesis Plan: ${targetProject}` : "🎯 Synthesis Plan";

        const nodes = new Map<string, GraphNode>();
        const edges: GraphEdge[] = [];

        for (const line of lines) {
            const tokens = line.split(/\s*(?:->|=>)\s*/).filter(t => t.trim().length > 0);
            let prevId: string | null = null;

            for (const token of tokens) {
                const rawToken = token.trim();
                const linkMatch = rawToken.match(/\[\[(.*?)\]\]/);
                let currentId = rawToken;

                if (!nodes.has(currentId)) {
                    let type: 'eln' | 'smiles' | 'text' = 'text';
                    let label = rawToken;
                    let smiles = '';
                    let data = null;

                    if (linkMatch) {
                        const cleanName = linkMatch[1].split('|')[0].trim(); 
                        const alias = linkMatch[1].includes('|') ? linkMatch[1].split('|')[1].trim() : null;

                        let file = this.plugin.app.metadataCache.getFirstLinkpathDest(cleanName, ctx.sourcePath);
                        if (!file) file = this.plugin.app.vault.getMarkdownFiles().find((f: TFile) => f.basename === cleanName || f.name === cleanName);

                        if (file) {
                            const exp = await this.fetchChemicalData(file);
                            if (exp && exp.smiles) {
                                type = exp.type; smiles = exp.smiles; data = exp.data;
                                label = alias ? alias : (exp.type === 'eln' ? (exp.data?.code || file.basename) : file.basename);
                                currentId = file.path; 
                            } else { label = `[No Structure: ${cleanName}]`; }
                        } else { label = `[Missing Note: ${cleanName}]`; }
                    } else if (rawToken.includes('|')) {
                        const parts = rawToken.split('|');
                        type = 'smiles'; smiles = parts[0].trim(); label = parts[1].trim();
                    } else {
                        const isSmiles = /^[A-Za-z0-9@+\-\[\]\(\)\\\/=#%\.]+$/.test(rawToken) && /[A-Za-z]/.test(rawToken);
                        if (isSmiles) { 
                            type = 'smiles'; smiles = rawToken; 
                            label = rawToken.length > 15 ? `${rawToken.substring(0,12)}...` : rawToken; 
                        } else { type = 'text'; label = rawToken; }
                    }

                    if (!nodes.has(currentId)) nodes.set(currentId, { id: currentId, type, smiles, label, data, rank: 0, rawToken });
                }

                if (prevId) edges.push({ source: prevId, target: currentId });
                prevId = currentId;
            }
        }

        await this.renderDAG(el, nodes, edges, "", mapTitle, ctx, true);
    }

    private async renderDAG(el: HTMLElement, nodes: Map<string, GraphNode>, edges: GraphEdge[], folderPath: string, titleText: string, ctx: any, isInteractive: boolean = false) {
        
        let changed = true; let loops = 0;
        while (changed && loops < 100) {
            changed = false;
            edges.forEach(edge => {
                const sNode = nodes.get(edge.source); const tNode = nodes.get(edge.target);
                if (sNode && tNode && sNode.rank >= tNode.rank) { tNode.rank = sNode.rank + 1; changed = true; }
            });
            loops++;
        }

        let cIdx = 0;
        nodes.forEach(n => {
            if (n.rank === 0) { n.color = PATH_COLORS[cIdx % PATH_COLORS.length]; cIdx++; }
        });
        changed = true; loops = 0;
        while(changed && loops < 100) {
            changed = false;
            edges.forEach(e => {
                const sNode = nodes.get(e.source); const tNode = nodes.get(e.target);
                if (sNode && tNode && sNode.color) {
                    e.color = sNode.color; 
                    if (!tNode.color) { tNode.color = sNode.color; changed = true; }
                }
            });
            loops++;
        }
        nodes.forEach(n => { if (!n.color) { n.color = PATH_COLORS[cIdx % PATH_COLORS.length]; cIdx++; }});

        const wrapper = this.createBaseWrapper(el, folderPath, titleText, isInteractive, ctx);
        const scrollArea = wrapper.querySelector('.chem-pathway-grid') as HTMLElement;
        scrollArea.setCssStyles({ position: "relative", padding: "60px 80px" });

        if (nodes.size === 0) {
            scrollArea.empty();
            const emptyMsg = scrollArea.createDiv();
            emptyMsg.setText("Empty canvas. Use tools above or type connections (e.g., [[EXP-01]] -> C1=CC=CC=C1).");
            emptyMsg.setCssStyles({ padding: "20px", color: "var(--text-muted)", fontStyle: "italic" });
            return;
        }

        const graphContainer = scrollArea.createDiv();
        graphContainer.setCssStyles({ display: "flex", flexDirection: "row", gap: "80px", minWidth: "max-content", position: "relative" });
        
        const svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgOverlay.setAttribute('style', 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0;');
        
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        PATH_COLORS.forEach(c => {
            const hex = c.replace('#', '');
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', `arrow-${hex}`);
            marker.setAttribute('viewBox', '0 0 10 10');
            marker.setAttribute('refX', '8');
            marker.setAttribute('refY', '5');
            marker.setAttribute('markerWidth', '5');
            marker.setAttribute('markerHeight', '5');
            marker.setAttribute('orient', 'auto-start-reverse');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M 0 2 L 8 5 L 0 8 z');
            path.setAttribute('fill', c);
            marker.appendChild(path);
            defs.appendChild(marker);
        });
        svgOverlay.appendChild(defs);
        graphContainer.appendChild(svgOverlay);

        const columns: GraphNode[][] = [];
        nodes.forEach(n => { if (!columns[n.rank]) columns[n.rank] = []; columns[n.rank].push(n); });

        for (const col of columns) {
            if (!col) continue;
            const colDiv = graphContainer.createDiv();
            colDiv.setCssStyles({ display: "flex", flexDirection: "column", gap: "40px", justifyContent: "center", zIndex: "1" });
            
            for (const node of col) {
                if (node.type === 'eln') {
                    this.drawExperimentNode(colDiv, node, isInteractive, ctx, el, node.color);
                } else if (node.type === 'text') {
                    const nodeEl = colDiv.createDiv({ cls: "chem-exp-node" });
                    nodeEl.setAttribute("data-id", node.id);
                    nodeEl.setCssStyles({ display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(135deg, ${node.color}11, var(--background-primary))`, border: "1px solid var(--background-modifier-border)", borderLeft: `4px solid ${node.color}`, borderRadius: "12px", padding: "15px 25px", minWidth: "100px", fontWeight: "600", fontSize: "14px", color: "var(--text-normal)", textAlign: "center", wordBreak: "break-word", boxShadow: "0 4px 15px rgba(0,0,0,0.05)", zIndex: "2", position: "relative", transition: "transform 0.2s" });
                    nodeEl.setText(node.label);
                    node.el = nodeEl;
                    if (isInteractive) this.attachMindMapInteractions(nodeEl, node, ctx, el, graphContainer, svgOverlay);
                } else {
                    this.drawChemicalNode(colDiv, node.smiles, node.label, node.rawToken || null, ctx, el, node, isInteractive, graphContainer, svgOverlay, node.color);
                }
            }
        }

        const drawLines = () => {
            svgOverlay.setAttribute('style', `position: absolute; top: 0; left: 0; width: ${graphContainer.scrollWidth}px; height: ${graphContainer.scrollHeight}px; pointer-events: none; z-index: 0;`);
            Array.from(svgOverlay.querySelectorAll('path.chem-edge')).forEach(e => e.remove());

            const getRelativePos = (element: HTMLElement) => {
                let x = 0, y = 0; let curr: HTMLElement | null = element;
                while (curr && curr !== graphContainer) { x += curr.offsetLeft; y += curr.offsetTop; curr = curr.offsetParent as HTMLElement; }
                return { x, y, w: element.offsetWidth, h: element.offsetHeight };
            };

            edges.forEach(edge => {
                const sNode = nodes.get(edge.source); const tNode = nodes.get(edge.target);
                if (sNode?.el && tNode?.el) {
                    const sPos = getRelativePos(sNode.el); const tPos = getRelativePos(tNode.el);
                    const startX = sPos.x + sPos.w; const startY = sPos.y + (sPos.h / 2);
                    const endX = tPos.x - 8; const endY = tPos.y + (tPos.h / 2);

                    const dx = Math.max(Math.abs(endX - startX) * 0.5, 40);
                    const pathD = `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`;

                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    path.setAttribute('class', 'chem-edge');
                    path.setAttribute('d', pathD);
                    path.setAttribute('fill', 'none');
                    path.setAttribute('stroke', edge.color || 'var(--text-muted)');
                    path.setAttribute('stroke-width', '2.5'); 
                    path.setAttribute('stroke-linecap', 'round');
                    if (edge.color) path.setAttribute('marker-end', `url(#arrow-${edge.color.replace('#', '')})`);
                    svgOverlay.appendChild(path);
                }
            });
        };

        window.setTimeout(drawLines, 100); 
        new ResizeObserver(() => drawLines()).observe(wrapper);
        this.attachSearchLogic(wrapper);
    }

    private attachMindMapInteractions(nodeEl: HTMLElement, node: GraphNode, ctx: any, el: HTMLElement, graphContainer: HTMLElement, svgOverlay: SVGSVGElement) {
        const toolOverlay = nodeEl.createDiv();
        toolOverlay.setCssStyles({ position: "absolute", right: "-110px", top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: "4px", opacity: "0", transition: "opacity 0.2s", zIndex: "10" });
        nodeEl.addEventListener('mouseenter', () => toolOverlay.setCssStyles({ opacity: "1" }));
        nodeEl.addEventListener('mouseleave', () => toolOverlay.setCssStyles({ opacity: "0" }));

        const dragHandle = toolOverlay.createDiv({ attr: { title: "Drag to connect" } });
        dragHandle.setCssStyles({ width: "16px", height: "16px", background: node.color || 'var(--interactive-accent)', border: "3px solid var(--background-primary)", borderRadius: "50%", cursor: "crosshair", pointerEvents: "auto", boxShadow: "0 2px 4px rgba(0,0,0,0.2)" });
        
        const branchStructBtn = toolOverlay.createEl("button", { attr: { title: "Add Structure Branch" } });
        branchStructBtn.setCssStyles({ width: "24px", height: "24px", padding: "0", background: "var(--interactive-accent)", border: "none", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-on-accent)", fontSize: "12px", boxShadow: "0 2px 6px rgba(0,0,0,0.15)" });
        branchStructBtn.appendText("⬡");
        branchStructBtn.createSpan({ text: "+" }).setCssStyles({ fontSize: "8px" });
        branchStructBtn.onclick = (e) => {
            e.stopPropagation();
            this.plugin.openKetcherModal("", "smiles", (newData: string) => {
                this.updateMarkdownBlock(ctx, el, null, `\n${node.rawToken} -> ${newData}`);
            });
        };

        const branchTextBtn = toolOverlay.createEl("button", { attr: { title: "Add Text Branch" } });
        branchTextBtn.setCssStyles({ width: "24px", height: "24px", padding: "0", background: "var(--background-secondary-alt)", border: "1px solid var(--background-modifier-border)", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-normal)", fontSize: "11px", fontWeight: "bold", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" });
        branchTextBtn.appendText("T");
        branchTextBtn.createSpan({ text: "+" }).setCssStyles({ fontSize: "8px" });
        branchTextBtn.onclick = (e) => {
            e.stopPropagation();
            new TextPromptModal(this.plugin.app, "Add Text Note", "Enter text for the new branch", "", (txt) => {
                this.updateMarkdownBlock(ctx, el, null, `\n${node.rawToken} -> ${txt}`);
            }).open();
        };

        const editBtn = toolOverlay.createEl("button", { attr: { title: "Edit or Delete Node" } });
        editBtn.setCssStyles({ width: "24px", height: "24px", padding: "0", background: "var(--background-secondary-alt)", border: "1px solid var(--background-modifier-border)", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-normal)", fontSize: "12px", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" });
        editBtn.appendText("✏️");
        editBtn.onclick = (e) => {
            e.stopPropagation();
            new TextPromptModal(this.plugin.app, "Edit Node", "Change the link/text. Clear the input to delete this node.", node.rawToken || "", (newVal) => {
                this.updateMarkdownNodeText(ctx, el, node.rawToken!, newVal);
            }).open();
        };

        let isDragging = false;
        let tempPath: SVGPathElement | null = null;

        const getRelativeMousePos = (e: MouseEvent) => {
            const rect = graphContainer.getBoundingClientRect();
            return { x: e.clientX - rect.left + graphContainer.scrollLeft, y: e.clientY - rect.top + graphContainer.scrollTop };
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            const mousePos = getRelativeMousePos(e);
            let sx = 0, sy = 0; let curr: HTMLElement | null = nodeEl;
            while (curr && curr !== graphContainer) { sx += curr.offsetLeft; sy += curr.offsetTop; curr = curr.offsetParent as HTMLElement; }
            sx += nodeEl.offsetWidth; sy += nodeEl.offsetHeight / 2;

            const dx = Math.max(Math.abs(mousePos.x - sx) * 0.5, 30);
            const d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${mousePos.x - dx} ${mousePos.y}, ${mousePos.x} ${mousePos.y}`;
            if (tempPath) tempPath.setAttribute('d', d);
        };

        const onMouseUp = (e: MouseEvent) => {
            if (!isDragging) return;
            isDragging = false;
            if (tempPath) { tempPath.remove(); tempPath = null; }
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            toolOverlay.setCssStyles({ display: 'none' });
            const targetEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.chem-exp-node') as HTMLElement;
            toolOverlay.setCssStyles({ display: 'flex' });

            if (targetEl && targetEl !== nodeEl) {
                const targetRawToken = targetEl.getAttribute('data-token') || targetEl.getAttribute('data-id');
                if (targetRawToken && node.rawToken) {
                    this.updateMarkdownBlock(ctx, el, null, `\n${node.rawToken} -> ${targetRawToken}`);
                    new Notice("Connected!");
                }
            }
        };

        dragHandle.addEventListener('mousedown', (e) => {
            e.preventDefault(); e.stopPropagation();
            isDragging = true;
            tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            tempPath.setAttribute('fill', 'none'); tempPath.setAttribute('stroke', node.color || 'var(--interactive-accent)');
            tempPath.setAttribute('stroke-width', '3'); tempPath.setAttribute('stroke-dasharray', '5,5');
            tempPath.setAttribute('marker-end', `url(#arrow-${(node.color || '').replace('#', '')})`);
            svgOverlay.appendChild(tempPath);

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    private updateMarkdownBlock(ctx: any, el: HTMLElement, oldText: string | null, newText: string) {
        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return;
        let info = ctx.getSectionInfo(el);
        if (!info && el.parentElement) info = ctx.getSectionInfo(el.parentElement);
        if (!info) return;

        const editor = view.editor;
        const lines = editor.getValue().split('\n');
        
        if (oldText && oldText !== newText) {
            for (let i = info.lineStart; i <= info.lineEnd; i++) {
                if (lines[i].includes(oldText)) {
                    lines[i] = lines[i].replace(oldText, newText);
                    break;
                }
            }
        } else if (!oldText) {
            lines.splice(info.lineEnd, 0, newText);
        }
        
        editor.setValue(lines.join('\n'));
    }

    private updateMarkdownNodeText(ctx: any, el: HTMLElement, oldToken: string, newToken: string) {
        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return;
        let info = ctx.getSectionInfo(el);
        if (!info && el.parentElement) info = ctx.getSectionInfo(el.parentElement);
        if (!info) return;

        const editor = view.editor;
        const lines = editor.getValue().split('\n');
        
        for (let i = info.lineStart; i <= info.lineEnd; i++) {
            if (lines[i].includes(oldToken)) {
                if (newToken === "") {
                    let line = lines[i].replace(oldToken, '');
                    line = line.replace(/(->|=>|-)\s*(->|=>|-)/g, '$1'); 
                    line = line.replace(/^\s*(->|=>|-)\s*/, ''); 
                    line = line.replace(/\s*(->|=>|-)\s*$/, ''); 
                    
                    if (line.trim() === '') lines.splice(i, 1); 
                    else lines[i] = line;
                } else {
                    lines[i] = lines[i].replace(oldToken, newToken);
                }
                editor.setValue(lines.join('\n'));
                break;
            }
        }
    }

    private createBaseWrapper(parent: HTMLElement, folderPath: string, titleText: string, isInteractive: boolean = false, ctx?: any): HTMLElement {
        const wrapper = parent.createDiv({ cls: "chem-pathway-wrapper" });
        wrapper.setCssStyles({ border: "1px solid var(--background-modifier-border)", borderRadius: "12px", background: "var(--background-primary)", overflow: "hidden", marginTop: "10px", boxShadow: "0 4px 15px rgba(0,0,0,0.02)" });
        
        const toolbar = wrapper.createDiv();
        toolbar.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", background: "var(--background-secondary)", borderBottom: "1px solid var(--background-modifier-border)", flexWrap: "wrap", gap: "10px", zIndex: "10", position: "relative" });
        
        const h3 = toolbar.createEl("h3", { text: titleText });
        h3.setCssStyles({ margin: "0", fontSize: "16px", fontWeight: "700", color: "var(--text-normal)", display: "flex", alignItems: "center", gap: "8px" });

        const tools = toolbar.createDiv();
        tools.setCssStyles({ display: "flex", gap: "8px", alignItems: "center" });
        
        if (isInteractive && ctx) {
            const addSmiBtn = tools.createEl("button", { text: "⬡ Add Structure" });
            addSmiBtn.setCssStyles({ height: "28px", fontSize: "11px", padding: "0 12px", borderRadius: "4px", fontWeight: "600" });
            addSmiBtn.onclick = () => {
                this.plugin.openKetcherModal("", "smiles", (newData: string) => { this.updateMarkdownBlock(ctx, wrapper, null, `\n${newData}`); });
            };

            const addTxtBtn = tools.createEl("button", { text: "📝 Add Note" });
            addTxtBtn.setCssStyles({ height: "28px", fontSize: "11px", padding: "0 12px", borderRadius: "4px", fontWeight: "600" });
            addTxtBtn.onclick = () => {
                new TextPromptModal(this.plugin.app, "Add Note Node", "Enter text for the new node", "", (txt) => { this.updateMarkdownBlock(ctx, wrapper, null, `\n${txt}`); }).open();
            };

            const addElnBtn = tools.createEl("button", { text: "🧪 Add ELN", cls: "mod-cta" });
            addElnBtn.setCssStyles({ height: "28px", fontSize: "11px", padding: "0 12px", borderRadius: "4px", fontWeight: "600" });
            addElnBtn.onclick = () => {
                const activeFile = this.plugin.app.workspace.getActiveFile();
                const targetFolder = folderPath || (activeFile?.parent?.path === "/" ? "" : activeFile?.parent?.path) || "";
                
                new CreateExperimentModal(this.plugin.app, this.plugin, this.plugin.settings.elnPrefix, targetFolder, async (expCode: string) => {
                    this.updateMarkdownBlock(ctx, wrapper, null, `\n[[${expCode}]]`);
                    await this.plugin.api.eln.createExperiment(expCode, targetFolder);
                }).open();
            };
        }

        const searchInp = tools.createEl("input", { type: "search", cls: "chem-pathway-search", placeholder: "Search nodes..." });
        searchInp.setCssStyles({ width: "140px", padding: "6px 12px", fontSize: "12px", borderRadius: "4px", border: "1px solid var(--background-modifier-border)" });

        const grid = wrapper.createDiv({ cls: "chem-pathway-grid" });
        grid.setCssStyles({ padding: "20px", overflowX: "auto", display: "flex", flexDirection: "row", alignItems: "center" });
        return wrapper;
    }

    private drawChemicalNode(parent: HTMLElement, smiles: string, label: string, rawToken: string | null, ctx?: any, el?: HTMLElement, nodeObj?: GraphNode, isInteractive: boolean = false, graphContainer?: HTMLElement, svgOverlay?: SVGSVGElement, color?: string) {
        const bgGrad = color ? `linear-gradient(135deg, ${color}11, var(--background-primary))` : 'var(--background-secondary)';
        const borderL = color ? `4px solid ${color}` : `1px solid var(--background-modifier-border)`;
        
        const box = parent.createDiv({ cls: "chem-exp-node" });
        box.setAttribute("data-search", `${label} ${smiles}`.toLowerCase());
        if (nodeObj) box.setAttribute("data-id", nodeObj.id);
        else box.setAttribute("data-id", smiles);
        if (rawToken) box.setAttribute("data-token", rawToken);
        else box.setAttribute("data-token", smiles);

        box.setCssStyles({ display: "flex", flexDirection: "column", alignItems: "center", background: bgGrad, border: "1px solid var(--background-modifier-border)", borderLeft: borderL, borderRadius: "12px", padding: "12px", width: "140px", boxShadow: "0 4px 15px rgba(0,0,0,0.05)", position: "relative", transition: "transform 0.2s", zIndex: "2" });
        
        if (nodeObj) nodeObj.el = box;

        const preview = box.createDiv();
        preview.setCssStyles({ width: "120px", height: "90px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--background-primary)", borderRadius: "6px", boxShadow: "inset 0 0 4px rgba(0,0,0,0.02)" });
        preview.createSpan({ text: "⏳" });

        const labelDiv = box.createDiv();
        labelDiv.setText(label);
        labelDiv.setCssStyles({ fontSize: "11px", fontWeight: "600", color: "var(--text-normal)", textAlign: "center", marginTop: "8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" });

        if (rawToken && ctx && el) {
            box.setCssStyles({ cursor: "pointer" });
            box.title = "Double-click to edit Structure/Name";
            box.onmouseover = () => { box.setCssStyles({ transform: "translateY(-2px)" }); };
            box.onmouseout = () => { box.setCssStyles({ transform: "translateY(0)" }); };

            box.addEventListener("dblclick", (e) => {
                e.stopPropagation();
                this.plugin.openKetcherModal(smiles, "smiles", (newData: string) => {
                    const replacement = label !== "Structure" ? `${newData}|${label}` : newData;
                    this.updateMarkdownNodeText(ctx, el, rawToken, replacement);
                });
            });
        }

        if (isInteractive && nodeObj && graphContainer && svgOverlay) {
            this.attachMindMapInteractions(box, nodeObj, ctx, el!, graphContainer, svgOverlay);
        }

        window.requestAnimationFrame(async () => {
            const renderEl = await this.plugin.api.renderStructure(smiles, 120, 90);
            preview.empty();
            if (renderEl) { renderEl.setCssStyles({ maxWidth: '100%', maxHeight: '100%' }); preview.appendChild(renderEl); } 
            else preview.createSpan({ text: "❌" });
        });
    }

    private drawExperimentNode(parent: HTMLElement, node: GraphNode, isInteractive: boolean = false, ctx?: any, el?: HTMLElement, color?: string) {
        const yieldNum = parseFloat(node.data?.products?.[0]?.yield);
        const yieldStr = isNaN(yieldNum) ? 'N/A' : `${yieldNum}%`;
        const badgeColor = yieldNum >= 80 ? 'var(--text-success)' : yieldNum <= 30 ? 'var(--text-error)' : 'var(--text-warning)';

        const bgGrad = color ? `linear-gradient(135deg, ${color}11, var(--background-primary))` : 'var(--background-primary)';
        const borderL = color ? `4px solid ${color}` : `1px solid var(--background-modifier-border)`;

        const nodeEl = parent.createDiv({ cls: "chem-exp-node" });
        nodeEl.setAttribute("data-search", `${node.label} ${node.smiles} ${node.data?.project || ''}`.toLowerCase());
        nodeEl.setAttribute("data-id", node.id);
        if (node.rawToken) nodeEl.setAttribute("data-token", node.rawToken);
        
        nodeEl.setCssStyles({ display: "flex", flexDirection: "column", alignItems: "center", background: bgGrad, border: "1px solid var(--background-modifier-border)", borderLeft: borderL, borderRadius: "12px", padding: "12px", width: "140px", boxShadow: "0 4px 15px rgba(0,0,0,0.05)", position: "relative", transition: "transform 0.2s", zIndex: "2" });
        node.el = nodeEl;

        const header = nodeEl.createDiv();
        header.setCssStyles({ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: "8px", alignItems: "center" });
        
        const lbl = header.createDiv();
        lbl.setText(node.label);
        lbl.setCssStyles({ fontSize: "11px", fontWeight: "700", color: color || 'var(--text-accent)', whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
        
        const b = header.createDiv();
        b.setText(yieldStr);
        b.setCssStyles({ fontSize: "10px", fontWeight: "800", color: badgeColor, background: "var(--background-secondary-alt)", padding: "2px 6px", borderRadius: "4px", border: "1px solid var(--background-modifier-border)" });
        
        this.attachHoverActions(nodeEl, node.id, node.label, node.data);

        if (isInteractive && ctx && el) {
            const graphContainer = el.querySelector('.chem-pathway-grid') as HTMLElement;
            const svgOverlay = el.querySelector('svg') as SVGSVGElement;
            if (graphContainer && svgOverlay) this.attachMindMapInteractions(nodeEl, node, ctx, el, graphContainer, svgOverlay);
        }

        const preview = nodeEl.createDiv();
        preview.setCssStyles({ width: "120px", height: "90px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--background-primary)", borderRadius: "6px", boxShadow: "inset 0 0 4px rgba(0,0,0,0.02)" });
        preview.createSpan({ text: "⏳" });

        if (node.data?.project) {
            const pj = nodeEl.createDiv();
            pj.setText(node.data.project);
            pj.setCssStyles({ fontSize: "9px", color: "var(--text-muted)", textTransform: "uppercase", marginTop: "6px", letterSpacing: "0.5px", width: "100%", textAlign: "center" });
        }

        window.requestAnimationFrame(async () => {
            const renderEl = await this.plugin.api.renderStructure(node.smiles, 120, 90);
            preview.empty();
            if (renderEl) { renderEl.setCssStyles({ maxWidth: '100%', maxHeight: '100%' }); preview.appendChild(renderEl); } 
            else preview.createSpan({ text: "❌" });
        });
    }

    private attachHoverActions(nodeEl: HTMLElement, filePath: string, code: string, data: any) {
        const overlay = nodeEl.createDiv();
        overlay.setCssStyles({ position: "absolute", inset: "0", background: "rgba(0,0,0,0.7)", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", opacity: "0", transition: "opacity 0.2s", backdropFilter: "blur(2px)", zIndex: "5" });
        
        nodeEl.addEventListener('mouseenter', () => { overlay.setCssStyles({ opacity: "1" }); nodeEl.setCssStyles({ transform: "translateY(-2px)" }); });
        nodeEl.addEventListener('mouseleave', () => { overlay.setCssStyles({ opacity: "0" }); nodeEl.setCssStyles({ transform: "translateY(0)" }); });
        
        const openBtn = overlay.createEl("button", { text: "👁️", attr: { title: "Open Note" } });
        openBtn.setCssStyles({ padding: "5px", background: "transparent", border: "none", cursor: "pointer", fontSize: "16px" });
        openBtn.onclick = () => {
            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) this.plugin.app.workspace.getLeaf(false).openFile(file);
        };
        
        const cloneBtn = overlay.createEl("button", { text: "🗐", attr: { title: "Clone Exp" } });
        cloneBtn.setCssStyles({ padding: "5px", background: "transparent", border: "none", cursor: "pointer", fontSize: "16px" });
        cloneBtn.onclick = () => {
            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) new CloneExperimentModal(this.plugin.app, this.plugin, code, file, data).open();
        };
    }

    private attachSearchLogic(wrapper: HTMLElement) {
        const searchInput = wrapper.querySelector('.chem-pathway-search') as HTMLInputElement;
        const nodes = wrapper.querySelectorAll('.chem-exp-node');
        
        searchInput.addEventListener('input', (e: any) => {
            const query = e.target.value.toLowerCase();
            nodes.forEach((node: any) => {
                const text = node.getAttribute('data-search') || "";
                if (text.includes(query)) {
                    node.style.opacity = "1";
                    node.style.filter = "none";
                } else {
                    node.style.opacity = "0.3";
                    node.style.filter = "grayscale(100%)";
                }
            });
        });
    }

    private async fetchChemicalData(file: TFile): Promise<{type: 'eln'|'smiles', smiles: string, data?: any} | null> {
        const content = await this.plugin.app.vault.cachedRead(file);
        
        const elnMatch = content.match(/```eln\s*\n([\s\S]*?)\n```/);
        if (elnMatch) {
            try {
                const { parseYaml } = require('obsidian');
                const safeSource = elnMatch[1].replace(/smiles:\s*(.*)$/gm, (m, p1) => {
                    let s = p1.trim(); if (!s) return m;
                    const cMatch = s.match(/(\s+#.*)$/); if (cMatch) s = s.substring(0, s.length - cMatch[1].length).trim();
                    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.substring(1, s.length - 1);
                    return `smiles: '${s.replace(/\\"/g, '"').replace(/'/g, "''")}'`;
                });
                const data = parseYaml(safeSource);
                const smiles = data.products?.[0]?.smiles || data.reactants?.[0]?.smiles;
                if (smiles) return { type: 'eln', smiles, data };
            } catch(e) {}
        }

        const smiMatch = content.match(/```smiles\s*\n([\s\S]*?)\n```/);
        if (smiMatch && smiMatch[1].trim()) return { type: 'smiles', smiles: smiMatch[1].trim() };

        const cache = this.plugin.app.metadataCache.getFileCache(file);
        if (cache?.frontmatter?.smiles) return { type: 'smiles', smiles: cache.frontmatter.smiles };

        return null;
    }
}

class TextPromptModal extends Modal {
    title: string; desc: string; initialVal: string; onSubmit: (val: string) => void;
    constructor(app: App, title: string, desc: string, initialVal: string, onSubmit: (val: string) => void) {
        super(app); this.title = title; this.desc = desc; this.initialVal = initialVal; this.onSubmit = onSubmit;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: this.title });
        contentEl.createEl('p', { text: this.desc, cls: 'color-text-muted' }).setCssStyles({ fontSize: "12px", marginBottom: "10px" });
        const inp = contentEl.createEl('input', { type: 'text', value: this.initialVal });
        inp.setCssStyles({ width: '100%', marginBottom: '15px' });
        inp.onkeydown = (e) => { if (e.key === 'Enter') { this.onSubmit(inp.value.trim()); this.close(); } };
        const btn = contentEl.createEl('button', { text: 'Save', cls: 'mod-cta' });
        btn.setCssStyles({ float: 'right' });
        btn.onclick = () => { this.onSubmit(inp.value.trim()); this.close(); };
        window.setTimeout(() => { inp.focus(); inp.select(); }, 50);
    }
    onClose() { this.contentEl.empty(); }
}