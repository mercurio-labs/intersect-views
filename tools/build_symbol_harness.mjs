import {compilerBuild} from './compiler_build.mjs';
import {copyFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const result=compilerBuild(['build','-p','intersect-view-harness','--lib','--features','symbol-properties-gate','--target','wasm32-unknown-unknown','--profile','test-fast','--locked'],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status??1);
await mkdir('harness/web/public',{recursive:true});
await copyFile(resolve(process.env.CARGO_TARGET_DIR??'target','wasm32-unknown-unknown/test-fast/intersect_view_harness.wasm'),'harness/web/public/symbols-host.wasm');
