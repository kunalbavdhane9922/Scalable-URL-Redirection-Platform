import { describe, it, expect, jest } from '@jest/globals';
import {
  publishEvent,
  enqueueClickEvent,
  ensureConsumerGroup,
  acknowledgeEvent,
} from '../../src/services/queue-service.js';

describe('Queue Service (§11 Asynchronous Queue & §11.1 Queue Reliability)', () => {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  describe('publishEvent', () => {
    it('publishes event to Redis Streams using xadd', async () => {
      const mockRedis = {
        xadd: jest.fn().mockResolvedValue('1700000000000-0'),
      };

      await publishEvent(mockRedis, mockLogger, 'link_created', { shortCode: 'abc' });

      expect(mockRedis.xadd).toHaveBeenCalledWith(
        expect.any(String),
        '*',
        'event_type',
        'link_created',
        'payload',
        JSON.stringify({ shortCode: 'abc' }),
        'timestamp',
        expect.any(String),
      );
    });

    it('logs warning and does not throw when Redis xadd fails (resilience)', async () => {
      const mockRedis = {
        xadd: jest.fn().mockRejectedValue(new Error('Redis connection refused')),
      };

      await expect(
        publishEvent(mockRedis, mockLogger, 'link_clicked', { shortCode: 'fail' })
      ).resolves.not.toThrow();

      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('enqueueClickEvent (§8 step 9 & §11.1 non-blocking)', () => {
    it('is fire-and-forget and does not block or throw', () => {
      const mockRedis = {
        xadd: jest.fn().mockRejectedValue(new Error('Redis stream full')),
      };

      expect(() => {
        enqueueClickEvent(mockRedis, mockLogger, 'testCode', 'https://example.com');
      }).not.toThrow();
    });
  });

  describe('ensureConsumerGroup', () => {
    it('creates consumer group with MKSTREAM', async () => {
      const mockRedis = {
        xgroup: jest.fn().mockResolvedValue('OK'),
      };

      await ensureConsumerGroup(mockRedis, mockLogger);
      expect(mockRedis.xgroup).toHaveBeenCalled();
    });

    it('gracefully handles BUSYGROUP when group already exists', async () => {
      const mockRedis = {
        xgroup: jest.fn().mockRejectedValue(new Error('BUSYGROUP Consumer Group name already exists')),
      };

      await expect(ensureConsumerGroup(mockRedis, mockLogger)).resolves.not.toThrow();
    });

    it('propagates non-BUSYGROUP errors', async () => {
      const mockRedis = {
        xgroup: jest.fn().mockRejectedValue(new Error('NOPERM No permission to run xgroup')),
      };

      await expect(ensureConsumerGroup(mockRedis, mockLogger)).rejects.toThrow('NOPERM');
    });
  });

  describe('acknowledgeEvent', () => {
    it('calls xack with stream key, consumer group and message ID', async () => {
      const mockRedis = {
        xack: jest.fn().mockResolvedValue(1),
      };

      await acknowledgeEvent(mockRedis, '1700000000000-0');
      expect(mockRedis.xack).toHaveBeenCalled();
    });
  });
});
