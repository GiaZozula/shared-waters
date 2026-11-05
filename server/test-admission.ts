import { registerAgentRoutes as register } from './agent.js';
/** Explicit fake-provider admission override. Never imported by runtime code. */
export const registerAgentRoutes: typeof register = (server, db, model, admit) =>
  register(server, db, model, admit ?? (async () => ({remaining: 0, finish: async () => {}})));
