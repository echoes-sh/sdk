import * as readline from "readline";

interface SelectOption {
  label: string;
  value: string;
}

export class ExitPromptError extends Error {
  constructor(message = "User cancelled the prompt") {
    super(message);
    this.name = "ExitPromptError";
  }
}

class Prompts {
  private rl: readline.Interface | null = null;
  private rejectFn: ((error: Error) => void) | null = null;

  private getReadline(): readline.Interface {
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      // Handle close event (triggered by Ctrl+C)
      this.rl.on("close", () => {
        if (this.rejectFn) {
          this.rejectFn(new ExitPromptError());
          this.rejectFn = null;
        }
      });
    }
    return this.rl;
  }

  close(): void {
    this.rejectFn = null;
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  async text(options: {
    message: string;
    placeholder?: string;
    defaultValue?: string;
    validate?: (value: string) => string | true;
  }): Promise<string> {
    const rl = this.getReadline();
    const defaultHint = options.defaultValue ? ` (${options.defaultValue})` : "";
    const prompt = `${options.message}${defaultHint}: `;

    return new Promise((resolve, reject) => {
      this.rejectFn = reject;

      rl.question(prompt, (answer) => {
        this.rejectFn = null;
        const value = answer.trim() || options.defaultValue || "";

        if (options.validate) {
          const validation = options.validate(value);
          if (validation !== true) {
            console.log(`  Error: ${validation}`);
            resolve(this.text(options));
            return;
          }
        }

        resolve(value);
      });
    });
  }

  async password(options: { message: string }): Promise<string> {
    return new Promise((resolve, reject) => {
      this.rejectFn = reject;
      const stdin = process.stdin;
      const stdout = process.stdout;

      stdout.write(`${options.message}: `);

      if (stdin.isTTY) {
        stdin.setRawMode(true);
      }
      stdin.resume();

      let password = "";

      const cleanup = () => {
        if (stdin.isTTY) {
          stdin.setRawMode(false);
        }
        stdin.removeListener("data", onData);
        this.rejectFn = null;
      };

      const onData = (char: Buffer) => {
        const c = char.toString();

        switch (c) {
          case "\n":
          case "\r":
          case "\u0004":
            cleanup();
            stdout.write("\n");
            resolve(password);
            break;
          case "\u0003": // Ctrl+C
            cleanup();
            stdout.write("\n");
            reject(new ExitPromptError());
            break;
          case "\u007F": // Backspace
            if (password.length > 0) {
              password = password.slice(0, -1);
              stdout.clearLine(0);
              stdout.cursorTo(0);
              stdout.write(`${options.message}: ${"*".repeat(password.length)}`);
            }
            break;
          default:
            password += c;
            stdout.write("*");
            break;
        }
      };

      stdin.on("data", onData);
    });
  }

  async confirm(options: { message: string; defaultValue?: boolean }): Promise<boolean> {
    const rl = this.getReadline();
    const defaultHint = options.defaultValue === true ? " (Y/n)" : options.defaultValue === false ? " (y/N)" : " (y/n)";
    const prompt = `${options.message}${defaultHint}: `;

    return new Promise((resolve, reject) => {
      this.rejectFn = reject;

      rl.question(prompt, (answer) => {
        this.rejectFn = null;
        const normalized = answer.trim().toLowerCase();

        if (normalized === "") {
          resolve(options.defaultValue ?? false);
          return;
        }

        if (normalized === "y" || normalized === "yes") {
          resolve(true);
        } else if (normalized === "n" || normalized === "no") {
          resolve(false);
        } else {
          console.log("  Please answer y or n");
          resolve(this.confirm(options));
        }
      });
    });
  }

  async select(options: {
    message: string;
    options: SelectOption[];
    defaultValue?: string;
  }): Promise<string> {
    const rl = this.getReadline();

    console.log(`\n${options.message}`);
    options.options.forEach((opt, index) => {
      const isDefault = opt.value === options.defaultValue;
      const marker = isDefault ? " (default)" : "";
      console.log(`  ${index + 1}. ${opt.label}${marker}`);
    });

    return new Promise((resolve, reject) => {
      this.rejectFn = reject;

      rl.question("\nSelect option (number): ", (answer) => {
        this.rejectFn = null;
        const trimmed = answer.trim();

        if (trimmed === "" && options.defaultValue) {
          resolve(options.defaultValue);
          return;
        }

        const index = parseInt(trimmed, 10) - 1;

        if (isNaN(index) || index < 0 || index >= options.options.length) {
          console.log("  Invalid selection, please try again");
          resolve(this.select(options));
          return;
        }

        resolve(options.options[index].value);
      });
    });
  }
}

export const prompts = new Prompts();
