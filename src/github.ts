import { Octokit } from "octokit";
import { SearchRepoResultItem } from "./types";
import { logger } from "./config";
import { GITHUB_SEARCH_MAX_PAGE_SIZE } from "./const";

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
 * Represents a value that can be used in a repo search query.
 */
export type RepoSearchValue = number | Date | string;

/**
 * Interface for specifying a single-value keyword in a repository search query.
 *
 * For more information, see:
 * https://docs.github.com/en/rest/search#constructing-a-search-query
 *
 * Notice that I am slightly abusing GitHub's terminology here. The "keyword"
 * in their terminology refers to a field name and a value, e.g. "stars:>=1000".
 * Here, however, only the values are specified. The field names are part of the
 * `RepoSearchQuery` interface.
 */
export interface RepoSearchSingleValueKeyword<T extends RepoSearchValue> {
  value?: T;
}

/**
 * Interface for specifying a single search keyword in a repository search
 * query.
 *
 * For more information, see:
 * https://docs.github.com/en/rest/search#constructing-a-search-query
 *
 * Notice that I am slightly abusing GitHub's terminology here. The "keyword"
 * in their terminology refers to a field name and a value, e.g. "stars:>=1000".
 * Here, however, only the values are specified. The field names are part of the
 * `RepoSearchQuery` interface.
 */
export interface RepoSearchRangeKeyword<T extends RepoSearchValue> {
  minValue?: T;
  maxValue?: T;
}

/**
 * Interface for specifying a search query for repositories.
 *
 * For more information, see:
 * https://docs.github.com/en/rest/search#constructing-a-search-query
 */
export interface RepoSearchQuery {
  created: RepoSearchRangeKeyword<Date>;
  language?: RepoSearchSingleValueKeyword<string>[];
  stars?: RepoSearchRangeKeyword<number>;
  forks?: RepoSearchRangeKeyword<number>;
}

/**
 * Converts a repo search query value to a string.
 * @param value The value to be converted.
 * @returns The string representation of the value.
 */
