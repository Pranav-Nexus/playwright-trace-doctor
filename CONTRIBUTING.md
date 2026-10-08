# Contributing to Playwright Trace Doctor 🩺

Thank you for your interest in contributing to **Playwright Trace Doctor**! We welcome PRs, bug reports, and heuristic improvements to help developers and AI agents debug broken tests faster.

---

## 🛠️ Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Pranav-Nexus/playwright-trace-doctor.git
   cd playwright-trace-doctor
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build TypeScript:**
   ```bash
   npm run build
   ```

4. **Run tests & stress benchmark:**
   ```bash
   npm test
   npm run test:stress
   ```

---

## 📌 PR Guidelines

- **Branch Naming:** Use descriptive branches like `feat/new-detector`, `fix/locator-regex`, `docs/readme-update`.
- **Commit Messages:** Follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `perf:`, `test:`).
- **Token Efficiency:** Any new diagnostic output intended for MCP agent consumption must stay within strict token budgets (< 1.5k tokens).
- **Zero Regression:** Ensure `npm run test:stress` passes with 5/5 suites passing before opening a PR.
