// Load the production TypeScript helper without requiring Node's optional
// native TypeScript stripping (the project test runner also supports Node 20).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('../../utils/turnSubmissionIdentity.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const exports = {};
vm.runInNewContext(code, { exports });
export const { captureTurnSubmissionIdentity, sameTurnSubmissionIdentity } = exports;
