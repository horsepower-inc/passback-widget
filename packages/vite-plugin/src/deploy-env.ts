// A hosted preview build hands the pull request number to the widget.

export const PR_STORAGE_KEY = 'passback:pr'; // must equal PR_STORAGE_KEY in packages/widget/src/pr-link.ts

const PULL_REQUEST = /^[1-9]\d{0,8}$/;

export function pullRequestFromEnv(env: Record<string, string | undefined>): number | undefined {
  const vercel = env.VERCEL_GIT_PULL_REQUEST_ID;
  if (vercel !== undefined && PULL_REQUEST.test(vercel)) return Number(vercel);
  const netlify = env.REVIEW_ID;
  if (env.CONTEXT === 'deploy-preview' && netlify !== undefined && PULL_REQUEST.test(netlify)) {
    return Number(netlify);
  }
  return undefined;
}

export function pullRequestScript(pullRequest: number): string {
  const key = JSON.stringify(PR_STORAGE_KEY);
  return `try{sessionStorage.getItem(${key})||sessionStorage.setItem(${key},"${pullRequest}")}catch(e){}`;
}
