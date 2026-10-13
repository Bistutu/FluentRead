import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';

const root = process.cwd();
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite'));
const {build} = viteRequire('esbuild');
const result = await build({
  entryPoints: [path.join(root, 'userscript/languageBundles.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const code = result.outputFiles[0].text;
const {UI_LANGUAGE_BUNDLES} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
{
  const outputDir = path.join(root, 'userscript/languages');
  fs.mkdirSync(outputDir, {recursive: true});
  for (const [language, bundle] of Object.entries(UI_LANGUAGE_BUNDLES)) {
    if (language === 'en-US') continue; // English remains in the offline userscript.
    const contents = JSON.stringify(bundle);
    const digest = createHash('sha256').update(contents).digest('hex').slice(0, 16);
    const target = path.join(outputDir, `${language}.${digest}.json`);
    if (!fs.existsSync(target)) fs.writeFileSync(target, `${contents}\n`);
    console.log(path.relative(root, target));
  }
}
