import * as fs from "fs";
import * as path from "path";
import { prompts, ExitPromptError } from "../utils/prompts";
import {
  detectProjectType,
  detectPackageManager,
  getProjectName,
  hasEnvFile,
  getEnvFilePath,
  isTypescript,
  type ProjectType,
  type PackageManager,
} from "../utils/detect";
import {
  colors,
  symbols,
  success,
  error,
  warning,
  info,
  step,
  title,
  code,
  newline,
  log,
} from "../utils/colors";

interface InitConfig {
  projectName: string;
  apiKey: string;
  projectType: ProjectType;
  packageManager: PackageManager;
  useTypescript: boolean;
  addToEnv: boolean;
  createConfigFile: boolean;
}

const ECHOES_DASHBOARD_URL = "https://echoes.sh/dashboard/projects";

export async function init(): Promise<void> {
  const cwd = process.cwd();

  printBanner();

  log(colors.dim("Initializing Echoes in your project...\n"));

  // Detect project info
  const detectedType = detectProjectType(cwd);
  const detectedPackageManager = detectPackageManager(cwd);
  const detectedProjectName = getProjectName(cwd);
  const hasTs = isTypescript(cwd);

  if (detectedType === "unknown") {
    warning(
      "Could not detect project type. Make sure you're in a Node.js project directory."
    );
  } else {
    info(
      `Detected ${colors.bold(formatProjectType(detectedType))} project using ${colors.bold(detectedPackageManager)}`
    );
  }

  newline();

  try {
    // Step 1: Project name
    step(1, "Project Configuration");

    const projectName = await prompts.text({
      message: "Project name",
      defaultValue: detectedProjectName || path.basename(cwd),
      validate: (value) => {
        if (!value.trim()) return "Project name is required";
        if (value.length < 2) return "Project name must be at least 2 characters";
        return true;
      },
    });

    // Step 2: API Key
    step(2, "API Key Setup");

    log(
      `\n  You'll need an API key from your Echoes dashboard.`
    );
    log(
      `  ${colors.dim("Create a project at:")} ${colors.cyan(ECHOES_DASHBOARD_URL)}\n`
    );

    const hasApiKey = await prompts.confirm({
      message: "Do you already have an API key?",
      defaultValue: true,
    });

    let apiKey = "";

    if (hasApiKey) {
      apiKey = await prompts.text({
        message: "Enter your API key",
        validate: (value) => {
          if (!value.trim()) return "API key is required";
          if (!value.startsWith("ek_")) {
            return "API key should start with 'ek_'";
          }
          return true;
        },
      });
    } else {
      log(
        `\n  ${colors.yellow(symbols.arrow)} Visit ${colors.cyan(ECHOES_DASHBOARD_URL)} to create a project and get your API key.`
      );
      log(
        `  ${colors.dim("You can add it later to your .env file as ECHOES_API_KEY")}\n`
      );

      apiKey = await prompts.text({
        message: "Enter your API key (or press Enter to skip)",
        defaultValue: "",
      });
    }

    // Step 3: Configuration options
    step(3, "Configuration Options");

    const addToEnv = await prompts.confirm({
      message: "Add API key to .env file?",
      defaultValue: !!apiKey,
    });

    const createConfigFile = await prompts.confirm({
      message: `Create echoes.config.${hasTs ? "ts" : "js"} file?`,
      defaultValue: true,
    });

    // Build config
    const config: InitConfig = {
      projectName,
      apiKey,
      projectType: detectedType,
      packageManager: detectedPackageManager,
      useTypescript: hasTs,
      addToEnv,
      createConfigFile,
    };

    // Apply configuration
    newline();
    title("Setting up Echoes...");
    newline();

    // Create .env entry
    if (addToEnv && apiKey) {
      await addApiKeyToEnv(cwd, apiKey);
    }

    // Create config file
    if (createConfigFile) {
      await createEchoesConfig(cwd, config);
    }

    // Show success message and next steps
    printNextSteps(config);

    prompts.close();
  } catch (err) {
    prompts.close();

    // Handle graceful exit (Ctrl+C)
    if (err instanceof ExitPromptError) {
      newline();
      log(colors.dim("Setup cancelled."));
      newline();
      process.exit(0);
    }

    throw err;
  }
}

