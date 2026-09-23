export interface CliOptions {
  input: string;
  output?: string;
  help: boolean;
}

const HELP = `easyql — validate a JSON schema and print SQLite DDL

Usage:
  easyql [input] [-o output]

  input            schema file (default: schema.json)
  -o, --output     write DDL to file instead of stdout
  -h, --help       show this help
`;

export function parseArgs(argv: string[]): CliOptions | { error: string } {
  const positionals: string[] = [];
  let output: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "-o" || arg === "--output") {
      const next = argv[++i];
      if (!next) return { error: "missing value for -o/--output" };
      output = next;
    } else if (arg.startsWith("-")) {
      return { error: `unknown flag "${arg}"` };
    } else {
      positionals.push(arg);
    }
  }

  if (positionals.length > 1) {
    return { error: `unexpected argument "${positionals[1]}"` };
  }

  return { input: positionals[0] ?? "schema.json", output, help };
}

export function helpText(): string {
  return HELP;
}
