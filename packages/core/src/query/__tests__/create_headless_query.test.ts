import { allSettled, createStore, fork } from 'effector';
import { describe, test, expect, vi } from 'vitest';

import { allPrevSettled, watchRemoteOperation } from '@farfetched/test-utils';

import { createDefer } from '../../libs/lohyphen';
import { createHeadlessQuery } from '../create_headless_query';
import { unknownContract } from '../../contract/unknown_contract';
import { invalidDataError } from '../../errors/create_error';

describe('core/createHeadlessQuery without contract', () => {
  const query = createHeadlessQuery({
    contract: unknownContract,
    mapData: ({ result }) => result,
  });

  test('start triggers executeFx', async () => {
    const mockFn = vi.fn();

    const scope = fork({ handlers: [[query.__.executeFx, mockFn]] });

    await allSettled(query.start, { scope, params: 42 });

    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledWith(42);
  });

  test('finished.success triggers after executeFx.done', async () => {
    const scope = fork({ handlers: [[query.__.executeFx, vi.fn((p) => p)]] });

    const { listeners } = watchRemoteOperation(query, scope);

    await allSettled(query.start, { scope, params: 42 });

    expect(scope.getState(query.$data)).toBe(42);
    expect(scope.getState(query.$error)).toBeNull();
    expect(listeners.onSuccess).toHaveBeenCalledTimes(1);
    expect(listeners.onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ params: 42, result: 42 })
    );

    expect(listeners.onSkip).not.toHaveBeenCalled();
    expect(listeners.onFailure).not.toHaveBeenCalled();

    expect(listeners.onFinally).toHaveBeenCalledTimes(1);
    expect(listeners.onFinally).toHaveBeenCalledWith(
      expect.objectContaining({ params: 42 })
    );
  });

  test('finished.failure triggers after executeFx.fail', async () => {
    const scope = fork({
      handlers: [
        [
          query.__.executeFx,
          vi.fn(() => {
            throw new Error('from mock');
          }),
        ],
      ],
    });

    const { listeners } = watchRemoteOperation(query, scope);

    await allSettled(query.start, { scope, params: 42 });

    expect(scope.getState(query.$error)).toEqual(new Error('from mock'));
    expect(scope.getState(query.$data)).toBeNull();

    expect(listeners.onFailure).toHaveBeenCalledTimes(1);
    expect(listeners.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        params: 42,
        error: new Error('from mock'),
      })
    );

    expect(listeners.onSuccess).not.toHaveBeenCalled();
    expect(listeners.onSkip).not.toHaveBeenCalled();

    expect(listeners.onFinally).toHaveBeenCalledTimes(1);
    expect(listeners.onFinally).toHaveBeenCalledWith(
      expect.objectContaining({ params: 42 })
    );
  });

  test('skipped query has initial status', async () => {
    const disabledQuery = createHeadlessQuery({
      enabled: false,
      contract: unknownContract,
      mapData: ({ result }) => result,
    });

    const scope = fork({ handlers: [[disabledQuery.__.executeFx, vi.fn()]] });

    await allSettled(disabledQuery.start, { scope, params: 42 });

    expect(scope.getState(disabledQuery.$status)).toBe('initial');
  });

  test('$status changes on stages', async () => {
    const executorFirstDefer = createDefer();
    const executorSecondDefer = createDefer();

    const scope = fork({
      handlers: [
        [
          query.__.executeFx,
          vi
            .fn()
            .mockImplementationOnce(() => executorFirstDefer.promise)
            .mockImplementationOnce(() => executorSecondDefer.promise),
        ],
      ],
    });

    expect(scope.getState(query.$status)).toBe('initial');
    expect(scope.getState(query.$pending)).toBeFalsy();
    expect(scope.getState(query.$failed)).toBeFalsy();
    expect(scope.getState(query.$succeeded)).toBeFalsy();

    // do not await
    allSettled(query.start, { scope, params: 42 });

    expect(scope.getState(query.$status)).toBe('pending');
    expect(scope.getState(query.$pending)).toBeTruthy();
    expect(scope.getState(query.$failed)).toBeFalsy();
    expect(scope.getState(query.$succeeded)).toBeFalsy();

    executorFirstDefer.resolve('result');
    await allPrevSettled(scope);

    expect(scope.getState(query.$status)).toBe('done');
    expect(scope.getState(query.$pending)).toBeFalsy();
    expect(scope.getState(query.$failed)).toBeFalsy();
    expect(scope.getState(query.$succeeded)).toBeTruthy();

    // do not await
    allSettled(query.start, { scope, params: 42 });

    expect(scope.getState(query.$status)).toBe('pending');
    expect(scope.getState(query.$pending)).toBeTruthy();
    expect(scope.getState(query.$failed)).toBeFalsy();
    expect(scope.getState(query.$succeeded)).toBeFalsy();

    executorSecondDefer.reject(new Error('error'));
    await allPrevSettled(scope);

    expect(scope.getState(query.$status)).toBe('fail');
    expect(scope.getState(query.$pending)).toBeFalsy();
    expect(scope.getState(query.$failed)).toBeTruthy();
    expect(scope.getState(query.$succeeded)).toBeFalsy();
  });

  test('re-execute', async () => {
    const scope = fork({
      handlers: [
        [
          query.__.executeFx,
          vi
            .fn()
            .mockResolvedValueOnce('first done')
            .mockRejectedValueOnce(new Error('first error'))
            .mockResolvedValueOnce('second done')
            .mockRejectedValueOnce(new Error('second error')),
        ],
      ],
    });

    // first done
    await allSettled(query.start, { scope, params: 42 });

    expect(scope.getState(query.$data)).toBe('first done');
    expect(scope.getState(query.$error)).toBeNull();

    // first error
    await allSettled(query.start, { scope, params: 42 });

    expect(scope.getState(query.$data)).toBeNull();
    expect(scope.getState(query.$error)).toEqual(new Error('first error'));

    // second done
    await allSettled(query.start, { scope, params: 42 });

    expect(scope.getState(query.$data)).toBe('second done');
    expect(scope.getState(query.$error)).toBeNull();

    // second error
    await allSettled(query.start, { scope, params: 42 });

    expect(scope.getState(query.$data)).toBeNull();
    expect(scope.getState(query.$error)).toEqual(new Error('second error'));
  });
});

