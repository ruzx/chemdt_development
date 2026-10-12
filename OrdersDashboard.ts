// OrdersDashboard.ts

import { ItemView, WorkspaceLeaf, TFile, Notice, debounce, Modal, App, Setting } from 'obsidian';
import type ChemEditPlugin from './main';
import { renderLimsNav } from './SharedBase';

export const ORDERS_DASHBOARD_VIEW_TYPE = "chem-orders-dashboard";

interface OrderEntry {
    file: TFile;
    name: string;
    type: string; 
    supplier: string;
    catalog: string;
    amount: string;
    price: string;
    status: string;
    requester: string;
    orderDate: string;
    receiveDate: string;
    timestamp: number;
    rowEl?: HTMLElement;
    searchText: string;
}

export class OrdersDashboardView extends ItemView {
    plugin: ChemEditPlugin;
    toolbarEl: HTMLElement;
    tableBodyEl: HTMLElement;
    allEntries: OrderEntry[] = [];
    currentFilter: string = 'All';
    searchQuery: string = '';

    constructor(leaf: WorkspaceLeaf, plugin: ChemEditPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return ORDERS_DASHBOARD_VIEW_TYPE; }
    getDisplayText() { return "Orders & Requests"; }
    getIcon() { return "shopping-cart"; }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('chem-orders-dashboard-view');
        
        container.setCssStyles({ display: "flex", flexDirection: "column", padding: "0", background: "var(--background-primary)" });

