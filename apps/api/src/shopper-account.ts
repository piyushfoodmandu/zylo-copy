import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { QueryResultRow } from 'pg'
import type { Queryable } from './target-business-repository.ts'

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>

/**
 * scrypt is in Node's standard library, so account security does not depend on
 * a third-party hashing package staying maintained. The cost parameters are the
 * defaults' memory-hard end: 64 MiB per verification, which is cheap for one
 * login and expensive for a list of stolen hashes.
 */
const keyLength = 64
const saltBytes = 16

const maxFailedLogins = 8
const lockoutMinutes = 15

export class ShopperAccountError extends Error {
  readonly code:
    | 'account_email_invalid'
    | 'account_password_weak'
    | 'account_email_taken'
    | 'account_credentials_invalid'
    | 'account_locked'
    | 'account_not_found'
  readonly status: number

  constructor(
    code: ShopperAccountError['code'],
    message: string,
    status: number
  ) {
    super(message)
    this.name = 'ShopperAccountError'
    this.code = code
    this.status = status
  }
}

export type ShopperAccount = {
  accountId: string
  email: string
  displayName?: string
  createdAt: string
}

type AccountRow = QueryResultRow & {
  account_id: string
  email: string
  display_name: string | null
  password_salt: string | null
  password_hash: string | null
  created_at: Date
  failed_login_count: number
  locked_until: Date | null
}

// Deliberately permissive: an address that reaches a mailbox is the only thing
// that matters, and clever local-part rules reject real addresses.
const emailPattern = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/

export const normaliseEmail = (email: string) => email.trim().toLowerCase()

const assertEmail = (email: string) => {
  const trimmed = email.trim()
  if (!emailPattern.test(trimmed) || trimmed.length > 320) {
    throw new ShopperAccountError('account_email_invalid', 'Enter an email address Arro can reach.', 422)
  }
  return trimmed
}

/**
 * Length is the only requirement. Composition rules push people towards
 * `Passw0rd!` and away from long passphrases, which is the wrong trade.
 */
const assertPassword = (password: string) => {
  if (password.length < 10 || password.length > 512) {
    throw new ShopperAccountError(
      'account_password_weak',
      'Use a password of at least 10 characters.',
      422
    )
  }
  return password
}

const derive = async (password: string, salt: Buffer) => scrypt(password, salt, keyLength)

const toAccount = (row: AccountRow): ShopperAccount => ({
  accountId: row.account_id,
  email: row.email,
  ...(row.display_name ? { displayName: row.display_name } : {}),
  createdAt: row.created_at.toISOString()
})