function printBanner(): void {
  log("");
  log(colors.cyan("  ┌─────────────────────────────────────────┐"));
  log(colors.cyan("  │                                         │"));
  log(colors.cyan("  │") + "    " + colors.bold(colors.white("((("))  + colors.cyan("  E C H O E S") + "                 " + colors.cyan("│"));
  log(colors.cyan("  │") + "   " + colors.bold(colors.white("((("))  + colors.dim("   Centralized Feedback") + "        " + colors.cyan("│"));
  log(colors.cyan("  │") + "    " + colors.bold(colors.white("((("))  + colors.dim("  for Developers") + "              " + colors.cyan("│"));
  log(colors.cyan("  │                                         │"));
  log(colors.cyan("  └─────────────────────────────────────────┘"));
  log("");
}

function formatProjectType(type: ProjectType): string {
  switch (type) {
    case "nextjs":
      return "Next.js";
    case "react":
      return "React";
    case "node":
      return "Node.js";
    default:
      return "Unknown";
  }
}

async function addApiKeyToEnv(cwd: string, apiKey: string): Promise<void> {
  const envPath = getEnvFilePath(cwd);
  const envExists = hasEnvFile(cwd);
  const envVarLine = `ECHOES_API_KEY=${apiKey}`;

  try {
    if (envExists) {
      const content = fs.readFileSync(envPath, "utf-8");

      // Check if already exists
      if (content.includes("ECHOES_API_KEY=")) {
        warning("ECHOES_API_KEY already exists in .env file, skipping...");
        return;
      }

      // Append to file
      const newContent = content.endsWith("\n")
        ? `${content}${envVarLine}\n`
        : `${content}\n${envVarLine}\n`;

      fs.writeFileSync(envPath, newContent);
      success(`Added ECHOES_API_KEY to ${path.basename(envPath)}`);
    } else {
      // Create new .env file
      fs.writeFileSync(envPath, `${envVarLine}\n`);
      success(`Created ${path.basename(envPath)} with ECHOES_API_KEY`);
    }
  } catch (err) {
    error(`Failed to update .env file: ${(err as Error).message}`);
  }
}

async function createEchoesConfig(
  cwd: string,
  config: InitConfig
): Promise<void> {
  const ext = config.useTypescript ? "ts" : "js";
  const configPath = path.join(cwd, `echoes.config.${ext}`);

  if (fs.existsSync(configPath)) {
    warning(`echoes.config.${ext} already exists, skipping...`);
    return;
  }

  const configContent = config.useTypescript
    ? generateTypescriptConfig(config)
    : generateJavascriptConfig(config);

  try {
    fs.writeFileSync(configPath, configContent);
    success(`Created echoes.config.${ext}`);
  } catch (err) {
    error(`Failed to create config file: ${(err as Error).message}`);
  }
}

function generateTypescriptConfig(config: InitConfig): string {
  return `import { type EchoesConfig } from "@echoessh/sdk";

const echoesConfig: EchoesConfig = {
  // Your Echoes API key (loaded from environment variable)
  apiKey: process.env.ECHOES_API_KEY!,

  // Optional: Set a default user identifier
  // defaultUserIdentifier: undefined,

  // Optional: Add default metadata to all feedback
  // defaultMetadata: {
  //   app: "${config.projectName}",
  //   version: "1.0.0",
  // },

  // Optional: Enable debug mode for development
  // debug: process.env.NODE_ENV === "development",
};

export default echoesConfig;
`;
}

