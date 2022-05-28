import { Octokit } from "octokit";
import { exec } from "child_process";
import { promisify } from "util";
import { join as joinPath } from "path";
import * as fs from "fs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
  disableConsoleLogging,
  enableConsoleLogging,
  logger,
  setLogLevel,
} from "./config";
import * as cliProgress from "cli-progress";
import { SearchRepoResultItem, SimpleUser } from "./types";
import retry from "async-retry";

const GIT_CLONE_EXPECTED_STDERR_REGEX = /^Cloning into '.+'...$/;

const GIT_CLONE_RETRY_OPTS = {
  retries: 10,
  factor: 2, // exponential backoff
  minTimeout: 1000, // 1 second.
  maxTimeout: 5 * 60 * 1000, // 5 minutes
};

const execPromisified = promisify(exec);

async function execAsync(command: string) {
  logger.debug(`Executing command: ${command}`);
  return await execPromisified(command);
}

if (!process.env.GITHUB_TOKEN) {
  throw Error("GITHUB_TOKEN is not set");
}

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  request: {
    retries: 15,
    retryAfter: 20,
  },
  // TODO This doesn't seem to work. I experience noticeable delays during the
  // search phase which clearly indicate throttling, but I don't see any log.
  log: {
    debug: (message: string) => {
      logger.debug(message);
    },
    info: (message: string) => {
      logger.info(message);
    },
    warn: (message: string) => {
      logger.warn(message);
    },
    error: (message: string) => {
      logger.error(message);
    },
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

const LANGUAGE_FILE_EXTENSION_MAP: { [language: string]: Readonly<string[]> } =
  {
    c: ["c", "h"],
    cpp: ["C", "cc", "cpp", "cxx", "h", "hpp"],
    csharp: ["cs"],
    css: ["css"],
    go: ["go"],
    html: ["html"],
    java: ["java"],
    js: ["js"],
    perl: ["pl"],
    php: ["php"],
    python: ["py"],
    rust: ["rs"],
    sql: ["sql"],
    ts: ["ts"],
  } as const;

const SortOptions = ["stars", "forks"] as const;
type Sort = typeof SortOptions[number];

const OrderOptions = ["asc", "desc"] as const;
type Order = typeof OrderOptions[number];

const GITHUB_SEARCH_MAX_PAGE_SIZE = 100;

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
): Promise<SearchRepoResultItem[]> {
  const pageSize = Math.min(maxRepoCount, GITHUB_SEARCH_MAX_PAGE_SIZE);
  const pageCount = Math.ceil(maxRepoCount / pageSize);

  logger.info(`Searching for '${language}' repos...`);
  if (pageCount > 1) {
    logger.info(
      `${pageCount} requests are required to retrieve ${maxRepoCount} repos.`
    );
  }

  // Paginated requests to retrieve the desired number of repos.
  const itemsFromAllPages = [];
  for (let page = 1; page <= pageCount; page++) {
    logger.debug(`Searching for '${language}' repos [${page}/${pageCount}]...`);
    const {
      data: { items },
    } = await octokit.rest.search.repos({
      q: `language:${language}`,
      per_page: pageSize,
      page,
      sort,
      order,
    });
    itemsFromAllPages.push(...items);
  }

  logger.info(`Found ${itemsFromAllPages.length} ${language} repos:`);
  itemsFromAllPages.forEach((repo) => {
    logger.info(`- ${repo.full_name}`);
  });

  return itemsFromAllPages;
}

/**
 * Executes a git command to clone the given repository.
 *
 * @param repo The repository to clone.
 * @param cloneDir The directory to clone the repository into.
 */
async function gitClone(
  repo: SearchRepoResultItem & { owner: SimpleUser }, // We require the owner.
  cloneDir: string
): Promise<void> {
  const { full_name: repoFullName, html_url: repoHtmlUrl } = repo;

  // To reduce download time, we clone with the `--depth` flag set to 1.
  const res = await execAsync(`git clone --depth 1 ${repoHtmlUrl} ${cloneDir}`);

  // Check for unexpected output that could potentially indicate an error.
  if (
    res.stdout.trim() !== "" ||
    !GIT_CLONE_EXPECTED_STDERR_REGEX.test(res.stderr.trim())
  ) {
    logger.warn(`Unexpected stdout or stderr while cloning ${repoFullName}:
stdout:
${res.stdout}

stderr:
${res.stderr}`);
  }
}

