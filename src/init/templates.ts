/**
 * Workflow and configuration templates for playwright-trace-doctor init
 */

export const GITHUB_WORKFLOW_TEMPLATE = `name: Playwright Tests & Trace Doctor Autopsy

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write # Required for sticky PR failure diagnostic comments

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright Browsers
        run: npx playwright install --with-deps

      - name: Run Playwright Tests
        run: npx playwright test

      # 🩺 Trace Doctor Failure Autopsy
      - name: Run Playwright Trace Doctor Autopsy
        if: failure()
        run: |
          npx playwright-trace-doctor --latest --markdown > trace-autopsy.md
          cat trace-autopsy.md >> $GITHUB_STEP_SUMMARY

      - name: Post Diagnostic Autopsy to PR
        if: failure() && github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}
          script: |
            const fs = require('fs');
            if (!fs.existsSync('trace-autopsy.md')) return;
            const body = fs.readFileSync('trace-autopsy.md', 'utf8');
            const header = '<!-- playwright-trace-doctor-report -->';
            const commentBody = \`\${header}\\n\${body}\`;

            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });

            const botComment = comments.find(c => c.body && c.body.includes(header));
            if (botComment) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: botComment.id,
                body: commentBody,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body: commentBody,
              });
            }
`;

export const MCP_CURSOR_CONFIG = {
  mcpServers: {
    'trace-doctor': {
      command: 'npx',
      args: ['-y', 'playwright-trace-doctor', 'mcp'],
    },
  },
};

export const MCP_ANTIGRAVITY_CONFIG = {
  mcpServers: {
    'trace-doctor': {
      command: 'npx',
      args: ['-y', 'playwright-trace-doctor', 'mcp'],
    },
  },
};