export const createShopperAccounts = (database: Queryable) => ({
  async register(input: { email: string; password: string; displayName?: string }): Promise<ShopperAccount> {
    const email = assertEmail(input.email)
    const password = assertPassword(input.password)
    const normalized = normaliseEmail(email)
    const salt = randomBytes(saltBytes)
    const hash = await derive(password, salt)
    const accountId = `acct_${randomUUID()}`

    const result = await database.query<AccountRow>(
      `insert into shopper_accounts (
         account_id, email_normalized, email, password_salt, password_hash, display_name
       ) values ($1, $2, $3, $4, $5, $6)
       on conflict (email_normalized) do nothing
       returning account_id, email, display_name, password_salt, password_hash,
                 created_at, failed_login_count, locked_until`,
      [
        accountId,
        normalized,
        email,
        salt.toString('base64'),
        hash.toString('base64'),
        input.displayName?.trim() || null
      ]
    )

    const row = result.rows[0]
    if (!row) {
      // Registration is the one place an account's existence is unavoidably
      // observable — the address cannot be given to two people. Sign-in stays
      // uniform so it leaks nothing.
      throw new ShopperAccountError('account_email_taken', 'That email already has an Arro account.', 409)
    }
    return toAccount(row)
  },

  async authenticate(input: { email: string; password: string }): Promise<ShopperAccount> {
    const normalized = normaliseEmail(input.email)
    const result = await database.query<AccountRow>(
      `select account_id, email, display_name, password_salt, password_hash,
              created_at, failed_login_count, locked_until
         from shopper_accounts
        where email_normalized = $1`,
      [normalized]
    )
    const row = result.rows[0]

    if (row?.locked_until && row.locked_until.getTime() > Date.now()) {
      throw new ShopperAccountError(
        'account_locked',
        'Too many attempts. Try again in a few minutes.',
        429
      )
    }

    // The comparison runs even when no account exists, against a throwaway salt,
    // so a missing address and a wrong password cost the same wall-clock time
    // and cannot be told apart by timing. An account that only ever signed in
    // with a provider has no password and takes the same path.
    const salt = row?.password_salt ? Buffer.from(row.password_salt, 'base64') : randomBytes(saltBytes)
    const expected = row?.password_hash ? Buffer.from(row.password_hash, 'base64') : randomBytes(keyLength)
    const candidate = await derive(input.password, salt)
    const matched = Boolean(row?.password_hash) &&
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)

    if (!matched) {
      if (row) {
        await database.query(
          `update shopper_accounts
              set failed_login_count = failed_login_count + 1,
                  locked_until = case
                    when failed_login_count + 1 >= $2 then now() + ($3 || ' minutes')::interval
                    else locked_until
                  end,
                  updated_at = now()
            where account_id = $1`,
          [row.account_id, maxFailedLogins, String(lockoutMinutes)]
        )
      }
      throw new ShopperAccountError(
        'account_credentials_invalid',
        'That email and password do not match an Arro account.',
        401
      )
    }

    await database.query(
      `update shopper_accounts
          set failed_login_count = 0, locked_until = null, last_login_at = now(), updated_at = now()
        where account_id = $1`,
      [row!.account_id]
    )
    return toAccount(row!)
  },

  /**
   * Signs in through an identity provider, creating the account on first use.
   *
   * Matching is on the provider subject, not the email: an address can change
   * owner, a subject cannot. When the subject is new but the verified email
   * already belongs to an account, the identity is linked to it — that is the
   * same person arriving a second way, and refusing would strand them.
   */
  async signInWithIdentity(input: {
    provider: 'google' | 'apple'
    subject: string
    email?: string
    emailVerified: boolean
    name?: string
  }): Promise<ShopperAccount> {
    const linked = await database.query<AccountRow>(
      `select a.account_id, a.email, a.display_name, a.password_salt, a.password_hash,
              a.created_at, a.failed_login_count, a.locked_until
         from shopper_account_identities i
         join shopper_accounts a on a.account_id = i.account_id
        where i.provider = $1 and i.subject = $2`,
      [input.provider, input.subject]
    )
    if (linked.rows[0]) return toAccount(linked.rows[0])

    const email = input.email?.trim()
    if (email && input.emailVerified) {
      const existing = await database.query<AccountRow>(
        `select account_id, email, display_name, password_salt, password_hash,
                created_at, failed_login_count, locked_until
           from shopper_accounts where email_normalized = $1`,
        [normaliseEmail(email)]
      )
      const row = existing.rows[0]
      if (row) {
        await database.query(
          `insert into shopper_account_identities (provider, subject, account_id, email)
           values ($1, $2, $3, $4)
           on conflict (provider, subject) do nothing`,
          [input.provider, input.subject, row.account_id, email ?? null]
        )
        return toAccount(row)
      }
    }

    const accountId = `acct_${randomUUID()}`
    // A provider account with no address still needs a unique key, and the
    // subject is the only stable one available.
    const placeholder = email ?? `${input.provider}:${input.subject}`
    const created = await database.query<AccountRow>(
      `insert into shopper_accounts (account_id, email_normalized, email, display_name)
       values ($1, $2, $3, $4)
       returning account_id, email, display_name, password_salt, password_hash,
                 created_at, failed_login_count, locked_until`,
      [accountId, normaliseEmail(placeholder), placeholder, input.name?.trim() || null]
    )
    await database.query(
      `insert into shopper_account_identities (provider, subject, account_id, email)
       values ($1, $2, $3, $4)`,
      [input.provider, input.subject, accountId, email ?? null]
    )
    return toAccount(created.rows[0]!)
  },

  async read(accountId: string): Promise<ShopperAccount | undefined> {
    const result = await database.query<AccountRow>(
      `select account_id, email, display_name, password_salt, password_hash,
              created_at, failed_login_count, locked_until
         from shopper_accounts where account_id = $1`,
      [accountId]
    )
    const row = result.rows[0]
    return row ? toAccount(row) : undefined
  },

  /** Binds a signed session to an account so it can be revoked server-side. */
  async bindSession(input: { sessionId: string; accountId: string; expiresAt: string }) {
    await database.query(
      `insert into shopper_account_sessions (session_id, account_id, expires_at)
       values ($1, $2, $3)
       on conflict (session_id) do update
         set account_id = excluded.account_id,
             expires_at = excluded.expires_at,
             last_seen_at = now()`,
      [input.sessionId, input.accountId, input.expiresAt]
    )
  },

  async accountForSession(sessionId: string): Promise<ShopperAccount | undefined> {
    const result = await database.query<AccountRow>(
      `select a.account_id, a.email, a.display_name, a.password_salt, a.password_hash,
              a.created_at, a.failed_login_count, a.locked_until
         from shopper_account_sessions s
         join shopper_accounts a on a.account_id = s.account_id
        where s.session_id = $1 and s.expires_at > now()`,
      [sessionId]
    )
    const row = result.rows[0]
    return row ? toAccount(row) : undefined
  },

  async revokeSession(sessionId: string) {
    await database.query('delete from shopper_account_sessions where session_id = $1', [sessionId])
  }
})

export type ShopperAccounts = ReturnType<typeof createShopperAccounts>
