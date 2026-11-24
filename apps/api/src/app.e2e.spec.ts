import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './app.module';

/**
 * Boots the real AppModule (all module boundaries wired, exactly as
 * main.ts does) and hits the one real endpoint the STEP 4 foundation
 * has — /health — through an actual HTTP request. This is the "run
 * relevant tests" checkpoint for STEP 4: it proves the DI graph
 * resolves cleanly (no circular imports, no missing providers across
 * the CommonModule/SharedModule/AuthModule/RikModule/PifModule/
 * AdminModule/NotificationModule boundary) and that ConfigModule's
 * fail-fast validation (loadApiEnv) accepts a complete, valid env —
 * before any business logic is added on top of this foundation.
 *
 * The fixture env this relies on lives in jest.setup.ts (it must be in
 * place before AppModule's static import above even runs — see that
 * file for why).
 */
describe('AppModule (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns 200 with no internal detail leaked', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'esamagri-api' });
    expect(res.body).not.toHaveProperty('stack');
    expect(res.body).not.toHaveProperty('config');
  });
});
