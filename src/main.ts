import { Octokit } from "octokit";

async function main() {
  if (!process.env.GITHUB_TOKEN) {
    throw Error("GITHUB_TOKEN is not set");
  }

  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });

  const {
    data: { login },
  } = await octokit.rest.users.getAuthenticated();

  console.log(`Hello ${login}!`);
}

main().then();
