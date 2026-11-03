# Repository quality and anti-slop standards

These standards apply to documentation, user interfaces, code changes, and public project claims. They are review criteria, not evidence that a project already meets them.

## Truth before presentation
- Describe only functionality visible in the code or verified in a working deployment.
- Distinguish prototypes, demonstrations, and production integrations.
- Do not invent metrics, users, security guarantees, accessibility certifications, or test results.
- Explain important limitations and external dependencies plainly.

## Writing and presentation
- Prefer precise, short sentences over marketing language.
- Avoid inflated labels such as "enterprise-grade", "revolutionary", "ultimate", and "flagship" without specific evidence.
- Do not use decorative emoji, excessive badges, fake terminal output, animated counters, or unrelated imagery.
- Make the first README screen useful: purpose, current status, and how to run or view the project.
- Use consistent headings, terminology, links, and capitalization. Keep screenshots real and current.

## Interface quality
- Prioritize clear hierarchy, meaningful content, keyboard access, contrast, responsive layout, and reduced-motion support.
- Avoid generic dashboard cards, gratuitous gradients, glass effects, and motion without a user benefit.
- Do not sacrifice readability or performance for visual novelty.
- Test small screens, empty states, errors, and loading states when changing UI.

## Engineering and maintenance
- Keep changes scoped, reversible, and explained.
- Do not add dependencies, CI workflows, badges, or tests merely for appearances.
- Never commit credentials, tokens, private user data, or production secrets.
- Document actual setup and verification commands; do not claim checks passed unless run.
- Preserve working routes, deployment configuration, license terms, and attribution.

## Pull request acceptance
1. Every public-facing claim is supported or explicitly qualified.
2. No broken links or placeholder content are introduced.
3. Changes do not modify runtime behavior unless separately requested and tested.
4. The PR describes what changed, what was verified, and what remains unverified.
5. The project owner reviews changes before merge.

Copyright and attribution: Kevin Oloan Simatupang. Existing licenses and third-party attribution remain authoritative.
