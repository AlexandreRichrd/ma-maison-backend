import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor() {
    this.transporter = process.env.SMTP_HOST
      ? nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT ?? 587),
          secure: Number(process.env.SMTP_PORT ?? 587) === 465,
          auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
        })
      : null;

    // The From address is always SMTP_USER, not a separately configurable
    // value — DMARC checks From against the authenticated sending mailbox,
    // so letting them drift apart (e.g. a leftover placeholder From while
    // SMTP_USER points at the real mailbox) is exactly what lands invites
    // in spam. Tying them together makes that mismatch impossible.
    this.from = process.env.SMTP_USER
      ? `"Hearth" <${process.env.SMTP_USER}>`
      : '"Hearth" <no-reply@hearth.local>';
  }

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
    await this.transporter.sendMail({ from: this.from, to, subject, text });
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

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const link = this.appUrl(`/reset-password?token=${token}`);
    await this.send(
      email,
      'Réinitialise ton mot de passe Hearth',
      `Une réinitialisation de mot de passe a été demandée pour ce compte.\n\nChoisis un nouveau mot de passe ici : ${link}\n\nCe lien expire dans 1 heure. Si tu n'es pas à l'origine de cette demande, ignore cet email.`,
    );
  }
}
