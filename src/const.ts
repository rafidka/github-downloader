/**
 * List of programming languages the user can download repositories for.
 */
export const LANGUAGES = [
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

/**
 * A union type that can be set to any of the supported programming languages.
 */
export type Language = typeof LANGUAGES[number];

/**
 * A map of programming languages to the file extensions that are associated
 * with them.
 */
export const LANGUAGE_FILE_EXTENSION_MAP: {
  [language: string]: Readonly<string[]>;
} = {
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

/**
 * The list of available sort options when searching for repositories.
 */
export const SortOptions = ["stars", "forks"] as const;

/**
 * Specifies the sort options when searching for repositories.
 */
export type Sort = typeof SortOptions[number];

/**
 * The list of available order options when searching for repositories.
 */
export const OrderOptions = ["asc", "desc"] as const;

/**
 * Specifies the order options when searching for repositories.
 */
export type Order = typeof OrderOptions[number];

/**
 * The maximum page size when using GitHub's search API.
 * @see https://docs.github.com/en/rest/reference/search#search-repositories
 */
export const GITHUB_SEARCH_MAX_PAGE_SIZE = 100;

/**
 * The maximum number of repositories that can be searched for.
 */
export const GITHUB_SEARCH_MAX_RESULT_COUNT = 1000;
