declare namespace Cloudflare {
  interface Env {
    FILES: R2Bucket;
    OPENWOOD_LLM_BASE_URL?: string;
    OPENWOOD_LLM_API_KEY?: string;
    OPENWOOD_LLM_MODEL?: string;
    OPENWOOD_PUBLIC_ORIGIN?: string;
    OPENWOOD_MAX_RUNS_PER_DAY?: string;
    OPENWOOD_MAX_DEPLOYMENT_RUNS_PER_DAY?: string;
    OPENWOOD_AUDIENCE_SIGNALS_PER_PROJECT_MINUTE?: string;
  }
}
