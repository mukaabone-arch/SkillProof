import { HttpException, HttpStatus } from '@nestjs/common';
import { ContactService } from './contact.service';
import { ContactSubmissionDto } from './contact.dto';
import { SendEmailParams } from '../notifications/email-provider.interface';

function makeService() {
  const emailProvider = { send: jest.fn(async (_params: SendEmailParams): Promise<void> => undefined) };
  const service = new ContactService(emailProvider as never);
  return { service, emailProvider };
}

function validDto(overrides: Partial<ContactSubmissionDto> = {}): ContactSubmissionDto {
  return {
    fullName: 'Ada Lovelace',
    email: 'ada@example.com',
    reason: 'general_enquiry',
    description: 'Hello, I have a question about SkillProof.',
    ...overrides,
  };
}

describe('ContactService', () => {
  it('sends to info@flairfuture.com with reply-to set to the submitter', async () => {
    const { service, emailProvider } = makeService();

    const res = await service.submit(validDto(), '1.1.1.1');

    expect(res).toEqual({ ok: true });
    expect(emailProvider.send).toHaveBeenCalledTimes(1);
    const params = emailProvider.send.mock.calls[0][0];
    expect(params.to).toBe('info@flairfuture.com');
    expect(params.replyTo).toBe('ada@example.com');
    expect(params.subject).toContain('General enquiry');
    expect(params.subject).toContain('Ada Lovelace');
    expect(params.html).toContain('ada@example.com');
  });

  it('escapes HTML in user input so the email body cannot be injected into', async () => {
    const { service, emailProvider } = makeService();

    await service.submit(
      validDto({ fullName: '<script>alert(1)</script>', description: 'a & b < c > d' }),
      '2.2.2.2',
    );

    const html = emailProvider.send.mock.calls[0][0].html as string;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b &lt; c &gt; d');
  });

  it('drops honeypot submissions silently (success response, no email sent)', async () => {
    const { service, emailProvider } = makeService();

    const res = await service.submit(validDto({ company: 'AcmeBot' }), '3.3.3.3');

    expect(res).toEqual({ ok: true }); // bot learns nothing
    expect(emailProvider.send).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only description as empty', async () => {
    const { service, emailProvider } = makeService();

    await expect(service.submit(validDto({ description: '   ' }), '4.4.4.4')).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
    expect(emailProvider.send).not.toHaveBeenCalled();
  });

  it('rate-limits: a second send from the same IP within the cooldown is 429', async () => {
    const { service, emailProvider } = makeService();

    await service.submit(validDto(), '5.5.5.5');
    await expect(service.submit(validDto(), '5.5.5.5')).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(emailProvider.send).toHaveBeenCalledTimes(1); // the blocked one never sent

    // A different IP is unaffected.
    await expect(service.submit(validDto(), '6.6.6.6')).resolves.toEqual({ ok: true });
  });

  it('surfaces a provider send failure as an error, not a false success', async () => {
    const { service, emailProvider } = makeService();
    emailProvider.send.mockRejectedValueOnce(new Error('Resend down'));

    await expect(service.submit(validDto(), '7.7.7.7')).rejects.toBeInstanceOf(HttpException);
  });
});
