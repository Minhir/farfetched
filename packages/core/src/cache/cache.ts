import { createEffect, Event, sample, split } from 'effector';

import { time } from '../libs/patronus';
import { parseTime, Time } from '../libs/date-nfs';
import {
  RemoteOperationParams,
  RemoteOperationResult,
} from '../remote_operation/type';
import { Query } from '../query/type';
import { inMemoryCache } from './adapters/in_memory';
import { CacheAdapter, CacheAdapterInstance } from './adapters/type';
import { enrichFinishedSuccessWithKey, enrichStartWithKey } from './key/key';

interface CacheParameters {
  adapter?: CacheAdapter;
  staleAfter?: Time;
  purge?: Event<void>;
}

interface CacheParametersDefaulted {
  adapter: CacheAdapter;
  staleAfter?: Time;
  purge?: Event<void>;
}

export function cache<Q extends Query<any, any, any, any>>(
  query: Q,
  params?: CacheParameters
): void {
  query.__.lowLevelAPI.registerInterruption();

  const defaultedParams: CacheParametersDefaulted = {
    adapter: params?.adapter ?? inMemoryCache(),
    ...params,
  };

  connectPurge(defaultedParams);
  saveToCache(query, defaultedParams);
  pickFromCache(query, defaultedParams);
}

function connectPurge({ adapter, purge }: CacheParametersDefaulted) {
  if (purge) {
    const purgeCachedValuesFx = createEffect(
      ({ instance }: { instance: CacheAdapterInstance }) => instance.purge()
    );

    sample({
      clock: purge,
      source: { instance: adapter.__.$instance },
      target: purgeCachedValuesFx,
    });
  }
}

function saveToCache<Q extends Query<any, any, any>>(
  query: Q,
  { adapter }: CacheParametersDefaulted
) {
  const putCachedValueFx = createEffect(
    ({
      instance,
      key,
      value,
    }: {
      instance: CacheAdapterInstance;
      key: string;
      value: unknown;
    }) => instance.set({ key, value })
  );

  // TODO: allow to subscribe on __ to log invalid key error
  const { doneWithKey } = split(enrichFinishedSuccessWithKey(query), {
    doneWithKey: (
      p
    ): p is {
      params: RemoteOperationParams<Q>;
      result: RemoteOperationResult<Q>;
      key: string;
    } => p.key !== null,
  });

  sample({
    clock: doneWithKey,
    source: adapter.__.$instance,
    fn: (instance, { key, result }) => ({
      instance,
      key,
      value: result,
    }),
    target: putCachedValueFx,
  });
}

function pickFromCache<Q extends Query<any, any, any>>(
  query: Q,
  { adapter, staleAfter }: CacheParametersDefaulted
) {
  const pickCachedValueFx = createEffect(
    async ({
      instance,
      key,
    }: {
      instance: CacheAdapterInstance;
      key: string;
      params: RemoteOperationParams<Q>;
    }) => instance.get({ key })
  );

  const $now = time({ clock: pickCachedValueFx });

  // TODO: allow to subscribe on __ to log invalid key error
  const { startWithKey, __: startWithoutKey } = split(
    enrichStartWithKey(query),
    {
      startWithKey: (
        p
      ): p is {
        params: RemoteOperationParams<Q>;
        key: string;
      } => p.key !== null,
    }
  );

  sample({
    clock: startWithKey,
    source: adapter.__.$instance,
    fn: (instance, { key, params }) => ({ instance, key, params }),
    target: pickCachedValueFx,
  });

  const { found, __: notFound } = split(pickCachedValueFx.done, {
    found: ({ result }) => Boolean(result),
  });

  const { __: foundStale, foundFresh } = split(
    sample({ clock: found, source: $now, fn: (now, f) => ({ ...f, now }) }),
    {
      foundFresh: ({ result, now }) => {
        if (!staleAfter || !result) {
          return false;
        }

        return result.cachedAt + parseTime(staleAfter) > now;
      },
    }
  );

  sample({
    clock: [
      sample({ clock: foundStale, fn: (p) => ({ ...p, isFreshData: false }) }),
      sample({ clock: foundFresh, fn: (p) => ({ ...p, isFreshData: true }) }),
    ],
    fn: ({ result, params, isFreshData }) => ({
      result: result!.value,
      params: params.params,
      meta: { stopErrorPropagation: true, isFreshData },
    }),
    target: query.__.lowLevelAPI.fillData,
  });

  sample({
    clock: [
      foundStale.map(({ params }) => params),
      notFound.map(({ params }) => params),
      startWithoutKey,
    ],
    target: query.__.lowLevelAPI.resumeExecution,
  });
}
