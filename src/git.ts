// NodeJS imports.
import * as fs from "fs";

// 3rd party imports.
import retry from "async-retry";

// Local imports.
import { GIT_CLONE_EXPECTED_STDERR_REGEX } from "./main";
import { Language, LANGUAGE_FILE_EXTENSION_MAP } from "./const";
import { SearchRepoResultItem, SimpleUser } from "./types";
import { execAsync, rmAsync } from "./async";
import { join as joinPath } from "path";
import { logger } from "./config";

const GIT_CLONE_RETRY_OPTS = {
  retries: 10,
  factor: 2, // exponential backoff
  minTimeout: 1000, // 1 second.
  maxTimeout: 5 * 60 * 1000, // 5 minutes
};

/**
 * Executes a git command to clone the given repository.
 *
 * @param repo The repository to clone.
 * @param cloneDir The directory to clone the repository into.
 */
async function gitCloneHelper(
  repo: SearchRepoResultItem & { owner: SimpleUser },
  cloneDir: string
): Promise<void> {
  const { full_name: repoFullName, html_url: repoHtmlUrl } = repo;

  // Removes the clone directory if it exists.
  if (fs.existsSync(cloneDir)) {
    // TODO We are not supposed to need this, since cloneRepo() function checks if
    // the directory exists, and if it does, it doesn't process to clone.
    // However, experimentally, I experienced some errors with `git clone` related
    // to the directory already existing.
    await rmAsync(cloneDir, {
      recursive: true,
      force: true,
    });
  }

  // To reduce download time, we clone with the `--depth` flag set to 1.
  const res = await execAsync(
    `git clone --depth 1 ${repoHtmlUrl} ${cloneDir}`,
    {
      env: {
        // We need to set the GIT_TERMINAL_PROMPT variable to avoid credentials
        // prompt from git, which requires interactivity. I presume in this
        // case, the git command will fail and will be retried later. Notice
        // that for a clone, we don't need to have credentials, but it seems
        // that GitHub asks for them in case of excessive requests from the same
        // IP address. Hence, we just need to fail and let the retry mechanism
        // handle it.
        GIT_TERMINAL_PROMPT: "0",
      },
    }
  );

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
 * Executes a git command to clone the given repository. This function will
 * retry the clone operation in case of failure.
 *
 * @param repo The repository to clone.
 * @param cloneDir The directory to clone the repository into.
 */
export async function gitClone(
  repo: SearchRepoResultItem & { owner: SimpleUser }, // We require the owner.
  cloneDir: string
): Promise<void> {
  const { name: repoName } = repo;
  try {
    await retry(async (_bail, attempt) => {
      try {
        await gitCloneHelper(repo, cloneDir);
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
 * Fetches the code of a repository into the given directory.
 *
 * This function is not simply a wrapper around `git clone`, but also cleans
 * non-code files from the repository after cloning. The list of programming
 * languages to consider is specified by the {@link languagesToKeep} parameter.
 *
 * Notice that in addition to keeping the code files, this function also keeps
 * the README and LICENSE files.
 *
 * @param repo The repository to fetch the code of.
 * @param reposDir The directory to clone the repository to.
 * @param languagesToKeep An array containing the programming languages to keep
 * after cloning the repository during the clean up phase.
 */
export async function fetchRepoCode(
  repo: SearchRepoResultItem & { owner: SimpleUser }, // We require the owner.
  reposDir: string,
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

  logger.info(`Cloning ${repoFullName}...`);

  // First, clone the repository.
  await gitClone(repo, cloneDir);

  // Then, remove non-code files except LICENSE or README files from the cloned
  // repository.
  await cleanUpRepo(cloneDir, languagesToKeep);
}