/**
 * Same as {@link gitClone}, but retries the operation if it fails.
 *
 * @param repo The repository to clone.
 * @param cloneDir The directory to clone the repository into.
 */
async function gitCloneWithRetries(
  repo: SearchRepoResultItem & { owner: SimpleUser }, // We require the owner.
  cloneDir: string
) {
  const { name: repoName } = repo;
  try {
    await retry(async (_bail, attempt) => {
      try {
        await gitClone(repo, cloneDir);
      } catch (err) {
        logger.warn(`Attempt ${attempt} to clone ${repoName} failed: ${err}`);
        throw err;
      }
    }, GIT_CLONE_RETRY_OPTS);
  } catch (err) {
    logger.error(`Failed to clone ${repoName}: ${err}`);
    // Rethrow the error so the promise is rejected.
    throw err;
  }
}

/**
 * Removes non-code files except LICENSE or README files from a repository.
 *
 * @param cloneDir The directory where the repository was cloned.
 * @param languagesToKeep A list of programming languages to keep code for.
 */
async function cleanUpRepo(
  cloneDir: string,
  languagesToKeep: Readonly<Language[]>
): Promise<void> {
  // Finds the extensions of the languages that we would like to keep.
  const extsToKeep = languagesToKeep.flatMap(
    (lang) => LANGUAGE_FILE_EXTENSION_MAP[lang]
  );

  // Builds `find` utility arguments to exclude the files with the extensions
  // extensions we want to keep.
  const extsToKeepFlags = extsToKeep
    .map((ext) => `-not -name "*.${ext}"`)
    .join(" ");

  // Builds `find` utility arguments to exclude LICENSE files.
  const licenseFileFlags = `-not -iname "LICENSE*" -not -iname "COPYING"`;

  // Builds `find` utility arguments to exclude README files.
  const readmeFileFlags = `-not -iname "README*"`;

  try {
    // Execute a bash command to delete all files in the repository that are not
    // code or license files.
    await execAsync(
      `find ${cloneDir} -type f ` +
        `${extsToKeepFlags} ` + // Keep code files.
        `${licenseFileFlags} ` + // Keep LICENSE files.
        `${readmeFileFlags} ` + // Keep README files.
        `-delete` // Delete all other files.
    );

    // Execute a bash command to delete all empty directories in the repository.
    await execAsync(`find ${cloneDir} -type d -empty -delete`);
  } catch (err) {
    logger.warn(`Failed to clean up ${cloneDir}: ${err}
Notice that the repository was successfully cloned, but it will likely contain
other files that are not code files. You can delete those files manually.
`);
  }
}

/**
 * Clones a repository to the given directory.
 *
 * This function is not simply a wrapper around `git clone`, but also cleans
 * non-code files from the repository after cloning. The list of programming
 * languages to consider is specified by the {@link languagesToKeep} parameter.
 *
 * Notice that in addition to keeping the code files, this function also keeps
 * the README and LICENSE files.
 *
 * @param repo The repository to clone.
 * @param reposDir The directory to clone the repository to.
 * @param language The programming language of the repository.
 * @param languagesToKeep An array containing the programming languages to keep
 * after cloning the repository during the clean up phase.
 */
async function cloneRepo(
  repo: SearchRepoResultItem & { owner: SimpleUser }, // We require the owner.
  reposDir: string,
  language: Language,
  languagesToKeep: Readonly<Language[]>
): Promise<void> {
  const {
    owner: { login: ownerLogin },
    name: repoName,
    full_name: repoFullName,
  } = repo;
  const cloneDir = joinPath(reposDir, ownerLogin, repoName);

  // Cloning repositories is slow, so we only do it if the repository doesn't
  // already exist.
  if (fs.existsSync(cloneDir)) {
    logger.info(`Skipping ${ownerLogin}/${repoName} as it is already cloned.`);
    return;
  }

  logger.info(`[lang: ${language}] Cloning ${repoFullName}...`);

  // First, clone the repository.
  await gitCloneWithRetries(repo, cloneDir);

  // Then, remove non-code files except LICENSE or README files from the cloned
  // repository.
  await cleanUpRepo(cloneDir, languagesToKeep);
}

