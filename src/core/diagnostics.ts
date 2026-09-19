import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

// Автодетект команд проверки после правок файлов — как в KitCode.
export async function detectDiagnostics(cwd: string): Promise<string[]> {
  const commands: string[] = [];

  const pkg = await readPackageJson(join(cwd, 'package.json'));
  if (pkg) {
    const manager = await packageManager(cwd, pkg.packageManager);
    for (const name of ['lint', 'typecheck', 'check', 'test']) {
      if (typeof pkg.scripts?.[name] === 'string') {
        commands.push(manager === 'yarn' ? `yarn ${name}` : `${manager} run ${name}`);
      }
    }
  }

  if (await isFile(join(cwd, 'Cargo.toml'))) commands.push('cargo check', 'cargo test');
  if (await isFile(join(cwd, 'go.mod'))) commands.push('go test ./...');
  if (
    (await isFile(join(cwd, 'pyproject.toml'))) ||
    (await isFile(join(cwd, 'pytest.ini'))) ||
    (await isFile(join(cwd, 'tox.ini')))
  ) {
    commands.push('python -m pytest');
  }

  return [...new Set(commands)].slice(0, 8);
}

interface PackageJson {
  packageManager?: string;
  scripts?: Record<string, unknown>;
}

async function readPackageJson(file: string): Promise<PackageJson | null> {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > 1_000_000) return null;
    const value = JSON.parse(await readFile(file, 'utf-8')) as unknown;
    if (typeof value !== 'object' || value === null) return null;
    return value as PackageJson;
  } catch {
    return null;
  }
}

type Manager = 'npm' | 'pnpm' | 'yarn' | 'bun';

async function packageManager(cwd: string, declared?: string): Promise<Manager> {
  const name = declared?.split('@')[0];
  if (name === 'pnpm' || name === 'yarn' || name === 'bun' || name === 'npm') return name;
  if (await isFile(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await isFile(join(cwd, 'yarn.lock'))) return 'yarn';
  if ((await isFile(join(cwd, 'bun.lock'))) || (await isFile(join(cwd, 'bun.lockb')))) return 'bun';
  return 'npm';
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}
