import chalk from "chalks-log";

export const log = {
  info: (message: string) => console.log(chalk.cyan(message)),
  detail: (message: string) => console.log(chalk.gray(message)),
  warn: (message: string) => console.warn(chalk.yellow(message)),
  market: (message: string) => console.log(chalk.yellow(message)),
  error: (message: string, error?: unknown) => {
    if (error !== undefined) {
      console.error(chalk.red(message), error);
      return;
    }
    console.error(chalk.red(message));
  },
};
