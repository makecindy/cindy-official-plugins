# Account selection and both SSO sources: requirements and gaps

[简体中文](test-environments-accounts.zh-CN.md)

On 2026-11-09 the user confirmed both sources are required: **an enterprise account
already signed in to daily Cindy, and enterprise SSO already signed in in the system
browser**. Email/phone and other real account methods enabled by Cindy must also be
addable/selectable. Track the complete requirement in #309; it is not all implemented in 1.2.1.

## Intended workflow

1. Choose a project.
2. Choose a saved account, or add another account.
3. Add through daily Cindy authorization, browser SSO, or Cindy's existing email/phone login.
4. Complete required consent, confirm the actual account, and start/continue testing.
5. Reuse its retained profile on subsequent runs; expired authorization must not silently fall back to another account.

SSO/email/phone are login methods, not necessarily distinct identities. Deduplicate
using application account keys, never inferred domains, organization kind or display
names. Distinct personal/organization membership keys remain separately selectable.
Passwords, verification codes and tokens never go into the plugin or AI conversation.

## Actual 1.2.1 behavior

| Entry | Current behavior | Remaining gap |
| --- | --- | --- |
| Saved target-profile accounts | Preselect next-run account or switch during a run; retain public keys | Real Host/account evidence; labels do not guarantee login-method identification |
| Email/phone addition | Manual login in the target app followed by public-reference discovery | No dedicated one-click Add account plugin entry; phone availability depends on region/service configuration |
| Existing browser SSO | Target Cindy's normal SSO flow opens its system browser, which may reuse an existing enterprise session | Selection/consent or reauthentication may still be required; real SSO integration unverified |
| Authorize from daily Cindy's saved account | **Not implemented**; discovery currently covers only the owned target instance | Complete public consent/target-bound independent-session authorization API missing |

Being on the same computer does not merge isolated account vaults. Do not mount daily
Cindy's vault into the target, remove isolation or copy credential files to imitate
authorization. B's browser is not A's browser; remote first-login link handoff remains unimplemented.

## Step-by-step current acceptance

1. Sign in as A in the target app, refresh plugin status; A should be discovered.
2. Stop, select A under Account for the next start, and start again; valid auth should reuse the same profile.
3. Add B through the target app's normal account UI, optionally using a different login method; refresh and check both accounts remain.
4. Switch to B and back to A in the plugin; actual target identity and data must follow.
5. If target Cindy offers SSO, use its enterprise login and complete system-browser consent.
   Check discovery/selection/restart. Browser passwordless success is not proof of daily-Cindy authorization.
6. If phone login is enabled, complete ordinary verification-code login and repeat discovery/selection/restart.
   An unavailable method is recorded as unavailable on this channel, never a fabricated pass.
7. Daily-Cindy-to-empty-test-profile authorization remains **not implemented**, even when browser SSO succeeds.

See [simple use](test-environments-simple.md) and [handoff](test-environments-handoff.en.md).
On macOS plugin references normally live in `~/Library/Application Support/Test Environments/catalog.json`.
An account's `sessions[profile-id].userDataDir` locates its target profile, whose `safe-storage/`
is application-owned. Check paths/directory existence only; do not open/decrypt/share credential files.

## Minimum daily-Cindy authorization contract (not implemented)

Reuse native account choice, consent, instance/device identity and the application vault.
The plugin orchestrates public references only.

- Target main creates a request bound to its own instance/device, realm, challenge, expiry and intended account; secrets remain in target main.
- Daily Cindy's native account chooser explicitly selects an account and confirms verifiable target details; do not silently authorize the active identity.
- Server verifies approver identity/target challenge and issues the target's own session with distinct allow/deny/expired outcomes, single redemption, replay protection and revocation.
- Target main redeems directly and persists through existing encrypted login completion. Plugin sees only request ID/status/public account summary.
- Cancellation, timeout or disconnection reads the original request; no automatic reapproval, redemption or identity fallback.

Reviewed auth-server routes expose normal code login, browser authorization-code/PKCE
redemption, refresh and account switching, but no directly reusable complete daily-Cindy
to isolated-target grant was found. This is not a claim that no related code exists.
Current Host accounts.settings has no exposed operations, and no corresponding public
plugin SDK entry was found. authBeginAddAccount initializes target login state; it does
not itself open the native add-account page or grant authorization. Establish the minimal
client/server contract and integration evidence before inventing endpoints.

This change records the confirmed requirement and gaps only. It changes no client/server,
authority or login entry. The 1.2.1 package/evidence remain unchanged; 134 automated checks
do not verify the missing capability or real enterprise SSO.
