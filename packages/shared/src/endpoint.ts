function basename(workspacePath: string): string {
  const trimmed = workspacePath.replace(/[\\/]+$/, '');
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return separator === -1 ? trimmed : trimmed.slice(separator + 1);
}

const PIPE_PREFIX = '\\\\.\\pipe\\dust-';

/** Pure function: workspace path → workspace folder name (`basename`). */
export function endpointIdentity(workspacePath: string): string {
  return basename(workspacePath);
}

/** Full named-pipe endpoint for a workspace: `\\.\pipe\dust-<basename>`. */
export function completionPipeName(workspacePath: string): string {
  return `${PIPE_PREFIX}${endpointIdentity(workspacePath)}`;
}
