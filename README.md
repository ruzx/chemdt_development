# ChemSpec Viewer

**ChemSpec Viewer** is a fast, offline, and universally compatible spectrum viewer built explicitly for synthetic chemists inside Obsidian.

It is designed to be the perfect companion to the **ChemEdit** plugin, allowing you to drag-and-drop raw analytical data directly into your electronic lab notebook (ELN) and seamlessly interact with it.

### Features
* **NMR Processing:** Instantly renders `.nmr`, `.jdx`, or raw Bruker `acqus`/`1r` datasets. Fully interactive with Mnova-style integration S-curves, multiplet brackets, J-coupling calculations, and vertical peak picking.
* **FT-IR & Cyclic Voltammetry:** Safely unzips and plots standard `.jdx`, `.jcamp`, `.csv`, and `.txt` files directly in your notes.
* **PubNMR Simulation:** Paste standard ACS NMR strings (e.g., `1H NMR (400 MHz, CDCl3) δ 7.31 – 7.11 (m, 3H)`) into a ```` ```pubnmr ```` block to instantly render a mathematically simulated, interactive spectrum.
* **Exporting:** Copy drafted ACS multi-proton strings to your clipboard, or export fully interactive `.jdx` spectra and vector-perfect `.svg` publication figures directly from your notes.

### Usage
Type `![[spectrum.jdx]]` anywhere in your notes, or click the **ChemSpec** icon in your left sidebar to open the dedicated full-screen standalone application.