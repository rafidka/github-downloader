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
info: Searching for c repos (sorted desc by forks)...
info: Searching for cpp repos (sorted desc by forks)...
info: Searching for csharp repos (sorted desc by forks)...
info: Searching for css repos (sorted desc by forks)...
info: Searching for go repos (sorted desc by forks)...
info: Searching for html repos (sorted desc by forks)...
info: Searching for java repos (sorted desc by forks)...
info: Searching for js repos (sorted desc by forks)...
info: Searching for perl repos (sorted desc by forks)...
info: Searching for php repos (sorted desc by forks)...
info: Searching for python repos (sorted desc by forks)...
info: Searching for rust repos (sorted desc by forks)...
info: Searching for sql repos (sorted desc by forks)...
info: Searching for ts repos (sorted desc by forks)...
info: Found 1 sql repos:
info: - tony-landis/agilebill
info: Found 1 perl repos:
info: - x0rz/EQGRP
info: Found 1 c repos:
info: - torvalds/linux
info: Found 1 rust repos:
info: - rust-lang/rust
info: Found 1 css repos:
info: - barryclark/jekyll-now
info: Found 1 php repos:
info: - laravel/laravel
info: Found 1 go repos:
info: - kubernetes/kubernetes
info: Found 1 cpp repos:
info: - opencv/opencv
info: Found 1 csharp repos:
info: - dotnet/AspNetCore.Docs
info: Found 1 ts repos:
info: - ant-design/ant-design
info: Found 1 java repos:
info: - eugenp/tutorials
info: Found 1 html repos:
info: - octocat/Spoon-Knife
info: Found 1 python repos:
info: - jackfrued/Python-100-Days
info: Found 1 js repos:
info: - udacity/frontend-nanodegree-resume
info: [lang: c] Cloning linux...
info: [lang: cpp] Cloning opencv...
info: [lang: csharp] Cloning AspNetCore.Docs...
info: [lang: css] Cloning jekyll-now...
info: [lang: go] Cloning kubernetes...
info: [lang: html] Cloning Spoon-Knife...
info: [lang: java] Cloning tutorials...
info: [lang: js] Cloning frontend-nanodegree-resume...
info: [lang: perl] Cloning EQGRP...
info: [lang: php] Cloning laravel...
info: [lang: python] Cloning Python-100-Days...
info: [lang: rust] Cloning rust...
info: [lang: sql] Cloning agilebill...
info: [lang: ts] Cloning ant-design...
```

# License

Luckily, the world doesn't revolve around me. As such, unless there is a strong
reason not to, I usually publish my code under [The
Unlicense](https://unlicense.org/), meaning that anyone is free to make use of
this code however they like. This repository is no exception. See
[LICENSE](LICENSE).