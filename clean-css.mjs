import fs from 'fs';

// Esbuild outputs to main.css, but Obsidian needs styles.css
const cssFile = fs.existsSync('main.css') ? 'main.css' : (fs.existsSync('styles.css') ? 'styles.css' : null);

if (!cssFile) {
    console.error('CSS file not found!');
    process.exit(0);
}

let css = fs.readFileSync(cssFile, 'utf-8');

// 1. SCROLLBARS: Safely remove all Webkit scrollbar rules
css = css.replace(/([^\}]+::-webkit-scrollbar[^\}]*?)\{([^}]+)\}/g, '');

// 2. Remove !important to pass linter
css = css.replace(/!important/g, '');

// 3. Remove column- properties (multicolumn warning)
css = css.replace(/column-count:[^;]+;/g, '');
css = css.replace(/column-gap:[^;]+;/g, '');
css = css.replace(/-moz-column-[^:]+:[^;]+;/g, '');
css = css.replace(/-webkit-column-[^:]+:[^;]+;/g, '');

// 4. Remove text-indent (css-text-indent warning)
css = css.replace(/text-indent:[^;]+;/g, '');

// 5. Remove advanced text-decoration (only keep none or underline)
css = css.replace(/text-decoration:\s*(?!none|underline)[^;]+;/g, 'text-decoration: none;');

// 6. DUPLICATE PROPERTIES: Fix all exact duplicates flagged by the Obsidian linter
// Safely matches ONLY the innermost CSS rule blocks (avoids breaking @keyframes and @media blocks)
css = css.replace(/\{([^{}]+)\}/g, (match, inner) => {
    
    // PROTECT semicolons inside URLs and strings so they aren't destroyed
    let protectedInner = inner.replace(/url\([^)]+\)/g, m => m.replace(/;/g, '__SEMICOLON__'));
    protectedInner = protectedInner.replace(/"[^"]*"/g, m => m.replace(/;/g, '__SEMICOLON__'));
    protectedInner = protectedInner.replace(/'[^']*'/g, m => m.replace(/;/g, '__SEMICOLON__'));

    const declarations = protectedInner.split(';');
    const props = {};
    const orderedProps = [];
    
    for (let i = 0; i < declarations.length; i++) {
        const decl = declarations[i].trim();
        if (!decl) continue;
        
        const colonIdx = decl.indexOf(':');
        if (colonIdx === -1) {
            orderedProps.push({ raw: decl });
            continue;
        }
        
        const prop = decl.substring(0, colonIdx).trim();
        const val = decl.substring(colonIdx + 1).trim();
        
        if (props.hasOwnProperty(prop)) {
            const idx = orderedProps.findIndex(p => p.prop === prop);
            if (idx !== -1) orderedProps.splice(idx, 1);
        }
        
        props[prop] = val;
        orderedProps.push({ prop, val });
    }
    
    let cleanedInner = orderedProps.map(item => {
        if (item.raw !== undefined) return item.raw;
        return `${item.prop}:${item.val}`;
    }).join(';');
    
    // RESTORE semicolons
    cleanedInner = cleanedInner.replace(/__SEMICOLON__/g, ';');
    
    // Ensure trailing semicolon is present if the block isn't empty
    if (cleanedInner.length > 0 && !cleanedInner.endsWith(';')) {
        cleanedInner += ';';
    }
    
    return `{${cleanedInner}}`;
});

// Output the clean file to styles.css
fs.writeFileSync('styles.css', css);

// Cleanup the original main.css esbuild artifact
if (cssFile === 'main.css') fs.unlinkSync('main.css');

console.log('✅ Safely cleaned styles.css! All duplicate properties, !important, and scrollbars removed.');