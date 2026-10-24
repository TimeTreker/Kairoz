// Simulation software builds (仿真车软件): which modules the mock CI can build and what a build
// request may name. A repository and ref are only recorded; nothing is downloaded or executed.

/** Modules connected to the mock build provider, each with its registered recipe. */
export const SIM_MODULES = [
  { id: 'brake', name: '制动模块', nameEn: 'Brake module', recipe: 'mock-brake-build-v1' },
  { id: 'perception', name: '感知模块', nameEn: 'Perception module', recipe: 'mock-perception-build-v1' },
  { id: 'planning', name: '规划模块', nameEn: 'Planning module', recipe: 'mock-planning-build-v1' },
  { id: 'cabin', name: '座舱模块', nameEn: 'Cabin module', recipe: 'mock-cabin-build-v1' },
] as const;

export type SimModule = (typeof SIM_MODULES)[number];

export function simModule(id: string): SimModule | undefined {
  return SIM_MODULES.find((m) => m.id === id);
}

/** Only plain GitHub repository addresses: no other host, scheme, credentials, path or query. */
const REPOSITORY = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/;
const REF = /^[A-Za-z0-9._/-]{1,120}$/;
const COMMIT = /^[0-9a-f]{40}$/i;

export function repositoryIssue(url: string): string | null {
  return REPOSITORY.test(url.trim()) ? null : 'use a GitHub repository address: https://github.com/<owner>/<repo>';
}

export function refIssue(ref: string): string | null {
  return REF.test(ref.trim()) ? null : 'a branch, tag or commit: letters, digits, . _ / - (up to 120)';
}

/**
 * The commit a build pins. A 40-hex commit is recorded as given (its existence is not checked);
 * a branch or tag is resolved by the mock provider to a labelled mock commit.
 */
export function resolvedCommit(ref: string, buildId: string): string {
  return COMMIT.test(ref) ? ref.toLowerCase() : `mock-commit:${buildId}`;
}
