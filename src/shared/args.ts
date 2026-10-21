// Argument handling without a shell. Users type arguments as one line, the
// way they would in a Windows shortcut; we split them with the same rules the
// Microsoft C runtime uses (CommandLineToArgvW), then hand the array to
// child_process.spawn with shell: false, which re-quotes each argument safely.

export function splitArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let hasToken = false;
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === '\\') {
      let slashes = 0;
      while (input[i] === '\\') {
        slashes++;
        i++;
      }
      if (input[i] === '"') {
        current += '\\'.repeat(Math.floor(slashes / 2));
        if (slashes % 2 === 1) {
          current += '"';
          i++;
        }
      } else {
        current += '\\'.repeat(slashes);
      }
      hasToken = true;
      continue;
    }
    if (ch === '"') {
      // "" inside a quoted section is a literal quote.
      if (inQuotes && input[i + 1] === '"') {
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      hasToken = true;
      i++;
      continue;
    }
    if (!inQuotes && (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r')) {
      if (hasToken) args.push(current);
      current = '';
      hasToken = false;
      i++;
      continue;
    }
    current += ch;
    hasToken = true;
    i++;
  }
  if (hasToken) args.push(current);
  return args;
}

/** Characters that cmd.exe interprets even inside arguments. */
export const CMD_METACHARACTERS = /[&|<>^%!"\r\n]/;

/** Quotes one argument the way CommandLineToArgvW expects (for display). */
export function quoteArg(arg: string): string {
  if (arg && !/[\s"]/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

export function formatCommandLine(command: string, args: string[]): string {
  return [command, ...args].map(quoteArg).join(' ');
}
