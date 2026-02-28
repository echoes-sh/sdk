#!/usr/bin/env node
import { init } from "./commands/init";

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case "init":
      await init();
      break;
    case "--version":
    case "-v":
      console.log("@echoessh/sdk v1.0.0");
      break;
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
  Echoes CLI - Centralized feedback platform for developers

  Usage: echoes <command>

  Commands:
    init        Initialize Echoes in your project

  Options:
    -v, --version    Show version number
    -h, --help       Show help

  Examples:
    $ echoes init

  Documentation: https://echoes.sh/docs
`);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
