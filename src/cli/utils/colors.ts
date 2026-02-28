// Simple ANSI color utilities - no dependencies needed

const isColorSupported =
  process.env.FORCE_COLOR !== "0" &&
  (process.env.FORCE_COLOR === "1" ||
    process.env.COLORTERM !== undefined ||
    (process.stdout.isTTY && process.env.TERM !== "dumb"));

function colorize(code: string, text: string): string {
  if (!isColorSupported) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export const colors = {
  // Basic colors
  red: (text: string) => colorize("31", text),
  green: (text: string) => colorize("32", text),
  yellow: (text: string) => colorize("33", text),
  blue: (text: string) => colorize("34", text),
  magenta: (text: string) => colorize("35", text),
  cyan: (text: string) => colorize("36", text),
  white: (text: string) => colorize("37", text),
  gray: (text: string) => colorize("90", text),

  // Styles
  bold: (text: string) => colorize("1", text),
  dim: (text: string) => colorize("2", text),
  italic: (text: string) => colorize("3", text),
  underline: (text: string) => colorize("4", text),

  // Semantic
  success: (text: string) => colorize("32", text),
  error: (text: string) => colorize("31", text),
  warning: (text: string) => colorize("33", text),
  info: (text: string) => colorize("36", text),
};

export const symbols = {
  check: isColorSupported ? "✔" : "[OK]",
  cross: isColorSupported ? "✖" : "[ERR]",
  arrow: isColorSupported ? "→" : "->",
  bullet: isColorSupported ? "•" : "-",
  info: isColorSupported ? "ℹ" : "[i]",
  warning: isColorSupported ? "⚠" : "[!]",
  star: isColorSupported ? "★" : "*",
};

export function log(message: string): void {
  console.log(message);
}

export function success(message: string): void {
  console.log(`${colors.green(symbols.check)} ${message}`);
}

export function error(message: string): void {
  console.log(`${colors.red(symbols.cross)} ${message}`);
}

export function warning(message: string): void {
  console.log(`${colors.yellow(symbols.warning)} ${message}`);
}

export function info(message: string): void {
  console.log(`${colors.blue(symbols.info)} ${message}`);
}

export function step(number: number, message: string): void {
  console.log(`\n${colors.cyan(colors.bold(`Step ${number}:`))} ${message}`);
}

export function title(text: string): void {
  console.log(`\n${colors.bold(colors.cyan(text))}`);
}

export function code(text: string): void {
  console.log(colors.gray(`  ${text}`));
}

export function newline(): void {
  console.log();
}
