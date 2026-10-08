import * as fs from 'fs';
import * as path from 'path';
import pc from 'picocolors';
import { GITHUB_WORKFLOW_TEMPLATE, MCP_CURSOR_CONFIG } from './templates.js';

export interface InitOptions {
  ciOnly?: boolean;
  mcpOnly?: boolean;
  dryRun?: boolean;
  force?: boolean;
  dir?: string;
}

export interface ProjectInspection {
  projectRoot: string;
  hasPackageJson: boolean;
  playwrightConfigPath?: string;
  hasTracingConfigured: boolean;
  existingWorkflowsDir?: string;
  existingMcpConfigs: string[];
}

/**
 * Inspect the target project directory for Playwright, CI, and AI configurations
 */
export function inspectProject(baseDir: string): ProjectInspection {
  const root = path.resolve(baseDir);
  const hasPackageJson = fs.existsSync(path.join(root, 'package.json'));

  // Look for Playwright configuration
  const configCandidates = [
    'playwright.config.ts',
    'playwright.config.js',
    'playwright.config.mjs',
    'playwright.config.cjs',
  ];

  let playwrightConfigPath: string | undefined;
  let hasTracingConfigured = false;

  for (const candidate of configCandidates) {
    const fullPath = path.join(root, candidate);
    if (fs.existsSync(fullPath)) {
      playwrightConfigPath = fullPath;
      const content = fs.readFileSync(fullPath, 'utf8');
      // Check if trace option is set to retain on failure or always on
      if (
        content.includes("'retain-on-failure'") ||
        content.includes('"retain-on-failure"') ||
        content.includes("'on'") ||
        content.includes('"on"') ||
        content.includes("'on-first-retry'") ||
        content.includes('"on-first-retry"')
      ) {
        hasTracingConfigured = true;
      }
      break;
    }
  }

  // Look for existing MCP configurations
  const mcpCandidates = [
    path.join(root, '.cursor', 'mcp.json'),
    path.join(root, 'antigravity.json'),
    path.join(root, '.vscode', 'mcp.json'),
  ];
  const existingMcpConfigs = mcpCandidates.filter((p) => fs.existsSync(p));

  const workflowsDir = path.join(root, '.github', 'workflows');
  const existingWorkflowsDir = fs.existsSync(workflowsDir) ? workflowsDir : undefined;

  return {
    projectRoot: root,
    hasPackageJson,
    playwrightConfigPath,
    hasTracingConfigured,
    existingWorkflowsDir,
    existingMcpConfigs,
  };
}

/**
 * Run the one-command setup utility
 */
export async function runInit(options: InitOptions = {}): Promise<void> {
  const baseDir = options.dir || process.cwd();
  const inspection = inspectProject(baseDir);

  console.log(pc.cyan('\n🩺 Playwright Trace Doctor Setup Wizard'));
  console.log(pc.gray('=============================================='));

  if (!inspection.hasPackageJson) {
    console.warn(
      pc.yellow(`⚠️  Warning: No package.json found in ${inspection.projectRoot}. Setup proceeding anyway.`)
    );
  }

  // 1. Playwright Config Check
  if (inspection.playwrightConfigPath) {
    const configRel = path.relative(inspection.projectRoot, inspection.playwrightConfigPath);
    if (inspection.hasTracingConfigured) {
      console.log(pc.green(`✔ Found Playwright configuration: ${configRel} (tracing active)`));
    } else {
      console.log(pc.yellow(`⚠️  Found Playwright configuration: ${configRel}, but trace retention may be inactive.`));
      console.log(pc.gray('   To ensure traces are saved on failure, ensure your config includes:'));
      console.log(pc.cyan("   use: { trace: 'retain-on-failure' }"));
    }
  } else {
    console.log(pc.yellow('ℹ No playwright.config.* detected. Traces will be triaged whenever generated.'));
  }

  // 2. Configure GitHub Actions Workflow (unless --mcp-only)
  if (!options.mcpOnly) {
    const targetWorkflowPath = path.join(
      inspection.projectRoot,
      '.github',
      'workflows',
      'playwright-trace-doctor.yml'
    );
    const workflowRel = path.relative(inspection.projectRoot, targetWorkflowPath);

    if (fs.existsSync(targetWorkflowPath) && !options.force) {
      console.log(pc.blue(`ℹ GitHub Actions workflow already exists: ${workflowRel} (use --force to overwrite)`));
    } else {
      if (options.dryRun) {
        console.log(pc.magenta(`[DRY-RUN] Would create GitHub Actions workflow: ${workflowRel}`));
      } else {
        const workflowsDir = path.dirname(targetWorkflowPath);
        if (!fs.existsSync(workflowsDir)) {
          fs.mkdirSync(workflowsDir, { recursive: true });
        }
        fs.writeFileSync(targetWorkflowPath, GITHUB_WORKFLOW_TEMPLATE, 'utf8');
        console.log(pc.green(`✔ Created GitHub Actions failure autopsy workflow: ${workflowRel}`));
      }
    }
  }

  // 3. Configure Local AI Agent MCP Setup (unless --ci-only)
  if (!options.ciOnly) {
    const cursorMcpPath = path.join(inspection.projectRoot, '.cursor', 'mcp.json');
    const antigravityMcpPath = path.join(inspection.projectRoot, 'antigravity.json');

    // Register into .cursor/mcp.json if .cursor exists, or antigravity.json if antigravity exists
    let mcpTarget: string | undefined;
    if (fs.existsSync(path.join(inspection.projectRoot, '.cursor'))) {
      mcpTarget = cursorMcpPath;
    } else if (fs.existsSync(antigravityMcpPath)) {
      mcpTarget = antigravityMcpPath;
    }

    if (mcpTarget) {
      const relMcp = path.relative(inspection.projectRoot, mcpTarget);
      if (options.dryRun) {
        console.log(pc.magenta(`[DRY-RUN] Would register trace-doctor MCP server into: ${relMcp}`));
      } else {
        try {
          let current: any = {};
          if (fs.existsSync(mcpTarget)) {
            current = JSON.parse(fs.readFileSync(mcpTarget, 'utf8'));
          }
          current.mcpServers = current.mcpServers || {};
          current.mcpServers['trace-doctor'] = {
            command: 'npx',
            args: ['-y', 'playwright-trace-doctor', 'mcp'],
          };
          fs.writeFileSync(mcpTarget, JSON.stringify(current, null, 2), 'utf8');
          console.log(pc.green(`✔ Configured trace-doctor MCP server in: ${relMcp}`));
        } catch (err: any) {
          console.warn(pc.yellow(`⚠️ Could not auto-update ${relMcp}: ${err.message}`));
        }
      }
    }
  }

  console.log(pc.gray('=============================================='));
  console.log(pc.green('🎉 Setup Complete!'));
  console.log(pc.gray('\nNext steps:'));
  console.log(pc.cyan('1. Run your tests: ') + pc.white('npx playwright test'));
  console.log(pc.cyan('2. Instant CLI triage: ') + pc.white('npx playwright-trace-doctor --latest'));
  console.log(pc.cyan('3. On CI failures: ') + pc.white('Trace Doctor will automatically autopsy failures on PRs.\n'));
}
