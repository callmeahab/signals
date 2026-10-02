import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import postcss from 'postcss';
const out='packages/ui/dist';await mkdir(out,{recursive:true});
const tree=postcss.parse(await readFile('packages/ui/src/styles.css','utf8'));
const theme=postcss.root();
tree.walkRules(rule=>{
 if(rule.selectors?.every(s=>s===':root'||s==='.dark')) {theme.append(rule.clone());rule.remove();return;}
 let parent=rule.parent;while(parent){if(parent.type==='atrule'&&parent.name.includes('keyframes'))return;parent=parent.parent;}
 rule.selectors=rule.selectors.map(selector=>selector==='body'?'.signals-ui':selector==='*'?'.signals-ui, .signals-ui *':`.signals-ui ${selector}`);
});
await writeFile(`${out}/styles.css`,tree.toString());await writeFile(`${out}/theme.css`,theme.toString());
await copyFile('../LICENSE','packages/ui/LICENSE');
