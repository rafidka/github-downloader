import * as fs from "fs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { logger, setLogLevel } from "./config";
import { GITHUB_LAUNCH_DATE, Language, LANGUAGES } from "./const";
import { fetchRepoCode } from "./git";
import { RepoSearchQuery, searchRepos } from "./github";

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
  minStars: number;
  maxRepoCount?: number;
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
          "repositories that would be cloned in non-dry run mode.",
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
      "min-stars": {
        type: "number",
        require: true,
        describe: `The minimum number of stars for the repositories to download.`,
      },
      "max-repo-count": {
        type: "number",
        require: false,
        describe: `The minimum number of stars for the repositories to download.`,
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
    minStars,
    maxRepoCount,
  } = parseArgs();

  if (verbose) {
    console.log('Verbose mode requested. Setting log level to "debug".');
    setLogLevel("debug");
  } else {
    setLogLevel("info");
  }

  // Create the `repos` directory if it doesn't exist.
  if (!fs.existsSync(reposDir)) {
    logger.info(`Creating repos directory ${reposDir}...`);
    fs.mkdirSync(reposDir);
  }

  // Search for the repositories to clone.
  logger.info("Searching for repositories...");
  const query: RepoSearchQuery = {
    language: languages.map((l) => ({
      value: l,
    })),
    stars: {
      minValue: minStars,
    },
    created: {
      minValue: GITHUB_LAUNCH_DATE,
      maxValue: new Date(),
    },
  };

  // TODO We should be able to continue searching for more repositories while
  // cloning the current ones.
  for await (const partition of searchRepos(query)) {
    const promises: Promise<void>[] = [];

    for (const repo of partition.repos) {
      logger.info(`Cloning ${repo.name}`);
      if (dryRun) {
        // In dry-run mode; no need to clone the repository.
        continue;
      }

      if (!repo.owner) {
        // The purpose of this check is mainly to prevent a TypeScript compiler
        // error; I don't know why a repository would not have an owner.
        logger.warn(`Skipping ${repo.name} as it is not owned by a user.`);
        continue;
      }

      const languagesToKeep =
        keepOnlyMainLanguage && repo.language
          ? [repo.language as Language] // TODO Try to not use "as" keyword.
          : languages;
      promises.push(fetchRepoCode(repo as any, reposDir, languagesToKeep));
    }
    // Wait for all promises to finish.
    await Promise.all(promises);

    logger.info(
      `Finished cloning ${partition.countProgress}/${partition.totalCount} repositories.`
    );

    if (maxRepoCount && partition.countProgress >= maxRepoCount) {
      logger.info(`Reached max repo count ${maxRepoCount}.`);
      break;
    }
  }

  logger.info("");
  logger.info("Done. Please check the log files for any warnings or errors.");
}

main()
  .then()
  .catch((err) => {
    logger.error(err);
    process.exit(1);
  });
