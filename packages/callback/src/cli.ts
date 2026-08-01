import * as fs from 'fs';
import * as net from 'net';
import {
  CallbackStatus,
  CompletionFrame,
  CompletionSummary,
  endpointIdentity,
  isCallbackStatus,
} from '@dust/shared';

const PIPE_PREFIX = '\\\\.\\pipe\\dust-';
const CONNECT_TIMEOUT_MS = 5000;

interface CallbackArgs {
  status?: CallbackStatus;
  id?: string;
  summaryFile?: string;
  workspace?: string;
  help?: boolean;
}

const REQUIRED_FLAGS: Array<keyof CallbackArgs> = ['status', 'id', 'summaryFile', 'workspace'];

const USAGE = `dust-callback — @dust/callback: signal completion of a dust actor step.

Signals the dust extension that a dispatched turn has finished. The extension
listens on a workspace-keyed named pipe and advances the engine only after a
matching frame arrives.

Usage:
  dust-callback --status <done|error|needs-input> \\
      --id <correlationId> --summary_file <path> --workspace <name>

Flags:
  --status <done|error|needs-input>  (required) Authoritative turn outcome.
  --id <correlationId>               (required) Routes the frame to the exact
                                     awaiting step. The engine may have more
                                     than one step in flight, so a frame must
                                     name its target.
  --summary_file <path>              (required) Path to a JSON file matching the
                                     summary schema:
                                     {
                                       "confidence": <number 0-100>,
                                       "actions": ["<string>", ...],
                                       "notes": "<string>"
                                     }
                                     A path (not inline text) so large
                                     summaries never hit argv limits.
  --workspace <name>                 (required) Workspace folder name — the same
                                     basename the extension uses to name the pipe.
  --help, -h                         Print this usage and exit.

Example:
  dust-callback --status done \\
      --id 3f2a9c1b-0000-4000-8000-000000000000 \\
      --summary_file ./summary.json \\
      --workspace my-project

Exit codes: 0 on success, 1 on missing/invalid arguments or invalid summary
file, 2 on pipe connection failure.`;

function parseArgs(argv: string[]): CallbackArgs {
  const args: CallbackArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--status': {
        const value = argv[++i];
        args.status = isCallbackStatus(value) ? value : (value as CallbackStatus);
        break;
      }
      case '--id':
        args.id = argv[++i];
        break;
      case '--summary_file':
        args.summaryFile = argv[++i];
        break;
      case '--workspace':
        args.workspace = argv[++i];
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        break;
    }
  }
  return args;
}

function validateArgs(args: CallbackArgs): string[] {
  const missing = REQUIRED_FLAGS.filter((flag) => args[flag] === undefined);
  if (!missing.includes('status') && !isCallbackStatus(args.status as CallbackStatus)) {
    return [`status must be one of: done, error, needs-input`];
  }
  return missing;
}

function readSummary(path: string): CompletionSummary {
  const raw = fs.readFileSync(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`summary file is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const summary = parsed as Partial<CompletionSummary>;
  if (typeof summary !== 'object' || summary === null || Array.isArray(summary)) {
    throw new Error(`summary file must be a JSON object`);
  }
  if (typeof summary.confidence !== 'number' || summary.confidence < 0 || summary.confidence > 100) {
    throw new Error(`summary.confidence must be a number between 0 and 100`);
  }
  if (!Array.isArray(summary.actions) || summary.actions.some((a) => typeof a !== 'string')) {
    throw new Error(`summary.actions must be an array of strings`);
  }
  return {
    confidence: summary.confidence,
    actions: summary.actions,
    ...(summary.notes !== undefined ? { notes: summary.notes } : {}),
  };
}

function deliver(args: CallbackArgs, summary: CompletionSummary): Promise<void> {
  const pipeName = `${PIPE_PREFIX}${endpointIdentity(args.workspace as string)}`;
  const frame: CompletionFrame = {
    status: args.status as CallbackStatus,
    correlationId: args.id as string,
    summary,
  };

  return new Promise<void>((resolve, reject) => {
    const socket = net.createConnection(pipeName);
    socket.once('connect', () => {
      socket.write(`${JSON.stringify(frame)}\n`);
      socket.end();
    });
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
      socket.destroy(new Error(`timed out connecting to ${pipeName}`));
    });
    socket.once('error', (err) => reject(err));
    socket.once('close', () => resolve());
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }

  const invalid = validateArgs(args);
  if (invalid.length > 0) {
    process.stderr.write(`Error: missing or invalid required argument(s): ${invalid.join(', ')}\n\n`);
    process.stderr.write(`${USAGE}\n`);
    process.exit(1);
  }

  let summary: CompletionSummary;
  try {
    summary = readSummary(args.summaryFile as string);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
    process.exit(1);
  }

  try {
    await deliver(args, summary);
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: failed to deliver completion frame: ${message}\n`);
    process.exit(2);
  }
}

main();
