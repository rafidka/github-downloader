import * as fs from "fs";
import * as _ from "lodash";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
  disableConsoleLogging,
  enableConsoleLogging,
  logger,
  setLogLevel,
} from "./config";
import * as cliProgress from "cli-progress";
import {
  Language,
  Sort,
  Order,
  GITHUB_SEARCH_MAX_RESULT_COUNT,
  GITHUB_SEARCH_MAX_PAGE_SIZE,
  LANGUAGES,
  SortOptions,
  OrderOptions,
} from "./const";
import { fetchRepoCode } from "./git";
import { searchRepos } from "./github";

export const GIT_CLONE_EXPECTED_STDERR_REGEX = /^Cloning into '.+'...$/;

if (!process.env.GITHUB_TOKEN) {
  throw Error("GITHUB_TOKEN is not set");
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
        fetchRepoCode(repo as any, reposDir, languagesToKeep)
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
