import { useAction, useMutation } from 'convex/react';
import { makeFunctionReference, type FunctionReference } from 'convex/server';
import type { CloudAction, CloudApi, CloudMutation, CloudQuery } from '@molly/platform';
import {
  usePublicConvexQuery,
  useRecoverableConvexQuery,
} from '../src/hooks/use-recoverable-convex-query';

function queryReference<Args, Result>(
  operation: CloudQuery<Args, Result>
): FunctionReference<'query'> {
  return makeFunctionReference<'query'>(operation.name);
}

function mutationReference<Args, Result>(
  operation: CloudMutation<Args, Result>
): FunctionReference<'mutation'> {
  return makeFunctionReference<'mutation'>(operation.name);
}

function actionReference<Args, Result>(
  operation: CloudAction<Args, Result>
): FunctionReference<'action'> {
  return makeFunctionReference<'action'>(operation.name);
}

function useCloudPlatformQuery<Args, Result>(
  operation: CloudQuery<Args, Result>,
  args: Args | 'skip'
): Result | undefined {
  const reference = queryReference(operation);
  const publicResult = usePublicConvexQuery(
    reference,
    operation.access === 'public' ? (args as Parameters<typeof usePublicConvexQuery>[1]) : 'skip'
  );
  const authenticatedResult = useRecoverableConvexQuery(
    reference,
    operation.access === 'authenticated'
      ? (args as Parameters<typeof useRecoverableConvexQuery>[1])
      : 'skip'
  );
  return (operation.access === 'public' ? publicResult : authenticatedResult) as Result | undefined;
}

/**
 * Legacy hosted-operation fixture used only by component tests. Production
 * routes never mount this adapter.
 */
export const cloudPlatformApi: CloudApi = {
  useQuery: <Args, Result>(operation: CloudQuery<Args, Result>, args: Args | 'skip') =>
    useCloudPlatformQuery(operation, args),
  useMutation: <Args, Result>(operation: CloudMutation<Args, Result>) =>
    useMutation(mutationReference(operation)) as (args: Args) => Promise<Result>,
  useAction: <Args, Result>(operation: CloudAction<Args, Result>) =>
    useAction(actionReference(operation)) as (args: Args) => Promise<Result>,
};
