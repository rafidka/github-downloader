# github-downloader

# Overview

A tool for downloading a large number of repositories from GitHub.

I wrote this tool as I would like to train an ML model on source code. GitHub
doesn't have an easy mechanism to allow users to download a large number of
repositories, so I decided to write my own tool to facilitate this.

You might wonder why not just execute a `git clone` command on the repositories I need.
There are multiple reasons actually:

- I would like to download the top repositories (by star or fork count), which
  requires a call to GitHub API.

- Making a large number of `git clone` requests can potentially cause
  throttling, hence a retry mechanism is required.

- If the execution breaks midway for any reason, re-executing it will skip the
  repositories that were already downloaded.

- For model training, one only needs the source files, so other files, e.g.
  images, binaries, documentation, etc., need to be cleaned to avoid a
  considerable unnecessary space waste. This scripts does this automatically on
  each repository after cloning.

- Doing a `git clone` clones the entire history by default. Again, this is a
  huge unnecessary space waste, especially with top repositories which have a
  large number of contributors and thus the history is likely huge.

## Usage

After cloning this repository locally, make sure to install the required npm
packages using:

```shell
npm install
```

Then, execute the following command to show the help message:

```shell
npm run main
```

For example, the following will download the top repositories (by number of
forks) from each of the programming languages that this tool currently support
(check help message for a list):

```shell
npm run main -- --repos-dir /home/rafid/WorkspaceData/repos --max-repo-count 1
```

If you execute it, you will see an output likes the following

```
npm run main -- --repos-dir /home/rafid/WorkspaceData/repos --max-repo-count 10

> github-downloader@0.1.0 main
> ts-node src/main "--repos-dir" "/home/rafid/WorkspaceData/repos" "--max-repo-count" "10"

Cloned repos: [========================================] 100% | 140/140
Failed repos: [----------------------------------------] 0% | 0/140

Done. Please check the log files for any warnings or errors.
```

# License

Luckily, the world doesn't revolve around me. As such, unless there is a strong
reason not to, I usually publish my code under [The
Unlicense](https://unlicense.org/), meaning that anyone is free to make use of
this code however they like. This repository is no exception. See
[LICENSE](LICENSE).
