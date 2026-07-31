/**
 * Shared visual wrapper for every candidate notification email — a plain
 * header with the app name, the notification's own body markup untouched,
 * then a single CTA button linking back into the app. One helper so every
 * notification type gets the same look by construction, instead of each
 * call site hand-rolling its own layout/link markup.
 *
 * Deliberately old-school table + inline-style HTML (no <style> block, no
 * flexbox/grid) — this is what actually renders consistently across Gmail,
 * Outlook, and other email clients that strip <style> tags or ignore modern
 * CSS entirely.
 */
export interface NotificationCta {
  label: string;
  /** Absolute URL — build with WEB_BASE_URL, never a bare path. */
  url: string;
}

const BRAND_COLOR = '#5B4FE0'; // matches apps/web's --brand-600 / --indigo

export function renderNotificationEmail(bodyHtml: string, cta: NotificationCta): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:32px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#ffffff;border-radius:8px;font-family:Arial,Helvetica,sans-serif;">
        <tr>
          <td style="background-color:${BRAND_COLOR};padding:20px 32px;border-radius:8px 8px 0 0;">
            <span style="color:#ffffff;font-size:18px;font-weight:bold;">SkillProof</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;color:#1f2933;font-size:15px;line-height:1.5;">
            ${bodyHtml}
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
              <tr>
                <td align="center" style="border-radius:6px;background-color:${BRAND_COLOR};">
                  <a href="${cta.url}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">${cta.label}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim();
}
