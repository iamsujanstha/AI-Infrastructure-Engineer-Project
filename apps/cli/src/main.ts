#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const engineRoot = resolve(__dirname, '../../context-engine');
const interpreter = process.env.CONTEXT_ENGINE_PYTHON ?? resolve(engineRoot, '.venv/bin/python');
const child = spawn(interpreter, [resolve(engineRoot, 'local_cli.py'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: false,
});
child.on('error', () => {
  process.stderr.write('Context engine Python unavailable. Run uv sync in apps/context-engine.\n');
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}