function parseArgs(): {
  dryRun: boolean;
  verbose: boolean;
  reposDir: string;
  languages: Readonly<Language[]>;
  keepOnlyMainLanguage: boolean;
  maxRepoCount: number;
  sort: Sort;
  order: Order;
} {
  // Create yargs with a parameter for the repository directory.
  const argv = yargs(hideBin(process.argv))
    .options({
      "dry-run": {
        type: "boolean",
        default: true,
        require: true,
        describe:
          "Doesn't actually clone repositories, but prints the lists of " +
          "repositories that would be clone in non-dry run mode.",
      },
      verbose: {
        type: "boolean",
        default: false,
        require: true,
        describe:
          "Whether to print extra logs during execution. This can be noisy.",
      },
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
      "keep-only-main-language": {
        type: "boolean",
        require: true,
        describe: `Repositories rarely contain only one language. If this flag
is set, only the code files of the main language of the repository will be kept.
If it is not set, all code files of the repository will be kept. For example,
while the Linux repository contains mainly C code, it also has code in Python,
Perl, etc. If this flag is set to true, only C files will be left; if it is set
to false, other code files that this tool supports will be kept.`.trim(),
        default: false,
      },
      "max-repo-count": {
        type: "number",
        require: true,
        describe: `The maximum number of repositories to download for each
programming language.`,
      },
      sort: {
        require: true,
        default: "stars" as Sort,
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
  const {
    dryRun,
    verbose,
    reposDir,
    languages,
    keepOnlyMainLanguage,
    maxRepoCount,
    sort,
    order,
  } = parseArgs();

  if (verbose) {
    console.log('Verbose mode requested. Setting log level to "debug".');
    setLogLevel("debug");
  } else {
    setLogLevel("info");
  }

  // Search for the repositories to clone.
  logger.info("Searching for repositories...");
  if (!verbose && maxRepoCount > GITHUB_SEARCH_MAX_PAGE_SIZE) {
    // When maxRepoCount is greater than maxPageSize, we need to make multiple
    // requests to GitHub to get the desired number of repos. Thus, we print a
    logger.warn(`You requested more than ${GITHUB_SEARCH_MAX_PAGE_SIZE}
repositories, meaning that we will have to make paginated requests to the GitHub
API to get the desired number of repositories. If you would like to see messages
for each paginated request made to see the progress, consider using the
--verbose flag.`);
  }
  const repoLists = await Promise.all(
    languages.map((l) => searchRepos(l, maxRepoCount, sort, order))
  );

  if (dryRun) {
    logger.warn("Dry run mode enabled. No repositories will be cloned.");
    logger.warn(
      "If run in non-dry run mode, the following repositories will be cloned:"
    );
    repoLists.forEach((repoList, idx) => {
      const language = languages[idx];
      for (const repo of repoList) {
        if (!repo.owner) {
          // The purpose of this check is mainly to prevent a TypeScript
          // compiler error; I don't know why the 'owner' field is optional as
          // it seems to me all repositories must have owners.
          logger.warn(`Skipping ${repo.name} as it is not owned by a user.`);
          continue;
        }
        console.log(`[lang: ${language}] - ${repo.full_name}`);
      }
    });

    console.log(
      'To clone the repositories, run again with "--dry-run" set to false.'
    );
    return;
  }

  // Create the `repos` directory if it doesn't exist.
  if (!fs.existsSync(reposDir)) {
    logger.info(`Creating repos directory ${reposDir}...`);
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

  // Disable console logging to avoid breaking the progress bars.
  disableConsoleLogging();

  const promises: Promise<void>[] = [];
  repoLists.forEach((repoList, idx) => {
    const language = languages[idx];
    for (const repo of repoList) {
      if (!repo.owner) {
        // The purpose of this check is mainly to prevent a TypeScript compiler
        // error; I don't know why a repository would not have an owner.
        logger.warn(`Skipping ${repo.name} as it is not owned by a user.`);
        clonedReposBar.increment();
        continue;
      }

      const languagesToKeep = keepOnlyMainLanguage ? [language] : languages;
      promises.push(
        cloneRepo(repo as any, reposDir, language, languagesToKeep)
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

  // Re-enable console logging.
  enableConsoleLogging();

  logger.info("");
  logger.info("Done. Please check the log files for any warnings or errors.");
}

main()
  .then()
  .catch((err) => {
    logger.error(err);
    process.exit(1);
  });
