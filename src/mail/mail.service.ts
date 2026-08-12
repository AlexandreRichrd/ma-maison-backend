import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

const FROM = process.env.MAIL_FROM ?? 'Hearth <no-reply@hearth.local>';

@Injectable()
export class MailService {
  private readonly transporter: Transporter | null = process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      })
    : null;

  // SMTP is optional in development — without it, emails are logged instead
  // of sent, so the invite/activate flow can be exercised locally without
  // real mail infrastructure. Required in production (see .env.example).
  private async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.transporter) {
      console.log(
        `[mail] SMTP not configured — logging instead of sending.\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`,
      );
      return;
    }
    await this.transporter.sendMail({ from: FROM, to, subject, text });
  }

  private appUrl(path: string): string {
    const base = process.env.APP_URL ?? 'http://localhost:5173';
    return new URL(path, base).toString();
  }

  async sendInviteEmail(email: string, token: string): Promise<void> {
    const link = this.appUrl(`/register?token=${token}`);
    await this.send(
      email,
      'Invitation à rejoindre Hearth',
      `Tu as été invité·e à rejoindre le foyer sur Hearth.\n\nCrée ton compte ici : ${link}\n\nCe lien expire dans 7 jours.`,
    );
  }

  async sendActivationEmail(email: string, token: string): Promise<void> {
    const link = this.appUrl(`/activate?token=${token}`);
    await this.send(
      email,
      'Active ton compte Hearth',
      `Bienvenue sur Hearth ! Active ton compte pour pouvoir te connecter :\n\n${link}\n\nCe lien expire dans 24 heures.`,
    );
  }
}
