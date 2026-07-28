const GITHUB_API_URL = "https://api.github.com";

export type GithubConfig = {
  token: string;
  repo: string;
  baseBranch: string;
};

/** Reads GitHub credentials/config from env vars. Returns null if not configured. */
export function getGithubConfig(): GithubConfig | null {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return null;
  return { token, repo, baseBranch: process.env.GITHUB_BASE_BRANCH || "main" };
}

async function githubFetch(path: string, token: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(`${GITHUB_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  const data: any = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`GitHub API error ${response.status} on ${path}: ${data?.message ?? response.statusText}`);
  }
  return data;
}

export async function getBranchSha({ repo, branch, token }: { repo: string; branch: string; token: string }): Promise<string> {
  const ref = await githubFetch(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token);
  return ref.object.sha;
}

export async function getFileContent({
  repo,
  path,
  ref,
  token,
}: {
  repo: string;
  path: string;
  ref: string;
  token: string;
}): Promise<{ content: string; sha: string }> {
  const file = await githubFetch(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, token);
  const content = Buffer.from(file.content, "base64").toString("utf-8");
  return { content, sha: file.sha };
}

export async function createBranch({
  repo,
  branch,
  fromSha,
  token,
}: {
  repo: string;
  branch: string;
  fromSha: string;
  token: string;
}): Promise<void> {
  await githubFetch(`/repos/${repo}/git/refs`, token, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }),
  });
}

export async function updateFile({
  repo,
  path,
  branch,
  sha,
  content,
  message,
  token,
}: {
  repo: string;
  path: string;
  branch: string;
  sha: string;
  content: string;
  message: string;
  token: string;
}): Promise<void> {
  await githubFetch(`/repos/${repo}/contents/${path}`, token, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf-8").toString("base64"),
      sha,
      branch,
    }),
  });
}

export async function createPullRequest({
  repo,
  branch,
  baseBranch,
  title,
  body,
  token,
}: {
  repo: string;
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
  token: string;
}): Promise<string> {
  const pr = await githubFetch(`/repos/${repo}/pulls`, token, {
    method: "POST",
    body: JSON.stringify({ title, head: branch, base: baseBranch, body }),
  });
  return pr.html_url;
}
