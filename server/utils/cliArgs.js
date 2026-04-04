export function parseCliArgs(args) {
  const parsed = { command: 'start', options: {} };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--port' || arg === '-p') {
      parsed.options.port = args[++i];
    } else if (arg.startsWith('--port=')) {
      parsed.options.port = arg.split('=')[1];
    } else if (arg === '--database-path') {
      parsed.options.databasePath = args[++i];
    } else if (arg.startsWith('--database-path=')) {
      parsed.options.databasePath = arg.split('=')[1];
    } else if (arg === '--model' || arg === '-m') {
      parsed.options.model = args[++i];
    } else if (arg.startsWith('--model=')) {
      parsed.options.model = arg.split('=')[1];
    } else if (arg === '--key') {
      parsed.options.key = args[++i];
    } else if (arg.startsWith('--key=')) {
      parsed.options.key = arg.split('=')[1];
    } else if (arg === '--base-url') {
      parsed.options.baseUrl = args[++i];
    } else if (arg.startsWith('--base-url=')) {
      parsed.options.baseUrl = arg.split('=')[1];
    } else if (arg === '--help' || arg === '-h') {
      parsed.command = 'help';
    } else if (arg === '--version' || arg === '-v') {
      parsed.command = 'version';
    } else if (!arg.startsWith('-')) {
      parsed.command = arg;
    }
  }

  return parsed;
}
