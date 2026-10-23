# Workspace members

Settings → **Members** is where a workspace owner (or an admin) adds people to
their workspace, chooses which dashboard tabs each one can open, and issues the
credentials they sign in with.

## What happens when you add someone

1. A `users` row is created with a unique **username** and a **password**,
   stored only as a bcrypt hash.
2. A `profiles` row and a `workspace_members` row are created. The membership
   row is what attaches them to the workspace and records their module grant.
3. The credentials are emailed through the workspace's own email service.
4. The response returns the credentials **once** so the owner can pass them on
   directly. They are never retrievable afterwards.

The member signs in at `/auth` with **either** their username or their email
address.

### Generated or owner-chosen credentials

By default the username and password are generated: a 16-character password
from an unambiguous alphabet, and a handle derived from the member's name. The
member is prompted to replace a generated password on first arrival, and the
members list badges them **Temporary password** until they do.

Switching on *Set sign-in details myself* in the add dialog lets the owner type
both. A password the owner chose is the member's to keep — no replace-this
prompt, because the two of them agreed on it. Owner-typed handles are
restricted to lowercase letters, digits and `. _ -`, and may not contain `@`,
so a username can never be mistaken for an email at the sign-in prompt.

## Passwords after the first day

Three routes, all of which work:

| Who | How |
| --- | --- |
| The member | Settings → Security → change password, once signed in |
| The member, locked out | *Forgot password?* on `/auth`, using **username or email** |
| The owner or an admin | *Generate and send password* for a fresh random one, or *Set a new password* in the member dialog to type one |

Every one of these clears the temporary-password flag and invalidates any reset
link the member had in flight.

### Addresses that already have an account

An address that already belongs to a MaxForm workspace is refused, and the
existing account's password is never touched. Two reasons:

* Otherwise "add member" would be a password reset for any address someone
  could type.
* A signed-in account works in exactly one workspace — there is no switcher —
  so recording a second membership would have no visible effect. Refusing is
  better than a silent no-op.

## Module grants

The catalogue lives in [`src/lib/workspace-modules.ts`](../src/lib/workspace-modules.ts)
and is the single list both the server and the UI read. Adding a module to the
product means adding it there once.

* `allowed_modules IS NULL` means unrestricted. Owners and admins are always
  stored this way, whatever the picker shows.
* A non-empty array restricts the member to exactly those tabs.
* `home` and `settings` are always granted — the member has to be able to land
  somewhere and change their own password.

Grants are enforced in two places: the dashboard renders its rail from them and
redirects a disallowed `?tab=` to Home, and the server refuses workspace-level
settings writes for anyone who is not an owner or admin.

## How a member sees the owner's data

Every module in this product scopes rows by the workspace owner's user id
(`created_by = $userId`). [`server/workspace-access.ts`](../server/workspace-access.ts)
maps a signed-in account to the workspace it acts in, and each module's
`authenticatedUserId()` now returns that workspace id. For an owner the two ids
are identical, which is why the change is invisible to existing accounts.

Projects is the one module that needs both identities: ownership is a property
of the workspace, but *project scoping* is a property of the person. It carries
the acting account through an `AsyncLocalStorage` set once per request, so the
scope check and the row-level security policies see the individual while the
queries see the workspace.

## Roles

| Role | Tabs | Workspace settings | Members |
| --- | --- | --- | --- |
| Owner | All | Yes | Yes |
| Admin | All | Yes | Yes |
| Manager | As granted | No | No |
| Member | As granted | No | No |

## The controls, and what each one actually does

They are deliberately different in reach — reaching for the wrong one is the
usual way an administrative action does more damage than intended.

| Control | Reach | Reversible | Notes |
| --- | --- | --- | --- |
| **Suspend** | This workspace only | Yes | Signs in fine, sees a suspension banner and no tabs. |
| **Block** | The whole product | Yes | Sign-in refused, and live sessions are refused at their next request. |
| **Remove from workspace** | This workspace only | Re-add them | Membership deleted; the account survives. |
| **Delete account** | The account itself | **No** | Row destroyed. Offered only for accounts this workspace created. |

