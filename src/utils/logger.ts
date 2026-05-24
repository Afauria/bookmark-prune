const colors = {
  reset: '\x1b[0m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  success: '\x1b[32m',
};

export const logger = {
  info(msg: string, data?: Record<string, unknown>) {
    if (data) {
      console.log(`${colors.info}[INFO]${colors.reset} ${msg}`, JSON.stringify(data));
    } else {
      console.log(`${colors.info}[INFO]${colors.reset} ${msg}`);
    }
  },

  warn(msg: string, data?: Record<string, unknown>) {
    if (data) {
      console.warn(`${colors.warn}[WARN]${colors.reset} ${msg}`, JSON.stringify(data));
    } else {
      console.warn(`${colors.warn}[WARN]${colors.reset} ${msg}`);
    }
  },

  error(msg: string, data?: Record<string, unknown>) {
    if (data) {
      console.error(`${colors.error}[ERROR]${colors.reset} ${msg}`, JSON.stringify(data));
    } else {
      console.error(`${colors.error}[ERROR]${colors.reset} ${msg}`);
    }
  },

  success(msg: string) {
    console.log(`${colors.success}[SUCCESS]${colors.reset} ${msg}`);
  },

  progress(msg: string) {
    process.stderr.write(`\r${msg}`);
  },
};
