import type { Env } from "./env";
import { handleWorkerRequest } from "./routes/dispatch";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleWorkerRequest(request, env);
  },
};
