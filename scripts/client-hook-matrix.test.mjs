import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';
test('audit matrix covers the directly guarded hook edit callbacks',async()=>{
 const testText=await readFile(new URL('./client-all-manager-actions-guard.test.mjs',import.meta.url),'utf8'),doc=await readFile(new URL('../docs/client-edit-hook-matrix.md',import.meta.url),'utf8');const src=ts.createSourceFile('test.mjs',testText,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let names;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(src)==='names'&&ts.isArrayLiteralExpression(n.initializer)){const values=n.initializer.elements.map(x=>x.text);if(values.includes('deleteLocationThreat'))names=values}ts.forEachChild(n,visit)}visit(src);assert.ok(names);assert.equal(names.length,22);for(const name of names)assert.ok(doc.includes(`\`${name}\``),`missing ${name}`);
});

test('generated static UI cross-reference matches current source',async()=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');await promisify(execFile)(process.execPath,[new URL('./client-edit-ui-map.mjs',import.meta.url).pathname,'--check']);
});