        const header = container.createDiv();
        header.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "20px 30px", background: "var(--background-secondary)", borderBottom: "1px solid var(--background-modifier-border)" });
        const titleArea = header.createDiv();
        titleArea.setCssStyles({ display: "flex", flexDirection: "column" });

        renderLimsNav(titleArea, "orders", this.plugin);

        titleArea.createEl("h2", { text: "Orders & Requests" }).setCssStyles({ margin: "0", fontSize: "22px", fontWeight: "700", color: "var(--text-normal)" });
        titleArea.createEl("span", { text: "Track chemicals, consumables, and equipment purchases" }).setCssStyles({ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" });

        const newBtn = header.createEl("button", { text: "+ New Request", cls: "mod-cta" });
        newBtn.setCssStyles({ height: "36px", fontSize: "14px", fontWeight: "600", padding: "0 20px" });
        newBtn.onclick = () => {
            const folder = window.localStorage.getItem('chem-orders-dir') || "Orders";
            new CreateOrderModal(this.app, folder).open();
        };

        this.toolbarEl = container.createDiv();
        this.toolbarEl.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "15px 30px", background: "var(--background-primary)", borderBottom: "1px solid var(--background-modifier-border)" });
        
        const leftTools = this.toolbarEl.createDiv();
        leftTools.setCssStyles({ display: "flex", gap: "15px", alignItems: "center" });
        const filterTabs = leftTools.createDiv();
        filterTabs.setCssStyles({ display: "flex", gap: "8px" });
        const tabs = ['All', 'Planned', 'Ordered', 'Received'];
        
        tabs.forEach(t => {
            const btn = filterTabs.createEl("button", { text: t });
            btn.setCssStyles({ borderRadius: "20px", padding: "4px 16px", fontSize: "12px", fontWeight: "600", border: `1px solid ${this.currentFilter === t ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'}`, background: this.currentFilter === t ? 'var(--interactive-accent)' : 'var(--background-primary)', color: this.currentFilter === t ? 'var(--text-on-accent)' : 'var(--text-muted)', boxShadow: "none" });
            btn.onclick = () => {
                this.currentFilter = t;
                this.renderToolbar();
                this.applyFilters();
            };
        });

        const dirWrap = leftTools.createDiv();
        dirWrap.setCssStyles({ display: "flex", alignItems: "center", gap: "6px", marginLeft: "10px" });
        dirWrap.createEl("span", { text: "📁 Folder:" }).setCssStyles({ fontSize: "11px", fontWeight: "600", color: "var(--text-muted)" });
        const dirInp = dirWrap.createEl("input", { type: "text", value: window.localStorage.getItem('chem-orders-dir') || "Orders" });
        dirInp.setCssStyles({ width: "120px", fontSize: "12px", padding: "4px 8px", borderRadius: "4px", height: "26px", border: "1px solid var(--background-modifier-border)" });
        dirInp.onchange = (e: any) => {
            window.localStorage.setItem('chem-orders-dir', e.target.value.trim());
            void this.loadOrders();
        };

        const searchInp = this.toolbarEl.createEl("input", { type: "search", placeholder: "Search item, supplier, catalog..." });
        searchInp.setCssStyles({ width: "280px", fontSize: "13px", borderRadius: "6px" });
        searchInp.oninput = (e: any) => {
            this.searchQuery = e.target.value.toLowerCase();
            this.applyFilters();
        };

        const tableContainer = container.createDiv();
        tableContainer.setCssStyles({ flexGrow: "1", overflow: "auto", padding: "0 30px 30px 30px" });
        const table = tableContainer.createEl("table");
        table.setCssStyles({ width: "100%", borderCollapse: "separate", borderSpacing: "0", textAlign: "left", fontSize: "13px" });
        const thead = table.createEl("thead");
        thead.setCssStyles({ position: "sticky", top: "0", background: "var(--background-primary)", zIndex: "10" });
        
        const tr = thead.createEl("tr");
        const cols = [
            { name: "Item", width: "200px" },
            { name: "Supplier Info", width: "200px" },
            { name: "Amount & Price", width: "150px" },
            { name: "Requester", width: "150px" },
            { name: "Status", width: "120px" },
            { name: "Actions", width: "120px" }
        ];

        cols.forEach(c => {
            const th = tr.createEl("th", { text: c.name });
            th.setCssStyles({ padding: "16px 10px", borderBottom: "2px solid var(--background-modifier-border)", color: "var(--text-muted)", fontWeight: "600", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", width: c.width });
        });

        this.tableBodyEl = table.createEl("tbody");

        await this.loadOrders();
        
        let refreshTimeout: number;
        const requestRefresh = () => {
            window.clearTimeout(refreshTimeout);
            refreshTimeout = window.setTimeout(() => void this.loadOrders(), 2000);
        };
        this.registerEvent(this.app.vault.on('modify', requestRefresh));
        this.registerEvent(this.app.vault.on('create', requestRefresh));
        this.registerEvent(this.app.vault.on('delete', requestRefresh));
    }

    private renderToolbar() {
        const btns = this.toolbarEl.querySelectorAll('button');
        btns.forEach((btn: HTMLElement) => {
            const isMatch = btn.innerText === this.currentFilter;
            btn.setCssStyles({ background: isMatch ? 'var(--interactive-accent)' : 'var(--background-primary)', color: isMatch ? 'var(--text-on-accent)' : 'var(--text-muted)', borderColor: isMatch ? 'var(--interactive-accent)' : 'var(--background-modifier-border)' });
        });
    }

    private async loadOrders() {
        const targetDir = window.localStorage.getItem('chem-orders-dir') || "Orders";
        const files = this.app.vault.getMarkdownFiles();
        const entries: OrderEntry[] = [];

        for (const file of files) {
            const inFolder = targetDir && file.path.startsWith(targetDir);
            const cache = this.app.metadataCache.getFileCache(file);
            const fmTags = cache?.frontmatter?.tags || [];
            const isTagged = Array.isArray(fmTags) ? fmTags.includes('order') : fmTags === 'order';

            if (!inFolder && !isTagged) continue;

            const fm = cache?.frontmatter || {};
            const name = fm.name || file.basename;
            const type = fm.type || "Chemical";
            const supplier = fm.supplier || "-";
            const catalog = fm.catalog || "-";
            const status = fm.status || "Planned";

            entries.push({
                file,
                name,
                type,
                supplier,
                catalog,
                amount: fm.amount || "-",
                price: fm.price || "-",
                status,
                requester: fm.requester || "-",
                orderDate: fm.order_date || "-",
                receiveDate: fm.receive_date || "-",
                timestamp: file.stat.mtime,
                searchText: `${name} ${type} ${supplier} ${catalog} ${fm.requester||''}`.toLowerCase()
            });
        }

        const statusWeight: Record<string, number> = { "Planned": 1, "Ordered": 2, "Received": 3 };
        this.allEntries = entries.sort((a, b) => {
            const wA = statusWeight[a.status] || 99;
            const wB = statusWeight[b.status] || 99;
            if (wA !== wB) return wA - wB;
            return b.timestamp - a.timestamp; 
        });
        
        this.buildTableDOM();
        this.applyFilters();
    }

    private buildTableDOM() {
        this.tableBodyEl.empty();

        if (this.allEntries.length === 0) {
            const tr = this.tableBodyEl.createEl("tr");
            const td = tr.createEl("td", { text: "No orders found. Add requests to an Orders folder or use tags: [order]." });
            td.setAttribute("colspan", "6");
            td.setCssStyles({ textAlign: "center", padding: "40px", color: "var(--text-muted)", fontStyle: "italic" });
            return;
        }

        this.allEntries.forEach(e => {
            const tr = this.tableBodyEl.createEl("tr");
            tr.setCssStyles({ cursor: "default", transition: "background 0.2s" });
            e.rowEl = tr;

            tr.onmouseover = () => tr.setCssStyles({ backgroundColor: "var(--background-secondary-alt)" });
            tr.onmouseout = () => tr.setCssStyles({ backgroundColor: "transparent" });

            const tdItem = tr.createEl("td");
            tdItem.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
            const nameEl = tdItem.createDiv({ text: e.name });
            nameEl.setCssStyles({ fontWeight: "700", color: "var(--text-accent)", fontSize: "14px", marginBottom: "4px", cursor: "pointer" });
            nameEl.onclick = () => this.app.workspace.getLeaf(false).openFile(e.file);
            
            const typeIcon = e.type === "Chemical" ? "🧪" : e.type === "Consumable" ? "🧤" : "🔬";
            tdItem.createDiv({ text: `${typeIcon} ${e.type}` }).setCssStyles({ fontSize: "11px", color: "var(--text-muted)", fontWeight: "600" });

            const tdSup = tr.createEl("td");
            tdSup.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
            tdSup.createDiv({ text: e.supplier }).setCssStyles({ fontSize: "13px", color: "var(--text-normal)", fontWeight: "600", marginBottom: "4px" });
            tdSup.createDiv({ text: `Cat: ${e.catalog}` }).setCssStyles({ fontSize: "11px", color: "var(--text-muted)", fontFamily: "monospace" });

            const tdAmt = tr.createEl("td");
            tdAmt.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
            tdAmt.createDiv({ text: e.amount }).setCssStyles({ fontSize: "13px", color: "var(--text-normal)", fontWeight: "600", marginBottom: "4px" });
            tdAmt.createDiv({ text: e.price }).setCssStyles({ fontSize: "12px", color: "var(--text-success)", fontWeight: "600" });

            const tdReq = tr.createEl("td");
            tdReq.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
            tdReq.createDiv({ text: `👤 ${e.requester}` }).setCssStyles({ fontSize: "12px", color: "var(--text-normal)", marginBottom: "4px" });
            if (e.orderDate && e.orderDate !== "-") tdReq.createDiv({ text: `Ordered: ${e.orderDate}` }).setCssStyles({ fontSize: "10px", color: "var(--text-muted)" });
            if (e.receiveDate && e.receiveDate !== "-") tdReq.createDiv({ text: `Rcvd: ${e.receiveDate}` }).setCssStyles({ fontSize: "10px", color: "var(--text-muted)" });

            const tdStatus = tr.createEl("td");
            tdStatus.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
            let color = 'var(--text-muted)', bg = 'var(--background-primary)';
            if (e.status === 'Planned') color = 'var(--text-accent)';
            else if (e.status === 'Ordered') color = 'var(--text-warning)';
            else if (e.status === 'Received') color = 'var(--text-success)';
            
            const statSpan = tdStatus.createDiv({ text: e.status.toUpperCase() });
            statSpan.setCssStyles({ display: "inline-block", padding: "4px 10px", borderRadius: "12px", fontSize: "10px", fontWeight: "700", color: color, border: `1px solid ${color}`, background: bg });

            const tdActions = tr.createEl("td");
            tdActions.setCssStyles({ padding: "16px 10px", borderBottom: "1px solid var(--background-modifier-border-hover)" });
            
            if (e.status === 'Planned') {
                const btn = tdActions.createEl("button", { text: "🛒 Mark Ordered" });
                btn.setCssStyles({ fontSize: "11px", padding: "4px", height: "26px", width: "100%" });
                btn.onclick = async () => {
                    await this.app.fileManager.processFrontMatter(e.file, (fm: any) => { 
                        fm.status = "Ordered"; 
                        fm.order_date = window.moment().format("YYYY-MM-DD");
                    });
                };
            } else if (e.status === 'Ordered') {
                const btn = tdActions.createEl("button", { text: "📦 Mark Received" });
                btn.setCssStyles({ fontSize: "11px", padding: "4px", height: "26px", width: "100%" });
                btn.onclick = async () => {
                    await this.app.fileManager.processFrontMatter(e.file, (fm: any) => { 
                        fm.status = "Received"; 
                        fm.receive_date = window.moment().format("YYYY-MM-DD");
                    });
                };
            }
        });
    }

    private applyFilters() {
        this.allEntries.forEach(e => {
            if (!e.rowEl) return;
            const matchFilter = this.currentFilter === 'All' || e.status === this.currentFilter;
            const matchSearch = !this.searchQuery || e.searchText.includes(this.searchQuery);
            e.rowEl.setCssStyles({ display: (matchFilter && matchSearch) ? "" : "none" });
        });
    }
}

