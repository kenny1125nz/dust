function basename(workspacePath: string): string {
  const trimmed = workspacePath.replace(/[\\/]+$/, '');
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return separator === -1 ? trimmed : trimmed.slice(separator + 1);
}

const WINDOWS_PIPE_PREFIX = '\\\\.\\pipe\\dust-';

/** Pure function: workspace path → workspace folder name (`basename`). */
export function endpointIdentity(workspacePath: string): string {
  return basename(workspacePath);
}

/**
 * The shared endpoint for a workspace's completion channel.
 *
 * - Windows: a named pipe `\\.\pipe\dust-<name>`.
 * - POSIX: an absolute Unix-socket path under the system temp dir. A socket
 *   path is resolved against the *process* CWD, and the extension host and the
 *   `dust-callback` CLI run in different directories, so a relative name would
 *   point at two different files and the connect would fail with ENOENT.
 *
 * The `os`/`path` requires are deferred so this module stays bundleable for
 * the webview (which never calls this function); consumers in Node get the
 * absolute socket path.
 */
export function completionPipeName(workspacePath: string): string {
  const name = basename(workspacePath);
  if (process.platform === 'win32') {
    return `${WINDOWS_PIPE_PREFIX}${name}`;
  }
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  return path.join(os.tmpdir(), `dust-${name}.sock`);
}
