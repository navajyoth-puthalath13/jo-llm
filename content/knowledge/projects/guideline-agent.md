---
id: guideline-agent
title: Guideline Agent
covers: what it is, how it works, my role, why I built it, its limits
keywords: [guideline agent, guideline, agent, a11y agent, accessibility agent, pull request, pull requests, pr review, reviewer, code review, wcag, eslint, jsx-a11y, automated review]
actions: [a11y-agent]
---

- What it is: an open-source, learning-first AI reviewer for GitHub pull requests that looks for WCAG accessibility issues.
- How it works: it combines deterministic checks from eslint-plugin-jsx-a11y with AI-assisted review, and returns contextual findings and suggested fixes.
- My role: an independent design and engineering project.
- Why I built it: accessibility issues such as color contrast problems, inaccessible custom icons and missing alternative text can be fixed one by one, but similar problems reappear as a product and its contributors evolve. I wanted project-specific guidance to meet contributors inside the pull-request workflow, instead of expecting everyone to remember every guideline.
- Limits: it's a read-only reviewer. It doesn't modify files, create commits, push code or apply automatic fixes. Its findings are advisory and should be reviewed.
- Case study: https://navajyoth.com/work/a11y-agent
- Code: https://github.com/navajyoth-puthalath13/Guideline-Agent