class CreateOrderModal extends Modal {
    folder: string;
    data = { name: "", type: "Chemical", supplier: "", catalog: "", amount: "", price: "" };

    constructor(app: App, folder: string) {
        super(app); this.folder = folder;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "New Order Request" });

        new Setting(contentEl).setName("Item Name").addText(t => t.onChange(v => this.data.name = v));
        new Setting(contentEl).setName("Type").addDropdown(d => d.addOption("Chemical", "🧪 Chemical").addOption("Consumable", "🧤 Consumable / Labware").addOption("Equipment", "🔬 Equipment").setValue("Chemical").onChange(v => this.data.type = v));
        new Setting(contentEl).setName("Supplier").addText(t => t.onChange(v => this.data.supplier = v));
        new Setting(contentEl).setName("Catalog #").addText(t => t.onChange(v => this.data.catalog = v));
        new Setting(contentEl).setName("Amount (e.g. 500g, 10pk)").addText(t => t.onChange(v => this.data.amount = v));
        new Setting(contentEl).setName("Estimated Price").addText(t => t.onChange(v => this.data.price = v));

        new Setting(contentEl).addButton(btn => btn.setButtonText("Create Request").setCta().onClick(async () => {
            if (!this.data.name.trim()) { new Notice("Name is required"); return; }
            
            if (!await this.app.vault.adapter.exists(this.folder)) {
                await this.app.vault.createFolder(this.folder);
            }

            const safeName = this.data.name.replace(/[\\/:"*?<>|]/g, '_') + "_" + window.moment().format("HHmmss");
            const content = `---
tags: [order]
name: "${this.data.name}"
type: "${this.data.type}"
supplier: "${this.data.supplier}"
catalog: "${this.data.catalog}"
amount: "${this.data.amount}"
price: "${this.data.price}"
status: "Planned"
requester: "Current User"
order_date: ""
receive_date: ""
---
# ${this.data.name} Request

## 🔗 Links / Quotes
- [Product Link]()

## 📝 Notes
- Why do we need this? 
`;
            const file = await this.app.vault.create(`${this.folder}/${safeName}.md`, content);
            this.app.workspace.getLeaf(false).openFile(file);
            new Notice("Order request created!");
            this.close();
        }));
    }
    onClose() { this.contentEl.empty(); }
}