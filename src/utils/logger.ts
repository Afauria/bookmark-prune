export const logger = {
  info(msg: string, data?: Record<string, unknown>) {
    if (data) {
      console.log(`[INFO] ${msg}`, JSON.stringify(data));
    } else {
      console.log(`[INFO] ${msg}`);
    }
  },

  warn(msg: string, data?: Record<string, unknown>) {
    if (data) {
      console.warn(`[WARN] ${msg}`, JSON.stringify(data));
    } else {
      console.warn(`[WARN] ${msg}`);
    }
  },

  error(msg: string, data?: Record<string, unknown>) {
    if (data) {
      console.error(`[ERROR] ${msg}`, JSON.stringify(data));
    } else {
      console.error(`[ERROR] ${msg}`);
    }
  },

  progress(msg: string) {
    process.stderr.write(`\r${msg}`);
  },
};
