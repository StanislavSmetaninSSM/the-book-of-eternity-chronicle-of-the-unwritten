import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

test('operation audit inventories the public inventory and player-action managers', async () => {
  const doc=await readFile(new URL('../docs/client-edit-operation-audit.md',import.meta.url),'utf8');
  for (const path of ['../hooks/logic/inventoryActions.ts','../hooks/logic/playerActions.ts','../hooks/logic/saveLoad.ts','../hooks/logic/turn.ts','../hooks/logic/multiplayer.ts','../hooks/logic/music.ts']) {
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

test('audit includes directly exported useGameLogic callbacks', async () => {
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8');
 const doc=await readFile(new URL('../docs/client-edit-operation-audit.md',import.meta.url),'utf8');
 const src=ts.createSourceFile('useGameLogic.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let hook;
 const visit=n=>{if(ts.isFunctionDeclaration(n)&&n.name?.text==='useGameLogic') hook=n;ts.forEachChild(n,visit)};visit(src);assert.ok(hook?.body);
 const callbacks=new Set();for(const statement of hook.body.statements) if(ts.isVariableStatement(statement)) for(const d of statement.declarationList.declarations) if(ts.isIdentifier(d.name)&&d.initializer&&(ts.isArrowFunction(d.initializer)||ts.isCallExpression(d.initializer)&&d.initializer.expression.getText(src)==='useCallback')) callbacks.add(d.name.text);
 const result=hook.body.statements.find(ts.isReturnStatement)?.expression;assert.ok(result&&ts.isObjectLiteralExpression(result));
 for(const prop of result.properties){const key=ts.isShorthandPropertyAssignment(prop)?prop.name.text:ts.isPropertyAssignment(prop)?prop.name.getText(src):null;const value=ts.isShorthandPropertyAssignment(prop)?key:ts.isPropertyAssignment(prop)?prop.initializer.getText(src):null;if(key&&callbacks.has(value))assert.ok(doc.includes('`'+key+'`'),`useGameLogic callback ${key} missing from audit`)}
});
