import * as fs from "fs";
import { exec, ExecOptions } from "child_process";
import { promisify } from "util";
import { logger } from "./config";

/**
 * An async version of the `rm` function from the `fs` module.
 */
export const rmAsync = promisify(fs.rm);

const execPromisified = promisify(exec);

/**
 * An async version of the `exec` function from the `child_process` module.
 * @param command See the documentation for the `exec` function.
 * @param options See the documentation for the `exec` function.
 * @returns See the documentation for the `exec` function.
 */
export async function execAsync(command: string, options?: ExecOptions) {
  logger.debug(`Executing command: ${command}`);
  if (options) {
    return await execPromisified(command, options);
  } else {
    return await execPromisified(command);
  }
}
