import { spawnSync } from 'node:child_process';
import process from 'node:process';

const wasmPackVersion = '0.15.1';
const version = spawnSync('wasm-pack', ['--version'], { encoding: 'utf8' });
if (version.status !== 0 || version.stdout.trim() !== `wasm-pack ${wasmPackVersion}`) {
  console.error(`Install wasm-pack ${wasmPackVersion} with: cargo install wasm-pack --version ${wasmPackVersion} --locked`);
  process.exit(1);
}

const result = spawnSync('wasm-pack', [
  'build', 'rust/calendar-puzzle',
  '--target', 'web',
  '--out-dir', '../../src/generated/calendar-puzzle',
  '--out-name', 'calendar_puzzle',
  '--release',
  '--no-gitignore',
  '--no-pack',
  '--no-opt',
  '--', '--locked',
], { stdio: 'inherit' });

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
