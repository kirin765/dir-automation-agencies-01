/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  readonly GMAIL_CLIENT_ID?: string;
  readonly GMAIL_CLIENT_SECRET?: string;
  readonly GMAIL_REFRESH_TOKEN?: string;
  readonly GMAIL_USER_EMAIL?: string;
  readonly GMAIL_FROM_NAME?: string;
  readonly GMAIL_RATE_LIMIT_PER_MIN?: string;
  readonly GMAIL_DRYRUN?: string;
  readonly DEFAULT_EMAIL_SUBJECT?: string;
  readonly DEFAULT_EMAIL_BODY_TEMPLATE?: string;
}
