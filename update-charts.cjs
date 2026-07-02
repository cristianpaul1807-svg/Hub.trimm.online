const fs = require('fs');
const path = require('path');

const directory = path.join(__dirname, 'src', 'components', 'charts');

const files = fs.readdirSync(directory).filter(f => f.endsWith('.tsx'));

files.forEach(file => {
    const filePath = path.join(directory, file);
    let content = fs.readFileSync(filePath, 'utf8');

    // Replace #2a2a2a with #e5e7eb for borders
    content = content.replace(/stroke="#2a2a2a"/g, 'stroke="#e5e7eb"');
    
    // Replace previous bar fill
    content = content.replace(/fill="#2a2a2a"/g, 'fill="#e5e7eb"');
    
    // Replace text color
    content = content.replace(/#a0a0a0/g, '#4b5563');

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated charts colors in: ${file}`);
});
