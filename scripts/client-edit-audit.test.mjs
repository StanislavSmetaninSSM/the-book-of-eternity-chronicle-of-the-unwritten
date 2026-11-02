import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

test('operation audit inventories the public inventory and player-action managers', async () => {
  const doc=await readFile(new URL('../docs/client-edit-operation-audit.md',import.meta.url),'utf8');
  for (const path of ['../hooks/logic/inventoryActions.ts','../hooks/logic/playerActions.ts']) {
    const text=await readFile(new URL(path,import.meta.url),'utf8');
    const file=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
    const returns=[];
    const visit=n=>{if(ts.isReturnStatement(n)&&n.expression&&ts.isObjectLiteralExpression(n.expression)) returns.push(n.expression);ts.forEachChild(n,visit)};
    visit(file);
    const result=returns.sort((a,b)=>b.properties.length-a.properties.length)[0];
    assert.ok(result);
    for(const prop of result.properties){
      assert.ok(ts.isShorthandPropertyAssignment(prop),`audit test needs updating for non-shorthand export in ${path}`);
      assert.ok(doc.includes('`'+prop.name.text+'`'),`${path}: ${prop.name.text} missing from operation audit`);
    }
  }
});