function repoSearchValueToString(value?: RepoSearchValue): string {
  if (!value) {
    return "*";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value.toString();
}

/**
 * Converts a repo search single-value keyword, i.e. one with a single value,
 * to a string.
 *
 * @param keyword The keyword to convert.
 *
 * @returns The string representation of the keyword.
 */
function repoSearchSingleValueKeywordToString<T extends RepoSearchValue>(
  keyword: RepoSearchSingleValueKeyword<T>
): string {
  if (!keyword.value) {
    return "";
  }
  const value = repoSearchValueToString(keyword.value);
  return `${value}`;
}

/**
 * Converts a repo search range keyword, i.e. one with min and max values, to a
 * string.
 *
 * @param keyword The keyword to convert.
 *
 * @returns The string representation of the keyword.
 */
function repoSearchRangeKeywordToString<T extends RepoSearchValue>(
  keyword: RepoSearchRangeKeyword<T>
): string {
  if (!keyword.minValue && !keyword.maxValue) {
    return "";
  }
  const minValue = repoSearchValueToString(keyword.minValue);
  const maxValue = repoSearchValueToString(keyword.maxValue);
  return `${minValue}..${maxValue}`;
}

/**
 * Converts a repo search keyword to a string.
 *
 * @param keyword The keyword to be converted.
 *
 * @returns The string representation of the keyword.
 */
function repoSearchKeywordToString<T extends RepoSearchValue>(
  keyword: RepoSearchRangeKeyword<T> | RepoSearchSingleValueKeyword<T>
): string {
  if ("minValue" in keyword) {
    // This is a range keyword.
    return repoSearchRangeKeywordToString(keyword);
  } else if ("value" in keyword) {
    // This is a single-value keyword.
    return repoSearchSingleValueKeywordToString(keyword);
  } else {
    throw new Error("Unexpected code execution path.");
  }
}

/**
 * Converts a repo search query to a string.
 *
 * @param query The query to convert.
 *
 * @returns The string representation of the query.
 */
function repoSearchQueryToString(query: RepoSearchQuery): string {
  return Object.entries(query)
    .flatMap(([key, value]) => {
      if (Array.isArray(value)) {
        return value.map((v) => [key, v]);
      } else {
        return [[key, value]];
      }
    })
    .map(([fieldName, keyword]) => {
      return [fieldName, repoSearchKeywordToString(keyword)];
    })
    .filter(([, keywordStr]) => keywordStr !== "")
    .map(([fieldName, keywordStr]) => `${fieldName}:${keywordStr}`)
    .join(" ");
}

/**
 * Finds the number of repositories matching a given search query.
 *
 * @param query The repo search query.
 *
 * @returns The number of repositories matching the query.
 */
export async function findRepoCount(query: RepoSearchQuery): Promise<number> {
  const q = repoSearchQueryToString(query);
  const res = await octokit.rest.search.repos({
    q,
    per_page: 1,
  });
  return res.data.total_count;
}

/**
 * Interface used with partitionRepoSearchQuery to define a certain partition.
 */
interface SearchReposPartition {
  /**
   * The number of repositories in this partition.
   */
  count: number;

  /**
   * The starting date of this partition.
   */
  startDate: Date;

  /**
   * The ending date of this partition.
   */
  endDate: Date;
}

/**
 * Helper function for {@link partitionRepoSearchQuery}. See that function for
 * more information.
 */
async function partitionRepoSearchQueryHelper(
  query: RepoSearchQuery,
  maxRepoCountPerPartition: number,
  rootCall = true
): Promise<SearchReposPartition[]> {
  // Make sure we have valid creation min and max dates.
  if (!query.created?.minValue || !query.created?.maxValue) {
    throw new Error(
      "partitionRepoSearchQuery requires a valid creation start date."
    );
  }
  const { minValue: startDate, maxValue: endDate } = query.created;

  const count = await findRepoCount(query);
  if (count <= maxRepoCountPerPartition) {
    logger.debug(`Query contains ${count} repos; no need to partition.`);
    return [{ count, startDate, endDate }];
  }

  if (rootCall) {
    // Calculate the total number of bisections we need to do.
    const numBisections = Math.ceil(
      Math.log2(count / maxRepoCountPerPartition)
    );

    // Calculate the total number of requests to GitHub API we need to make.
    const numRequests = 2 ** (numBisections + 1) + 1;

    // Based on GitHub's max of 30 requests per minute, calculate the total
    // time required to finish partitioning.
    const totalMinutes = Math.ceil(numRequests / 30);

    logger.info(
      `There are ${count} matches for this query. To be able to retrieve all
      matches, the query needs to be partitioned. This operation will take
      up to ${totalMinutes} minutes.
      `
    );
  }

  logger.debug(`Query contains ${count} repositories. Partitioning...`);
  const midDate = new Date(
    startDate.getTime() + (endDate.getTime() - startDate.getTime()) / 2
  );
  const leftPartition = await partitionRepoSearchQueryHelper(
    {
      ...query,
      created: {
        ...query.created,
        maxValue: midDate,
      },
    },
    maxRepoCountPerPartition,
    false
  );
  const rightPartition = await partitionRepoSearchQueryHelper(
    {
      ...query,
      created: {
        ...query.created,
        minValue: midDate,
      },
    },
    maxRepoCountPerPartition,
    false
  );

  return [...leftPartition, ...rightPartition];
}

/**
 * Given a repository search query with valid creation date range, this function
 * partitions, if necessary, the query into multiple queries with smaller date
 * ranges such that each query returns at most `maxRepoCountInPartition` results.
 *
 * @param query The query to partition.
 * @param maxRepoCountPerPartition The maximum number of repositories in each
 * partition.
 *
 * @returns The list of partitions.
 */
async function partitionRepoSearchQuery(
  query: RepoSearchQuery,
  maxRepoCountPerPartition: number
): Promise<SearchReposPartition[]> {
  return await partitionRepoSearchQueryHelper(
    query,
    maxRepoCountPerPartition,
    true
  );
}

interface SearchReposResultPartition {
  totalCount: number;
  countInPartition: number;
  countProgress: number;
  percentageProgress: number;
  startDate: Date;
  endDate: Date;
  repos: SearchRepoResultItem[];
}

/**
 * Search for repositories within GitHub using the given query.
 *
 * This function works around GitHub's search API limitation of returning at most
 * 1000 results by partitioning the search query into multiple queries with
 * smaller date ranges.
 *
 * NOTICE that due to the potentially large number of partitions, the results
 * cannot be sorted.
 *
 * @param query The query for searching.
 *
 * @returns A promise
 */
export async function* searchRepos(
  query: RepoSearchQuery
): AsyncGenerator<SearchReposResultPartition> {
  const partitions = await partitionRepoSearchQuery(
    query,
    GITHUB_SEARCH_MAX_PAGE_SIZE
  );

  logger.info(`Broke the query into ${partitions.length} partitions:`);
  for (const partition of partitions) {
    const [count, start, end] = [
      partition.count,
      partition.startDate.toISOString(),
      partition.endDate.toISOString(),
    ];
    logger.info(`- ${count} repos between ${start} and ${end}`);
  }

  async function searchReposInPartition(
    partition: SearchReposPartition
  ): Promise<SearchRepoResultItem[]> {
    logger.debug(
      `Searching repos in partition ${partition.startDate} - ${partition.endDate}`
    );
    const response = await octokit.rest.search.repos({
      q: repoSearchQueryToString({
        ...query,
        created: {
          minValue: partition.startDate,
          maxValue: partition.endDate,
        },
      }),
      per_page: partition.count,
    });
    return response.data.items;
  }

  const totalRepoCount = partitions
    .map((p) => p.count)
    .reduce((a, b) => a + b, 0);
  let countSoFar = 0;

  for (const partition of partitions) {
    countSoFar += partition.count;
    yield {
      totalCount: totalRepoCount,
      countInPartition: partition.count,
      countProgress: countSoFar,
      percentageProgress: countSoFar / totalRepoCount,
      startDate: partition.startDate,
      endDate: partition.endDate,
      repos: await searchReposInPartition(partition),
    };
  }
}

/**
 * Exports some of the functions in this module for testing purposes.
 */
export const exportedForTesting = {
  repoSearchValueToString,
  repoSearchSingleValueKeywordToString,
  repoSearchRangeKeywordToString,
  repoSearchKeywordToString,
  repoSearchQueryToString,
};
