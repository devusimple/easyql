export type CliOptions =
  | { command: "generate"; input: string; output?: string; help: boolean }
  | { command: "diff"; old: string; current: string; output?: string; help: boolean }
  | { command: "seed"; schema: string; data: string; output?: string; help: boolean }
  | { command: "init"; dir: string; force: boolean; help: boolean }
  | { command: "validate"; schema: string; data?: string; help: boolean }
  | { command: "version"; help: boolean };

const HELP = `easyql — validate a JSON schema and print SQLite DDL

Usage:
  easyql [input] [-o output]        generate DDL from a schema file
  easyql diff <old> <new> [-o out]  migration statements from old to new schema
  easyql seed <schema> <data> [-o]  INSERTs from a JSON seed file
  easyql validate <schema> [data]   check schema (and seed) files, quiet on success
  easyql init [dir] [-f]            scaffold schema.json + seed.json
  easyql --version                  print version

  input            schema file (default: schema.json)
  -o, --output     write SQL to file instead of stdout
  -f, --force      overwrite existing files (init only)
  -h, --help       show this help
`;

export function parseArgs(argv: string[]): CliOptions | { error: string } {
  if (argv.includes("--version") || argv.includes("-V")) return { command: "version", help: false };
  if (argv[0] === "diff") return parseDiffArgs(argv.slice(1));
  if (argv[0] === "seed") return parseSeedArgs(argv.slice(1));
  if (argv[0] === "init") return parseInitArgs(argv.slice(1));
  if (argv[0] === "validate") return parseValidateArgs(argv.slice(1));
  return parseGenerateArgs(argv);
}

function parseFlags(argv: string[]): { output?: string; force?: boolean; help: boolean; rest: string[] } | { error: string } {
  let output: string | undefined;
  let force = false;
  let help = false;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "-f" || arg === "--force") {
      force = true;
    } else if (arg === "-o" || arg === "--output") {
      const next = argv[++i];
      if (!next) return { error: "missing value for -o/--output" };
      output = next;
    } else if (arg.startsWith("-")) {
      return { error: `unknown flag "${arg}"` };
    } else {
      rest.push(arg);
    }
  }

  return { output, force, help, rest };
}

function parseGenerateArgs(argv: string[]): CliOptions | { error: string } {
  const flags = parseFlags(argv);
  if ("error" in flags) return flags;
  if (flags.rest.length > 1) return { error: `unexpected argument "${flags.rest[1]}"` };
  return { command: "generate", input: flags.rest[0] ?? "schema.json", output: flags.output, help: flags.help };
}

function parseDiffArgs(argv: string[]): CliOptions | { error: string } {
  const flags = parseFlags(argv);
  if ("error" in flags) return flags;
  if (flags.rest.length < 2) return { error: "diff needs two schemas: easyql diff <old> <new>" };
  if (flags.rest.length > 2) return { error: `unexpected argument "${flags.rest[2]}"` };
  return { command: "diff", old: flags.rest[0], current: flags.rest[1], output: flags.output, help: flags.help };
}

function parseSeedArgs(argv: string[]): CliOptions | { error: string } {
  const flags = parseFlags(argv);
  if ("error" in flags) return flags;
  if (flags.rest.length < 2) return { error: "seed needs two files: easyql seed <schema> <data>" };
  if (flags.rest.length > 2) return { error: `unexpected argument "${flags.rest[2]}"` };
  return { command: "seed", schema: flags.rest[0], data: flags.rest[1], output: flags.output, help: flags.help };
}

function parseInitArgs(argv: string[]): CliOptions | { error: string } {
  const flags = parseFlags(argv);
  if ("error" in flags) return flags;
  if (flags.rest.length > 1) return { error: `unexpected argument "${flags.rest[1]}"` };
  return { command: "init", dir: flags.rest[0] ?? ".", force: flags.force ?? false, help: flags.help };
}

function parseValidateArgs(argv: string[]): CliOptions | { error: string } {
  const flags = parseFlags(argv);
  if ("error" in flags) return flags;
  if (flags.rest.length < 1) return { error: "validate needs a schema: easyql validate <schema> [data]" };
  if (flags.rest.length > 2) return { error: `unexpected argument "${flags.rest[2]}"` };
  return { command: "validate", schema: flags.rest[0], data: flags.rest[1], help: flags.help };
}

export function helpText(): string {
  return HELP;
}
