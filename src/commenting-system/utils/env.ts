/**
 * Safely access environment variables
 * Returns undefined if process or env vars are not available
 */
export const getEnv = (key: string): string | undefined => {
  // Check if running in an environment with process.env (webpack with DefinePlugin or similar)
  try {
    if (typeof process !== 'undefined' && process.env) {
      return process.env[key];
    }
  } catch (e) {
    // process might be defined but accessing it throws an error
  }
  return undefined;
};
