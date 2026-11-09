#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOrCreatePairingToken } from './arena-chat-bridge.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const yes = args.has('--yes');
const noInstall = args.has('--no-install');
const help = args.has('--help') || args.has('-h');

function printHelp() {
  console.log(`Book of Eternity local bridge setup\n\nUsage: npm run bridge:setup [-- --yes | --no-install]\n\n  --yes         Install locked npm dependencies if missing, then start both local services.\n  --no-install  Do not install dependencies; exit with instructions if they are missing.\n  --help        Show this help.\n\nThe browser extension must still be loaded once by the user in Chrome/Chromium.`);
}

async function askYesNo(question, defaultValue) {
  if (yes) return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = defaultValue ? ' [Y/n] ' : ' [y/N] ';
    const answer = (await prompt.question(`${question}${suffix}`)).trim().toLowerCase();
    if (!answer) return defaultValue;
    return ['y', 'yes'].includes(answer);
  } finally {
    prompt.close();
  }
}

async function dependenciesAvailable() {
  try {
    await Promise.all([
      access(path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')),
      access(path.join(root, 'node_modules', 'react', 'package.json')),
    ]);
    return true;
  } catch { return false; }
}

function installDependencies() {
  console.log('\nInstalling the exact dependencies in package-lock.json with npm ci…');
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmArgs = npmCli ? [npmCli, 'ci'] : ['ci'];
  const result = spawnSync(command, npmArgs, { cwd: root, stdio: 'inherit', shell: !npmCli && process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ci failed${result.status === null ? '' : ` (exit ${result.status})`}.`);
}

async function waitForHttp(url, child, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${label} stopped before becoming ready${child.exitCode === null ? '' : ` (exit ${child.exitCode})`}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000), cache: 'no-store' });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become ready at ${url}${lastError ? ` (${lastError.message})` : ''}.`);
}

function stopChild(child) {
  if (child && child.exitCode === null && !child.killed) child.kill('SIGTERM');
}

async function main() {
  if (help) { printHelp(); return; }
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) throw new Error(`Node.js 20 or newer is required; found ${process.versions.node}.`);

  let installed = await dependenciesAvailable();
  if (!installed) {
    if (noInstall) throw new Error('Dependencies are missing. Run npm ci, then rerun npm run bridge:setup.');
    const consent = noInstall ? false : await askYesNo('Dependencies are missing. Run npm ci from the lockfile? It replaces node_modules and runs dependency install scripts.', true);
    if (consent === null) throw new Error('Run this setup in an interactive terminal, or install dependencies with npm ci first.');
    if (!consent) throw new Error('Setup cancelled. Install dependencies with npm ci when ready.');
    installDependencies();
    installed = await dependenciesAvailable();
    if (!installed) throw new Error('npm ci completed, but Vite or React is still missing.');
  }

  const launch = await askYesNo('Start the local game and bridge now?', true);
  if (launch === null) throw new Error('Run this setup in an interactive terminal, or use --yes to start both services.');
  if (!launch) {
    console.log('Dependencies are ready. No pairing token or services were started; use the manual commands in docs/arena-chat-bridge.md when you want to launch them.');
    return;
  }

  await loadOrCreatePairingToken(root);
  console.log('\nOne-time browser step (cannot be automated safely by a local script):');
  console.log('  Chrome/Chromium → chrome://extensions → Developer mode → Load unpacked');
  console.log(`  Select: ${path.join(root, 'chat_extension')}`);
  console.log('  In the extension popup, paste the pairing token printed by the bridge and choose “Save & test”.');
  console.log('\nStarting on loopback only. Keep this terminal open; Ctrl+C stops both services.');

  const viteEntry = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const vite = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--strictPort'], { cwd: root, stdio: 'inherit', windowsHide: true });
  let bridge;
  let shuttingDown = false;
  const stopAll = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopChild(bridge);
    stopChild(vite);
  };
  process.once('SIGINT', stopAll);
  process.once('SIGTERM', stopAll);
  vite.once('exit', code => {
    if (!shuttingDown) {
      console.error(`\nVite stopped${code === null ? '' : ` (exit ${code})`}.`);
      stopAll();
    }
  });

  try {
    await waitForHttp('http://127.0.0.1:5173/', vite, 'Vite');
    console.log('\nGame: http://127.0.0.1:5173');
    bridge = spawn(process.execPath, [path.join(root, 'scripts', 'arena-chat-bridge.mjs')], { cwd: root, stdio: 'inherit', windowsHide: true });
    bridge.once('exit', code => {
      if (!shuttingDown) {
        console.error(`\nLocal bridge stopped${code === null ? '' : ` (exit ${code})`}.`);
        stopAll();
      }
    });
    await waitForHttp('http://127.0.0.1:8765/health', bridge, 'Local bridge');
    await new Promise(resolve => {
      const onExit = () => resolve();
      vite.once('exit', onExit);
      bridge.once('exit', onExit);
      if (shuttingDown || vite.exitCode !== null || bridge.exitCode !== null) onExit();
    });
  } finally {
    stopAll();
    process.removeListener('SIGINT', stopAll);
    process.removeListener('SIGTERM', stopAll);
  }
}

main().catch(error => {
  console.error(`\nSetup could not continue: ${error.message}`);
  process.exitCode = 1;
});