function generateJavascriptConfig(config: InitConfig): string {
  return `/** @type {import("@echoessh/sdk").EchoesConfig} */
const echoesConfig = {
  // Your Echoes API key (loaded from environment variable)
  apiKey: process.env.ECHOES_API_KEY,

  // Optional: Set a default user identifier
  // defaultUserIdentifier: undefined,

  // Optional: Add default metadata to all feedback
  // defaultMetadata: {
  //   app: "${config.projectName}",
  //   version: "1.0.0",
  // },

  // Optional: Enable debug mode for development
  // debug: process.env.NODE_ENV === "development",
};

module.exports = echoesConfig;
`;
}

function printNextSteps(config: InitConfig): void {
  newline();
  title("Setup Complete!");
  newline();

  log(colors.bold("Next steps:"));
  newline();

  let stepNum = 1;

  // If no API key, remind to add it
  if (!config.apiKey) {
    log(
      `  ${colors.cyan(`${stepNum}.`)} Get your API key from ${colors.cyan(ECHOES_DASHBOARD_URL)}`
    );
    log(`     and add it to your .env file:`);
    code("ECHOES_API_KEY=ek_live_your_api_key");
    newline();
    stepNum++;
  }

  // Install SDK if needed
  const installCmd = getInstallCommand(config.packageManager);
  log(`  ${colors.cyan(`${stepNum}.`)} Install the SDK (if not already installed):`);
  code(installCmd);
  newline();
  stepNum++;

  // Show usage example based on project type
  log(`  ${colors.cyan(`${stepNum}.`)} Start sending feedback:`);
  newline();

  if (config.projectType === "nextjs" || config.projectType === "react") {
    printReactUsage(config);
  } else {
    printNodeUsage(config);
  }

  newline();
  log(colors.dim("─".repeat(50)));
  newline();
  log(`${colors.bold("Documentation:")} ${colors.cyan("https://echoes.sh/docs")}`);
  log(`${colors.bold("Dashboard:")}     ${colors.cyan("https://echoes.sh/dashboard")}`);
  newline();
}

function getInstallCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case "bun":
      return "bun add @echoessh/sdk";
    case "pnpm":
      return "pnpm add @echoessh/sdk";
    case "yarn":
      return "yarn add @echoessh/sdk";
    default:
      return "npm install @echoessh/sdk";
  }
}

function printReactUsage(config: InitConfig): void {
  if (config.createConfigFile) {
    log(colors.gray(`     // Using your config file`));
    code(`import echoesConfig from "./echoes.config";`);
    code(`import { Echoes } from "@echoessh/sdk";`);
    newline();
    code(`const echoes = new Echoes(echoesConfig);`);
  } else {
    code(`import { Echoes } from "@echoessh/sdk";`);
    newline();
    code(`const echoes = new Echoes({`);
    code(`  apiKey: process.env.ECHOES_API_KEY!,`);
    code(`});`);
  }

  newline();
  code(`// Send feedback`);
  code(`await echoes.send({`);
  code(`  category: "bug",`);
  code(`  message: "Something went wrong",`);
  code(`  userIdentifier: user?.email,`);
  code(`});`);
}

function printNodeUsage(config: InitConfig): void {
  if (config.createConfigFile) {
    if (config.useTypescript) {
      code(`import echoesConfig from "./echoes.config";`);
      code(`import { Echoes } from "@echoessh/sdk";`);
    } else {
      code(`const echoesConfig = require("./echoes.config");`);
      code(`const { Echoes } = require("@echoessh/sdk");`);
    }
    newline();
    code(`const echoes = new Echoes(echoesConfig);`);
  } else {
    if (config.useTypescript) {
      code(`import { Echoes } from "@echoessh/sdk";`);
    } else {
      code(`const { Echoes } = require("@echoessh/sdk");`);
    }
    newline();
    code(`const echoes = new Echoes({`);
    code(`  apiKey: process.env.ECHOES_API_KEY,`);
    code(`});`);
  }

  newline();
  code(`// Send feedback`);
  code(`await echoes.send({`);
  code(`  category: "feature",`);
  code(`  message: "Add dark mode support",`);
  code(`});`);
}
