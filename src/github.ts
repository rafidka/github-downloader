import * as _ from "lodash";
import {
  Language,
  Sort,
  Order,
  GITHUB_SEARCH_MAX_RESULT_COUNT,
  GITHUB_SEARCH_MAX_PAGE_SIZE,
} from "./const";
import { Octokit } from "octokit";
import { SearchRepoResultItem } from "./types";
import { logger } from "./config";

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

/**
 * Retrieves a list of repositories for a given language, sorted by the number
 * of stars or forks depending on the `sort` parameter.
 *
 * @param language The programming language of the repos to search.
 * @param maxRepoCount The maximum number of repos to return.
 * @param sort The field to sort the repos by.
 * @param order Whether the sort ascendingly or descendingly.
 * @param sortFieldMaxValue The maximum value of the sorting field. This is
 * useful to enable retrieving more than the maximum number of results GitHub
 * allows. So, after the first request to this function, one can make another
 * call, setting the value of this parameter to the minimum value retrieved
 * from the last call.
 *
 * @return A list of repositories.
 */
async function searchReposHelper(
  language: Language,
  maxRepoCount: number,
  sort: Sort = "forks",
  order: Order = "desc",
  sortFieldMaxValue?: number
): Promise<SearchRepoResultItem[]> {
  if (maxRepoCount > GITHUB_SEARCH_MAX_RESULT_COUNT) {
    throw Error(
      `maxRepoCount cannot be greater than ${GITHUB_SEARCH_MAX_RESULT_COUNT}`
    );
  }

  const pageSize = Math.min(maxRepoCount, GITHUB_SEARCH_MAX_PAGE_SIZE);
  const pageCount = Math.ceil(maxRepoCount / pageSize);

  logger.info(`Searching for '${language}' repos...`);
  if (pageCount > 1) {
    logger.info(
      `${pageCount} requests are required to retrieve ${maxRepoCount} repos.`
    );
  }

  let query = `language:${language} archived:false`;
  if (sortFieldMaxValue) {
    query = `${sort}:<${sortFieldMaxValue} ${query}`;
  }

  // Paginated requests to retrieve the desired number of repos.
  const itemsFromAllPages: SearchRepoResultItem[] = [];
  for (let page = 1; page <= pageCount; page++) {
    logger.debug(`Searching for '${language}' repos [${page}/${pageCount}]...`);
    const res = await octokit.rest.search.repos({
      q: query,
      per_page: pageSize,
      page,
      sort,
      order,
    });
    const {
      data: { items },
    } = res;

    // Unfortunately, the results from the pages can overlap, so we deduplicate
    // them.
    const newItems = _.differenceBy(items, itemsFromAllPages, (x) => x.id);
    itemsFromAllPages.push(...newItems);
  }

  logger.info(`Found ${itemsFromAllPages.length} ${language} repos:`);
  itemsFromAllPages.forEach((repo) => {
    logger.info(`- ${repo.full_name}`);
  });

  return itemsFromAllPages;
}
/**
 * Similar to {@link searchReposHelper}, but is not limited by the maximum number of
 * results GitHub allows.
 *
 * @param language The programming language of the repos to search.
 * @param maxRepoCount The maximum number of repos to return.
 * @param sort The field to sort the repos by.
 * @param order Whether the sort ascendingly or descendingly.
 *
 * @return A list of repositories.
 */

export async function searchRepos(
  language: Language,
  maxRepoCount: number,
  sort: Sort = "forks",
  order: Order = "desc"
) {
  const maxRepoCountForOneCall = Math.min(
    maxRepoCount,
    GITHUB_SEARCH_MAX_RESULT_COUNT
  );
  const callCount = Math.ceil(maxRepoCount / maxRepoCountForOneCall);

  let sortFieldMaxValue: number | undefined = undefined;
  const itemsFromAllCalls: SearchRepoResultItem[] = [];
  for (let call = 1; call <= callCount; call++) {
    logger.info(
      `Calling searchRepos to search for '${language}' repos [${call}/${callCount}].`
    );
    let repos = await searchReposHelper(
      language,
      maxRepoCountForOneCall,
      sort,
      order,
      sortFieldMaxValue
    );

    if (repos.length == 0) {
      // No more results.
      break;
    }

    // Deduplicate the results. This is necessary to remove duplicates at the
    // boundaries of the sort field max value.
    const newItems = _.differenceBy(repos, itemsFromAllCalls, (x) => x.id);
    itemsFromAllCalls.push(...newItems);

    // Update the sort field max value to retrieve more results.
    if (sort === "stars") {
      sortFieldMaxValue = Math.min(
        ...repos.map((repo) => repo.stargazers_count)
      );
    } else {
      sortFieldMaxValue = Math.min(...repos.map((repo) => repo.forks_count));
    }
  }

  return itemsFromAllCalls;
}
