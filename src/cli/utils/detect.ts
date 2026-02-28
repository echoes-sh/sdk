import * as fs from "fs";
import * as path from "path";

export type ProjectType = "nextjs" | "react" | "node" | "unknown";
export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function detectProjectType(cwd: string): ProjectType {
  const packageJsonPath = path.join(cwd, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    return "unknown";
  }

  try {
    const packageJson: PackageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf-8")
    );

    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    if (allDeps["next"]) {
      return "nextjs";
    }

    if (allDeps["react"] || allDeps["react-dom"]) {
      return "react";
    }

    return "node";
  } catch {
    return "unknown";
  }
}

export function detectPackageManager(cwd: string): PackageManager {
  if (fs.existsSync(path.join(cwd, "bun.lockb")) || fs.existsSync(path.join(cwd, "bun.lock"))) {
    return "bun";
  }

  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (fs.existsSync(path.join(cwd, "yarn.lock"))) {
    return "yarn";
  }

  return "npm";
}

export function getProjectName(cwd: string): string | null {
  const packageJsonPath = path.join(cwd, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson: PackageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf-8")
    );
    return packageJson.name || null;
  } catch {
    return null;
  }
}

export function hasEnvFile(cwd: string): boolean {
  return (
    fs.existsSync(path.join(cwd, ".env")) ||
    fs.existsSync(path.join(cwd, ".env.local"))
  );
}

export function getEnvFilePath(cwd: string): string {
  if (fs.existsSync(path.join(cwd, ".env.local"))) {
    return path.join(cwd, ".env.local");
  }
  return path.join(cwd, ".env");
}

export function isTypescript(cwd: string): boolean {
  return (
    fs.existsSync(path.join(cwd, "tsconfig.json")) ||
    fs.existsSync(path.join(cwd, "tsconfig.base.json"))
  );
}
