function basename(workspacePath: string): string {
  const trimmed = workspacePath.replace(/[\\/]+$/, '');
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return separator === -1 ? trimmed : trimmed.slice(separator + 1);
}

export function endpointIdentity(workspacePath: string): string {
  return basename(workspacePath);
}