describe('core/createHeadlessQuery with contract', () => {
  test('contract find invalid data', async () => {
    const query = createHeadlessQuery({
      contract: {
        isData: (raw): raw is unknown => false,
        getErrorMessages: () => ['got it'],
      },
      mapData: ({ result }) => result,
    });

    const scope = fork({ handlers: [[query.__.executeFx, vi.fn()]] });

    const { listeners } = watchRemoteOperation(query, scope);

    await allSettled(query.start, { scope, params: 42 });

    expect(scope.getState(query.$error)).toEqual(
      invalidDataError({ validationErrors: ['got it'] })
    );

    expect(listeners.onFailure).toHaveBeenCalledTimes(1);
    expect(listeners.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        params: 42,
        error: invalidDataError({ validationErrors: ['got it'] }),
      })
    );
  });

  test('contract transforms data', async () => {
    const extractedData = Symbol('extractedData');

    const query = createHeadlessQuery({
      contract: {
        isData: (raw): raw is unknown => true,
        getErrorMessages: () => [],
      },
      mapData: ({ result }) => result,
    });

    const scope = fork({
      handlers: [
        [query.__.executeFx, vi.fn().mockResolvedValue(extractedData)],
      ],
    });

    const { listeners } = watchRemoteOperation(query, scope);

    await allSettled(query.start, { scope, params: 42 });

    expect(scope.getState(query.$data)).toEqual(extractedData);

    expect(listeners.onSuccess).toHaveBeenCalledTimes(1);
    expect(listeners.onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        params: 42,
        result: extractedData,
      })
    );
  });

  test('contract receives response (for data)', async () => {
    const response = Symbol('response');

    const validate = vi.fn().mockReturnValue([]);

    const query = createHeadlessQuery({
      contract: {
        isData: (raw): raw is unknown => false,
        getErrorMessages: validate,
      },
      mapData: ({ result }) => result,
    });

    const scope = fork({
      handlers: [[query.__.executeFx, vi.fn(() => response)]],
    });

    await allSettled(query.start, { scope, params: 42 });

    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith(response);
  });
});

describe('core/createHeadlessQuery with contract and', () => {
  test('core/createHeadlessQuery with contract and mapData (callback)', async () => {
    const rawRata = Symbol('rawRata');
    const passedParams = Symbol('passedParams');
    const mappedData = Symbol('mappedData');

    const query = createHeadlessQuery({
      contract: unknownContract,
      mapData({ result, params }) {
        expect(result).toBe(rawRata);
        expect(params).toBe(passedParams);
        return mappedData;
      },
    });

    const scope = fork({
      handlers: [[query.__.executeFx, vi.fn(() => rawRata)]],
    });

    await allSettled(query.start, { scope, params: passedParams });

    expect(scope.getState(query.$data)).toEqual(mappedData);
  });

  test('sourced callback)', async () => {
    const $source = createStore('first');

    const mappedData = Symbol('mappedData');

    const query = createHeadlessQuery({
      contract: unknownContract,
      mapData: {
        source: $source,
        fn: ({ result, params }, source) => {
          expect(source).toBe('first');
          return mappedData;
        },
      },
    });

    const scope = fork({
      handlers: [[query.__.executeFx, vi.fn()]],
    });

    await allSettled(query.start, { scope, params: 'random data' });

    expect(scope.getState(query.$data)).toEqual(mappedData);
  });
});

describe('core/createHeadlessQuery enabled', () => {
  test('enabled by default', () => {
    const query = createHeadlessQuery({
      contract: unknownContract,
      mapData: ({ result }) => result,
    });

    const scope = fork({ handlers: [[query.__.executeFx, vi.fn()]] });

    expect(scope.getState(query.$enabled)).toBe(true);
  });

  test('skip execution on disabled query', async () => {
    const query = createHeadlessQuery({
      contract: unknownContract,
      mapData: ({ result }) => result,
      enabled: false,
    });

    const scope = fork({ handlers: [[query.__.executeFx, vi.fn()]] });

    const watcher = watchRemoteOperation(query, scope);

    await allSettled(query.start, { scope, params: {} });

    expect(scope.getState(query.$enabled)).toBe(false);
    expect(watcher.listeners.onSkip).toBeCalledTimes(1);
    expect(watcher.listeners.onSkip).toBeCalledWith(
      expect.objectContaining({ params: {} })
    );
  });

  test('reset', async () => {
    const query = createHeadlessQuery({
      contract: unknownContract,
      mapData: ({ result }) => result,
      enabled: false,
    });

    const scope = fork({ handlers: [[query.__.executeFx, vi.fn()]] });

    await allSettled(query.start, { scope, params: {} });

    await allSettled(query.reset, { scope });

    expect(scope.getState(query.$data)).toBeNull();
    expect(scope.getState(query.$error)).toBeNull();
    expect(scope.getState(query.$status)).toBe('initial');
    expect(scope.getState(query.$stale)).toBeFalsy();
  });
});