Two guards worth knowing:

* Block and Delete are refused for an account this workspace did **not**
  create. Borrowing someone's account into a workspace does not earn the right
  to end it.
* Nothing a member made is lost when they go. Everything is filed under the
  workspace owner's id, so deleting the account cascades away their profile and
  membership and nothing else.

## What a member can never reach

Workspace-level settings, in full. The Members, Currency and Billing sections
are absent from their sidebar, and the General section shows only their own
profile — the workspace identity and branding controls are not rendered for
them at all, rather than shown and refused on save. The server refuses the
writes independently (`403`), so a hand-made request gets the same answer as
the hidden button.

## Activity log

Every member row has **View activity log**, open to the owner and admins only.
It reads from `workspace_member_events`, which records:

* **Sign-ins** — so "when were they last here" has an answer. The members table
  surfaces the most recent one in its *Last active* column.
* **Administrative acts** — added, role changed, tab access changed, details
  changed, suspended, restored, blocked, unblocked, password set or generated,
  removed, account deleted. Each carries who did it.
* **Self-service** — a member changing their own password appears too, marked
  as theirs rather than an administrator's.

Passwords are never written to the trail; an add records only whether the
credentials were *generated* or *set by owner*.

Rows outlive the accounts they describe: `member_user_id` is `ON DELETE SET
NULL` and the member's email is denormalised into `member_label`, so deleting an
account does not erase the record of what was done to it.

## The emails, and where to edit them

Every membership message is a **workspace email template**, seeded under a
`members` module and editable in Email settings → Templates like any other.
Nothing is composed inline, so an owner can reword these without touching code.

| Template | Sent when |
| --- | --- |
| `member_credentials` | An account is provisioned, or an owner sets a password |
| `member_password_reset` | An owner generates a fresh password |
| `member_workspace_access` | An existing account is added to the workspace |
| `member_access_changed` | Role or tab access changes |
| `member_suspended` | Workspace access is paused |
| `member_removed` | Membership ends |

The password is a **send-time variable** (`{{member.password}}`), never stored
on the template or in the audit trail. `server/member-email-templates.test.ts`
pins the variable contract in both directions: the credentials templates must
carry the tokens `workspace-members.ts` supplies, and the messages that are not
about a password must not reference one.

A workspace with no active email provider cannot send these. The owner is told
so, and the generated credentials are shown once in the UI to be passed on by
hand — the member is created either way.

## Installing

Two migrations, both additive and re-runnable:

```bash
npm run members:install           # 100 — accounts, usernames, module grants
npm run members:install-admin     # 103 — blocking, provisioned flag, send audit
npm run members:install-activity  # 104 — the activity log
```

Migration 100 backfills a username for every existing account from their email
local part and ensures every account has an owner membership row for its own
workspace. Until it is applied, the Members screen cannot list anyone.

## Verifying

```bash
npm run smoke:members     # API level, no browser needed
npm run dev               # then, in another shell:
npm run smoke:members:ui  # browser level, drives the real screens
```

`smoke:members` drives the real HTTP handlers end to end against `DATABASE_URL`: provisions a
throwaway owner and member, signs the member in by both username and email,
asserts they land in the owner's workspace with exactly the granted tabs and no
workspace-admin rights, then exercises self-service password change, owner-set
password, suspend, block, duplicate-refusal and delete. Everything it creates is
removed in a `finally` block, including on failure.

`smoke:members:ui` drives Chromium through the screens themselves: the owner
fills in the real Add-member dialog, and the member it creates signs in through
the real form and is checked for a rail holding exactly the granted tabs, a
Settings sidebar with no workspace sections, and an activity log the owner can
open. It needs the dev server running, and honours `SMOKE_BASE_URL` if Vite
picked a port other than 8080.
