import { jest } from '@jest/globals';
import { ServiceBroker, Context } from 'moleculer';

import WaitForExpect from 'wait-for-expect';
import BullMqMixin from '../../src/index.js';

const getServiceName = (service) => {
  if (service.version != null && !(service.settings || {}).$noVersionPrefix) {
    return `v${service.version}.${service.name}`;
  }
  return service.name;
};

const redisDefault = { db: '0', host: 'localhost', port: '6379' }

describe('Mixin', () => {
  const broker = new ServiceBroker({
    logger: false,
    cacher: 'redis://localhost/0',
  });

  const service = broker.createService({
    name: 'jobs',
    mixins: [BullMqMixin],
    settings: {
      bullmq: {
        worker: { concurrency: 1 },
        client: redisDefault,
      },
    },
    actions: {
      resize: {
        queue: true,
        async handler(ctx) {
          const { width, height } = ctx.params;
          const { bucket } = ctx.meta;
          if (ctx.locals.job) {
            ctx.locals.job.updateProgress(100);
            return { bucket, size: width * height, job: ctx.locals.job.id };
          }
        },
      },
      payment: {
        queue: true,
        params: { amount: 'number' },
        async handler() {
          throw new Error('Your too poor for this payment');
        },
      },
      'report.generate': {
        handler(ctx) {
          return this.localQueue(ctx, 'resize');
        },
      },
    },
  });
  const ctx = (service.currentContext = Context.create(
    broker,
    undefined,
    undefined,
    { meta: { bucket: 'NGNLS2' } }
  ));

  const emitSpy = jest.spyOn(broker, 'emit');
  broker.createService({ name: 'scheduler', mixins: [BullMqMixin] }); // Try without actions

  const serviceName = getServiceName(service);

  const expectJobEvent = (name, params) => {
    expect(emitSpy.mock.calls).toContainEqual([
      `${serviceName}.${name}`,
      params,
      expect.any(Object),
    ]);
    expect(emitSpy.mock.calls).toContainEqual([
      name,
      params,
      serviceName,
      expect.any(Object),
    ]);
  };

  beforeAll(async () => {
    await broker.start();
  });
  afterAll(async () => {
    await broker.stop();
  });

  it('should have a bull worker', () => expect(service.$worker).toBeDefined());

  it('should queue a successful job', async () => {
    const job = await service.localQueue(ctx, 'resize', {
      width: 42,
      height: 42,
    });
    await WaitForExpect(async () => {
      expectJobEvent('resize.progress', { id: job.id, progress: 100 });
      expectJobEvent('resize.completed', { id: job.id });

      const { returnvalue, progress } = await service.job(job.id);
      expect(returnvalue).toStrictEqual({
        bucket: 'NGNLS2',
        size: 1764,
        job: job.id,
      }); // This confirm the meta, params & locals has been passed to the job
      expect(progress).toBe(100);
    });
  });

  it('should queue a failed job', async () => {
    emitSpy.mockClear();
    const jobs = [
      await service.queue(
        ctx,
        serviceName,
        'payment',
        { amount: 2000 },
        { priority: 200 }
      ),
      await service.queue(ctx, serviceName, 'payment'),
    ];
    await WaitForExpect(async () => {
      expectJobEvent('payment.active', { id: jobs[0].id });
      expectJobEvent('payment.failed', { id: jobs[0].id });

      expectJobEvent('payment.active', { id: jobs[1].id });
      expectJobEvent('payment.failed', { id: jobs[1].id });

      const errors = [
        await service.job(serviceName, jobs[0].id),
        await service.job(serviceName, jobs[1].id),
      ];
      expect(errors[0].failedReason).toBe('Your too poor for this payment');
      expect(errors[1].failedReason).toBe('Parameters validation error!');
    });
  });
});

