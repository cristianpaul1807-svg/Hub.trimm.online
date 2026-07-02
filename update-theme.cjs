const fs = require('fs');
const path = require('path');

const directory = path.join(__dirname, 'src');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(walk(file));
        } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
            results.push(file);
        }
    });
    return results;
}

const files = walk(directory);

let changedFiles = 0;

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let newContent = content;

    // Regex to match className="..."
    const classNameRegex = /className=["']([^"']*)["']/g;
    
    newContent = content.replace(classNameRegex, (match, classStr) => {
        if (!classStr.includes('text-white')) return match;

        // Condition to KEEP text-white: if it has bg-hubBlue, bg-red-, bg-green-, bg-black, bg-gradient-, etc.
        const keepWhite = classStr.includes('bg-hubBlue') || 
                          classStr.includes('bg-red-') || 
                          classStr.includes('bg-green-') || 
                          classStr.includes('bg-black') || 
                          classStr.includes('bg-blue-') ||
                          classStr.includes('bg-indigo-') ||
                          classStr.includes('bg-purple-') ||
                          classStr.includes('bg-gradient-');

        if (!keepWhite) {
            // If it has text-white, replace it with text-hubText
            // For hover:text-white, we might want hover:text-hubBlue
            let newClassStr = classStr;
            
            if (newClassStr.includes('hover:text-white')) {
                newClassStr = newClassStr.replace(/hover:text-white/g, 'hover:text-hubBlueText');
            }
            if (newClassStr.includes('text-white')) {
                // If it's a title or bold text, use hubText (dark slate)
                newClassStr = newClassStr.replace(/\btext-white\b/g, 'text-hubText');
            }
            
            return `className="${newClassStr}"`;
        }
        
        return match;
    });

    if (content !== newContent) {
        fs.writeFileSync(file, newContent, 'utf8');
        changedFiles++;
        console.log(`Updated: ${file}`);
    }
});

console.log(`Finished updating ${changedFiles} files.`);
