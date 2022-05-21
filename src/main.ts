import { Octokit } from "octokit";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { logger } from "./config";
import * as cliProgress from "cli-progress";

const execAsync = promisify(exec);

if (!process.env.GITHUB_TOKEN) {
  throw Error("GITHUB_TOKEN is not set");
}

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  request: {
    retries: 5,
    retryAfter: 60,
  },
});

// List of programming languages the user can download repositories for.
const LANGUAGES = [
  "c",
  "cpp",
  "csharp",
  "css",
  "go",
  "html",
  "java",
  "js",
  "perl",
  "php",
  "python",
  "rust",
  "sql",
  "ts",
] as const;
type Language = typeof LANGUAGES[number];

const LANGUAGE_FILE_EXTENSION_MAP = {
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  css: "css",
  go: "go",
  html: "html",
  java: "java",
  js: "js",
  perl: "pl",
  php: "php",
  python: "py",
  rust: "rs",
  sql: "sql",
  ts: "ts",
} as const;

const SortOptions = ["stars", "forks"] as const;
type Sort = typeof SortOptions[number];

const OrderOptions = ["asc", "desc"] as const;
type Order = typeof OrderOptions[number];

/**
 * Retrieves a list of repositories for a given language, sorted by the number
 * of stars or forks depending on the `sort` parameter.
 *
 * @param language The programming language of the repos to search.
 * @param maxRepoCount The maximum number of repos to return.
 * @param sort The field to sort the repos by.
 * @param order Whether the sort ascendingly or descendingly.
 *
 * @return A list of repositories.
 */
async function searchRepos(
  language: Language,
  maxRepoCount: number,
  sort: Sort = "forks",
  order: Order = "desc"
) {
  logger.info(
    `Searching for ${language} repos (sorted ${order} by ${sort})...`
  );
  const {
    data: { items },
  } = await octokit.rest.search.repos({
    q: `language:${language}`,
    per_page: maxRepoCount,
    sort,
    order,
  });
  logger.info(`Found ${items.length} ${language} repos:`);
  items.forEach((repo) => {
    logger.info(`- ${repo.full_name}`);
  });

  return items;
}

/**
 * Clones a repository to the given directory.
 * @param repo The repository to clone.
 * @param reposDir The directory to clone the repository to.
 * @param language The programming language of the repository.
 */
async function cloneRepo(
  repo: {
    owner: {
      login: string;
    };
    name: string;
    html_url: string;
  },
  reposDir: string,
  language: Language
): Promise<void> {
  // Execute a `git clone` on the repository. We clone the repo in a
  // sub-directory with the name of the repository under the given repository
  // directory.
  const {
    owner: { login: ownerLogin },
    name,
    html_url,
  } = repo;
  const cloneDir = `${reposDir}/${ownerLogin}/${name}`;

  // Cloning repositories is slow, so we only do it if the repository
  // doesn't already exist.
  if (fs.existsSync(cloneDir)) {
    logger.info(`Skipping ${ownerLogin}/${name} as it is already cloned.`);
    return;
  }

  logger.info(`[lang: ${language}] Cloning ${repo.name}...`);

  // To reduce download time, we clone with the `--depth` flag set to 1.
  try {
    await execAsync(`git clone --depth 1 ${html_url} ${cloneDir}`);
  } catch (err) {
    logger.error(`Failed to clone ${repo.name}: ${err}`);
    return;
  }

  // Find the extension of the programming language of the repository.
  const fileExtension = LANGUAGE_FILE_EXTENSION_MAP[language];

  try {
    // Execute a bash command to delete all files in the repository that are not code files.
    await execAsync(
      `find ${cloneDir} -type f -not -name "*.${fileExtension}" -delete`
    );

    // Execute a bash command to delete all empty directories in the repository.
    await execAsync(`find ${cloneDir} -type d -empty -delete`);
  } catch (err) {
    logger.warn(`Failed to clean up ${repo.name}: ${err}
Notice that the repository was successfully cloned, but it will likely contain other files that are not ${language} code files. You can delete these files manually.
`);
  }
}

function parseArgs(): {
  reposDir: string;
  languages: Readonly<Language[]>;
  maxRepoCount: number;
  sort: Sort;
  order: Order;
} {
  // Create yargs with a parameter for the repository directory.
  const argv = yargs(hideBin(process.argv))
    .options({
      "repos-dir": {
        type: "string",
        require: true,
        describe: "The directory to clone repositories to",
      },
      languages: {
        array: true,
        require: true,
        describe: "The programming languages to download repositories for",
        default: LANGUAGES,
        choices: LANGUAGES,
      },
      "max-repo-count": {
        type: "number",
        require: true,
        describe:
          "The maximum number of repositories per programming language to download",
      },
      sort: {
        require: true,
        default: "forks" as Sort,
        describe: "The field to sort the repos by",
        choices: SortOptions,
      },
      order: {
        require: true,
        default: "desc" as Order,
        describe: "Whether to sort ascendingly or descendingly",
        choices: OrderOptions,
      },
    })
    .parseSync();

  return argv;
}

async function main() {
  const { reposDir, languages, maxRepoCount, sort, order } = parseArgs();

  // Search for the repositories to clone.
  const repoLists = await Promise.all(
    LANGUAGES.map((language) => {
      // Ensure that language is one of LANGUAGES.
      if (!languages.includes(language)) {
        throw new Error(`Invalid language: ${language}`);
      }
      return searchRepos(language, maxRepoCount, sort, order);
    })
  );

  // Create the `repos` directory if it doesn't exist.
  if (!fs.existsSync(reposDir)) {
    logger.info(`Creating repos directory ${reposDir} ...`);
    fs.mkdirSync(reposDir);
  }

  // Calculate the total number of repositories to download.
  const totalRepoCount = repoLists.reduce((acc, list) => acc + list.length, 0);

  // Create progress bars to show the progress of the process.
  const multiProgressBar = new cliProgress.MultiBar({});
  const clonedReposBar = multiProgressBar.create(
    totalRepoCount,
    0,
    {},
    {
      format: `Cloned repos: [{bar}] {percentage}% | {value}/{total}`,
    }
  );
  const failedReposBar = multiProgressBar.create(
    totalRepoCount,
    0,
    {},
    {
      format: `Failed repos: [{bar}] {percentage}% | {value}/{total}`,
    }
  );

  const promises: Promise<void>[] = [];
  repoLists.forEach((repoList, idx) => {
    const language = LANGUAGES[idx];
    for (const repo of repoList) {
      if (!repo.owner) {
        // The purpose of this check is mainly to prevent a TypeScript compiler error; I don't
        // know why a repository would not have an owner.
        logger.warn(`Skipping ${repo.name} as it is not owned by a user.`);
        clonedReposBar.increment();
        continue;
      }

      promises.push(
        cloneRepo(repo as any, reposDir, language)
          .then(() => {
            clonedReposBar.increment();
          })
          .catch(() => {
            failedReposBar.increment();
          })
      );
    }
  });

  // Wait for all promises to finish.
  await Promise.all(promises);

  // Stop progress bars.
  clonedReposBar.stop();
  multiProgressBar.stop();

  console.log('Done. Please check the log files for any warnings or errors.');
}

main()
  .then()
  .catch((err) => {
    logger.error(err);
    process.exit(1);
  });