describe('MixinVersion', () => {
  const broker = new ServiceBroker({
    logger: false,
    cacher: 'redis://localhost/0',
  });
  const service = broker.createService({
    name: 'jobs',
    version: 1,
    mixins: [BullMqMixin],
    settings: {
      bullmq: {
        worker: { concurrency: 1 },
        client: redisDefault,
      },
    },
    actions: {
      resize: {
        queue: true,
        async handler(ctx) {
          const { width, height } = ctx.params;
          const { bucket } = ctx.meta;
          if (ctx.locals.job) {
            ctx.locals.job.updateProgress(100);
            return { bucket, size: width * height, job: ctx.locals.job.id };
          }
        },
      },
      payment: {
        queue: true,
        params: { amount: 'number' },
        async handler() {
          throw new Error('Your too poor for this payment');
        },
      },
      'report.generate': {
        handler(ctx) {
          return this.localQueue(ctx, 'resize');
        },
      },
    },
  });

  const ctx = (service.currentContext = Context.create(
    broker,
    undefined,
    undefined,
    { meta: { bucket: 'NGNLS2' } }
  ));
  const emitSpy = jest.spyOn(broker, 'emit');
  broker.createService({ name: 'scheduler', mixins: [BullMqMixin] }); // Try without actions

  const serviceName = getServiceName(service);

  const expectJobEvent = (name, params) => {
    expect(emitSpy.mock.calls).toContainEqual([
      `${serviceName}.${name}`,
      params,
      expect.any(Object),
    ]);
    expect(emitSpy.mock.calls).toContainEqual([
      name,
      params,
      serviceName,
      expect.any(Object),
    ]);
  };

  beforeAll(() => broker.start());
  afterAll(() => broker.stop());

  it('should have a bull worker', () => expect(service.$worker).toBeDefined());

  it('should queue a successful job', async () => {
    const job = await service.localQueue(ctx, 'resize', {
      width: 42,
      height: 42,
    });
    await WaitForExpect(async () => {
      expectJobEvent('resize.progress', { id: job.id, progress: 100 });
      expectJobEvent('resize.completed', { id: job.id });

      const { returnvalue, progress } = await service.job(job.id);
      expect(returnvalue).toStrictEqual({
        bucket: 'NGNLS2',
        size: 1764,
        job: job.id,
      }); // This confirm the meta, params & locals has been passed to the job
      expect(progress).toBe(100);
    });
  });

  it('should queue a failed job', async () => {
    emitSpy.mockClear();
    const jobs = [
      await service.queue(
        ctx,
        serviceName,
        'payment',
        { amount: 2000 },
        { priority: 200 }
      ),
      await service.queue(ctx, serviceName, 'payment'),
    ];
    await WaitForExpect(async () => {
      expectJobEvent('payment.active', { id: jobs[0].id });
      expectJobEvent('payment.failed', { id: jobs[0].id });

      expectJobEvent('payment.active', { id: jobs[1].id });
      expectJobEvent('payment.failed', { id: jobs[1].id });

      const errors = [
        await service.job(serviceName, jobs[0].id),
        await service.job(serviceName, jobs[1].id),
      ];
      expect(errors[0].failedReason).toBe('Your too poor for this payment');
      expect(errors[1].failedReason).toBe('Parameters validation error!');
    });
  });
});

describe('MixinVersionWithoutPrefix', () => {
  const broker = new ServiceBroker({
    logger: false,
    cacher: 'redis://localhost/0',
  });
  const service = broker.createService({
    name: 'jobs',
    version: 1,
    mixins: [BullMqMixin],
    settings: {
      $noVersionPrefix: true,
      bullmq: {
        worker: { concurrency: 1 },
        client: redisDefault,
      },
    },
    actions: {
      resize: {
        queue: true,
        async handler(ctx) {
          const { width, height } = ctx.params;
          const { bucket } = ctx.meta;
          if (ctx.locals.job) {
            ctx.locals.job.updateProgress(100);
            return { bucket, size: width * height, job: ctx.locals.job.id };
          }
        },
      },
      payment: {
        queue: true,
        params: { amount: 'number' },
        async handler() {
          throw new Error('Your too poor for this payment');
        },
      },
      'report.generate': {
        handler(ctx) {
          return this.localQueue(ctx, 'resize');
        },
      },
    },
  });
  const ctx = (service.currentContext = Context.create(
    broker,
    undefined,
    undefined,
    { meta: { bucket: 'NGNLS2' } }
  ));
  const emitSpy = jest.spyOn(broker, 'emit');
  const scheduler = broker.createService({
    name: 'scheduler',
    mixins: [BullMqMixin],
  }); // Try without actions

  const serviceName = getServiceName(service);

  const expectJobEvent = (name, params) => {
    expect(emitSpy.mock.calls).toContainEqual([
      `${serviceName}.${name}`,
      params,
      expect.any(Object),
    ]);
    expect(emitSpy.mock.calls).toContainEqual([
      name,
      params,
      serviceName,
      expect.any(Object),
    ]);
  };

  beforeAll(() => broker.start());
  afterAll(() => broker.stop());

  it('should have a bull worker', () => expect(service.$worker).toBeDefined());

  it('should queue a successful job', async () => {
    const job = await service.localQueue(ctx, 'resize', {
      width: 42,
      height: 42,
    });
    await WaitForExpect(async () => {
      expectJobEvent('resize.progress', { id: job.id, progress: 100 });
      expectJobEvent('resize.completed', { id: job.id });

      const { returnvalue, progress } = await service.job(job.id);
      expect(returnvalue).toStrictEqual({
        bucket: 'NGNLS2',
        size: 1764,
        job: job.id,
      }); // This confirm the meta, params & locals has been passed to the job
      expect(progress).toBe(100);
    });
  });

  it('should queue a failed job', async () => {
    emitSpy.mockClear();
    const jobs = [
      await service.queue(
        ctx,
        serviceName,
        'payment',
        { amount: 2000 },
        { priority: 200 }
      ),
      await service.queue(ctx, serviceName, 'payment'),
    ];
    await WaitForExpect(async () => {
      expectJobEvent('payment.active', { id: jobs[0].id });
      expectJobEvent('payment.failed', { id: jobs[0].id });

      expectJobEvent('payment.active', { id: jobs[1].id });
      expectJobEvent('payment.failed', { id: jobs[1].id });

      const errors = [
        await service.job(serviceName, jobs[0].id),
        await service.job(serviceName, jobs[1].id),
      ];
      expect(errors[0].failedReason).toBe('Your too poor for this payment');
      expect(errors[1].failedReason).toBe('Parameters validation error!');
    });
  });
});
