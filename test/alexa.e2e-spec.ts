import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AlexaSignatureGuard } from '../src/alexa/alexa-signature.guard';
import type { ResponseEnvelope } from '../src/alexa/types/alexa.types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// No real Amazon-signed request can be crafted in a test — AlexaSignatureGuard
// itself is covered in isolation by alexa-signature.guard.spec.ts (mocking
// alexa-verifier). Here it's overridden to always pass, so these tests only
// exercise AlexaController/AlexaService's handling of the request envelope.
describe('Alexa inbound endpoint (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(AlexaSignatureGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    await app.init();
    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE measures RESTART IDENTITY CASCADE`;
  });

  it('answers LaunchRequest with the current readings, in French', async () => {
    await prisma.measure.createMany({
      data: [
        {
          deviceName: 'capteur-salon',
          type: 'temperature',
          value: '21.3',
          recordedAt: new Date('2026-08-15T10:00:00.000Z'),
        },
        {
          deviceName: 'capteur-exterieur',
          type: 'temperature',
          value: '15.6',
          recordedAt: new Date('2026-08-15T10:00:00.000Z'),
        },
      ],
    });

    const res = await request(app.getHttpServer())
      .post('/alexa')
      .send({ request: { type: 'LaunchRequest' } })
      .expect(200);
    const body = res.body as ResponseEnvelope;

    expect(body.response.outputSpeech?.text).toContain('21,3');
    expect(body.response.outputSpeech?.text).toContain('15,6');
    expect(body.response.shouldEndSession).toBe(true);
  });

  it('answers an unrecognized intent gracefully instead of erroring', async () => {
    const res = await request(app.getHttpServer())
      .post('/alexa')
      .send({
        request: { type: 'IntentRequest', intent: { name: 'SomeOtherIntent' } },
      })
      .expect(200);
    const body = res.body as ResponseEnvelope;

    expect(body.response.outputSpeech?.text).toContain('pas compris');
    expect(body.response.shouldEndSession).toBe(false);
  });

  it('returns an empty response for SessionEndedRequest', async () => {
    const res = await request(app.getHttpServer())
      .post('/alexa')
      .send({ request: { type: 'SessionEndedRequest' } })
      .expect(200);

    expect(res.body as ResponseEnvelope).toEqual({
      version: '1.0',
      response: { shouldEndSession: true },
    });
  });

  // Full-stack coverage for the fix in this PR: #14's manifest now
  // declares events.endpoint, so Amazon sends skill events (e.g.
  // SKILL_PROACTIVE_SUBSCRIPTION_CHANGED) to this same route for real —
  // see CLAUDE.md's Alexa section. AlexaSignatureGuard is overridden here
  // like every other test in this file, so this only exercises the
  // controller/service handling of the envelope shape, same scope as the
  // other tests above.
  it('returns an empty response for a skill event, no speech', async () => {
    const res = await request(app.getHttpServer())
      .post('/alexa')
      .send({
        request: { type: 'AlexaSkillEvent.ProactiveSubscriptionChanged' },
      })
      .expect(200);

    expect(res.body as ResponseEnvelope).toEqual({
      version: '1.0',
      response: { shouldEndSession: true },
    });
  });
});
