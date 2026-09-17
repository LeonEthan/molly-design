import { createRouter as createTanstackRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
export type RouterContext = Record<string, never>;
type CreateRouterOptions = {
  basepath?: string;
  history?: Parameters<typeof createTanstackRouter>[0]['history'];
};

export const createRouter = (options: CreateRouterOptions) => {
  const router = createTanstackRouter({
    routeTree,
    basepath: options.basepath ?? '',
    history: options.history,
    defaultPreload: 'intent',
    scrollRestoration: true,
    context: {},
  });
  return router;
};

// Register router for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
