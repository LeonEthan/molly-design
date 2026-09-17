import spawn from 'cross-spawn';

// Executable-only contract, matching pi-acp's PI_ACP_PI_COMMAND. Never interpolate
// a user command into a shell string. Preserve Pi arguments and user config.
const command = (process.env.MOLLY_DESIGN_PI_COMMAND ?? process.env.LODY_DESIGN_PI_COMMAND);
const extension = (process.env.MOLLY_DESIGN_EXTENSION ?? process.env.LODY_DESIGN_EXTENSION);
if (!command || !extension) throw Error('Missing Molly Pi launch context');
const version = spawn.sync(command, ['--version'], {
  env: process.env,
  encoding: 'utf8',
  timeout: 5000,
  killSignal: 'SIGKILL',
  windowsHide: true,
});
const mcpExtension = (process.env.MOLLY_PI_MCP_EXTENSION ?? process.env.LODY_PI_MCP_EXTENSION);
const child = spawn(
  command,
  [
    '--extension',
    extension,
    ...(mcpExtension ? ['--extension', mcpExtension] : []),
    ...process.argv.slice(2),
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      MOLLY_DESIGN_PI_VERSION: version.status === 0 ? version.stdout.trim() : 'unknown',
    },
  }
);
child.on('error', () => {
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    child.kill(signal);
  });
