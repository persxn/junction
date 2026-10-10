// Stages everything the Junction installer carries next to Junction.exe (ruling A20):
//
//   src-tauri/staging/backend/   the esbuild backend bundle, its native addons and
//                                migrations, plus the category seed and the gazetteer
//   src-tauri/staging/node/      node.exe — exactly the version in .node-version —
//                                and Node's licence
//
// `tauri.release.conf.json` maps both into the install folder, so a user needs
// nothing installed beforehand: no Node, no database server, no runtime. Run it
// through `pnpm release` (apps/desktop) rather than by hand.
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const repo = path.resolve(desktop, '..', '..');
const staging = path.join(desktop, 'src-tauri', 'staging');

function fail(message) {
  console.error(`stage-release: ${message}`);
  process.exit(1);
}

// 1. The pinned Node. The installer ships the runtime the tests ran on, nothing else.
const pinned = readFileSync(path.join(repo, '.node-version'), 'utf8').trim();
if (process.version !== `v${pinned}`) {
  fail(`this is Node ${process.version}; .node-version pins v${pinned}. Run with the pinned Node.`);
}

// 2. A fresh backend bundle.
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
execFileSync(pnpm, ['--filter', '@compintel/backend', 'bundle'], {
  cwd: repo,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

rmSync(staging, { recursive: true, force: true });
const backend = path.join(staging, 'backend');
cpSync(path.join(repo, 'apps', 'backend', 'dist-bundle'), backend, { recursive: true });

// 3. Reference data the bundle looks for next to main.mjs (platform/resources.ts).
cpSync(
  path.join(repo, 'resources', 'category-rules.seed.json'),
  path.join(backend, 'resources', 'category-rules.seed.json'),
);
const gazetteer =
  process.env.JUNCTION_GAZETTEER ??
  path.join(process.env.LOCALAPPDATA ?? '', 'CompIntel-dev', 'gazetteer', 'gazetteer.db');
if (!existsSync(gazetteer)) {
  fail(
    `no gazetteer at ${gazetteer}. Build it with \`pnpm gazetteer:build\` or set JUNCTION_GAZETTEER.`,
  );
}
mkdirSync(path.join(backend, 'resources', 'gazetteer'), { recursive: true });
cpSync(gazetteer, path.join(backend, 'resources', 'gazetteer', 'gazetteer.db'));
cpSync(
  path.join(repo, 'resources', 'gazetteer', 'ATTRIBUTION.md'),
  path.join(backend, 'resources', 'gazetteer', 'ATTRIBUTION.md'),
);

// 4. node.exe and its licence.
const node = path.join(staging, 'node');
mkdirSync(node, { recursive: true });
cpSync(process.execPath, path.join(node, 'node.exe'));
const licence = await fetch(`https://raw.githubusercontent.com/nodejs/node/v${pinned}/LICENSE`);
if (!licence.ok) fail(`could not fetch Node's licence (${String(licence.status)})`);
writeFileSync(path.join(node, 'LICENSE.txt'), await licence.text());

// 5. The Visual C++ runtime, app-local (Microsoft's redistributable files). Junction.exe and
//    node.exe link it statically, but the prebuilt argon2 addon needs vcruntime140(_1).dll,
//    which a clean Windows does not have. Next to node.exe is where the loader looks first.
const vcrt =
  process.env.JUNCTION_VCRT_DIR ??
  (() => {
    const root = path.join(
      process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)',
      'Microsoft Visual Studio',
      '2022',
      'BuildTools',
      'VC',
      'Redist',
      'MSVC',
    );
    if (!existsSync(root)) return undefined;
    const versions = readdirSync(root)
      .filter((name) => /^\d+\./.test(name))
      .sort();
    const latest = versions.at(-1);
    return latest === undefined ? undefined : path.join(root, latest, 'x64', 'Microsoft.VC143.CRT');
  })();
if (vcrt === undefined || !existsSync(path.join(vcrt, 'vcruntime140.dll'))) {
  fail(
    'no Visual C++ redistributable folder found; set JUNCTION_VCRT_DIR to Microsoft.VC143.CRT (x64).',
  );
}
for (const dll of ['vcruntime140.dll', 'vcruntime140_1.dll']) {
  cpSync(path.join(vcrt, dll), path.join(node, dll));
  cpSync(path.join(vcrt, dll), path.join(backend, 'native', dll));
}

console.log(
  `stage-release: staged backend and Node v${pinned} into ${path.relative(repo, staging)}`,
);
