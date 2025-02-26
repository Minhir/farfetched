import { type Query } from '@farfetched/core';
import { useUnit } from 'effector-react';

/**
 * @deprecated Use `useUnit` from 'effector-react` instead
 */
function useQuery<Params, Data, Error, InitialData>(
  query: Query<Params, Data, Error, InitialData>
): {
  data: Data | InitialData;
  error: Error | null;
  stale: boolean;
  pending: boolean;
  start: (params: Params) => void;
};

/**
 * @deprecated Use `useUnit` from 'effector-react` instead
 */
function useQuery(query: Query<any, any, any>) {
  const [data, stale, error, pending, start] = useUnit([
    query.$data,
    query.$stale,
    query.$error,
    query.$pending,
    query.start,
  ]);

  return { data, stale, error, pending, start };
}

export { useQuery };
