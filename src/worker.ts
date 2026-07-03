import { routePartykitRequest } from "partyserver";
import { GameServer } from "../party/server";

export { GameServer };

export default {
  async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ??
      new Response("Not Found", { status: 404 })
    );
  },
};
